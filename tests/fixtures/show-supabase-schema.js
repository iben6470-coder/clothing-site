// Shows the schema created on Supabase and a sample of the migrated data.
// Usage: node tests/fixtures/show-supabase-schema.js "<connection string>"
const { Client } = require("pg");

const url = process.argv[2] || "";
if(!url){ console.error("Usage: node tests/fixtures/show-supabase-schema.js \"<connection string>\""); process.exit(1); }

(async () => {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const tables = await client.query(`
    SELECT table_name, column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const grouped = {};
  for(const row of tables.rows){
    (grouped[row.table_name] = grouped[row.table_name] || []).push(row);
  }
  for(const [table, columns] of Object.entries(grouped)){
    console.log(`\nTABLE ${table}:`);
    for(const column of columns){
      console.log(`  ${column.column_name}  ${column.data_type}${column.column_default ? `  DEFAULT ${column.column_default}` : ""}`);
    }
  }

  const products = await client.query("SELECT id, name, price, stock, audience, sizes, stock_by_size, image FROM products ORDER BY id");
  console.log("\nMIGRATED PRODUCTS:");
  for(const product of products.rows){
    console.log(`  #${product.id} ${product.name} | MAD ${product.price} | stock ${product.stock} | ${product.audience} | sizes ${product.sizes} | by-size ${product.stock_by_size}`);
  }
  const orders = await client.query("SELECT id, customer_name, status, total_price FROM orders ORDER BY id DESC LIMIT 5");
  console.log("\nLAST 5 MIGRATED ORDERS:");
  for(const order of orders.rows){
    console.log(`  #${order.id} ${order.customer_name} | ${order.status} | MAD ${order.total_price}`);
  }

  await client.end();
  process.exit(0);
})().catch((error) => { console.error("FAILED:", error.message); process.exit(1); });
