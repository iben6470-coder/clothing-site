// Test fixture: preloads an in-memory Postgres (pg-mem) and routes the "pg"
// module to it, so scripts can be exercised without a live database.
// Usage: node --require ./tests/fixtures/pgmem-preload.js <script.js>
const { newDb } = require("pg-mem");
const instance = newDb();
require("pg").Client = instance.adapters.createPg().Client;

// pg-mem implements very few native functions; stub the sequence helpers used
// by scripts/migrate-to-supabase.js (real PostgreSQL has them built in).
try{
  instance.public.registerFunction({ name: "pg_get_serial_sequence", args: ["text", "text"], returns: "text", implementation: () => null });
  instance.public.registerFunction({ name: "setval", args: ["text", "bigint"], returns: "bigint", implementation: () => 0 });
}catch(error){
  console.warn("pg-mem function stubs could not be registered:", error.message);
}

module.exports = instance;

