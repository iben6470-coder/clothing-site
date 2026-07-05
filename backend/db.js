const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "database", "clothing_site.db");
const DB_DIR = path.dirname(DB_PATH);

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (err) => {
  if(err){
    console.error("Error opening database:", err.message);
  }else{
    console.log("Connected to SQLite database at:", DB_PATH);
  }
});

function run(query, params = []){
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err){
      if(err){ reject(err); }
      else{ resolve(this); }
    });
  });
}

function get(query, params = []){
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if(err){ reject(err); }
      else{ resolve(row); }
    });
  });
}

function all(query, params = []){
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if(err){ reject(err); }
      else{ resolve(rows); }
    });
  });
}

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
      sizes TEXT DEFAULT '[]',
      stock INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `);

  await addColumnIfMissing("products", "category_id", "INTEGER");
  await addColumnIfMissing("products", "sizes", "TEXT DEFAULT '[]'");
  await addColumnIfMissing("products", "is_active", "INTEGER DEFAULT 1");

  await run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      customer_notes TEXT,
      total_price REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);


  await addColumnIfMissing("orders", "user_id", "INTEGER");
  await addColumnIfMissing("orders", "customer_name", "TEXT");
  await addColumnIfMissing("orders", "customer_phone", "TEXT");
  await addColumnIfMissing("orders", "customer_address", "TEXT");
  await addColumnIfMissing("orders", "customer_notes", "TEXT");
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
    ["admin", "admin@fashion-store.local", "admin123", "admin"]
  );
}

const ready = initializeDatabase().catch((err) => {
  console.error("Database initialization failed:", err.message);
});

module.exports = { db, run, get, all, ready, DB_PATH };
