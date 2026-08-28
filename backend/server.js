const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadLocalEnv(){
  const envPath = path.join(__dirname, "..", ".env");
  if(!fs.existsSync(envPath)){ return; }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for(const line of lines){
    const trimmed = line.trim();
    if(!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")){ continue; }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if(key && process.env[key] === undefined){ process.env[key] = value; }
  }
}

loadLocalEnv();

const { run, get, all, ready, DB_PATH } = require("./db");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "storage", "uploads");
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEFAULT_ADMIN_PASSWORD = "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const ADMIN_TOKEN_TTL_MS = Number(process.env.ADMIN_TOKEN_TTL_MS || 8 * 60 * 60 * 1000);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 20 * 1024 * 1024);
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 5 * 1024 * 1024);
const CARD_PAYMENT_URL = String(process.env.CARD_PAYMENT_URL || "").trim();
const ALLOWED_ORIGINS = new Set(String(process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500").split(",").map((item) => item.trim()).filter(Boolean));
const ORDER_STATUSES = new Set(["pending", "confirmed", "preparing", "delivered", "cancelled"]);
const PAYMENT_STATUSES = new Set(["unpaid", "pending_card_payment", "card_link_needed", "paid", "refunded"]);
const PAYMENT_METHODS = new Set(["cash", "card"]);
const PRODUCT_AUDIENCES = new Set(["unisex", "men", "women"]);
const loginAttempts = new Map();
const publicWriteAttempts = new Map();


// Periodically purge expired rate-limit entries so the maps cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for(const [key, entry] of loginAttempts){ if(entry.resetAt < now){ loginAttempts.delete(key); } }
  for(const [key, entry] of publicWriteAttempts){ if(entry.resetAt < now){ publicWriteAttempts.delete(key); } }
}, 60 * 60 * 1000).unref();

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if(!ADMIN_PASSWORD){
  console.error("SECURITY ERROR: set ADMIN_PASSWORD in .env or environment variables before opening the admin panel.");
  process.exit(1);
}
if(!process.env.ADMIN_SECRET){
  console.error("SECURITY ERROR: set ADMIN_SECRET in .env or environment variables so admin sessions are stable and private.");
  process.exit(1);
}

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

function corsHeaders(req){
  const origin = req?.headers?.origin || "";
  const headers = {
    "Access-Control-Allow-Methods":"GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type, x-admin-auth, Authorization",
    "Vary":"Origin"
  };
  if(origin && ALLOWED_ORIGINS.has(origin)){ headers["Access-Control-Allow-Origin"] = origin; }
  return headers;
}

function securityHeaders(req, extra = {}){
  return Object.assign({
    "X-Content-Type-Options":"nosniff",
    "X-Frame-Options":"DENY",
    "Referrer-Policy":"strict-origin-when-cross-origin",
    "Permissions-Policy":"camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":"default-src 'self'; img-src 'self' data: https:; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:; connect-src 'self' http://localhost:3000 http://127.0.0.1:3000; form-action 'self' https://formspree.io; frame-ancestors 'none'; base-uri 'self'"
  }, corsHeaders(req), extra);
}

