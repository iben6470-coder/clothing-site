// One-time migration: copy the local SQLite store into a Supabase Postgres database.
//
// Usage:
//   node scripts/migrate-to-supabase.js "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
// (or set DATABASE_URL in the environment instead of passing the URL)
//
// The script creates the schema on the target database (if missing), copies every
// table while keeping the original ids, and resets the id sequences so new rows
// continue after the migrated data.
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const target = String(process.argv[2] || process.env.DATABASE_URL || "").trim();
if(!target){
  console.error('Usage: node scripts/migrate-to-supabase.js "<supabase session-pooler connection string>"');
  process.exit(1);
}

process.env.DATABASE_URL = target;
const { ready, run, get, USE_POSTGRES } = require("../backend/db");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "database", "clothing_site.db");
const TABLES = ["categories", "products", "orders", "order_items", "product_reviews", "users", "cart"];

function readSqliteTable(table){
  return new Promise((resolve, reject) => {
    const sqlite = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (openError) => {
      if(openError){ reject(openError); return; }
      sqlite.all(`SELECT * FROM ${table}`, (error, rows) => {
        sqlite.close();
        if(error){ reject(error); } else { resolve(rows || []); }
      });
    });
  });
}

(async () => {
  if(!USE_POSTGRES){
    console.error("Postgres mode did not activate - check the connection string.");
    process.exit(1);
  }
  console.log("Connecting and creating schema on the Supabase database...");
  await ready;

  let totalRows = 0;
  for(const table of TABLES){
    let rows = [];
    try{
      rows = await readSqliteTable(table);
    }catch(error){
      console.log(`- ${table}: skipped (${error.message})`);
      continue;
    }
    if(!rows.length){
      console.log(`- ${table}: nothing to migrate`);
      continue;
    }

    let copied = 0;
    for(const row of rows){
      const columns = Object.keys(row);
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      const values = columns.map((column) => (row[column] === undefined ? null : row[column]));
      const quoted = columns.map((column) => `"${column}"`).join(", ");
      await run(`INSERT INTO ${table} (${quoted}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`, values);
      copied += 1;
    }

    const maxIdRow = await get(`SELECT COALESCE(MAX(id), 0) AS max_id FROM ${table}`);
    if(maxIdRow && Number(maxIdRow.max_id) > 0){
      try{
        await run(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), ${Number(maxIdRow.max_id)})`);
      }catch(sequenceError){
        console.warn(`  ! could not reset the id sequence for ${table}: ${sequenceError.message}`);
      }
    }
    totalRows += copied;
    console.log(`- ${table}: migrated ${copied} row(s)`);
  }

  const counts = {};
  for(const table of TABLES){
    const row = await get(`SELECT COUNT(*) AS count FROM ${table}`);
    counts[table] = Number(row ? row.count : 0);
  }
  console.log("\nRow counts on Supabase after migration:");
  for(const [table, count] of Object.entries(counts)){ console.log(`  ${table}: ${count}`); }
  console.log(`\nMigration finished. Copied ${totalRows} row(s) in total.`);
  process.exit(0);
})().catch((error) => {
  console.error("MIGRATION FAILED:", error.message);
  process.exit(1);
});
