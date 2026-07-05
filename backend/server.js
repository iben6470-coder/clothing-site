const http = require("http");
const fs = require("fs");
const path = require("path");
const { run, get, all, ready, DB_PATH } = require("./db");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const UPLOAD_DIR = path.join(ROOT, "storage", "uploads");

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
    "Access-Control-Allow-Methods":"GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type, x-admin-auth"
  };
}

function sendJson(res, status, data){
  res.writeHead(status, Object.assign({ "Content-Type":"application/json; charset=utf-8" }, corsHeaders()));
  res.end(JSON.stringify(data));
}

function verifyAdmin(req){
  return (req.headers["x-admin-auth"] || "") === "admin123";
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

function saveImage(dataUrl, prefix){
  const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(dataUrl || "");
  if(!match){
    throw new Error("Invalid image format");
  }

  const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const filename = `${prefix}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(match[3], "base64"));
  return `uploads/${filename}`;
}

function deleteUploadedImage(image){
  if(image && image.startsWith("uploads/")){
    const imagePath = path.join(UPLOAD_DIR, path.basename(image));
    if(fs.existsSync(imagePath)){
      fs.unlinkSync(imagePath);
    }
  }
}

function parseSizes(value){
  if(Array.isArray(value)){
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function staticFilePath(requestPath){
  if(requestPath === "/"){
    return path.join(ROOT, "index.html");
  }

  if(requestPath.startsWith("/uploads/")){
    return path.join(UPLOAD_DIR, path.basename(requestPath));
  }

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

async function handleCategories(req, res, url){
  if(req.method === "GET" && url.pathname === "/api/categories"){
    const categories = await all("SELECT * FROM categories WHERE is_active = 1 ORDER BY created_at DESC, id DESC");
    sendJson(res, 200, categories);
    return true;
  }

  if(req.method === "POST" && url.pathname === "/api/categories"){
    if(!verifyAdmin(req)){
      sendJson(res, 401, { error: "Unauthorized - Admin access required" });
      return true;
    }

    const payload = JSON.parse((await readBody(req)) || "{}");
    const name = String(payload.name || "").trim();
    const slug = slugify(payload.slug || name);
    const description = String(payload.description || "").trim();

    if(!name || !slug){
      sendJson(res, 400, { error: "Category name is required" });
      return true;
    }

    const exists = await get("SELECT id FROM categories WHERE slug = ?", [slug]);
    if(exists){
      sendJson(res, 409, { error: "Category slug already exists" });
      return true;
    }

    const image = payload.image ? saveImage(payload.image, "category") : "";
    const result = await run(
      "INSERT INTO categories (name, slug, description, image) VALUES (?, ?, ?, ?)",
      [name, slug, description, image]
    );
    const category = await get("SELECT * FROM categories WHERE id = ?", [result.lastID]);
    sendJson(res, 201, category);
    return true;
  }

  if(req.method === "DELETE" && url.pathname.startsWith("/api/categories/")){
    if(!verifyAdmin(req)){
      sendJson(res, 401, { error: "Unauthorized - Admin access required" });
      return true;
    }

    const id = url.pathname.split("/").pop();
    const category = await get("SELECT * FROM categories WHERE id = ?", [id]);
    if(!category){
      sendJson(res, 404, { error: "Category not found" });
      return true;
    }

    const products = await all("SELECT image FROM products WHERE category_id = ?", [id]);
    for(const product of products){
      deleteUploadedImage(product.image);
    }

    await run("DELETE FROM products WHERE category_id = ?", [id]);
    await run("DELETE FROM categories WHERE id = ?", [id]);
    deleteUploadedImage(category.image);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function handleProducts(req, res, url){
  if(req.method === "GET" && url.pathname === "/api/products"){
    const params = [];
    let where = "WHERE p.is_active = 1";
    const category = url.searchParams.get("category");

    if(category){
      where += " AND c.slug = ?";
      params.push(category);
    }

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
    if(!verifyAdmin(req)){
      sendJson(res, 401, { error: "Unauthorized - Admin access required" });
      return true;
    }

    const payload = JSON.parse((await readBody(req)) || "{}");
    const name = String(payload.name || "").trim();
    const price = Number(payload.price);
    const description = String(payload.description || "").trim();
    const stock = Number(payload.stock || 0);
    const categoryId = Number(payload.categoryId || payload.category_id);
    const sizes = parseSizes(payload.sizes);

    if(!name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(categoryId) || categoryId <= 0){
      sendJson(res, 400, { error: "Name, price, and category are required" });
      return true;
    }

    const category = await get("SELECT * FROM categories WHERE id = ?", [categoryId]);
    if(!category){
      sendJson(res, 400, { error: "Category does not exist" });
      return true;
    }

    if(!payload.image){
      sendJson(res, 400, { error: "Product image is required" });
      return true;
    }

    const image = saveImage(payload.image, "product");
    const result = await run(
      "INSERT INTO products (name, category, category_id, price, description, image, sizes, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [name, category.slug, categoryId, price, description, image, JSON.stringify(sizes), Number.isFinite(stock) ? stock : 0]
    );
    const product = await get("SELECT * FROM products WHERE id = ?", [result.lastID]);
    sendJson(res, 201, product);
    return true;
  }

  if(req.method === "DELETE" && url.pathname.startsWith("/api/products/")){
    if(!verifyAdmin(req)){
      sendJson(res, 401, { error: "Unauthorized - Admin access required" });
      return true;
    }

    const id = url.pathname.split("/").pop();
    const product = await get("SELECT * FROM products WHERE id = ?", [id]);
    if(product){
      await run("DELETE FROM products WHERE id = ?", [id]);
      deleteUploadedImage(product.image);
    }
    sendJson(res, 200, { ok: true });
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
    if(await handleCategories(req, res, url)){ return; }
    if(await handleProducts(req, res, url)){ return; }
    serveStatic(req, res);
  }catch(error){
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Fashion Store running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Uploads: ${UPLOAD_DIR}`);
});