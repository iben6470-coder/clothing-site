const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { run, get, all, ready, DB_PATH } = require("./db");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "storage", "uploads");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.createHash("sha256").update(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}:${DB_PATH}`).digest("hex");
const ORDER_STATUSES = new Set(["pending", "confirmed", "preparing", "delivered", "cancelled"]);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function corsHeaders(){
  return {
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type, x-admin-auth"
  };
}

function sendJson(res, status, data){
  res.writeHead(status, Object.assign({ "Content-Type":"application/json; charset=utf-8" }, corsHeaders()));
  res.end(JSON.stringify(data));
}

function verifyAdmin(req){
  return (req.headers["x-admin-auth"] || "") === ADMIN_TOKEN;
}

function slugify(value){
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readBody(req){
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if(body.length > 20 * 1024 * 1024){
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req){
  try{ return JSON.parse((await readBody(req)) || "{}"); }
  catch(error){ throw new Error("Invalid JSON body"); }
}

function saveImage(dataUrl, prefix){
  const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(dataUrl || "");
  if(!match){ throw new Error("Invalid image format"); }

  const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const filename = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(match[3], "base64"));
  return `uploads/${filename}`;
}

function deleteUploadedImage(image){
  if(image && image.startsWith("uploads/")){
    const imagePath = path.join(UPLOAD_DIR, path.basename(image));
    if(fs.existsSync(imagePath)){ fs.unlinkSync(imagePath); }
  }
}

function parseSizes(value){
  if(Array.isArray(value)){ return value.map(String).map((item) => item.trim()).filter(Boolean); }
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizePhone(phone){
  return String(phone || "").replace(/[^0-9+]/g, "").trim();
}

function whatsappUrl(phone, message){
  let normalized = normalizePhone(phone);
  if(normalized.startsWith("0")){ normalized = `212${normalized.slice(1)}`; }
  normalized = normalized.replace(/^\+/, "");
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

function staticFilePath(requestPath){
  if(requestPath === "/"){ return path.join(ROOT, "index.html"); }
  if(requestPath.startsWith("/uploads/")){ return path.join(UPLOAD_DIR, path.basename(requestPath)); }
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(ROOT, safePath);
}

function serveStatic(req, res){
  const requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const filePath = staticFilePath(requestPath);

  if(!filePath.startsWith(ROOT) && !filePath.startsWith(UPLOAD_DIR)){
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if(error){
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function orderWithItems(orderId){
  const order = await get("SELECT * FROM orders WHERE id = ?", [orderId]);
  if(!order){ return null; }
  order.items = await all("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC", [orderId]);
  order.whatsapp_url = whatsappUrl(order.customer_phone, confirmationMessage(order));
  return order;
}

function confirmationMessage(order){
  return [
    `Salam ${order.customer_name}, your Fashion Store order #${order.id} is confirmed.`,
    `Total: MAD ${order.total_price}`,
    "We will contact you soon for delivery details."
  ].join("\n");
}

async function handleAdmin(req, res, url){
  if(req.method === "POST" && url.pathname === "/api/admin/login"){
    const payload = await readJson(req);
    const username = String(payload.username || "").trim();
    const password = String(payload.password || "");
    if(username === ADMIN_USERNAME && password === ADMIN_PASSWORD){
      sendJson(res, 200, { ok:true, token:ADMIN_TOKEN, username:ADMIN_USERNAME });
    }else{
      sendJson(res, 401, { error:"Wrong username or password" });
    }
    return true;
  }
  return false;
}

