const http = require("http");
const fs = require("fs");
const path = require("path");
const { db, run, get, all } = require("./db");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if(!fs.existsSync(PRODUCTS_FILE)){
  fs.writeFileSync(PRODUCTS_FILE, "[]", "utf8");
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

function readProducts(){
  try{
    return JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
  }catch(error){
    return [];
  }
}

function writeProducts(products){
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2), "utf8");
}

function sendJson(res, status, data){
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req){
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if(body.length > 15 * 1024 * 1024){
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function saveImage(dataUrl, id){
  const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(dataUrl || "");
  if(!match){
    throw new Error("Invalid image format");
  }

  const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const filename = `product-${id}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(match[3], "base64"));
  return `uploads/${filename}`;
}

function serveStatic(req, res){
  let requestPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if(requestPath === "/"){
    requestPath = "/index.html";
  }

  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);

  if(!filePath.startsWith(ROOT)){
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try{
    if(req.method === "GET" && url.pathname === "/api/products"){
      const products = await all("SELECT * FROM products");
      sendJson(res, 200, products);
      return;
    }

    if(req.method === "POST" && url.pathname === "/api/products"){
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const name = String(payload.name || "").trim();
      const category = String(payload.category || "").trim();
      const price = Number(payload.price);

      if(!name || !["tshirts", "jeans", "jackets", "shoes"].includes(category) || !Number.isFinite(price) || price <= 0){
        sendJson(res, 400, { error: "Invalid product data" });
        return;
      }

      const id = Date.now().toString();
      const image = saveImage(payload.image, id);
      
      await run(
        `INSERT INTO products (name, category, price, description, image) VALUES (?, ?, ?, ?, ?)`,
        [name, category, price, payload.description || "", image]
      );
      
      const product = await get("SELECT * FROM products WHERE name = ? AND category = ?", [name, category]);
      sendJson(res, 201, product);
      return;
    }

    if(req.method === "DELETE" && url.pathname.startsWith("/api/products/")){
      const id = url.pathname.split("/").pop();
      const product = await get("SELECT * FROM products WHERE id = ?", [id]);
      await run("DELETE FROM products WHERE id = ?", [id]);

      if(product && product.image && product.image.startsWith("uploads/")){
        const imagePath = path.join(ROOT, product.image);
        if(imagePath.startsWith(UPLOAD_DIR) && fs.existsSync(imagePath)){
          fs.unlinkSync(imagePath);
        }
      }

      sendJson(res, 200, { ok: true });
      return;
    }

    serveStatic(req, res);
  }catch(error){
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Fashion Store running at http://localhost:${PORT}`);
  console.log(`Database: ${path.join(ROOT, "clothing_site.db")}`);
});