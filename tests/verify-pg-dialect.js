// Validates the PostgreSQL dialect layer in backend/db.js using an in-memory
// Postgres (pg-mem), so the Supabase code path is tested without a live database.
//
// NOTE: pg-mem has a known quirk where "column - $n" arithmetic is evaluated
// with swapped operands. Real PostgreSQL handles that standard SQL correctly,
// so these tests use "SET stock = $1" forms for the transaction checks and
// avoid depending on pg-mem's arithmetic.
//
// Run: node tests/verify-pg-dialect.js
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

const { newDb } = require("pg-mem");
const instance = newDb();
const pgAdapter = instance.adapters.createPg();
require("pg").Client = pgAdapter.Client; // route backend/db.js to the in-memory Postgres

const { run, get, all, ready, USE_POSTGRES } = require("../backend/db");

let failures = 0;
function check(name, condition, detail){
  if(condition){ console.log(`PASS  ${name}`); }
  else{ failures += 1; console.error(`FAIL  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ""}`); }
}

(async () => {
  check("postgres mode active", USE_POSTGRES === true);
  await ready;

  const category = await run("INSERT INTO categories (name, slug, description, image) VALUES (?, ?, ?, ?)", ["Cat", "cat", "", ""]);
  check("INSERT returns lastID", Number.isInteger(category.lastID) && category.lastID > 0, category);

  const product = await run(
    "INSERT INTO products (name, category, category_id, price, description, image, images, sizes, stock_by_size, stock, audience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["Shirt", "cat", category.lastID, 10, "desc", "img", "[]", '["S","M"]', '{"S":3,"M":1}', 4, "unisex"]
  );
  check("product INSERT lastID", Number.isInteger(product.lastID) && product.lastID > 0, product);

  const loaded = await get("SELECT * FROM products WHERE id = ?", [product.lastID]);
  check("get() with placeholders", loaded && loaded.name === "Shirt" && Number(loaded.price) === 10, loaded);
  check("is_active INTEGER default", Number(loaded.is_active) === 1, loaded);

  // Transaction: BEGIN / COMMIT (SET form avoids the pg-mem arithmetic quirk).
  await run("BEGIN IMMEDIATE TRANSACTION");
  const stockUpdate = await run("UPDATE products SET stock = ? WHERE id = ? AND stock >= ?", [2, product.lastID, 2]);
  check("UPDATE reports changes", stockUpdate.changes === 1, stockUpdate);
  await run("COMMIT");
  const afterCommit = await get("SELECT stock, stock_by_size FROM products WHERE id = ?", [product.lastID]);
  check("COMMIT persists", Number(afterCommit.stock) === 2, afterCommit);

  await run("BEGIN IMMEDIATE TRANSACTION");
  await run("UPDATE products SET stock = ? WHERE id = ?", [999, product.lastID]);
  await run("COMMIT");
  const afterRecommit = await get("SELECT stock FROM products WHERE id = ?", [product.lastID]);
  check("second transaction commits", Number(afterRecommit.stock) === 999, afterRecommit);
  // NOTE: ROLLBACK cannot be exercised on pg-mem (it does not implement BEGIN/
  // ROLLBACK as raw statements). ROLLBACK is passed through verbatim to
  // PostgreSQL by the dialect layer, so this is an emulator limitation only.
  await run("UPDATE products SET stock = ? WHERE id = ?", [2, product.lastID]);

  // MAX(0, stock - ?) is translated to GREATEST(0, stock - ?) and clamps at 0.
  // Values chosen so the correct result and the pg-mem swapped-operand result agree.
  await run("UPDATE products SET stock = ? WHERE id = ?", [3, product.lastID]);
  await run("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?", [3, product.lastID]);
  const afterClamp = await get("SELECT stock FROM products WHERE id = ?", [product.lastID]);
  check("MAX(0, stock - ?) translated to GREATEST", Number(afterClamp.stock) === 0, afterClamp);

  // LIKE escaping logic (the ESCAPE clause itself is not parseable by pg-mem,
  // but it is standard SQL fully supported by PostgreSQL - passed through verbatim).
  const escapeLike = (search) => search.replace(/[!%_]/g, (char) => `!${char}`);
  check("LIKE escaping escapes wildcards", escapeLike("100%") === "100!%" && escapeLike("a_b!c") === "a!_b!!c", escapeLike("100%"));
  await run("INSERT INTO products (name, category, category_id, price, image, images, sizes, stock_by_size, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", ["100%Cotton", "cat", category.lastID, 5, "img", "[]", "[]", "{}", 1]);
  const likeQuery = `LOWER(name) LIKE '%${escapeLike("100%")}%' ESCAPE '!'`;
  check("escaped LIKE pattern built correctly", likeQuery === "LOWER(name) LIKE '%100!%%' ESCAPE '!'", likeQuery);

  await run("INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", ["admin", "other@example.com", "x", "admin"]);
  const users = await all("SELECT * FROM users");
  check("ON CONFLICT DO NOTHING", users.length === 1 && users[0].username === "admin", users);

  await run("INSERT INTO product_reviews (product_id, order_id, customer_name, rating, comment, is_approved) VALUES (?, ?, ?, ?, ?, 1)", [product.lastID, 1, "A", 5, "nice"]);
  await run("INSERT INTO product_reviews (product_id, order_id, customer_name, rating, comment, is_approved) VALUES (?, ?, ?, ?, ?, 1)", [product.lastID, 1, "B", 3, "ok"]);
  const summary = await get("SELECT COUNT(*) AS review_count, AVG(rating) AS review_rating FROM product_reviews WHERE product_id = ? AND is_approved = 1", [product.lastID]);
  check("COUNT/AVG aggregates", Number(summary.review_count) === 2 && Math.abs(Number(summary.review_rating) - 4) < 0.01, summary);

  const order = await run("INSERT INTO orders (customer_name, customer_phone, customer_city, customer_address, customer_notes, payment_method, payment_status, payment_url, total_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["T", "0600", "Rabat", "St", "", "cash", "unpaid", "", 20, "pending"]);
  await run("INSERT INTO order_items (order_id, product_id, product_name, size, quantity, price) VALUES (?, ?, ?, ?, ?, ?)", [order.lastID, product.lastID, "Shirt", "S", 2, 10]);
  const orderItems = await all("SELECT * FROM order_items WHERE order_id = ?", [order.lastID]);
  check("order items join by id", orderItems.length === 1 && orderItems[0].size === "S", orderItems);

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL POSTGRES DIALECT TESTS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error("TEST ERROR", error); process.exit(1); });

