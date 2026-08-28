// End-to-end verification of the bug fixes. Run against a THROWAWAY database:
//   $env:PORT=3100; $env:DB_PATH="$PWD\database\test_verify.db"; node backend/server.js
//   node tests/verify-fixes.js
const BASE = process.env.TEST_BASE || "http://localhost:3100";
const fs = require("fs");
const path = require("path");

function envValue(key){
  const content = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
  for(const line of content.split(/\r?\n/)){
    const index = line.indexOf("=");
    if(index > 0 && line.slice(0, index).trim() === key){
      return line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

async function api(method, urlPath, body, token){
  const headers = { "Content-Type": "application/json" };
  if(token){ headers.Authorization = `Bearer ${token}`; }
  const response = await fetch(`${BASE}${urlPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

let failures = 0;
function check(name, condition, detail){
  if(condition){ console.log(`PASS  ${name}`); }
  else{ failures += 1; console.error(`FAIL  ${name}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ""}`); }
}

// 1x1 transparent PNG
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

(async () => {
  for(let i = 0; i < 40; i++){
    try{ await api("GET", "/api/payment-config"); break; }
    catch(error){ await new Promise((resolve) => setTimeout(resolve, 500)); }
  }

  const login = await api("POST", "/api/admin/login", { username: "admin", password: envValue("ADMIN_PASSWORD") });
  check("admin login", login.status === 200 && !!login.json.token, login.json);
  const token = login.json.token;
  const auth = (method, urlPath, body) => api(method, urlPath, body, token);

  const category = await auth("POST", "/api/categories", { name: "VerifyFixCat" });
  check("create category", category.status === 201, category.json);

  const product = await auth("POST", "/api/products", {
    name: "VerifyFixProduct", categoryId: category.json.id, price: 10, description: "test",
    sizes: "S,M", stockBySize: "S:3,M:1", images: [TINY_PNG]
  });
  check("create product", product.status === 201, product.json);
  const productId = product.json.id;

  const stockOf = async () => {
    const row = await api("GET", `/api/products/${productId}`);
    return JSON.parse(row.json.stock_by_size || "{}").S;
  };

  const order = await api("POST", "/api/orders", {
    customerName: "Test", customerPhone: "0600000000", customerCity: "Rabat", customerAddress: "Street 1",
    paymentMethod: "cash", items: [{ productId, size: "S", quantity: 2 }]
  });
  check("place order", order.status === 201, order.json);
  const orderId = order.json.id;
  check("stock deducted 3 -> 1", (await stockOf()) === 1, await stockOf());

  const badStatus = await auth("PATCH", `/api/orders/${orderId}`, { paymentStatus: "hacked" });
  check("invalid payment status rejected", badStatus.status === 400, badStatus.json);

  const cancel = await auth("PATCH", `/api/orders/${orderId}`, { status: "cancelled" });
  check("cancel order", cancel.status === 200, cancel.json);
  check("stock restored on cancel 1 -> 3", (await stockOf()) === 3, await stockOf());

  const reactivate = await auth("PATCH", `/api/orders/${orderId}`, { status: "confirmed" });
  check("reactivate order", reactivate.status === 200, reactivate.json);
  check("stock re-deducted 3 -> 1", (await stockOf()) === 1, await stockOf());

  const del = await auth("DELETE", `/api/orders/${orderId}`);
  check("delete active order", del.status === 200, del.json);
  check("stock restored on delete 1 -> 3", (await stockOf()) === 3, await stockOf());

  const wildcard = await api("GET", `/api/products?search=${encodeURIComponent("%")}`);
  check("LIKE wildcards escaped", wildcard.json.length === 0, wildcard.json.length);
  const normal = await api("GET", `/api/products?search=${encodeURIComponent("VerifyFix")}`);
  check("normal search still works", normal.json.length === 1, normal.json.length);

  await auth("DELETE", `/api/products/${productId}`);
  await auth("DELETE", `/api/categories/${category.json.id}`);
  const remaining = await api("GET", "/api/products");
  check("cleanup", !remaining.json.some((item) => item.id === productId));

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL TESTS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error("TEST ERROR", error); process.exit(1); });
