// Quick post-cleanup sanity check of row counts on Supabase.
const { Client } = require("pg");

(async () => {
  const client = new Client({
    connectionString: "postgresql://postgres.ldwlxgeqytcfijhpibbo:rHSYddHcPvuE87Dx@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const result = await client.query(
    "SELECT (SELECT COUNT(*) FROM categories) AS categories, (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM order_items) AS order_items, (SELECT COUNT(*) FROM product_reviews) AS reviews, (SELECT COUNT(*) FROM products WHERE name LIKE 'VerifyFix%') AS leftover_test_rows"
  );
  const row = result.rows[0];
  console.log(`categories: ${row.categories} | products: ${row.products} | orders: ${row.orders} | order_items: ${row.order_items} | reviews: ${row.reviews} | leftover test rows: ${row.leftover_test_rows}`);
  await client.end();
  process.exit(0);
})().catch((error) => { console.error("FAILED:", error.message); process.exit(1); });
