// Quick Supabase connectivity test.
// Usage: node tests/fixtures/test-supabase-connection.js "<connection string>"
const { Client } = require("pg");

const url = process.argv[2] || "";
if(!url){ console.error("Usage: node tests/fixtures/test-supabase-connection.js \"<connection string>\""); process.exit(1); }

(async () => {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const version = await client.query("SELECT version() AS v");
  console.log("CONNECTED:", String(version.rows[0].v).split(",")[0]);
  const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
  console.log("Existing public tables:", tables.rows.length ? tables.rows.map((row) => row.table_name).join(", ") : "(none yet)");
  await client.end();
  process.exit(0);
})().catch((error) => {
  console.error("CONNECTION FAILED:", error.message);
  process.exit(1);
});
