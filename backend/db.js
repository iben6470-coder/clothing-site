const path = require("path");
const fs = require("fs");

//
// Dual-mode database layer:
//  - Supabase / PostgreSQL mode when DATABASE_URL (or SUPABASE_DATABASE_URL) is set.
//  - Local SQLite mode otherwise (development fallback, same behavior as before).
//
const DATABASE_URL = String(process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL || "").trim();
const USE_POSTGRES = !!DATABASE_URL;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "database", "clothing_site.db");

let db, run, get, all, ready;

if(USE_POSTGRES){
  //
  // PostgreSQL (Supabase) mode.
  // A single dedicated Client is used (not a Pool) so queries stay serialized the
  // way SQLite serialized them - this keeps the BEGIN/COMMIT transactions in
  // server.js correct and the stock logic race-free.
  //
  const { Client } = require("pg");
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/i.test(DATABASE_URL);
  const sslDisabled = /sslmode=disable/i.test(DATABASE_URL);
  db = new Client({
    connectionString: DATABASE_URL,
    ssl: (!isLocalDb && !sslDisabled) ? { rejectUnauthorized: false } : undefined
  });

  // Translate the few SQLite dialect bits used by server.js into Postgres SQL,
  // and convert SQLite-style "?" placeholders into Postgres "$n" placeholders.
  function toPostgresSql(query){
    let text = String(query);
    text = text.replace(/BEGIN\s+IMMEDIATE\s+TRANSACTION/i, "BEGIN");
    text = text.replace(/MAX\(\s*0\s*,\s*stock\s*-\s*\?/gi, "GREATEST(0, stock - ?");
    let index = 0;
    text = text.replace(/\?/g, () => `$${++index}`);
    return text;
  }

  function toPgValues(params){
    return (params || []).map((value) => (value === undefined ? null : value));
  }

  run = async (query, params = []) => {
    let text = toPostgresSql(query);
    if(/^\s*INSERT\b/i.test(text) && !/\bRETURNING\b/i.test(text)){
      text += " RETURNING id";
    }
    const result = await db.query(text, toPgValues(params));
    const lastID = result.rows && result.rows[0] && result.rows[0].id !== undefined ? Number(result.rows[0].id) : undefined;
    return { lastID, changes: result.rowCount || 0 };
  };

  get = async (query, params = []) => {
    const result = await db.query(toPostgresSql(query), toPgValues(params));
    return result.rows[0] || undefined;
  };

  all = async (query, params = []) => {
    const result = await db.query(toPostgresSql(query), toPgValues(params));
    return result.rows;
  };

  // A fresh Supabase database gets the complete schema, so no column upgrades
  // are needed here (those only exist for old local SQLite databases).
  async function initializePostgres(){
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        image TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        category_id INTEGER,
        price REAL NOT NULL,
        description TEXT,
        image TEXT,
        images TEXT DEFAULT '[]',
        sizes TEXT DEFAULT '[]',
        stock_by_size TEXT DEFAULT '{}',
        stock INTEGER DEFAULT 0,
        audience TEXT DEFAULT 'unisex',
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        customer_name TEXT,
        customer_phone TEXT,
        customer_city TEXT,
        customer_address TEXT,
        customer_notes TEXT,
        payment_method TEXT DEFAULT 'cash',
        payment_status TEXT DEFAULT 'unpaid',
        payment_url TEXT,
        total_price REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        product_id INTEGER,
        product_name TEXT,
        size TEXT,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        order_id INTEGER NOT NULL,
        customer_name TEXT,
        customer_phone TEXT,
        rating INTEGER DEFAULT 5,
        comment TEXT,
        image TEXT,
        is_approved INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS cart (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        product_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query(
      "INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      ["admin", "admin@fashion-store.local", "env-managed", "admin"]
    );
  }

  ready = (async () => {
    await db.connect();
    await initializePostgres();
    console.log("Connected to PostgreSQL database (Supabase).");
  })().catch((err) => {
    console.error("PostgreSQL connection/initialization failed:", err.message);
  });

}else{

  //
  // SQLite mode (local development fallback).
  //
  const sqlite3 = require("sqlite3").verbose();

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new sqlite3.Database(DB_PATH, (err) => {
    if(err){
      console.error("Error opening database:", err.message);
    }else{
      console.log("Connected to SQLite database at:", DB_PATH);
    }
  });

  run = function(query, params = []){
    return new Promise((resolve, reject) => {
      db.run(query, params, function(err){
        if(err){ reject(err); }
        else{ resolve(this); }
      });
    });
  };

  get = function(query, params = []){
    return new Promise((resolve, reject) => {
      db.get(query, params, (err, row) => {
        if(err){ reject(err); }
        else{ resolve(row); }
      });
    });
  };

  all = function(query, params = []){
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if(err){ reject(err); }
        else{ resolve(rows); }
      });
    });
  };

  async function columnExists(table, column){
    const columns = await all(`PRAGMA table_info(${table})`);
    return columns.some((item) => item.name === column);
  }

  async function addColumnIfMissing(table, column, definition){
    if(!(await columnExists(table, column))){
      await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  async function initializeDatabase(){
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await addColumnIfMissing("users", "role", "TEXT DEFAULT 'admin'");

    await run(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        image TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT,
        category_id INTEGER,
        price REAL NOT NULL,
        description TEXT,
        image TEXT,
        images TEXT DEFAULT '[]',
        sizes TEXT DEFAULT '[]',
        stock_by_size TEXT DEFAULT '{}',
        stock INTEGER DEFAULT 0,
        audience TEXT DEFAULT 'unisex',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )
    `);

    await addColumnIfMissing("products", "category_id", "INTEGER");
    await addColumnIfMissing("products", "sizes", "TEXT DEFAULT '[]'");
    await addColumnIfMissing("products", "stock_by_size", "TEXT DEFAULT '{}'");
    await addColumnIfMissing("products", "images", "TEXT DEFAULT '[]'");
    await addColumnIfMissing("products", "is_active", "INTEGER DEFAULT 1");
    await addColumnIfMissing("products", "audience", "TEXT DEFAULT 'unisex'");


    await run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        customer_name TEXT,
        customer_phone TEXT,
        customer_city TEXT,
        customer_address TEXT,
        customer_notes TEXT,
        payment_method TEXT DEFAULT 'cash',
        payment_status TEXT DEFAULT 'unpaid',
        payment_url TEXT,
        total_price REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await addColumnIfMissing("orders", "user_id", "INTEGER");
    await addColumnIfMissing("orders", "customer_name", "TEXT");
    await addColumnIfMissing("orders", "customer_phone", "TEXT");
    await addColumnIfMissing("orders", "customer_city", "TEXT");
    await addColumnIfMissing("orders", "customer_address", "TEXT");
    await addColumnIfMissing("orders", "customer_notes", "TEXT");
    await addColumnIfMissing("orders", "payment_method", "TEXT DEFAULT 'cash'");
    await addColumnIfMissing("orders", "payment_status", "TEXT DEFAULT 'unpaid'");
    await addColumnIfMissing("orders", "payment_url", "TEXT");
    await addColumnIfMissing("orders", "total_price", "REAL DEFAULT 0");
    await addColumnIfMissing("orders", "status", "TEXT DEFAULT 'pending'");
    await addColumnIfMissing("orders", "created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP");
    await run(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER,
        product_name TEXT,
        size TEXT,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    await addColumnIfMissing("order_items", "order_id", "INTEGER");
    await addColumnIfMissing("order_items", "product_id", "INTEGER");
    await addColumnIfMissing("order_items", "product_name", "TEXT");
    await addColumnIfMissing("order_items", "size", "TEXT");
    await addColumnIfMissing("order_items", "quantity", "INTEGER DEFAULT 1");
    await addColumnIfMissing("order_items", "price", "REAL DEFAULT 0");
    await run(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        order_id INTEGER NOT NULL,
        customer_name TEXT,
        customer_phone TEXT,
        rating INTEGER DEFAULT 5,
        comment TEXT,
        image TEXT,
        is_approved INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      )
    `);

    await addColumnIfMissing("product_reviews", "product_id", "INTEGER");
    await addColumnIfMissing("product_reviews", "order_id", "INTEGER");
    await addColumnIfMissing("product_reviews", "customer_name", "TEXT");
    await addColumnIfMissing("product_reviews", "customer_phone", "TEXT");
    await addColumnIfMissing("product_reviews", "rating", "INTEGER DEFAULT 5");
    await addColumnIfMissing("product_reviews", "comment", "TEXT");
    await addColumnIfMissing("product_reviews", "image", "TEXT");
    await addColumnIfMissing("product_reviews", "is_approved", "INTEGER DEFAULT 0");
    await addColumnIfMissing("product_reviews", "created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP");
    await run(`
      CREATE TABLE IF NOT EXISTS cart (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        product_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    await run(
      "INSERT OR IGNORE INTO users (username, email, password, role) VALUES (?, ?, ?, ?)",
      ["admin", "admin@fashion-store.local", "env-managed", "admin"]
    );
  }

  ready = initializeDatabase().catch((err) => {
    console.error("Database initialization failed:", err.message);
  });
}

module.exports = { db, run, get, all, ready, DB_PATH, USE_POSTGRES };