async function handleCategories(req, res, url){
  if(req.method === "GET" && url.pathname === "/api/categories"){
    const categories = await all("SELECT * FROM categories WHERE is_active = 1 ORDER BY created_at DESC, id DESC");
    sendJson(res, 200, categories);
    return true;
  }

  if(req.method === "POST" && url.pathname === "/api/categories"){
    if(!verifyAdmin(req)){ sendJson(res, 401, { error:"Unauthorized - Admin access required" }); return true; }

    const payload = await readJson(req);
    const name = String(payload.name || "").trim();
    const slug = slugify(payload.slug || name);
    const description = String(payload.description || "").trim();

    if(!name || !slug){ sendJson(res, 400, { error:"Category name is required" }); return true; }
    if(await get("SELECT id FROM categories WHERE slug = ?", [slug])){ sendJson(res, 409, { error:"Category slug already exists" }); return true; }

    const image = payload.image ? saveImage(payload.image, "category") : "";
    const result = await run("INSERT INTO categories (name, slug, description, image) VALUES (?, ?, ?, ?)", [name, slug, description, image]);
    sendJson(res, 201, await get("SELECT * FROM categories WHERE id = ?", [result.lastID]));
    return true;
  }

  if(req.method === "PATCH" && url.pathname.startsWith("/api/categories/")){
    if(!verifyAdmin(req)){ sendJson(res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const id = url.pathname.split("/").pop();
    const category = await get("SELECT * FROM categories WHERE id = ?", [id]);
    if(!category){ sendJson(res, 404, { error:"Category not found" }); return true; }
    const payload = await readJson(req);
    const name = String(payload.name || category.name).trim();
    const slug = slugify(payload.slug || name);
    const description = String(payload.description ?? category.description ?? "").trim();
    if(!name || !slug){ sendJson(res, 400, { error:"Category name is required" }); return true; }
    const duplicate = await get("SELECT id FROM categories WHERE slug = ? AND id != ?", [slug, id]);
    if(duplicate){ sendJson(res, 409, { error:"Category slug already exists" }); return true; }
    let image = category.image || "";
    if(payload.image){ deleteUploadedImage(image); image = saveImage(payload.image, "category"); }
    await run("UPDATE categories SET name = ?, slug = ?, description = ?, image = ? WHERE id = ?", [name, slug, description, image, id]);
    await run("UPDATE products SET category = ? WHERE category_id = ?", [slug, id]);
    sendJson(res, 200, await get("SELECT * FROM categories WHERE id = ?", [id]));
    return true;
  }
  if(req.method === "DELETE" && url.pathname.startsWith("/api/categories/")){
    if(!verifyAdmin(req)){ sendJson(res, 401, { error:"Unauthorized - Admin access required" }); return true; }

    const id = url.pathname.split("/").pop();
    const category = await get("SELECT * FROM categories WHERE id = ?", [id]);
    if(!category){ sendJson(res, 404, { error:"Category not found" }); return true; }

    const products = await all("SELECT image FROM products WHERE category_id = ?", [id]);
    for(const product of products){ deleteUploadedImage(product.image); }
    await run("DELETE FROM products WHERE category_id = ?", [id]);
    await run("DELETE FROM categories WHERE id = ?", [id]);
    deleteUploadedImage(category.image);
    sendJson(res, 200, { ok:true });
    return true;
  }

  return false;
}

async function handleProducts(req, res, url){
  if(req.method === "GET" && url.pathname === "/api/products"){
    const params = [];
    let where = "WHERE p.is_active = 1";
    const category = url.searchParams.get("category");

    if(category){ where += " AND c.slug = ?"; params.push(category); }

    const products = await all(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${where}
      ORDER BY p.created_at DESC, p.id DESC
    `, params);
    sendJson(res, 200, products);
    return true;
  }

  if(req.method === "POST" && url.pathname === "/api/products"){
    if(!verifyAdmin(req)){ sendJson(res, 401, { error:"Unauthorized - Admin access required" }); return true; }

    const payload = await readJson(req);
    const name = String(payload.name || "").trim();
    const price = Number(payload.price);
    const description = String(payload.description || "").trim();
    const stock = Number(payload.stock || 0);
    const categoryId = Number(payload.categoryId || payload.category_id);
    const sizes = parseSizes(payload.sizes);

    if(!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(categoryId) || categoryId <= 0){
      sendJson(res, 400, { error:"Name, price, and category are required" });
      return true;
    }

    const category = await get("SELECT * FROM categories WHERE id = ?", [categoryId]);
    if(!category){ sendJson(res, 400, { error:"Category does not exist" }); return true; }
    if(!payload.image){ sendJson(res, 400, { error:"Product image is required" }); return true; }

    const image = saveImage(payload.image, "product");
    const result = await run(
      "INSERT INTO products (name, category, category_id, price, description, image, sizes, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [name, category.slug, categoryId, price, description, image, JSON.stringify(sizes), Number.isFinite(stock) ? stock : 0]
    );
    sendJson(res, 201, await get("SELECT * FROM products WHERE id = ?", [result.lastID]));
    return true;
  }

  if(req.method === "PATCH" && url.pathname.startsWith("/api/products/")){
    if(!verifyAdmin(req)){ sendJson(res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const id = url.pathname.split("/").pop();
    const product = await get("SELECT * FROM products WHERE id = ?", [id]);
    if(!product){ sendJson(res, 404, { error:"Product not found" }); return true; }
    const payload = await readJson(req);
    const name = String(payload.name || product.name).trim();
    const price = Number(payload.price ?? product.price);
    const description = String(payload.description ?? product.description ?? "").trim();
    const stock = Number(payload.stock ?? product.stock ?? 0);
    const categoryId = Number(payload.categoryId || payload.category_id || product.category_id);
    const sizes = parseSizes(payload.sizes ?? product.sizes);
    if(!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(categoryId) || categoryId <= 0){
      sendJson(res, 400, { error:"Name, price, and category are required" });
      return true;
    }
    const category = await get("SELECT * FROM categories WHERE id = ?", [categoryId]);
    if(!category){ sendJson(res, 400, { error:"Category does not exist" }); return true; }
    let image = product.image || "";
    if(payload.image){ deleteUploadedImage(image); image = saveImage(payload.image, "product"); }
    await run(
      "UPDATE products SET name = ?, category = ?, category_id = ?, price = ?, description = ?, image = ?, sizes = ?, stock = ? WHERE id = ?",
      [name, category.slug, categoryId, price, description, image, JSON.stringify(sizes), Number.isFinite(stock) ? stock : 0, id]
    );
    sendJson(res, 200, await get("SELECT * FROM products WHERE id = ?", [id]));
    return true;
  }
  if(req.method === "DELETE" && url.pathname.startsWith("/api/products/")){
    if(!verifyAdmin(req)){ sendJson(res, 401, { error:"Unauthorized - Admin access required" }); return true; }

    const id = url.pathname.split("/").pop();
    const product = await get("SELECT * FROM products WHERE id = ?", [id]);
    if(product){
      await run("DELETE FROM products WHERE id = ?", [id]);
      deleteUploadedImage(product.image);
    }
    sendJson(res, 200, { ok:true });
    return true;
  }

  return false;
}

async function handleOrders(req, res, url){
  if(req.method === "POST" && url.pathname === "/api/orders"){
    const payload = await readJson(req);
    const customerName = String(payload.customerName || payload.customer_name || "").trim();
    const customerPhone = normalizePhone(payload.customerPhone || payload.customer_phone);
    const customerAddress = String(payload.customerAddress || payload.customer_address || "").trim();
    const customerNotes = String(payload.customerNotes || payload.customer_notes || "").trim();
    const items = Array.isArray(payload.items) ? payload.items : [];

    if(!customerName || !customerPhone || !customerAddress || !items.length){
      sendJson(res, 400, { error:"Name, phone, address, and cart items are required" });
      return true;
    }

    const preparedItems = [];
    let total = 0;
    for(const item of items){
      const quantity = Math.max(1, Number(item.quantity || 1));
      const productId = Number(item.productId || item.product_id || item.id);
      let product = null;
      if(Number.isFinite(productId) && productId > 0){
        product = await get("SELECT * FROM products WHERE id = ? AND is_active = 1", [productId]);
      }
      const productName = product ? product.name : String(item.name || "Product").trim();
      const price = product ? Number(product.price) : Number(item.price || 0);
      const size = String(item.size || "").trim();
      if(!productName || !Number.isFinite(price) || price <= 0){ continue; }
      preparedItems.push({ productId: product ? product.id : 0, productName, size, quantity, price });
      total += price * quantity;
    }

    if(!preparedItems.length){ sendJson(res, 400, { error:"Your cart has no valid products" }); return true; }

    const result = await run(
      "INSERT INTO orders (customer_name, customer_phone, customer_address, customer_notes, total_price, status) VALUES (?, ?, ?, ?, ?, ?)",
      [customerName, customerPhone, customerAddress, customerNotes, total, "pending"]
    );

    for(const item of preparedItems){
      await run(
        "INSERT INTO order_items (order_id, product_id, product_name, size, quantity, price) VALUES (?, ?, ?, ?, ?, ?)",
        [result.lastID, item.productId, item.productName, item.size, item.quantity, item.price]
      );
    }

    sendJson(res, 201, await orderWithItems(result.lastID));
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/orders"){
    if(!verifyAdmin(req)){ sendJson(res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const status = url.searchParams.get("status");
    const params = [];
    let where = "";
    if(status && ORDER_STATUSES.has(status)){ where = "WHERE status = ?"; params.push(status); }
    const orders = await all(`SELECT * FROM orders ${where} ORDER BY created_at DESC, id DESC`, params);
    for(const order of orders){
      order.items = await all("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC", [order.id]);
      order.whatsapp_url = whatsappUrl(order.customer_phone, confirmationMessage(order));
    }
    sendJson(res, 200, orders);
    return true;
  }

  if(req.method === "PATCH" && url.pathname.startsWith("/api/orders/")){
    if(!verifyAdmin(req)){ sendJson(res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const id = url.pathname.split("/").pop();
    const payload = await readJson(req);
    const status = String(payload.status || "").trim();
    if(!ORDER_STATUSES.has(status)){ sendJson(res, 400, { error:"Invalid order status" }); return true; }
    const existing = await get("SELECT * FROM orders WHERE id = ?", [id]);
    if(!existing){ sendJson(res, 404, { error:"Order not found" }); return true; }
    await run("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
    sendJson(res, 200, await orderWithItems(id));
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  if(req.method === "OPTIONS"){
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  await ready;
  const url = new URL(req.url, `http://${req.headers.host}`);

  try{
    if(await handleAdmin(req, res, url)){ return; }
    if(await handleCategories(req, res, url)){ return; }
    if(await handleProducts(req, res, url)){ return; }
    if(await handleOrders(req, res, url)){ return; }
    serveStatic(req, res);
  }catch(error){
    sendJson(res, 500, { error:error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Fashion Store running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Uploads: ${UPLOAD_DIR}`);
});