function sendJson(req, res, status, data){
  res.writeHead(status, securityHeaders(req, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" }));
  res.end(JSON.stringify(data));
}

function base64url(value){
  return Buffer.from(value).toString("base64url");
}

function safeEqual(a, b){
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if(left.length !== right.length){ return false; }
  return crypto.timingSafeEqual(left, right);
}

function signTokenPayload(payload){
  return crypto.createHmac("sha256", ADMIN_SECRET).update(payload).digest("base64url");
}

function createAdminToken(){
  const payload = base64url(JSON.stringify({ sub:ADMIN_USERNAME, exp:Date.now() + ADMIN_TOKEN_TTL_MS, nonce:crypto.randomBytes(12).toString("hex") }));
  return `${payload}.${signTokenPayload(payload)}`;
}

function verifyAdmin(req){
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : (req.headers["x-admin-auth"] || "");
  const parts = String(token).split(".");
  if(parts.length !== 2){ return false; }
  const expected = signTokenPayload(parts[0]);
  if(!safeEqual(parts[1], expected)){ return false; }
  try{
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return payload.sub === ADMIN_USERNAME && Number(payload.exp || 0) > Date.now();
  }catch(error){ return false; }
}

function clientIp(req){
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  const parts = forwarded.split(",").map((item) => item.trim()).filter(Boolean);
  // The LAST entry is the one appended by our own proxy (Render/Netlify) and is the
  // only trustworthy hop. Earlier entries are client-controlled and spoofable, so
  // using them would let attackers rotate their identity and bypass rate limits.
  if(parts.length){ return parts[parts.length - 1]; }
  return String(req.socket.remoteAddress || "local");
}

function loginBlocked(req){
  const key = clientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if(!entry || entry.resetAt < now){ loginAttempts.delete(key); return false; }
  return entry.count >= 5;
}

function recordLoginFailure(req){
  const key = clientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(key) || { count:0, resetAt:now + 15 * 60 * 1000 };
  entry.count += 1;
  entry.resetAt = entry.resetAt < now ? now + 15 * 60 * 1000 : entry.resetAt;
  loginAttempts.set(key, entry);
}

function clearLoginFailures(req){
  loginAttempts.delete(clientIp(req));
}

function rateLimited(store, key, maxRequests, windowMs){
  const now = Date.now();
  const entry = store.get(key);
  if(!entry || entry.resetAt < now){
    store.set(key, { count:1, resetAt:now + windowMs });
    return false;
  }
  entry.count += 1;
  store.set(key, entry);
  return entry.count > maxRequests;
}

function publicWriteBlocked(req, scope, maxRequests = 20, windowMs = 10 * 60 * 1000){
  return rateLimited(publicWriteAttempts, scope + ":" + clientIp(req), maxRequests, windowMs);
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
      if(body.length > MAX_BODY_BYTES){
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

  const imageBuffer = Buffer.from(match[3], "base64");
  if(imageBuffer.length > MAX_IMAGE_BYTES){ throw new Error("Image is too large. Maximum size is 5MB."); }
  const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), imageBuffer);
  return `uploads/${filename}`;
}

function saveImages(images, prefix){
  if(!Array.isArray(images)){ return []; }
  return images.filter(Boolean).map((image) => saveImage(image, prefix));
}

function parseImageList(value, fallback = ""){
  let items = [];
  if(Array.isArray(value)){ items = value; }
  else{
    try{ items = JSON.parse(value || "[]"); }
    catch(error){ items = []; }
  }
  if(!Array.isArray(items)){ items = []; }
  if(fallback && !items.includes(fallback)){ items.unshift(fallback); }
  return items.filter(Boolean);
}

function deleteUploadedImages(images){
  parseImageList(images).forEach(deleteUploadedImage);
}

function normalizeAudience(value){
  const audience = String(value || "unisex").trim().toLowerCase();
  return PRODUCT_AUDIENCES.has(audience) ? audience : "unisex";
}

function normalizeProduct(row){
  if(!row){ return row; }
  const images = parseImageList(row.images, row.image);
  const stockBySize = parseStockBySize(row.stock_by_size);
  row.images = JSON.stringify(images);
  row.image = images[0] || row.image || "";
  row.audience = normalizeAudience(row.audience);
  row.stock_by_size = JSON.stringify(stockBySize);
  row.stock = stockTotal(stockBySize, row.stock);
  return row;
}async function attachReviewSummary(product){
  const summary = await get(
    "SELECT COUNT(*) AS review_count, AVG(rating) AS review_rating FROM product_reviews WHERE product_id = ? AND is_approved = 1",
    [product.id]
  );
  const photos = await all(
    "SELECT image FROM product_reviews WHERE product_id = ? AND is_approved = 1 AND image IS NOT NULL AND image != '' ORDER BY created_at DESC, id DESC LIMIT 4",
    [product.id]
  );
  product.review_count = Number(summary?.review_count || 0);
  product.review_rating = summary?.review_rating ? Number(summary.review_rating).toFixed(1) : "";
  product.review_photos = JSON.stringify(photos.map((item) => item.image).filter(Boolean));
  return product;
}

function deleteUploadedImage(image){
  if(image && image.startsWith("uploads/")){
    const imagePath = path.join(UPLOAD_DIR, path.basename(image));
    if(fs.existsSync(imagePath)){ fs.unlinkSync(imagePath); }
  }
}

function parseSizes(value){
  if(Array.isArray(value)){ return value.map(String).map((item) => item.trim()).filter(Boolean); }
  const text = String(value || "").trim();
  if(!text){ return []; }
  try{
    const parsed = JSON.parse(text);
    if(Array.isArray(parsed)){ return parsed.map(String).map((item) => item.trim()).filter(Boolean); }
  }catch(error){
    // Fall back to comma-separated admin input.
  }
  return text.split(",").map((item) => item.trim().replace(/^['\"]|['\"]$/g, "")).filter(Boolean);
}


function normalizeSize(value){ return String(value || "").trim().toUpperCase(); }

function parseStockBySize(value){
  let raw = value;
  if(typeof raw === "string"){
    const text = raw.trim();
    if(!text){ return {}; }
    try{ raw = JSON.parse(text); }
    catch(error){
      const map = {};
      text.split(",").forEach((entry) => {
        const parts = entry.split(":");
        if(parts.length < 2){ return; }
        const size = normalizeSize(parts[0]);
        const quantity = Math.max(0, Math.floor(Number(parts.slice(1).join(":").trim())));
        if(size && Number.isFinite(quantity)){ map[size] = quantity; }
      });
      return map;
    }
  }
  if(!raw || typeof raw !== "object" || Array.isArray(raw)){ return {}; }
  return Object.keys(raw).reduce((map, key) => {
    const size = normalizeSize(key);
    const quantity = Math.max(0, Math.floor(Number(raw[key] || 0)));
    if(size && Number.isFinite(quantity)){ map[size] = quantity; }
    return map;
  }, {});
}

function stockTotal(stockBySize, fallback = 0){
  const map = parseStockBySize(stockBySize);
  const values = Object.values(map);
  if(values.length){ return values.reduce((sum, value) => sum + Number(value || 0), 0); }
  return Math.max(0, Math.floor(Number(fallback || 0)));
}

function sizeListFromProduct(product){
  const sizes = parseSizes(product?.sizes);
  const mapSizes = Object.keys(parseStockBySize(product?.stock_by_size));
  return Array.from(new Set(sizes.concat(mapSizes).map(normalizeSize).filter(Boolean)));
}

function normalizePhone(phone){
  return String(phone || "").replace(/[^0-9+]/g, "").trim();
}

function phoneKey(phone){
  let normalized = normalizePhone(phone).replace(/^\+/, "");
  if(normalized.startsWith("0")){ normalized = `212${normalized.slice(1)}`; }
  return normalized;
}

function whatsappUrl(phone, message){
  let normalized = normalizePhone(phone);
  if(normalized.startsWith("0")){ normalized = `212${normalized.slice(1)}`; }
  normalized = normalized.replace(/^\+/, "");
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
function paymentUrlForOrder(order){
  if(!order || order.payment_method !== "card" || !CARD_PAYMENT_URL){ return ""; }
  try{
    const paymentUrl = new URL(CARD_PAYMENT_URL);
    paymentUrl.searchParams.set("order", order.id);
    paymentUrl.searchParams.set("amount", order.total_price);
    paymentUrl.searchParams.set("currency", "MAD");
    return paymentUrl.toString();
  }catch(error){
    return CARD_PAYMENT_URL;
  }
}

const PUBLIC_ROOT_FILES = new Set([
  "index.html", "category.html", "men.html", "women.html", "cart.html", "track.html",
  "support.html", "admin.html", "payment.html", "policies.html", "product.html", "404.html",
  "robots.txt", "sitemap.xml", "favicon.ico"
]);

function isInsidePath(base, target){
  const relative = path.relative(base, target);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function staticFilePath(requestPath){
  if(requestPath === "/"){ return path.join(ROOT, "index.html"); }
  if(!requestPath || requestPath.includes("\0") || requestPath.includes("..")){ return null; }

  if(requestPath.startsWith("/uploads/")){
    const uploadPath = path.resolve(UPLOAD_DIR, path.basename(requestPath));
    return isInsidePath(UPLOAD_DIR, uploadPath) ? uploadPath : null;
  }

  if(requestPath.startsWith("/assets/")){
    const assetRoot = path.join(ROOT, "assets");
    const assetPath = path.resolve(ROOT, "." + requestPath);
    return isInsidePath(assetRoot, assetPath) ? assetPath : null;
  }

  const rootFile = requestPath.replace(/^\/+/, "");
  if(PUBLIC_ROOT_FILES.has(rootFile)){ return path.join(ROOT, rootFile); }
  return null;
}

function serveStatic(req, res){
  let requestPath = "/";
  try{
    requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  }catch(error){
    res.writeHead(400, securityHeaders(req, { "Content-Type":"text/plain; charset=utf-8" }));
    res.end("Bad request");
    return;
  }

  const filePath = staticFilePath(requestPath);
  if(!filePath){
    res.writeHead(404, securityHeaders(req, { "Content-Type":"text/plain; charset=utf-8" }));
    res.end("Not found");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if(error){
      const fallback404 = path.join(ROOT, "404.html");
      if(requestPath !== "/404.html" && fs.existsSync(fallback404)){
        fs.readFile(fallback404, (notFoundError, notFoundContent) => {
          res.writeHead(404, securityHeaders(req, { "Content-Type":"text/html; charset=utf-8" }));
          res.end(notFoundError ? "Not found" : notFoundContent);
        });
        return;
      }
      res.writeHead(404, securityHeaders(req, { "Content-Type":"text/plain; charset=utf-8" }));
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, securityHeaders(req, { "Content-Type": mimeTypes[ext] || "application/octet-stream" }));
    res.end(content);
  });
}

async function orderWithItems(orderId){
  const order = await get("SELECT * FROM orders WHERE id = ?", [orderId]);
  if(!order){ return null; }
  order.items = await all("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC", [orderId]);
  order.payment_url = order.payment_url || paymentUrlForOrder(order);
  order.whatsapp_url = whatsappUrl(order.customer_phone, confirmationMessage(order));
  return order;
}

function confirmationMessage(order){
  return [
    `Thank you ${order.customer_name} for trusting Fashion Store.`,
    `Your order #${order.id} has been received.`,
    `Total: MAD ${order.total_price}`,
    `Payment: ${order.payment_method === "card" ? "Bank card" : "Cash / WhatsApp"}`,
    "We will contact you soon to confirm delivery."
  ].join("\n");
}

function restoreOrderStock(order){
  return deductRestoreOrderStock(order, +1);
}

function deductOrderStock(order){
  return deductRestoreOrderStock(order, -1);
}

async function deductRestoreOrderStock(order, direction){
  for(const item of (order.items || [])){
    const product = await get("SELECT id, stock, stock_by_size FROM products WHERE id = ?", [item.product_id]);
    if(!product){ continue; }
    const quantity = Number(item.quantity || 0);
    const map = parseStockBySize(product.stock_by_size);
    if(item.size && Object.keys(map).length){
      const sizeKey = normalizeSize(item.size);
      map[sizeKey] = Math.max(0, Number(map[sizeKey] || 0) + direction * quantity);
      await run("UPDATE products SET stock_by_size = ?, stock = ? WHERE id = ?", [JSON.stringify(map), stockTotal(map, product.stock), product.id]);
    }else{
      await run(direction > 0
        ? "UPDATE products SET stock = stock + ? WHERE id = ?"
        : "UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?",
        [quantity, product.id]);
    }
  }
}


async function handlePaymentConfig(req, res, url){
  if(req.method === "GET" && url.pathname === "/api/payment-config"){
    sendJson(req, res, 200, { cardEnabled:!!CARD_PAYMENT_URL });
    return true;
  }
  return false;
}
function csvEscape(value){
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendCsv(req, res, filename, rows){
  res.writeHead(200, securityHeaders(req, {
    "Content-Type":"text/csv; charset=utf-8",
    "Content-Disposition":`attachment; filename="${filename}"`,
    "Cache-Control":"no-store"
  }));
  res.end(rows.map((row) => row.map(csvEscape).join(",")).join("\n"));
}

async function handleAdmin(req, res, url){
  if(req.method === "GET" && url.pathname === "/api/admin/backup"){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const categories = await all("SELECT * FROM categories ORDER BY id ASC");
    const products = await all("SELECT * FROM products ORDER BY id ASC");
    const orders = await all("SELECT * FROM orders ORDER BY id ASC");
    const orderItems = await all("SELECT * FROM order_items ORDER BY order_id ASC, id ASC");
    const reviews = await all("SELECT * FROM product_reviews ORDER BY id ASC");
    sendJson(req, res, 200, { exported_at:new Date().toISOString(), categories, products:products.map(normalizeProduct), orders, order_items:orderItems, reviews });
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/export/products"){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const products = (await all("SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.id ASC")).map(normalizeProduct);
    sendCsv(req, res, "products.csv", [["id", "name", "category", "audience", "price", "stock", "sizes", "stock_by_size", "created_at"], ...products.map((product) => [product.id, product.name, product.category_name || product.category, product.audience, product.price, product.stock, parseSizes(product.sizes).join(" | "), product.stock_by_size, product.created_at])]);
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/export/orders"){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const orders = await all("SELECT * FROM orders ORDER BY created_at DESC, id DESC");
    const rows = [["id", "name", "phone", "city", "address", "items", "payment_method", "payment_status", "order_status", "total", "created_at"]];
    for(const order of orders){
      const items = await all("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC", [order.id]);
      rows.push([order.id, order.customer_name, order.customer_phone, order.customer_city || "", order.customer_address, items.map((item) => `${item.product_name}${item.size ? ` / ${item.size}` : ""} x${item.quantity}`).join(" | "), order.payment_method, order.payment_status, order.status, order.total_price, order.created_at]);
    }
    sendCsv(req, res, "orders.csv", rows);
    return true;
  }

  if(req.method === "POST" && url.pathname === "/api/admin/login"){
    if(loginBlocked(req)){
      sendJson(req, res, 429, { error:"Too many login attempts. Try again later." });
      return true;
    }
    const payload = await readJson(req);
    const username = String(payload.username || "").trim();
    const password = String(payload.password || "");
    if(safeEqual(username, ADMIN_USERNAME) && safeEqual(password, ADMIN_PASSWORD)){
      clearLoginFailures(req);
      sendJson(req, res, 200, { ok:true, token:createAdminToken(), username:ADMIN_USERNAME, expiresIn:ADMIN_TOKEN_TTL_MS });
    }else{
      recordLoginFailure(req);
      sendJson(req, res, 401, { error:"Wrong username or password" });
    }
    return true;
  }
  return false;
}

async function handleCategories(req, res, url){
  if(req.method === "GET" && url.pathname === "/api/categories"){
    const categories = await all("SELECT * FROM categories WHERE is_active = 1 ORDER BY created_at DESC, id DESC");
    sendJson(req, res, 200, categories);
    return true;
  }

  if(req.method === "POST" && url.pathname === "/api/categories"){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }

    const payload = await readJson(req);
    const name = String(payload.name || "").trim();
    const slug = slugify(payload.slug || name);
    const description = String(payload.description || "").trim();

    if(!name || !slug){ sendJson(req, res, 400, { error:"Category name is required" }); return true; }
    if(await get("SELECT id FROM categories WHERE slug = ?", [slug])){ sendJson(req, res, 409, { error:"Category slug already exists" }); return true; }

    const image = payload.image ? saveImage(payload.image, "category") : "";
    const result = await run("INSERT INTO categories (name, slug, description, image) VALUES (?, ?, ?, ?)", [name, slug, description, image]);
    sendJson(req, res, 201, await get("SELECT * FROM categories WHERE id = ?", [result.lastID]));
    return true;
  }

  if(req.method === "PATCH" && url.pathname.startsWith("/api/categories/")){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const id = url.pathname.split("/").pop();
    const category = await get("SELECT * FROM categories WHERE id = ?", [id]);
    if(!category){ sendJson(req, res, 404, { error:"Category not found" }); return true; }
    const payload = await readJson(req);
    const name = String(payload.name || category.name).trim();
    const slug = slugify(payload.slug || name);
    const description = String(payload.description ?? category.description ?? "").trim();
    if(!name || !slug){ sendJson(req, res, 400, { error:"Category name is required" }); return true; }
    const duplicate = await get("SELECT id FROM categories WHERE slug = ? AND id != ?", [slug, id]);
    if(duplicate){ sendJson(req, res, 409, { error:"Category slug already exists" }); return true; }
    let image = category.image || "";
    if(payload.image){ deleteUploadedImage(image); image = saveImage(payload.image, "category"); }
    await run("UPDATE categories SET name = ?, slug = ?, description = ?, image = ? WHERE id = ?", [name, slug, description, image, id]);
    await run("UPDATE products SET category = ? WHERE category_id = ?", [slug, id]);
    sendJson(req, res, 200, await get("SELECT * FROM categories WHERE id = ?", [id]));
    return true;
  }
  if(req.method === "DELETE" && url.pathname.startsWith("/api/categories/")){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }

    const id = url.pathname.split("/").pop();
    const category = await get("SELECT * FROM categories WHERE id = ?", [id]);
    if(!category){ sendJson(req, res, 404, { error:"Category not found" }); return true; }

    const products = await all("SELECT image, images FROM products WHERE category_id = ?", [id]);
    for(const product of products){ deleteUploadedImages(parseImageList(product.images, product.image)); }
    await run("DELETE FROM products WHERE category_id = ?", [id]);
    await run("DELETE FROM categories WHERE id = ?", [id]);
    deleteUploadedImage(category.image);
    sendJson(req, res, 200, { ok:true });
    return true;
  }

  return false;
}

async function handleProducts(req, res, url){
  if(req.method === "GET" && url.pathname === "/api/products"){
    const params = [];
    let where = "WHERE p.is_active = 1";
    const category = url.searchParams.get("category");
    const search = String(url.searchParams.get("search") || "").trim().toLowerCase();
    const sort = String(url.searchParams.get("sort") || "newest").trim();
    const rawAudience = String(url.searchParams.get("audience") || "").trim().toLowerCase();
    const audience = PRODUCT_AUDIENCES.has(rawAudience) ? rawAudience : "";

    if(category){ where += " AND c.slug = ?"; params.push(category); }
    if(audience === "men" || audience === "women"){ where += " AND LOWER(COALESCE(p.audience, 'unisex')) IN (?, 'unisex')"; params.push(audience); }
    else if(audience === "unisex"){ where += " AND LOWER(COALESCE(p.audience, 'unisex')) = ?"; params.push(audience); }
    if(search){
      const escaped = search.replace(/[\\%_]/g, (char) => `\\${char}`);
      where += " AND (LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(p.description, '')) LIKE ? ESCAPE '\\')";
      params.push(`%${escaped}%`, `%${escaped}%`);
    }

    const orderBy = {
      "price-asc":"p.price ASC, p.created_at DESC, p.id DESC",
      "price-desc":"p.price DESC, p.created_at DESC, p.id DESC",
      "stock":"p.stock DESC, p.created_at DESC, p.id DESC",
      "newest":"p.created_at DESC, p.id DESC"
    }[sort] || "p.created_at DESC, p.id DESC";

    const products = await all(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${where}
      ORDER BY ${orderBy}
    `, params);
    const normalizedProducts = [];
    for(const product of products){
      normalizedProducts.push(await attachReviewSummary(normalizeProduct(product)));
    }
    sendJson(req, res, 200, normalizedProducts);
    return true;
  }

  if(req.method === "GET" && url.pathname.startsWith("/api/products/")){
    const id = Number(url.pathname.split("/").pop());
    if(!Number.isFinite(id) || id <= 0){ sendJson(req, res, 400, { error:"Product is required" }); return true; }
    const product = await get(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ? AND p.is_active = 1
    `, [id]);
    if(!product){ sendJson(req, res, 404, { error:"Product not found" }); return true; }
    sendJson(req, res, 200, await attachReviewSummary(normalizeProduct(product)));
    return true;
  }

  if(req.method === "POST" && url.pathname === "/api/products"){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }

    const payload = await readJson(req);
    const name = String(payload.name || "").trim();
    const price = Number(payload.price);
    const description = String(payload.description || "").trim();
    const stockBySize = parseStockBySize(payload.stockBySize || payload.stock_by_size);
    const stock = Object.keys(stockBySize).length ? stockTotal(stockBySize, 0) : Number(payload.stock || 0);
    const categoryId = Number(payload.categoryId || payload.category_id);
    const sizes = Array.from(new Set(parseSizes(payload.sizes).concat(Object.keys(stockBySize)).map(normalizeSize).filter(Boolean)));
    const audience = normalizeAudience(payload.audience);

    if(!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(categoryId) || categoryId <= 0){
      sendJson(req, res, 400, { error:"Name, price, and category are required" });
      return true;
    }

    const category = await get("SELECT * FROM categories WHERE id = ?", [categoryId]);
    if(!category){ sendJson(req, res, 400, { error:"Category does not exist" }); return true; }
    const incomingImages = Array.isArray(payload.images) && payload.images.length ? payload.images : (payload.image ? [payload.image] : []);
    if(!incomingImages.length){ sendJson(req, res, 400, { error:"At least one product image is required" }); return true; }

    const images = saveImages(incomingImages, "product");
    const image = images[0] || "";
    const result = await run(
      "INSERT INTO products (name, category, category_id, price, description, image, images, sizes, stock_by_size, stock, audience) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [name, category.slug, categoryId, price, description, image, JSON.stringify(images), JSON.stringify(sizes), JSON.stringify(stockBySize), Number.isFinite(stock) ? stock : 0, audience]
    );
    sendJson(req, res, 201, normalizeProduct(await get("SELECT * FROM products WHERE id = ?", [result.lastID])));
    return true;
  }

  if(req.method === "PATCH" && url.pathname.startsWith("/api/products/")){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const id = url.pathname.split("/").pop();
    const product = await get("SELECT * FROM products WHERE id = ?", [id]);
    if(!product){ sendJson(req, res, 404, { error:"Product not found" }); return true; }
    const payload = await readJson(req);
    const name = String(payload.name || product.name).trim();
    const price = Number(payload.price ?? product.price);
    const description = String(payload.description ?? product.description ?? "").trim();
    const stockBySize = parseStockBySize(payload.stockBySize ?? payload.stock_by_size ?? product.stock_by_size);
    const stock = Object.keys(stockBySize).length ? stockTotal(stockBySize, 0) : Number(payload.stock ?? product.stock ?? 0);
    const categoryId = Number(payload.categoryId || payload.category_id || product.category_id);
    const sizes = Array.from(new Set(parseSizes(payload.sizes ?? product.sizes).concat(Object.keys(stockBySize)).map(normalizeSize).filter(Boolean)));
    const audience = normalizeAudience(payload.audience ?? product.audience);
    if(!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(categoryId) || categoryId <= 0){
      sendJson(req, res, 400, { error:"Name, price, and category are required" });
      return true;
    }
    const category = await get("SELECT * FROM categories WHERE id = ?", [categoryId]);
    if(!category){ sendJson(req, res, 400, { error:"Category does not exist" }); return true; }
    let images = parseImageList(product.images, product.image);
    if(Array.isArray(payload.images) && payload.images.length){
      deleteUploadedImages(images);
      images = saveImages(payload.images, "product");
    }else if(payload.image){
      deleteUploadedImages(images);
      images = saveImages([payload.image], "product");
    }
    const image = images[0] || "";
    await run(
      "UPDATE products SET name = ?, category = ?, category_id = ?, price = ?, description = ?, image = ?, images = ?, sizes = ?, stock_by_size = ?, stock = ?, audience = ? WHERE id = ?",
      [name, category.slug, categoryId, price, description, image, JSON.stringify(images), JSON.stringify(sizes), JSON.stringify(stockBySize), Number.isFinite(stock) ? stock : 0, audience, id]
    );
    sendJson(req, res, 200, normalizeProduct(await get("SELECT * FROM products WHERE id = ?", [id])));
    return true;
  }
  if(req.method === "DELETE" && url.pathname.startsWith("/api/products/")){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }

    const id = url.pathname.split("/").pop();
    const product = await get("SELECT * FROM products WHERE id = ?", [id]);
    if(product){
      await run("DELETE FROM products WHERE id = ?", [id]);
      deleteUploadedImages(parseImageList(product.images, product.image));
    }
    sendJson(req, res, 200, { ok:true });
    return true;
  }

  return false;
}

async function handleReviews(req, res, url){
  if(req.method === "GET" && url.pathname === "/api/reviews/admin"){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const reviews = await all(
      `SELECT r.id, r.product_id, r.order_id, r.customer_name, r.customer_phone, r.rating, r.comment, r.image, r.created_at,
              p.name AS product_name, p.image AS product_image
       FROM product_reviews r
       LEFT JOIN products p ON p.id = r.product_id
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 200`
    );
    sendJson(req, res, 200, reviews);
    return true;
  }

  if(req.method === "PATCH" && url.pathname.startsWith("/api/reviews/")){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const id = Number(url.pathname.split("/").pop());
    const payload = await readJson(req);
    const approved = payload.isApproved ?? payload.is_approved ?? 1;
    if(!Number.isFinite(id) || id <= 0){ sendJson(req, res, 400, { error:"Review is required" }); return true; }
    const review = await get("SELECT * FROM product_reviews WHERE id = ?", [id]);
    if(!review){ sendJson(req, res, 404, { error:"Comment not found" }); return true; }
    await run("UPDATE product_reviews SET is_approved = ? WHERE id = ?", [approved ? 1 : 0, id]);
    sendJson(req, res, 200, await get("SELECT * FROM product_reviews WHERE id = ?", [id]));
    return true;
  }

  if(req.method === "DELETE" && url.pathname.startsWith("/api/reviews/")){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const id = Number(url.pathname.split("/").pop());
    if(!Number.isFinite(id) || id <= 0){ sendJson(req, res, 400, { error:"Review is required" }); return true; }
    const review = await get("SELECT * FROM product_reviews WHERE id = ?", [id]);
    if(!review){ sendJson(req, res, 404, { error:"Comment not found" }); return true; }
    await run("DELETE FROM product_reviews WHERE id = ?", [id]);
    if(review.image){ deleteUploadedImage(review.image); }
    sendJson(req, res, 200, { ok:true });
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/reviews"){
    const productId = Number(url.searchParams.get("productId") || url.searchParams.get("product"));
    if(!Number.isFinite(productId) || productId <= 0){ sendJson(req, res, 400, { error:"Product is required" }); return true; }
    const reviews = await all(
      "SELECT id, product_id, order_id, customer_name, rating, comment, image, created_at FROM product_reviews WHERE product_id = ? AND is_approved = 1 ORDER BY created_at DESC, id DESC LIMIT 30",
      [productId]
    );
    sendJson(req, res, 200, reviews);
    return true;
  }

  if(req.method === "POST" && url.pathname === "/api/reviews"){
    if(publicWriteBlocked(req, "reviews", 10)){ sendJson(req, res, 429, { error:"Too many review attempts. Try again later." }); return true; }
    const payload = await readJson(req);
    const productId = Number(payload.productId || payload.product_id);
    const orderId = Number(payload.orderId || payload.order_id);
    const phone = payload.phone || payload.customerPhone || payload.customer_phone || "";
    const rating = Math.max(1, Math.min(5, Math.floor(Number(payload.rating || 5))));
    const comment = String(payload.comment || "").trim().slice(0, 800);
    if(!Number.isFinite(productId) || productId <= 0 || !Number.isFinite(orderId) || orderId <= 0 || !phone){
      sendJson(req, res, 400, { error:"Order, product, and phone are required" });
      return true;
    }
    if(!comment && !payload.image){
      sendJson(req, res, 400, { error:"Write a comment or add a photo" });
      return true;
    }
    const order = await orderWithItems(orderId);
    if(!order || phoneKey(order.customer_phone) !== phoneKey(phone)){
      sendJson(req, res, 404, { error:"Order not found for this phone" });
      return true;
    }
    const boughtItem = (order.items || []).find((item) => Number(item.product_id) === productId);
    if(!boughtItem){
      sendJson(req, res, 400, { error:"You can review only products from your order" });
      return true;
    }
    let image = "";
    if(payload.image){ image = saveImage(payload.image, "review"); }
    const existing = await get("SELECT * FROM product_reviews WHERE product_id = ? AND order_id = ? AND customer_phone = ?", [productId, orderId, order.customer_phone]);
    if(existing){
      if(existing.image && image){ deleteUploadedImage(existing.image); }
      await run(
        "UPDATE product_reviews SET customer_name = ?, rating = ?, comment = ?, image = COALESCE(NULLIF(?, ''), image), is_approved = 0, created_at = CURRENT_TIMESTAMP WHERE id = ?",
        [order.customer_name, rating, comment, image, existing.id]
      );
      sendJson(req, res, 200, await get("SELECT * FROM product_reviews WHERE id = ?", [existing.id]));
      return true;
    }
    const result = await run(
      "INSERT INTO product_reviews (product_id, order_id, customer_name, customer_phone, rating, comment, image, is_approved) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
      [productId, orderId, order.customer_name, order.customer_phone, rating, comment, image]
    );
    sendJson(req, res, 201, await get("SELECT * FROM product_reviews WHERE id = ?", [result.lastID]));
    return true;
  }

  return false;
}
async function handleOrders(req, res, url){
  if(req.method === "POST" && url.pathname === "/api/orders"){
    if(publicWriteBlocked(req, "orders", 20)){ sendJson(req, res, 429, { error:"Too many order attempts. Try again later." }); return true; }
    const payload = await readJson(req);
    const customerName = String(payload.customerName || payload.customer_name || "").trim();
    const customerPhone = normalizePhone(payload.customerPhone || payload.customer_phone);
    const customerCity = String(payload.customerCity || payload.customer_city || "").trim();
    const customerAddress = String(payload.customerAddress || payload.customer_address || "").trim();
    const customerNotes = String(payload.customerNotes || payload.customer_notes || "").trim();
    const paymentMethod = String(payload.paymentMethod || payload.payment_method || "cash").trim();
    const items = Array.isArray(payload.items) ? payload.items : [];

    if(!customerName || !customerPhone || !customerCity || !customerAddress || !items.length){
      sendJson(req, res, 400, { error:"Name, phone, city, address, and cart items are required" });
      return true;
    }
    if(!PAYMENT_METHODS.has(paymentMethod)){
      sendJson(req, res, 400, { error:"Choose a valid payment method" });
      return true;
    }

    const preparedItems = [];
    let total = 0;
    for(const item of items){
      const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
      const productId = Number(item.productId || item.product_id || item.id);
      let product = null;
      if(Number.isFinite(productId) && productId > 0){
        product = await get("SELECT * FROM products WHERE id = ? AND is_active = 1", [productId]);
      }
      if(!product && item.name){
        product = await get("SELECT * FROM products WHERE lower(name) = lower(?) AND is_active = 1 ORDER BY id DESC LIMIT 1", [String(item.name).trim()]);
      }
      if(!product){
        sendJson(req, res, 400, { error:"One of the products in your cart is no longer available. Remove it and add it again." });
        return true;
      }
      const stockMap = parseStockBySize(product.stock_by_size);
      const productSizes = sizeListFromProduct(product);
      const rawSize = normalizeSize(item.size || "");
      const matchedSize = productSizes.find((productSize) => normalizeSize(productSize) === rawSize);
      const size = productSizes.length ? matchedSize : rawSize;
      if(productSizes.length && !matchedSize){
        sendJson(req, res, 400, { error:`Choose a valid size for ${product.name}` });
        return true;
      }
      const sizeKey = normalizeSize(size);
      const usesSizeStock = Object.keys(stockMap).length > 0;
      const availableStock = usesSizeStock ? Number(stockMap[sizeKey] || 0) : Number(product.stock || 0);
      if(availableStock < quantity){
        sendJson(req, res, 409, { error:`Not enough stock for ${product.name}${size ? ` / ${size}` : ""}. Only ${availableStock} left.` });
        return true;
      }
      const price = Number(product.price);
      preparedItems.push({ productId:product.id, productName:product.name, size, sizeKey, quantity, price, usesSizeStock });
      total += price * quantity;
    }

    if(!preparedItems.length){ sendJson(req, res, 400, { error:"Your cart has no valid products" }); return true; }

    await run("BEGIN IMMEDIATE TRANSACTION");
    try{
      const paymentStatus = paymentMethod === "card" ? (CARD_PAYMENT_URL ? "pending_card_payment" : "card_link_needed") : "unpaid";
      const result = await run(
        "INSERT INTO orders (customer_name, customer_phone, customer_city, customer_address, customer_notes, payment_method, payment_status, payment_url, total_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [customerName, customerPhone, customerCity, customerAddress, customerNotes, paymentMethod, paymentStatus, "", total, "pending"]
      );

      for(const item of preparedItems){
        if(item.usesSizeStock){
          const fresh = await get("SELECT stock, stock_by_size FROM products WHERE id = ?", [item.productId]);
          const map = parseStockBySize(fresh?.stock_by_size);
          if(Number(map[item.sizeKey] || 0) < item.quantity){ throw new Error(`Stock changed while ordering ${item.productName}. Please refresh your cart.`); }
          map[item.sizeKey] = Number(map[item.sizeKey] || 0) - item.quantity;
          await run("UPDATE products SET stock_by_size = ?, stock = ? WHERE id = ?", [JSON.stringify(map), stockTotal(map, fresh?.stock), item.productId]);
        }else{
          const stockUpdate = await run("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?", [item.quantity, item.productId, item.quantity]);
          if(stockUpdate.changes === 0){ throw new Error(`Stock changed while ordering ${item.productName}. Please refresh your cart.`); }
        }
        await run(
          "INSERT INTO order_items (order_id, product_id, product_name, size, quantity, price) VALUES (?, ?, ?, ?, ?, ?)",
          [result.lastID, item.productId, item.productName, item.size, item.quantity, item.price]
        );
      }

      const order = await orderWithItems(result.lastID);
      await run("COMMIT");
      sendJson(req, res, 201, order);
    }catch(error){
      await run("ROLLBACK").catch(() => {});
      throw error;
    }
    return true;
  }

  if(req.method === "GET" && url.pathname === "/api/orders/track"){
    const id = Number(url.searchParams.get("order") || url.searchParams.get("id"));
    const phone = url.searchParams.get("phone") || "";
    if(!Number.isFinite(id) || id <= 0 || !phone){
      sendJson(req, res, 400, { error:"Order number and phone are required" });
      return true;
    }
    const order = await orderWithItems(id);
    if(!order || phoneKey(order.customer_phone) !== phoneKey(phone)){
      sendJson(req, res, 404, { error:"Order not found. Check your order number and phone." });
      return true;
    }
    sendJson(req, res, 200, order);
    return true;
  }
  if(req.method === "GET" && url.pathname === "/api/orders"){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const status = url.searchParams.get("status");
    const params = [];
    let where = "";
    if(status && ORDER_STATUSES.has(status)){ where = "WHERE status = ?"; params.push(status); }
    const orders = await all(`SELECT * FROM orders ${where} ORDER BY created_at DESC, id DESC`, params);
    for(const order of orders){
      order.items = await all("SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC", [order.id]);
      order.whatsapp_url = whatsappUrl(order.customer_phone, confirmationMessage(order));
    }
    sendJson(req, res, 200, orders);
    return true;
  }

  if(req.method === "DELETE" && url.pathname.startsWith("/api/orders/")){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const id = url.pathname.split("/").pop();
    const existing = await get("SELECT * FROM orders WHERE id = ?", [id]);
    if(!existing){ sendJson(req, res, 404, { error:"Order not found" }); return true; }
    if(existing.status !== "cancelled"){
      // Cancelled orders already returned their stock; active ones get it back on delete.
      const orderItems = await all("SELECT * FROM order_items WHERE order_id = ?", [id]);
      await restoreOrderStock({ items:orderItems });
    }
    await run("DELETE FROM order_items WHERE order_id = ?", [id]);
    await run("DELETE FROM orders WHERE id = ?", [id]);
    sendJson(req, res, 200, { ok:true });
    return true;
  }
  if(req.method === "PATCH" && url.pathname.startsWith("/api/orders/")){
    if(!verifyAdmin(req)){ sendJson(req, res, 401, { error:"Unauthorized - Admin access required" }); return true; }
    const id = url.pathname.split("/").pop();
    const payload = await readJson(req);
    const existing = await get("SELECT * FROM orders WHERE id = ?", [id]);
    if(!existing){ sendJson(req, res, 404, { error:"Order not found" }); return true; }

    const status = String(payload.status || existing.status || "pending").trim();
    if(!ORDER_STATUSES.has(status)){ sendJson(req, res, 400, { error:"Invalid order status" }); return true; }

    const customerName = String(payload.customerName || payload.customer_name || existing.customer_name || "").trim();
    const customerPhone = normalizePhone(payload.customerPhone || payload.customer_phone || existing.customer_phone || "");
    const customerCity = String(payload.customerCity || payload.customer_city || existing.customer_city || "").trim();
    const customerAddress = String(payload.customerAddress || payload.customer_address || existing.customer_address || "").trim();
    const customerNotes = String(payload.customerNotes ?? payload.customer_notes ?? existing.customer_notes ?? "").trim();
    const paymentStatusProvided = payload.paymentStatus !== undefined || payload.payment_status !== undefined;
    const paymentStatus = String(payload.paymentStatus ?? payload.payment_status ?? existing.payment_status ?? "unpaid").trim();
    if(paymentStatusProvided && !PAYMENT_STATUSES.has(paymentStatus)){
      sendJson(req, res, 400, { error:"Invalid payment status" });
      return true;
    }

    if(!customerName || !customerPhone || !customerCity || !customerAddress){
      sendJson(req, res, 400, { error:"Name, phone, city, and address are required" });
      return true;
    }

    // Keep inventory consistent when an order moves in or out of "cancelled".
    const wasCancelled = existing.status === "cancelled";
    const nowCancelled = status === "cancelled";
    if(nowCancelled !== wasCancelled){
      const orderItems = await all("SELECT * FROM order_items WHERE order_id = ?", [id]);
      if(nowCancelled){ await restoreOrderStock({ items:orderItems }); }
      else{ await deductOrderStock({ items:orderItems }); }
    }

    await run(
      "UPDATE orders SET customer_name = ?, customer_phone = ?, customer_city = ?, customer_address = ?, customer_notes = ?, payment_status = ?, status = ? WHERE id = ?",
      [customerName, customerPhone, customerCity, customerAddress, customerNotes, paymentStatus, status, id]
    );
    sendJson(req, res, 200, await orderWithItems(id));
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  if(req.method === "OPTIONS"){
    res.writeHead(204, securityHeaders(req));
    res.end();
    return;
  }

  await ready;
  const url = new URL(req.url, `http://${req.headers.host}`);

  try{
    if(await handlePaymentConfig(req, res, url)){ return; }
    if(await handleAdmin(req, res, url)){ return; }
    if(await handleCategories(req, res, url)){ return; }
    if(await handleProducts(req, res, url)){ return; }
    if(await handleReviews(req, res, url)){ return; }
    if(await handleOrders(req, res, url)){ return; }
    serveStatic(req, res);
  }catch(error){
    const status = error.message === "Request body too large" ? 413 : 500;
    sendJson(req, res, status, { error:error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Fashion Store running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Uploads: ${UPLOAD_DIR}`);
});

