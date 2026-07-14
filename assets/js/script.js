let cart = JSON.parse(localStorage.getItem("cart")) || [];
let editingCategoryId = null;
let editingProductId = null;
let editingOrderId = null;
let selectedProductImages = [];

const ADMIN_SESSION_KEY = "fashionAdminLoggedIn";
const ADMIN_TOKEN_KEY = "fashionAdminToken";
const ADMIN_TAB_KEY = "fashionAdminActiveTab";
const STORE_WHATSAPP = String(window.FASHION_STORE_WHATSAPP || "212775089960").replace(/[^0-9]/g, "");
const CARD_PAYMENT_URL = String(window.CARD_PAYMENT_URL || "").trim();
const API_BASE = (() => {
  const configuredApi = String(window.FASHION_API_BASE || "").replace(/\/$/, "");
  if(configuredApi){ return configuredApi; }
  const isLocalPreview = window.location.protocol === "file:" || (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port !== "3000");
  return isLocalPreview ? "http://localhost:3000" : "";
})();
const USE_BROWSER_STORE = false;
const STORE_KEYS = {
  categories:"fashionLocalCategories",
  products:"fashionLocalProducts",
  orders:"fashionLocalOrders"
};
const API = {
  adminLogin:`${API_BASE}/api/admin/login`,
  categories:`${API_BASE}/api/categories`,
  products:`${API_BASE}/api/products`,
  orders:`${API_BASE}/api/orders`,
  trackOrder:`${API_BASE}/api/orders/track`,
  paymentConfig:`${API_BASE}/api/payment-config`,
  reviews:`${API_BASE}/api/reviews`
};
const ORDER_STATUSES = ["pending", "confirmed", "preparing", "delivered", "cancelled"];
const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024;
const SCROLL_POSITION_PREFIX = "fashionScroll:";

const MOROCCO_CITIES = [
  "Casablanca", "Rabat", "Sale", "Temara", "Skhirat", "Mohammedia", "Benslimane", "Settat", "Berrechid", "El Gara", "Sidi Rahal", "Mediouna", "Nouaceur", "Bouskoura", "Tit Mellil",
  "Marrakech", "Tamansourt", "Ait Ourir", "Amizmiz", "Tahannaout", "Chichaoua", "Imintanoute", "Essaouira", "Tamanar", "Safi", "Youssoufia", "Benguerir", "Sidi Bou Othmane", "El Kelaa des Sraghna", "Attaouia", "Demnate",
  "Fes", "Meknes", "Ifrane", "Azrou", "Imouzzer Kandar", "Sefrou", "Bhalil", "Moulay Yacoub", "El Hajeb", "Ain Taoujdate", "Boulemane", "Missour", "Taza", "Tahla", "Oued Amlil", "Guercif",
  "Tangier", "Tetouan", "Martil", "Mdiq", "Fnideq", "Chefchaouen", "Ouazzane", "Ksar El Kebir", "Larache", "Asilah", "Al Hoceima", "Imzouren", "Beni Bouayach", "Targuist",
  "Agadir", "Inezgane", "Dcheira", "Ait Melloul", "Taroudant", "Oulad Teima", "Tiznit", "Sidi Ifni", "Biougra", "Chtouka Ait Baha", "Tafraout", "Taliouine", "Aoulouz", "Bouizakarne",
  "Oujda", "Nador", "Berkane", "Saida", "Taourirt", "Jerada", "Ahfir", "Zaio", "Driouch", "Midar", "Ben Taieb", "Figuig", "Bouarfa", "Aklim", "Ras El Ma", "Selouane",
  "Kenitra", "Sidi Kacem", "Sidi Slimane", "Souk El Arbaa", "Mechra Bel Ksiri", "Khemisset", "Tiflet", "Rommani", "Sidi Yahya El Gharb", "Sidi Allal El Bahraoui",
  "Beni Mellal", "Fquih Ben Salah", "Kasba Tadla", "Souk Sebt", "Oued Zem", "Khouribga", "Bejaad", "Hattane", "Azilal", "Afourer",
  "El Jadida", "Azemmour", "Sidi Bennour", "Oualidia", "Zemamra", "Bir Jdid", "Had Soualem",
  "Errachidia", "Rissani", "Erfoud", "Midelt", "Rich", "Goulmima", "Tinghir", "Boumalne Dades", "Kelaat M'Gouna", "Ouarzazate", "Skoura", "Zagora", "Agdz", "M'Hamid El Ghizlane",
  "Guelmim", "Tan-Tan", "Assa", "Zag", "Tarfaya", "Laayoune", "Boujdour", "Smara", "Dakhla", "Aousserd",
  "Ben Ahmed", "Oulad Abbou", "Sidi Hajjaj", "Boujniba", "Moulay Bousselham", "Jorf El Melha", "Arbaoua", "Lalla Mimouna", "Sidi Taibi", "Ain Harrouda"
];

function initCityField(){
  const list = document.getElementById("cityList");
  if(!list){ return; }
  const uniqueCities = Array.from(new Set(MOROCCO_CITIES)).sort((a, b) => a.localeCompare(b));
  list.innerHTML = uniqueCities.map((city) => `<option value="${escapeAttribute(city)}"></option>`).join("");
}


function scrollStorageKey(){
  return `${SCROLL_POSITION_PREFIX}${window.location.pathname}${window.location.search}`;
}

function saveScrollPosition(){
  try{
    sessionStorage.setItem(scrollStorageKey(), String(window.scrollY || window.pageYOffset || 0));
  }catch(error){
    // Browsers can block storage in private modes.
  }
}

function restoreScrollPosition(){
  if(window.location.hash){ return; }
  let saved = 0;
  try{ saved = Number(sessionStorage.getItem(scrollStorageKey()) || 0); }catch(error){ saved = 0; }
  if(!saved || saved < 2){ return; }
  let attempts = 0;
  const restore = () => {
    attempts += 1;
    window.scrollTo({ top:saved, left:0, behavior:"auto" });
    if(attempts < 8 && Math.abs((window.scrollY || window.pageYOffset || 0) - saved) > 4){
      window.setTimeout(restore, 180);
    }
  };
  window.setTimeout(restore, 80);
}


function mediaUrl(path){
  if(!path){ return ""; }
  if(path.startsWith("http") || path.startsWith("assets/") || path.startsWith("data:image/")){ return path; }
  return `${API_BASE}/${path}`;
}

function productImages(product){
  if(!product){ return []; }
  let images = [];
  if(Array.isArray(product.images)){ images = product.images; }
  else{
    try{ images = JSON.parse(product.images || "[]"); }
    catch(error){ images = []; }
  }
  if(product.image && !images.includes(product.image)){ images.unshift(product.image); }
  return images.filter(Boolean);
}

function firstProductImage(product){
  return productImages(product)[0] || product?.image || "";
}
function saveCart(){
  localStorage.setItem("cart", JSON.stringify(cart));
}

function updateCartCount(){
  cart = JSON.parse(localStorage.getItem("cart")) || [];
  const cartCount = document.getElementById("cartCount");
  const count = cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
  if(cartCount){ cartCount.innerText = count; }
}

function adminHeaders(extra = {}){
  const token = localStorage.getItem(ADMIN_TOKEN_KEY) || "";
  return Object.assign({}, extra, token ? { "Authorization":`Bearer ${token}`, "x-admin-auth":token } : {});
}

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"'`]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;", "`":"&#96;" }[char]));
}

function escapeAttribute(value){
  return escapeHtml(value);
}

function slugify(value){
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePhone(phone){
  let normalized = String(phone || "").replace(/[^0-9+]/g, "").trim();
  if(normalized.startsWith("0")){ normalized = `212${normalized.slice(1)}`; }
  return normalized.replace(/^\+/, "");
}

function whatsappUrl(phone, message){
  return `https://api.whatsapp.com/send?phone=${normalizePhone(phone)}&text=${encodeURIComponent(message)}`;
}
function openWhatsApp(url){
  const link = document.createElement("a");
  link.href = url;
  link.target = "_self";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { window.location.assign(url); }, 150);
}
function cardPaymentUrl(order){
  const base = String(order?.payment_url || CARD_PAYMENT_URL || "").trim();
  if(!base){ return ""; }
  try{
    const url = new URL(base, window.location.href);
    url.searchParams.set("order", order.id);
    url.searchParams.set("amount", order.total_price);
    url.searchParams.set("currency", "MAD");
    url.searchParams.set("return_url", `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}track.html?order=${encodeURIComponent(order.id)}&phone=${encodeURIComponent(order.customer_phone || "")}`);
    return url.toString();
  }catch(error){
    return base;
  }
}

function readStore(key){
  try{ return JSON.parse(localStorage.getItem(key)) || []; }
  catch(error){ return []; }
}

function writeStore(key, items){
  try{ localStorage.setItem(key, JSON.stringify(items)); }
  catch(error){ throw new Error("Image is too large for browser storage. Choose a smaller picture."); }
}

function localCategoryById(id){
  return readStore(STORE_KEYS.categories).find((category) => String(category.id) === String(id));
}

function localOrderMessage(order){
  return [
    `Thank you ${order.customer_name} for trusting Fashion Store.`,
    `Your order #${order.id} has been received.`,
    `Total: MAD ${order.total_price}`,
    "We will contact you soon to confirm delivery."
  ].join("\n");
}

function attachOrderHelpers(order){
  return Object.assign({}, order, { whatsapp_url:whatsappUrl(order.customer_phone, localOrderMessage(order)) });
}

function localGet(url){
  const parsed = new URL(url, window.location.origin);
  if(parsed.pathname.endsWith("/api/categories")){
    return readStore(STORE_KEYS.categories).filter((category) => category.is_active !== 0).sort((a, b) => b.id - a.id);
  }
  if(parsed.pathname.endsWith("/api/products")){
    const categorySlug = parsed.searchParams.get("category");
    const search = String(parsed.searchParams.get("search") || "").trim().toLowerCase();
    const sort = String(parsed.searchParams.get("sort") || "newest");
    const byCreated = (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0) || b.id - a.id;
    const products = readStore(STORE_KEYS.products)
      .filter((product) => product.is_active !== 0)
      .filter((product) => !categorySlug || product.category_slug === categorySlug || product.category === categorySlug)
      .filter((product) => !search || `${product.name || ""} ${product.description || ""}`.toLowerCase().includes(search));
    products.sort((a, b) => {
      if(sort === "price-asc"){ return Number(a.price || 0) - Number(b.price || 0) || byCreated(a, b); }
      if(sort === "price-desc"){ return Number(b.price || 0) - Number(a.price || 0) || byCreated(a, b); }
      if(sort === "stock"){ return Number(b.stock || 0) - Number(a.stock || 0) || byCreated(a, b); }
      return byCreated(a, b);
    });
    return products;
  }
  if(parsed.pathname.endsWith("/api/orders")){
    const status = parsed.searchParams.get("status");
    return readStore(STORE_KEYS.orders)
      .filter((order) => !status || order.status === status)
      .sort((a, b) => b.id - a.id)
      .map(attachOrderHelpers);
  }
  return [];
}

function localPost(url, data){
  const parsed = new URL(url, window.location.origin);
  if(parsed.pathname.endsWith("/api/admin/login")){
    throw new Error("Admin requires the secure Node backend.");
  }
  if(parsed.pathname.endsWith("/api/categories")){
    const categories = readStore(STORE_KEYS.categories);
    const name = String(data.name || "").trim();
    const slug = slugify(data.slug || name);
    if(!name || !slug){ throw new Error("Category name is required"); }
    if(categories.some((category) => category.slug === slug)){ throw new Error("Category slug already exists"); }
    const category = { id:Date.now(), name, slug, description:String(data.description || "").trim(), image:data.image || "", is_active:1, created_at:new Date().toISOString() };
    writeStore(STORE_KEYS.categories, categories.concat(category));
    return category;
  }
  if(parsed.pathname.endsWith("/api/products")){
    const products = readStore(STORE_KEYS.products);
    const category = localCategoryById(data.categoryId || data.category_id);
    const price = Number(data.price);
    const name = String(data.name || "").trim();
    const images = Array.isArray(data.images) && data.images.length ? data.images : (data.image ? [data.image] : []);
    if(!name || !Number.isFinite(price) || price <= 0 || !category){ throw new Error("Name, price, and category are required"); }
    if(!images.length){ throw new Error("At least one product image is required"); }
    const product = {
      id:Date.now(), name, category:category.slug, category_id:category.id, category_name:category.name, category_slug:category.slug,
      price, description:String(data.description || "").trim(), image:images[0], images:JSON.stringify(images),
      sizes:JSON.stringify(parseSizes(data.sizes)), stock:Number(data.stock || 0), is_active:1, created_at:new Date().toISOString()
    };
    writeStore(STORE_KEYS.products, products.concat(product));
    return product;
  }
  if(parsed.pathname.endsWith("/api/orders")){
    const orders = readStore(STORE_KEYS.orders);
    const items = Array.isArray(data.items) ? data.items : [];
    const total = items.reduce((sum, item) => sum + (Number(item.price) || 0) * Number(item.quantity || 1), 0);
    if(!data.customerName || !data.customerPhone || !data.customerCity || !data.customerAddress || !items.length){ throw new Error("Name, phone, city, address, and cart items are required"); }
    const order = {
      id:Date.now(), customer_name:data.customerName, customer_phone:data.customerPhone, customer_city:data.customerCity || "", customer_address:data.customerAddress,
      customer_notes:data.customerNotes || "", payment_method:data.paymentMethod || "cash", payment_status:data.paymentMethod === "card" ? "card_link_needed" : "unpaid", payment_url:CARD_PAYMENT_URL, total_price:total, status:"pending", created_at:new Date().toISOString(),
      items:items.map((item, index) => ({ id:index + 1, order_id:Date.now(), product_id:item.productId || null, product_name:item.name, size:item.size || "", quantity:Number(item.quantity || 1), price:Number(item.price || 0) }))
    };
    writeStore(STORE_KEYS.orders, orders.concat(order));
    return attachOrderHelpers(order);
  }
  throw new Error("Could not save.");
}

function localDelete(url){
  const parsed = new URL(url, window.location.origin);
  const id = parsed.pathname.split("/").pop();
  if(parsed.pathname.includes("/api/categories/")){
    writeStore(STORE_KEYS.categories, readStore(STORE_KEYS.categories).filter((category) => String(category.id) !== String(id)));
    writeStore(STORE_KEYS.products, readStore(STORE_KEYS.products).filter((product) => String(product.category_id) !== String(id)));
    return { ok:true };
  }
  if(parsed.pathname.includes("/api/products/")){
    writeStore(STORE_KEYS.products, readStore(STORE_KEYS.products).filter((product) => String(product.id) !== String(id)));
    return { ok:true };
  }
  if(parsed.pathname.includes("/api/orders/")){
    writeStore(STORE_KEYS.orders, readStore(STORE_KEYS.orders).filter((order) => String(order.id) !== String(id)));
    return { ok:true };
  }
  throw new Error("Could not delete.");
}

function localPatch(url, data){
  const parsed = new URL(url, window.location.origin);
  const id = parsed.pathname.split("/").pop();
  if(parsed.pathname.includes("/api/categories/")){
    const categories = readStore(STORE_KEYS.categories);
    const updated = categories.map((category) => {
      if(String(category.id) !== String(id)){ return category; }
      const name = String(data.name || category.name).trim();
      const slug = slugify(data.slug || name);
      return Object.assign({}, category, { name, slug, description:String(data.description ?? category.description ?? "").trim(), image:data.image || category.image });
    });
    const category = updated.find((item) => String(item.id) === String(id));
    writeStore(STORE_KEYS.categories, updated);
    writeStore(STORE_KEYS.products, readStore(STORE_KEYS.products).map((product) => String(product.category_id) === String(id) ? Object.assign({}, product, { category:category.slug, category_name:category.name, category_slug:category.slug }) : product));
    return category;
  }
  if(parsed.pathname.includes("/api/products/")){
    const products = readStore(STORE_KEYS.products);
    const category = localCategoryById(data.categoryId || data.category_id);
    const updated = products.map((product) => {
      if(String(product.id) !== String(id)){ return product; }
      return Object.assign({}, product, {
        name:String(data.name || product.name).trim(),
        category:category ? category.slug : product.category,
        category_id:category ? category.id : product.category_id,
        category_name:category ? category.name : product.category_name,
        category_slug:category ? category.slug : product.category_slug,
        price:Number(data.price ?? product.price),
        description:String(data.description ?? product.description ?? "").trim(),
        image:(Array.isArray(data.images) && data.images.length ? data.images[0] : (data.image || product.image)),
        images:JSON.stringify(Array.isArray(data.images) && data.images.length ? data.images : productImages(Object.assign({}, product, data))),
        sizes:JSON.stringify(parseSizes(data.sizes ?? product.sizes)),
        stock:Number(data.stock ?? product.stock ?? 0)
      });
    });
    writeStore(STORE_KEYS.products, updated);
    return updated.find((product) => String(product.id) === String(id));
  }
  if(parsed.pathname.includes("/api/orders/")){
    const orders = readStore(STORE_KEYS.orders);
    const updated = orders.map((order) => String(order.id) === String(id) ? Object.assign({}, order, {
      customer_name:data.customerName || data.customer_name || order.customer_name,
      customer_phone:data.customerPhone || data.customer_phone || order.customer_phone,
      customer_city:data.customerCity || data.customer_city || order.customer_city || "",
      customer_address:data.customerAddress || data.customer_address || order.customer_address,
      customer_notes:data.customerNotes ?? data.customer_notes ?? order.customer_notes,
      status:data.status || order.status
    }) : order);
    writeStore(STORE_KEYS.orders, updated);
    return attachOrderHelpers(updated.find((order) => String(order.id) === String(id)));
  }
  throw new Error("Could not update.");
}

function clearAdminSession(){
  localStorage.removeItem(ADMIN_SESSION_KEY);
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

function apiErrorMessage(response, result, fallback){
  if(response.status === 401 || response.status === 403){
    clearAdminSession();
    return "Admin session expired. Please log in again.";
  }
  return result?.error || fallback;
}

function backendConnectionMessage(){
  if(!API_BASE){ return "Backend is not connected. Start the Node server or set FASHION_API_BASE."; }
  return `Backend is not connected yet (${API_BASE}). Deploy the Render backend first.`;
}

async function apiGet(url){
  if(USE_BROWSER_STORE){ return localGet(url); }
  try{
    const response = await fetch(url, { headers:adminHeaders() });
    const result = await response.json().catch(() => ({}));
    if(!response.ok){ throw new Error(apiErrorMessage(response, result, "Could not load store data.")); }
    return result;
  }catch(error){
    if(error instanceof TypeError){ throw new Error(backendConnectionMessage()); }
    throw error;
  }
}

async function apiPost(url, data){
  if(USE_BROWSER_STORE){ return localPost(url, data); }
  try{
    const response = await fetch(url, { method:"POST", headers:adminHeaders({ "Content-Type":"application/json" }), body:JSON.stringify(data) });
    const result = await response.json().catch(() => ({}));
    if(!response.ok){ throw new Error(apiErrorMessage(response, result, "Could not save.")); }
    return result;
  }catch(error){
    if(error instanceof TypeError){ throw new Error(backendConnectionMessage()); }
    throw error;
  }
}

async function apiPatch(url, data){
  if(USE_BROWSER_STORE){ return localPatch(url, data); }
  try{
    const response = await fetch(url, { method:"PATCH", headers:adminHeaders({ "Content-Type":"application/json" }), body:JSON.stringify(data) });
    const result = await response.json().catch(() => ({}));
    if(!response.ok){ throw new Error(apiErrorMessage(response, result, "Could not update.")); }
    return result;
  }catch(error){
    if(error instanceof TypeError){ throw new Error(backendConnectionMessage()); }
    throw error;
  }
}

async function apiDelete(url){
  if(USE_BROWSER_STORE){ return localDelete(url); }
  try{
    const response = await fetch(url, { method:"DELETE", headers:adminHeaders() });
    const result = await response.json().catch(() => ({}));
    if(!response.ok){ throw new Error(apiErrorMessage(response, result, "Could not delete.")); }
    return result;
  }catch(error){
    if(error instanceof TypeError){ throw new Error(backendConnectionMessage()); }
    throw error;
  }
}

function getNav(){ return document.getElementById("navMenu") || document.querySelector("nav"); }
function toggleMenu(){ const nav = getNav(); if(nav){ nav.classList.toggle("active"); } }
function closeSearch(){ const searchPanel = document.getElementById("searchPanel"); const input = document.getElementById("searchInput"); if(input){ input.value = ""; } if(searchPanel){ searchPanel.style.display = "none"; } }
function searchProduct(event){ if(event.key !== "Enter"){ return; } const value = event.target.value.trim(); if(value){ window.location.href = `category.html?search=${encodeURIComponent(value)}`; } }

function readImageFile(file){
  if(!file){ return Promise.reject(new Error("Choose an image file.")); }
  if(!file.type.startsWith("image/")){ return Promise.reject(new Error("Only image files are allowed.")); }
  if(file.size > MAX_IMAGE_FILE_BYTES){ return Promise.reject(new Error("Image is too large. Maximum size is 5MB.")); }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readImageFiles(fileList){
  const files = Array.from(fileList || []);
  return Promise.all(files.map(readImageFile));
}
function parseSizes(value){
  if(Array.isArray(value)){ return value.map(String).map((item) => item.trim()).filter(Boolean); }
  try{ const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : []; }
  catch(error){ return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
}


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
  const values = Object.values(parseStockBySize(stockBySize));
  if(values.length){ return values.reduce((sum, value) => sum + Number(value || 0), 0); }
  return Math.max(0, Math.floor(Number(fallback || 0)));
}

function sizeListFromProduct(product){
  const sizes = parseSizes(product?.sizes);
  const mapSizes = Object.keys(parseStockBySize(product?.stock_by_size));
  return Array.from(new Set(sizes.concat(mapSizes).map(normalizeSize).filter(Boolean)));
}

function stockForSize(product, size){
  const map = parseStockBySize(product?.stock_by_size);
  const keys = Object.keys(map);
  if(keys.length){ return Math.max(0, Number(map[normalizeSize(size)] || 0)); }
  return Math.max(0, Number(product?.stock || 0));
}

function audienceLabel(value){
  const audience = String(value || "unisex").toLowerCase();
  if(audience === "men"){ return "Men"; }
  if(audience === "women"){ return "Women"; }
  return "Men + Women";
}

function currentAudiencePage(){
  const page = window.location.pathname.split("/").pop().replace(".html", "");
  return page === "men" || page === "women" ? page : "";
}

function normalizeSize(value){ return String(value || "").trim().toUpperCase(); }

function cartItemKey(productId, size){ return `${productId || "manual"}:${normalizeSize(size)}`; }

function addToCart(product, size = ""){
  size = normalizeSize(size);
  const stock = stockForSize(product, size);
  if(stock <= 0){ return false; }
  const item = cart.find((entry) => cartItemKey(entry.productId, entry.size) === cartItemKey(product.id, size));
  if(item){
    if(Number(item.quantity || 1) >= stock){ return false; }
    item.quantity = Number(item.quantity || 1) + 1;
    item.stock = stock;
  }else{
    cart.push({ productId:product.id, name:product.name, price:Number(product.price), size, quantity:1, stock, image:firstProductImage(product) });
  }
  saveCart();
  updateCartCount();
  return true;
}

function createEmpty(message, action){
  const empty = document.createElement("p");
  empty.className = "product-empty";
  empty.textContent = message;
  if(action){
    const link = document.createElement("a");
    link.href = action.href;
    link.textContent = action.label;
    empty.appendChild(document.createElement("br"));
    empty.appendChild(link);
  }
  return empty;
}

function createCategoryCard(category){
  const card = document.createElement("article");
  card.className = "category-card";
  const image = document.createElement("img");
  image.src = mediaUrl(category.image);
  image.alt = category.name;
  const body = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = category.name;
  const text = document.createElement("p");
  text.textContent = category.description || "Explore this collection.";
  const link = document.createElement("a");
  link.href = `category.html?category=${encodeURIComponent(category.slug)}`;
  link.textContent = "View Collection";
  body.append(title, text, link);
  card.append(image, body);
  return card;
}

function createProductCard(product){
  const card = document.createElement("article");
  card.className = "product";
  const images = productImages(product);
  const imageWrap = document.createElement("div");
  imageWrap.className = images.length > 1 ? "product-gallery product-gallery-rotatable" : "product-gallery";
  const image = document.createElement("img");
  image.src = mediaUrl(images[0] || product.image);
  image.alt = product.name;
  imageWrap.appendChild(image);

  const sizes = sizeListFromProduct(product);
  const stock = sizes.length ? stockForSize(product, sizes[0]) : stockTotal(product.stock_by_size, product.stock);
  const badge = document.createElement("span");
  badge.className = "product-badge";
  badge.textContent = stock <= 3 && stock > 0 ? "Limited" : "New drop";
  imageWrap.appendChild(badge);

  let currentImageIndex = 0;
  let thumbs = null;
  let angleLabel = null;
  const viewLabels = ["Front", "Side", "Back", "Detail"];
  const setProductImage = (index) => {
    if(!images.length){ return; }
    currentImageIndex = (index + images.length) % images.length;
    image.classList.remove("is-changing");
    image.offsetWidth;
    image.src = mediaUrl(images[currentImageIndex]);
    image.alt = `${product.name} ${viewLabels[currentImageIndex] || `View ${currentImageIndex + 1}`}`;
    image.classList.add("is-changing");
    if(angleLabel){ angleLabel.textContent = `${viewLabels[currentImageIndex] || "View"} ${currentImageIndex + 1}/${images.length}`; }
    if(thumbs){
      thumbs.querySelectorAll("button").forEach((item, thumbIndex) => item.classList.toggle("active", thumbIndex === currentImageIndex));
    }
  };

  if(images.length > 1){
    const controls = document.createElement("div");
    controls.className = "product-rotate-controls";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "product-rotate-btn";
    prev.setAttribute("aria-label", "Previous product view");
    prev.textContent = "<";
    angleLabel = document.createElement("span");
    angleLabel.className = "product-angle-label";
    angleLabel.textContent = `Front 1/${images.length}`;
    const next = document.createElement("button");
    next.type = "button";
    next.className = "product-rotate-btn";
    next.setAttribute("aria-label", "Next product view");
    next.textContent = ">";
    prev.addEventListener("click", () => setProductImage(currentImageIndex - 1));
    next.addEventListener("click", () => setProductImage(currentImageIndex + 1));
    controls.append(prev, angleLabel, next);
    imageWrap.appendChild(controls);

    let dragStartX = null;
    imageWrap.addEventListener("pointerdown", (event) => {
      if(event.target.closest("button")){ return; }
      dragStartX = event.clientX;
      imageWrap.classList.add("dragging");
    });
    imageWrap.addEventListener("pointerup", (event) => {
      if(dragStartX === null){ return; }
      const distance = event.clientX - dragStartX;
      imageWrap.classList.remove("dragging");
      dragStartX = null;
      if(Math.abs(distance) > 28){ setProductImage(currentImageIndex + (distance < 0 ? 1 : -1)); }
    });
    imageWrap.addEventListener("pointerleave", () => { dragStartX = null; imageWrap.classList.remove("dragging"); });

    thumbs = document.createElement("div");
    thumbs.className = "product-thumbs";
    images.forEach((src, index) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = index === 0 ? "active" : "";
      thumb.setAttribute("aria-label", `${product.name} ${viewLabels[index] || `view ${index + 1}`}`);
      const thumbImg = document.createElement("img");
      thumbImg.src = mediaUrl(src);
      thumbImg.alt = `${product.name} ${index + 1}`;
      thumb.appendChild(thumbImg);
      thumb.addEventListener("click", () => setProductImage(index));
      thumbs.appendChild(thumb);
    });
    imageWrap.appendChild(thumbs);
  }

  const title = document.createElement("h3");
  title.textContent = product.name;
  const price = document.createElement("p");
  price.className = "product-price";
  price.textContent = `MAD ${product.price}`;
  let select = null;
  if(sizes.length){
    select = document.createElement("select");
    select.className = "size-select";
    sizes.forEach((size) => {
      const option = document.createElement("option");
      const normalized = normalizeSize(size);
      const available = stockForSize(product, normalized);
      option.value = normalized;
      option.textContent = normalized + (parseStockBySize(product.stock_by_size)[normalized] !== undefined ? " / " + available + " left" : "");
      option.disabled = available <= 0;
      select.appendChild(option);
    });
    if(!select.value){
      const firstAvailable = Array.from(select.options).find((option) => !option.disabled);
      if(firstAvailable){ select.value = firstAvailable.value; }
    }
  }
  const button = document.createElement("button");
  button.type = "button";
  const currentStock = () => select ? stockForSize(product, select.value) : stock;
  const syncStockButton = () => {
    const available = currentStock();
    button.textContent = available <= 0 ? "Out of Stock" : "Add to Bag";
    button.disabled = available <= 0;
  };
  button.addEventListener("click", () => {
    const added = addToCart(product, select ? select.value : "");
    if(added){
      button.textContent = "Added to Bag";
      setTimeout(syncStockButton, 1100);
      return;
    }
    button.textContent = "No Stock Left";
    setTimeout(syncStockButton, 1100);
  });
  select?.addEventListener("change", syncStockButton);
  syncStockButton();
  card.append(imageWrap, title, price);
  const detailLink = document.createElement("a");
  detailLink.className = "product-details-link";
  detailLink.href = `product.html?id=${encodeURIComponent(product.id)}`;
  detailLink.textContent = "View Details";
  card.appendChild(detailLink);
  const reviewCount = Number(product.review_count || 0);
  if(reviewCount > 0){
    const review = document.createElement("div");
    review.className = "product-review-summary";
    const rating = Number(product.review_rating || 0);
    let photos = [];
    try{ photos = JSON.parse(product.review_photos || "[]"); }catch(error){ photos = []; }
    const stars = document.createElement("span");
    stars.className = "product-stars";
    stars.textContent = `${rating ? rating.toFixed(1) : "5.0"}/5 (${reviewCount} reviews)`;
    review.appendChild(stars);
    if(photos.length){
      const photoStrip = document.createElement("div");
      photoStrip.className = "review-photo-strip";
      photos.slice(0, 4).forEach((src) => {
        const reviewImg = document.createElement("img");
        reviewImg.src = mediaUrl(src);
        reviewImg.alt = `${product.name} customer review`;
        photoStrip.appendChild(reviewImg);
      });
      review.appendChild(photoStrip);
    }
    const reviewToggle = document.createElement("button");
    reviewToggle.type = "button";
    reviewToggle.className = "review-toggle";
    reviewToggle.textContent = "View Reviews";
    const reviewList = document.createElement("div");
    reviewList.className = "product-review-list";
    reviewList.hidden = true;
    reviewToggle.addEventListener("click", async () => {
      if(!reviewList.hidden){
        reviewList.hidden = true;
        reviewToggle.textContent = "View Reviews";
        return;
      }
      reviewToggle.textContent = "Loading...";
      try{
        const reviews = await apiGet(`${API.reviews}?productId=${encodeURIComponent(product.id)}`);
        reviewList.innerHTML = reviews.length ? reviews.map((item) => `
          <article class="customer-review">
            <div><strong>${escapeHtml(item.customer_name || "Customer")}</strong><span>${escapeHtml(Number(item.rating || 5))}/5</span></div>
            ${item.comment ? `<p>${escapeHtml(item.comment)}</p>` : ""}
            ${item.image ? `<img src="${escapeAttribute(mediaUrl(item.image))}" alt="Customer product photo">` : ""}
          </article>`).join("") : "<p>No reviews yet.</p>";
        reviewList.hidden = false;
        reviewToggle.textContent = "Hide Reviews";
      }catch(error){
        reviewList.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
        reviewList.hidden = false;
        reviewToggle.textContent = "View Reviews";
      }
    });
    review.append(reviewToggle, reviewList);
    card.appendChild(review);
  }
  if(product.description){
    const description = document.createElement("small");
    description.className = "product-description";
    description.textContent = String(product.description).replace(/\*\*/g, "").slice(0, 150);
    card.appendChild(description);
  }
  if(images.length > 1){
    const count = document.createElement("small");
    count.className = "product-photo-count";
    count.textContent = `${images.length} angle views`;
    card.appendChild(count);
  }
  const totalStock = stockTotal(product.stock_by_size, product.stock);
  if(totalStock > 0){
    const stockText = document.createElement("small");
    const updateStockText = () => {
      const shownStock = select ? stockForSize(product, select.value) : totalStock;
      stockText.className = shownStock <= 3 ? "stock-note low-stock" : "stock-note";
      stockText.textContent = shownStock <= 3 ? `Only ${shownStock} left` : `${shownStock} available`;
    };
    updateStockText();
    select?.addEventListener("change", updateStockText);
    card.appendChild(stockText);
  }
  if(select){ card.appendChild(select); }
  card.appendChild(button);
  return card;
}
async function renderHomeCategories(){
  const grid = document.getElementById("categoryGrid");
  if(!grid){ return; }
  grid.innerHTML = "";
  const categories = await apiGet(API.categories).catch(() => []);
  if(!categories.length){ grid.appendChild(createEmpty("Collections are coming soon.")); return; }
  categories.forEach((category) => grid.appendChild(createCategoryCard(category)));
}

function bindHomeProductSearch(){
  const searchInput = document.getElementById("homeProductSearch");
  const sortSelect = document.getElementById("homeProductSort");
  if(!searchInput && !sortSelect){ return; }
  if(searchInput?.dataset.bound === "true"){ return; }
  let timer = null;
  const update = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(renderHomeProducts, 180);
  };
  searchInput?.addEventListener("input", update);
  sortSelect?.addEventListener("change", () => renderHomeProducts());
  if(searchInput){ searchInput.dataset.bound = "true"; }
}

async function renderHomeProducts(){
  const grid = document.getElementById("homeProductGrid");
  if(!grid){ return; }
  bindHomeProductSearch();
  const count = document.getElementById("homeProductCount");
  const search = (document.getElementById("homeProductSearch")?.value || "").trim();
  const sort = document.getElementById("homeProductSort")?.value || "newest";
  const query = new URLSearchParams();
  if(search){ query.set("search", search); }
  if(sort){ query.set("sort", sort); }
  const endpoint = `${API.products}${query.toString() ? `?${query}` : ""}`;
  grid.innerHTML = "";
  const products = await apiGet(endpoint).catch(() => []);
  if(count){ count.textContent = search ? `${products.length} product${products.length === 1 ? "" : "s"} found for "${search}".` : ""; }
  if(!products.length){ grid.appendChild(createEmpty(search ? "No products match your search." : "Products are coming soon.")); return; }
  products.forEach((product) => grid.appendChild(createProductCard(product)));
}

function bindCategoryFilters(categorySlug){
  const audience = currentAudiencePage();
  const searchInput = document.getElementById("productSearch");
  const sortSelect = document.getElementById("productSort");
  if(!searchInput && !sortSelect){ return; }
  if(searchInput?.dataset.bound === "true"){ return; }
  const update = () => {
    const params = new URLSearchParams();
    if(categorySlug){ params.set("category", categorySlug); }
    if(audience){ params.set("audience", audience); }
    const search = (searchInput?.value || "").trim();
    const sort = sortSelect?.value || "newest";
    if(search){ params.set("search", search); }
    if(sort !== "newest"){ params.set("sort", sort); }
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
    renderCategoryPage();
  };
  let timer = null;
  searchInput?.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 220); });
  sortSelect?.addEventListener("change", update);
  if(searchInput){ searchInput.dataset.bound = "true"; }
}

async function renderCategoryPage(){
  const container = document.getElementById("categoryProducts") || document.querySelector(".product-container[data-managed-products]");
  if(!container){ return; }
  const params = new URLSearchParams(window.location.search);
  const categorySlug = params.get("category") || currentLegacyCategory();
  const audience = params.get("audience") || currentAudiencePage();
  const search = (params.get("search") || "").trim();
  const sort = params.get("sort") || "newest";
  const searchInput = document.getElementById("productSearch");
  const sortSelect = document.getElementById("productSort");
  if(searchInput && searchInput.value !== search){ searchInput.value = search; }
  if(sortSelect && sortSelect.value !== sort){ sortSelect.value = sort; }
  bindCategoryFilters(categorySlug);
  const title = document.getElementById("categoryTitle");
  const description = document.getElementById("categoryDescription");
  container.innerHTML = "";
  const categories = await apiGet(API.categories).catch(() => []);
  const query = new URLSearchParams();
  if(categorySlug){ query.set("category", categorySlug); }
  if(audience){ query.set("audience", audience); }
  if(search){ query.set("search", search); }
  if(sort){ query.set("sort", sort); }
  const endpoint = query.toString() ? `${API.products}?${query}` : API.products;
  const products = await apiGet(endpoint).catch(() => []);
  if(search){
    if(title){ title.textContent = `Search: ${search}`; }
    if(description){ description.textContent = `${products.length} product${products.length === 1 ? "" : "s"} found.`; }
  }else if(audience){
    if(title){ title.textContent = audience === "men" ? "Men" : "Women"; }
    if(description){ description.textContent = audience === "men" ? "Streetwear, essentials, and new drops for men." : "Streetwear, essentials, and new drops for women."; }
  }else{
    const category = categories.find((item) => item.slug === categorySlug);
    if(title){ title.textContent = category ? category.name : "Products"; }
    if(description){ description.textContent = category?.description || "Explore available products."; }
  }
  if(!products.length){ container.appendChild(createEmpty(search ? "No products match your search." : "Products are coming soon.")); return; }
  products.forEach((product) => container.appendChild(createProductCard(product)));
}
function currentLegacyCategory(){
  const page = window.location.pathname.split("/").pop().replace(".html", "");
  const map = { tshirts:"t-shirts", jeans:"jeans", jackets:"jackets", shoes:"shoes" };
  return map[page] || "";
}

function renderCartPage(){
  const container = document.getElementById("cartItems");
  const totalPrice = document.getElementById("totalPrice");
  if(!container || !totalPrice){ return; }
  cart = JSON.parse(localStorage.getItem("cart")) || [];
  container.innerHTML = "";
  const submit = document.getElementById("orderSubmitBtn");
  const status = document.getElementById("orderStatus");
  if(!cart.length){
    container.appendChild(createEmpty("Your cart is empty.", { href:"category.html", label:"Go to shop" }));
    totalPrice.textContent = "Total: MAD 0";
    if(submit){ submit.disabled = true; }
    if(status){ status.textContent = "Add a product to your cart first."; }
    return;
  }
  if(submit){ submit.disabled = false; }
  if(status && status.textContent === "Add a product to your cart first."){ status.textContent = ""; }
  let total = 0;
  cart.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    const details = document.createElement("div");
    details.className = "cart-line";
    if(item.image){
      const image = document.createElement("img");
      image.src = mediaUrl(item.image);
      image.alt = item.name;
      details.appendChild(image);
    }
    const copy = document.createElement("div");
    const quantity = Math.max(1, Number(item.quantity || 1));
    const stock = Number(item.stock || 0);
    copy.innerHTML = `<strong>${escapeHtml(item.name)}${item.size ? ` / ${escapeHtml(item.size)}` : ""}</strong><span>MAD ${Number(item.price) * quantity}</span>${stock ? `<small>${stock} in stock</small>` : ""}`;
    details.appendChild(copy);
    const controls = document.createElement("div");
    controls.className = "cart-controls";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "-";
    minus.addEventListener("click", () => { item.quantity = Math.max(1, quantity - 1); saveCart(); updateCartCount(); renderCartPage(); });
    const count = document.createElement("span");
    count.className = "cart-quantity";
    count.textContent = quantity;
    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.disabled = stock > 0 && quantity >= stock;
    plus.addEventListener("click", () => { item.quantity = stock > 0 ? Math.min(stock, quantity + 1) : quantity + 1; saveCart(); updateCartCount(); renderCartPage(); });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => { cart.splice(index, 1); saveCart(); updateCartCount(); renderCartPage(); });
    controls.append(minus, count, plus, remove);
    row.append(details, controls);
    container.appendChild(row);
    total += Number(item.price) * quantity;
  });
  totalPrice.textContent = `Total: MAD ${total}`;
}
function formatMad(value){
  const amount = Number(value || 0);
  return `MAD ${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

function orderItemLine(item){
  const name = item.product_name || item.name || "Product";
  const size = item.size ? ` / ${item.size}` : "";
  const quantity = Number(item.quantity || 1);
  const lineTotal = Number(item.price || 0) * quantity;
  return `${name}${size} x${quantity} - ${formatMad(lineTotal)}`;
}

function customerOrderLines(orderNumber, items, customer){
  const itemLines = (items || []).map(orderItemLine);
  const total = (items || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
  return [
    orderNumber ? `New Order #${orderNumber}` : "New Order",
    ...itemLines,
    `Name: ${customer.name}`,
    `Phone: ${customer.phone}`,
    customer.city ? `City: ${customer.city}` : "",
    `Address: ${customer.address}`,
    customer.notes ? `Notes: ${customer.notes}` : "",
    `Total: ${formatMad(customer.total ?? total)}`
  ].filter(Boolean).join("\n");
}

function ownerOrderMessage(order){
  return customerOrderLines(order.id, order.items || [], {
    name:order.customer_name,
    phone:order.customer_phone,
    city:order.customer_city || "",
    address:order.customer_address,
    notes:order.customer_notes,
    total:order.total_price
  });
}

function ownerCartMessage(customer, items){
  return customerOrderLines(null, items, customer);
}

async function sendOrder(){
  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const city = (document.getElementById("customerCity")?.value || "").trim();
  const address = document.getElementById("customerAddress").value.trim();
  const notes = (document.getElementById("customerNotes")?.value || "").trim();
  const status = document.getElementById("orderStatus");
  const paymentMethod = document.querySelector("input[name='paymentMethod']:checked")?.value || "cash";
  const submit = document.getElementById("orderSubmitBtn") || document.querySelector(".checkout-form button");
  if(status){ status.textContent = ""; }
  if(!name || !phone || !city || !address){ if(status){ status.textContent = "Fill your name, phone, city, and delivery address."; } return; }
  if(normalizePhone(phone).length < 9){ if(status){ status.textContent = "Enter a valid phone number."; } return; }
  if(paymentMethod === "card" && !(await cardPaymentEnabled())){
    if(status){ status.textContent = "Please choose Cash / WhatsApp for this order."; }
    return;
  }
  cart = (JSON.parse(localStorage.getItem("cart")) || []).map((item) => Object.assign({}, item, { size:normalizeSize(item.size) }));
  saveCart();
  if(!cart.length){ if(status){ status.textContent = "Your cart is empty."; } return; }
  const fallbackUrl = whatsappUrl(STORE_WHATSAPP, ownerCartMessage({ name, phone, city, address, notes }, cart));
  if(status){
    status.innerHTML = `Saving your order... <a href="${escapeAttribute(fallbackUrl)}" target="_self">Open WhatsApp</a>`;
  }
  if(submit){ submit.disabled = true; }
  try{
    const order = await apiPost(API.orders, { customerName:name, customerPhone:phone, customerCity:city, customerAddress:address, customerNotes:notes, paymentMethod, items:cart });
    localStorage.removeItem("cart");
    cart = [];
    updateCartCount();
    const trackUrl = `track.html?order=${encodeURIComponent(order.id)}&phone=${encodeURIComponent(order.customer_phone || phone)}&placed=1`;
    if(paymentMethod === "card"){
      const payUrl = cardPaymentUrl(order);
      if(!payUrl){ throw new Error("Bank card payment is not configured yet."); }
      if(status){ status.textContent = `Order #${order.id} saved. Opening secure bank payment...`; }
      window.location.href = payUrl;
      return;
    }
    if(status){ status.textContent = `Thank you for your trust. Order #${order.id} received.`; }
    window.location.assign(trackUrl);
  }catch(error){
    if(status){
      status.innerHTML = `${escapeHtml(error.message)}. <a href="${escapeAttribute(fallbackUrl)}" target="_self">Send order by WhatsApp</a>`;
    }
    if(submit){ submit.disabled = false; }
  }
}

function statusCopy(status){
  const labels = {
    pending:"Order received",
    confirmed:"Confirmed",
    preparing:"Preparing",
    delivered:"Delivered",
    cancelled:"Cancelled"
  };
  return labels[status] || status || "Pending";
}

function renderTrackedOrder(order){
  const result = document.getElementById("trackResult");
  if(!result){ return; }
  const items = order.items || [];
  const showThanks = new URLSearchParams(window.location.search).get("placed") === "1";
  const itemHtml = items.map((item) => {
    const quantity = Number(item.quantity || 1);
    const lineTotal = Number(item.price || 0) * quantity;
    return `<div class="track-item"><span>${escapeHtml(item.product_name || item.name || "Product")}${item.size ? ` / ${escapeHtml(item.size)}` : ""}</span><strong>x${escapeHtml(quantity)} - ${formatMad(lineTotal)}</strong></div>`;
  }).join("");
  const whatsapp = whatsappUrl(STORE_WHATSAPP, ownerOrderMessage(order));
  const payUrl = order.payment_method === "card" ? cardPaymentUrl(order) : "";
  result.hidden = false;
  result.innerHTML = `
    ${showThanks ? `<div class="order-thanks"><strong>Thank you for your trust.</strong><span>Your order has been received. We will contact you soon to confirm delivery.</span></div>` : ""}
    <div class="track-result-head">
      <div>
        <span class="track-kicker">Order #${escapeHtml(order.id)}</span>
        <h2>${escapeHtml(statusCopy(order.status))}</h2>
        <p>${escapeHtml(order.customer_name)} / ${escapeHtml(order.customer_phone)}</p>
      </div>
      <span class="track-badge ${escapeAttribute(order.status || "pending")}">${escapeHtml(order.status || "pending")}</span>
    </div>
    <div class="track-steps">
      ${["pending", "confirmed", "preparing", "delivered"].map((step) => `<span class="${ORDER_STATUSES.indexOf(order.status) >= ORDER_STATUSES.indexOf(step) && order.status !== "cancelled" ? "active" : ""}">${escapeHtml(statusCopy(step))}</span>`).join("")}
    </div>
    <div class="track-items">${itemHtml || "<p>No items found.</p>"}</div>
    <div class="track-summary">
      ${order.customer_city ? `<p><strong>City:</strong> ${escapeHtml(order.customer_city)}</p>` : ""}
      <p><strong>Address:</strong> ${escapeHtml(order.customer_address || "")}</p>
      ${order.customer_notes ? `<p><strong>Notes:</strong> ${escapeHtml(order.customer_notes)}</p>` : ""}
      <p><strong>Payment:</strong> ${escapeHtml(order.payment_method === "card" ? "Bank card" : "Cash / WhatsApp")}</p>
      <p><strong>Total:</strong> ${formatMad(order.total_price)}</p>
    </div>
    <div class="track-review-list">
      <h3>Review your products</h3>
      ${(order.items || []).map((item) => `<form class="review-form" data-product-id="${escapeAttribute(item.product_id)}" data-order-id="${escapeAttribute(order.id)}">
        <strong>${escapeHtml(item.product_name)}${item.size ? ` / ${escapeHtml(item.size)}` : ""}</strong>
        <select name="rating" aria-label="Rating">
          <option value="5">5 / Excellent</option>
          <option value="4">4 / Good</option>
          <option value="3">3 / Normal</option>
          <option value="2">2 / Not good</option>
          <option value="1">1 / Bad</option>
        </select>
        <textarea name="comment" placeholder="Tell other customers how it looks, fits, and feels."></textarea>
        <input type="file" name="image" accept="image/*">
        <button type="submit">Post Review</button>
        <span class="review-status"></span>
      </form>`).join("")}
    </div>
    <div class="track-actions">
      ${payUrl ? `<a href="${escapeAttribute(payUrl)}" target="_self">Pay by Bank Card</a>` : ""}
      <a href="${escapeAttribute(whatsapp)}" target="_self">Send Order on WhatsApp</a>
      <a href="index.html#shop">Continue Shopping</a>
    </div>`;
  bindReviewForms(order);
}

function bindReviewForms(order){
  document.querySelectorAll(".review-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".review-status");
      const button = form.querySelector("button");
      if(status){ status.textContent = "Saving review..."; }
      if(button){ button.disabled = true; }
      try{
        const file = form.querySelector("input[type='file']")?.files?.[0];
        const image = file ? await readImageFile(file) : "";
        const payload = {
          orderId:order.id,
          productId:form.dataset.productId,
          phone:order.customer_phone,
          rating:form.elements.rating.value,
          comment:form.elements.comment.value.trim(),
          image
        };
        await apiPost(API.reviews, payload);
        form.reset();
        if(status){ status.textContent = "Review posted. Thank you."; }
      }catch(error){
        if(status){ status.textContent = error.message; }
      }finally{
        if(button){ button.disabled = false; }
      }
    });
  });
}

async function loadTrackedOrder(orderId, phone){
  const status = document.getElementById("trackStatus");
  const result = document.getElementById("trackResult");
  if(!orderId || !phone){ return; }
  if(status){ status.textContent = "Loading order..."; }
  if(result){ result.hidden = true; }
  try{
    const url = `${API.trackOrder}?order=${encodeURIComponent(orderId)}&phone=${encodeURIComponent(phone)}`;
    const order = await apiGet(url);
    if(status){ status.textContent = ""; }
    renderTrackedOrder(order);
  }catch(error){
    if(status){ status.textContent = error.message; }
  }
}

function initTrackPage(){
  const form = document.getElementById("trackOrderForm");
  if(!form){ return; }
  const idInput = document.getElementById("trackOrderId");
  const phoneInput = document.getElementById("trackPhone");
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("order") || params.get("id") || "";
  const phone = params.get("phone") || "";

  if(orderId){ idInput.value = orderId; }
  if(phone){ phoneInput.value = phone; }
  if(orderId && phone){ loadTrackedOrder(orderId, phone); }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadTrackedOrder(idInput.value.trim(), phoneInput.value.trim());
  });
}
async function cardPaymentEnabled(){
  if(CARD_PAYMENT_URL){ return true; }
  try{
    const config = await apiGet(API.paymentConfig);
    return !!config.cardEnabled;
  }catch(error){
    return false;
  }
}

async function initPaymentMethods(){
  const cardInput = document.querySelector("input[name='paymentMethod'][value='card']");
  const cardLabel = document.querySelector(".card-payment-option");
  const note = document.getElementById("paymentNote");
  if(!cardInput){ return; }
  const enabled = await cardPaymentEnabled();
  cardInput.disabled = !enabled;
  if(cardLabel){ cardLabel.hidden = !enabled; cardLabel.classList.toggle("disabled", !enabled); }
  if(note){
    note.textContent = enabled ? "Bank card payments open in a secure external payment page." : "";
  }
}
function activateAdminTab(tab){
  if(!tab || !document.getElementById(tab.dataset.panel)){ return; }
  document.querySelectorAll(".admin-tab").forEach((item) => { item.classList.remove("active"); item.setAttribute("aria-selected", "false"); });
  document.querySelectorAll(".admin-panel").forEach((panel) => panel.classList.remove("active"));
  tab.classList.add("active");
  tab.setAttribute("aria-selected", "true");
  document.getElementById(tab.dataset.panel).classList.add("active");
  localStorage.setItem(ADMIN_TAB_KEY, tab.dataset.panel);
}

function initAdminTabs(){
  const savedPanel = localStorage.getItem(ADMIN_TAB_KEY);
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => activateAdminTab(tab));
  });
  if(savedPanel){ activateAdminTab(document.querySelector(`.admin-tab[data-panel="${savedPanel}"]`)); }
}

async function refreshCategorySelect(){
  const select = document.getElementById("productCategory");
  if(!select){ return; }
  const categories = await apiGet(API.categories).catch(() => []);
  select.innerHTML = "";
  if(!categories.length){ const option = document.createElement("option"); option.value = ""; option.textContent = "Add a category first"; select.appendChild(option); return; }
  categories.forEach((category) => { const option = document.createElement("option"); option.value = category.id; option.textContent = category.name; select.appendChild(option); });
}

function renderAdminStats(categories, products, orders){
  const stats = document.getElementById("adminStats");
  if(!stats){ return; }
  const pending = orders.filter((order) => order.status === "pending").length;
  const lowStock = products.filter((product) => Number(product.stock || 0) > 0 && Number(product.stock || 0) <= 3).length;
  const revenue = orders.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + Number(order.total_price || 0), 0);
  stats.innerHTML = "";
  [
    ["Orders", orders.length],
    ["Pending", pending],
    ["Products", products.length],
    ["Low Stock", lowStock],
    ["Revenue", `MAD ${revenue}`],
    ["Categories", categories.length]
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "admin-stat";
    item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
    stats.appendChild(item);
  });
}
async function renderAdminCategoryList(){
  const list = document.getElementById("adminCategoryList");
  if(!list){ return; }
  const categories = await apiGet(API.categories).catch(() => []);
  list.innerHTML = "";
  if(!categories.length){ list.appendChild(createEmpty("No categories added yet.")); return; }
  categories.forEach((category) => {
    const row = document.createElement("div");
    row.className = "admin-product-row";
    row.innerHTML = `<img src="${escapeAttribute(mediaUrl(category.image))}" alt=""><div><strong>${escapeHtml(category.name)}</strong><span>${escapeHtml(category.slug)}</span></div>`;
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.className = "edit-btn";
    editButton.addEventListener("click", () => startEditCategory(category));
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete";
    button.addEventListener("click", async () => { await apiDelete(`${API.categories}/${category.id}`); await refreshAdminData(); });
    row.append(editButton, button);
    list.appendChild(row);
  });
}

async function renderAdminProductList(){
  const list = document.getElementById("adminProductList");
  if(!list){ return; }
  const products = await apiGet(API.products).catch(() => []);
  list.innerHTML = "";
  if(!products.length){ list.appendChild(createEmpty("No products added yet.")); return; }
  products.forEach((product) => {
    const sizes = parseSizes(product.sizes).join(", ") || "No sizes";
    const stockBySizeText = Object.entries(parseStockBySize(product.stock_by_size)).map(([size, quantity]) => `${size}:${quantity}`).join(", ");
    const row = document.createElement("div");
    row.className = "admin-product-row";
    row.innerHTML = `<img src="${escapeAttribute(mediaUrl(firstProductImage(product)))}" alt=""><div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category_name || product.category)} / MAD ${escapeHtml(product.price)} / ${escapeHtml(audienceLabel(product.audience))} / Stock ${escapeHtml(product.stock || 0)}${stockBySizeText ? ` (${escapeHtml(stockBySizeText)})` : ""} / ${escapeHtml(sizes)} / ${productImages(product).length || 1} photos</span></div>`;
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.className = "edit-btn";
    editButton.addEventListener("click", () => startEditProduct(product));
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete";
    button.addEventListener("click", async () => { await apiDelete(`${API.products}/${product.id}`); await refreshAdminData(); });
    row.append(editButton, button);
    list.appendChild(row);
  });
}

function orderItemsText(order){
  return (order.items || []).map((item) => `${escapeHtml(item.product_name)}${item.size ? ` / ${escapeHtml(item.size)}` : ""} x${escapeHtml(item.quantity)} - MAD ${Number(item.price) * Number(item.quantity || 1)}`).join(" | ");
}

async function renderAdminOrderList(){
  const list = document.getElementById("adminOrderList");
  if(!list){ return; }
  const orders = await apiGet(API.orders).catch(() => []);
  list.innerHTML = "";
  if(!orders.length){ list.appendChild(createEmpty("No orders yet.")); return; }
  orders.forEach((order) => {
    const card = document.createElement("article");
    card.className = "admin-order-card";
    const details = document.createElement("div");
    details.innerHTML = `<div class="order-head"><strong>#${escapeHtml(order.id)} - ${escapeHtml(order.customer_name)}</strong><span>${escapeHtml(order.status)}</span></div><p>${escapeHtml(order.customer_phone)} / ${escapeHtml(order.customer_city || "No city")} / ${escapeHtml(order.customer_address)}</p><p>${orderItemsText(order)}</p><p><strong>Total: MAD ${escapeHtml(order.total_price)}</strong>${order.customer_notes ? ` / ${escapeHtml(order.customer_notes)}` : ""}</p><p>Payment: ${escapeHtml(order.payment_method || "cash")} / ${escapeHtml(order.payment_status || "unpaid")}</p>`;
    const actions = document.createElement("div");
    actions.className = "admin-order-actions";
    const select = document.createElement("select");
    ORDER_STATUSES.forEach((status) => { const option = document.createElement("option"); option.value = status; option.textContent = status; if(status === order.status){ option.selected = true; } select.appendChild(option); });
    select.addEventListener("change", async () => { await apiPatch(`${API.orders}/${order.id}`, { status:select.value }); await renderAdminOrderList(); });
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit Order";
    editButton.className = "edit-btn";
    editButton.addEventListener("click", () => startEditOrder(order));
    const link = document.createElement("a");
    link.href = order.whatsapp_url || whatsappUrl(order.customer_phone, localOrderMessage(order));
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Message Client";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.className = "danger-btn";
    deleteButton.addEventListener("click", async () => {
      if(confirm(`Delete order #${order.id}?`)){ await apiDelete(`${API.orders}/${order.id}`); await refreshAdminData(); }
    });
    actions.append(select, editButton, link, deleteButton);
    card.append(details, actions);
    list.appendChild(card);
  });
}

async function renderAdminReviewList(){
  const list = document.getElementById("adminReviewList");
  if(!list){ return; }
  const reviews = await apiGet(`${API.reviews}/admin`).catch(() => []);
  list.innerHTML = "";
  if(!reviews.length){ list.appendChild(createEmpty("No customer comments yet.")); return; }
  reviews.forEach((review) => {
    const row = document.createElement("div");
    row.className = "admin-product-row admin-review-row";
    const image = review.image || review.product_image;
    row.innerHTML = `
      ${image ? `<img src="${escapeAttribute(mediaUrl(image))}" alt="">` : ""}
      <div>
        <strong>${escapeHtml(review.product_name || `Product #${review.product_id}`)} / ${escapeHtml(review.rating || 5)}/5</strong>
        <span>Order #${escapeHtml(review.order_id)} / ${escapeHtml(review.customer_name || "Customer")} / ${escapeHtml(review.customer_phone || "")}</span>
        <p>${escapeHtml(review.comment || "Photo review")}</p>
      </div>`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete Comment";
    button.className = "danger-btn";
    button.addEventListener("click", async () => {
      if(confirm("Delete this customer comment?")){
        await apiDelete(`${API.reviews}/${review.id}`);
        await renderAdminReviewList();
        await renderAdminProductList();
      }
    });
    if(!Number(review.is_approved || 0)){
      const approveButton = document.createElement("button");
      approveButton.type = "button";
      approveButton.textContent = "Approve";
      approveButton.className = "edit-btn";
      approveButton.addEventListener("click", async () => {
        await apiPatch(API.reviews + "/" + review.id, { isApproved:1 });
        await renderAdminReviewList();
        await renderAdminProductList();
      });
      row.appendChild(approveButton);
    }
    row.appendChild(button);
    list.appendChild(row);
  });
}

function populateOrderStatusSelect(selectedStatus = "pending"){
  const select = document.getElementById("editOrderStatus");
  if(!select){ return; }
  select.innerHTML = "";
  ORDER_STATUSES.forEach((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    if(status === selectedStatus){ option.selected = true; }
    select.appendChild(option);
  });
}

function resetOrderEditForm(){
  editingOrderId = null;
  const form = document.getElementById("adminOrderEditForm");
  if(form){ form.reset(); form.hidden = true; }
  const status = document.getElementById("adminOrderEditStatus");
  if(status){ status.textContent = ""; }
}

function startEditOrder(order){
  editingOrderId = order.id;
  document.getElementById("editOrderId").value = order.id;
  document.getElementById("editOrderName").value = order.customer_name || "";
  document.getElementById("editOrderPhone").value = order.customer_phone || "";
  const editCity = document.getElementById("editOrderCity");
  if(editCity){ editCity.value = order.customer_city || ""; }
  document.getElementById("editOrderAddress").value = order.customer_address || "";
  document.getElementById("editOrderNotes").value = order.customer_notes || "";
  populateOrderStatusSelect(order.status || "pending");
  const form = document.getElementById("adminOrderEditForm");
  if(form){ form.hidden = false; form.scrollIntoView({ behavior:"smooth", block:"nearest" }); }
  const status = document.getElementById("adminOrderEditStatus");
  if(status){ status.textContent = `Editing order #${order.id}`; }
}
async function refreshAdminData(){
  const categories = await apiGet(API.categories).catch(() => []);
  const products = await apiGet(API.products).catch(() => []);
  const orders = await apiGet(API.orders);
  renderAdminStats(categories, products, orders);
  await refreshCategorySelect();
  await renderAdminCategoryList();
  await renderAdminProductList();
  await renderAdminOrderList();
  await renderAdminReviewList();
}

function productImageSelectionMessage(){
  return `${selectedProductImages.length} product pictures selected.`;
}

function renderImagePreviewGrid(preview, images, onRemove){
  if(!preview){ return; }
  preview.innerHTML = "";
  if(!images.length){ preview.hidden = true; return; }
  images.forEach((src, index) => {
    const item = document.createElement("div");
    item.className = "admin-preview-item";
    const image = document.createElement("img");
    image.src = mediaUrl(src);
    image.alt = "Product preview";
    item.appendChild(image);
    if(onRemove){
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Remove";
      button.addEventListener("click", () => onRemove(index));
      item.appendChild(button);
    }
    preview.appendChild(item);
  });
  preview.hidden = false;
}

function syncProductImageRequired(){
  const input = document.getElementById("productImage");
  if(input){ input.required = !editingProductId && selectedProductImages.length === 0; }
}

function renderSelectedProductImages(){
  const preview = document.getElementById("adminImagePreview");
  renderImagePreviewGrid(preview, selectedProductImages, (index) => {
    selectedProductImages.splice(index, 1);
    renderSelectedProductImages();
    const status = document.getElementById("adminProductStatus");
    if(status){ status.textContent = selectedProductImages.length ? productImageSelectionMessage() : "No product pictures selected."; }
  });
  syncProductImageRequired();
}
function bindProductPreview(){
  const input = document.getElementById("productImage");
  const preview = document.getElementById("adminImagePreview");
  if(!input || !preview){ return; }
  input.addEventListener("change", async () => {
    const images = await readImageFiles(input.files);
    selectedProductImages = selectedProductImages.concat(images);
    input.value = "";
    renderSelectedProductImages();
    const status = document.getElementById("adminProductStatus");
    if(status){ status.textContent = productImageSelectionMessage(); }
  });
}
function bindPreview(inputId, previewId){
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if(!input || !preview){ return; }
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if(!file){ preview.hidden = true; return; }
    preview.src = await readImageFile(file);
    preview.hidden = false;
  });
}

function categorySubmitButton(){ return document.querySelector("#adminCategoryForm button[type='submit']"); }
function productSubmitButton(){ return document.querySelector("#adminProductForm button[type='submit']"); }

function resetCategoryForm(){
  editingCategoryId = null;
  const form = document.getElementById("adminCategoryForm");
  if(form){ form.reset(); }
  const imageInput = document.getElementById("categoryImage");
  if(imageInput){ imageInput.required = true; }
  const preview = document.getElementById("categoryImagePreview");
  if(preview){ preview.hidden = true; preview.removeAttribute("src"); }
  const button = categorySubmitButton();
  if(button){ button.textContent = "Add Category"; }
}

function startEditCategory(category){
  editingCategoryId = category.id;
  document.getElementById("categoryName").value = category.name || "";
  document.getElementById("categorySlug").value = category.slug || "";
  document.getElementById("categoryDescriptionInput").value = category.description || "";
  const imageInput = document.getElementById("categoryImage");
  if(imageInput){ imageInput.required = false; imageInput.value = ""; }
  const preview = document.getElementById("categoryImagePreview");
  if(preview && category.image){ preview.src = mediaUrl(category.image); preview.hidden = false; }
  const button = categorySubmitButton();
  if(button){ button.textContent = "Update Category"; }
  const status = document.getElementById("adminCategoryStatus");
  if(status){ status.textContent = "Editing category. Choose a new image only if you want to replace it."; }
  document.querySelector('[data-panel="categoriesPanel"]')?.click();
}

function resetProductForm(){
  editingProductId = null;
  selectedProductImages = [];
  const form = document.getElementById("adminProductForm");
  if(form){ form.reset(); }
  const imageInput = document.getElementById("productImage");
  if(imageInput){ imageInput.required = true; imageInput.value = ""; }
  const preview = document.getElementById("adminImagePreview");
  if(preview){ preview.innerHTML = ""; preview.hidden = true; }
  const button = productSubmitButton();
  if(button){ button.textContent = "Add Product"; }
  syncProductImageRequired();
}

function startEditProduct(product){
  editingProductId = product.id;
  selectedProductImages = [];
  document.getElementById("productName").value = product.name || "";
  document.getElementById("productCategory").value = product.category_id || "";
  document.getElementById("productAudience").value = product.audience || "unisex";
  document.getElementById("productPrice").value = product.price || "";
  document.getElementById("productStock").value = product.stock || 0;
  const stockBySizeInput = document.getElementById("productStockBySize");
  if(stockBySizeInput){ stockBySizeInput.value = Object.entries(parseStockBySize(product.stock_by_size)).map(([size, quantity]) => `${size}:${quantity}`).join(", "); }
  document.getElementById("productSizes").value = parseSizes(product.sizes).join(", ");
  document.getElementById("productDescription").value = product.description || "";
  const imageInput = document.getElementById("productImage");
  if(imageInput){ imageInput.required = false; imageInput.value = ""; }
  const preview = document.getElementById("adminImagePreview");
  renderImagePreviewGrid(preview, productImages(product));
  const button = productSubmitButton();
  if(button){ button.textContent = "Update Product"; }
  const status = document.getElementById("adminProductStatus");
  if(status){ status.textContent = "Editing product. Choose a new image only if you want to replace it."; }
  syncProductImageRequired();
  document.querySelector('[data-panel="productsPanel"]')?.click();
}
function bindAdminDownloads(){
  document.querySelectorAll("[data-admin-download]").forEach((link) => {
    if(link.dataset.bound === "true"){ return; }
    link.dataset.bound = "true";
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      const status = document.getElementById("adminToolsStatus");
      if(status){ status.textContent = "Preparing download..."; }
      try{
        const response = await fetch(API_BASE + link.getAttribute("href"), { headers:adminHeaders() });
        if(!response.ok){
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "Could not export data.");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const download = document.createElement("a");
        download.href = url;
        download.download = link.dataset.adminDownload || "store-export";
        document.body.appendChild(download);
        download.click();
        download.remove();
        URL.revokeObjectURL(url);
        if(status){ status.textContent = "Download ready."; }
      }catch(error){
        if(status){ status.textContent = error.message; }
      }
    });
  });
}

function initAdminPage(){
  const loginBox = document.getElementById("adminLogin");
  const dashboard = document.getElementById("adminDashboard");
  if(!loginBox || !dashboard){ return; }
  initAdminTabs();
  bindAdminDownloads();
  bindPreview("categoryImage", "categoryImagePreview");
  bindProductPreview();
  const productForm = document.getElementById("adminProductForm");
  if(productForm){ productForm.noValidate = true; }
  const showDashboard = async () => {
    const status = document.getElementById("adminLoginStatus");
    const isLoggedIn = localStorage.getItem(ADMIN_SESSION_KEY) === "true" && !!localStorage.getItem(ADMIN_TOKEN_KEY);
    loginBox.hidden = isLoggedIn;
    dashboard.hidden = !isLoggedIn;
    if(isLoggedIn){
      try{
        await refreshAdminData();
      }catch(error){
        clearAdminSession();
        loginBox.hidden = false;
        dashboard.hidden = true;
        if(status){ status.textContent = error.message || "Please log in again."; }
      }
    }
  };
  document.getElementById("adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = document.getElementById("adminUsername").value.trim();
    const password = document.getElementById("adminPassword").value.trim();
    const status = document.getElementById("adminLoginStatus");
    status.textContent = "Logging in...";
    try{
      const result = await apiPost(API.adminLogin, { username, password });
      localStorage.setItem(ADMIN_SESSION_KEY, "true");
      localStorage.setItem(ADMIN_TOKEN_KEY, result.token);
      status.textContent = "";
      await showDashboard();
    }catch(error){ status.textContent = error.message; }
  });
  document.getElementById("adminLogoutBtn").addEventListener("click", async () => { clearAdminSession(); await showDashboard(); });
  populateOrderStatusSelect();
  document.getElementById("cancelOrderEditBtn")?.addEventListener("click", resetOrderEditForm);
  document.getElementById("adminOrderEditForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if(!editingOrderId){ return; }
    const status = document.getElementById("adminOrderEditStatus");
    if(status){ status.textContent = "Saving order..."; }
    try{
      await apiPatch(`${API.orders}/${editingOrderId}`, {
        customerName:document.getElementById("editOrderName").value.trim(),
        customerPhone:document.getElementById("editOrderPhone").value.trim(),
        customerCity:document.getElementById("editOrderCity")?.value.trim() || "",
        customerAddress:document.getElementById("editOrderAddress").value.trim(),
        customerNotes:document.getElementById("editOrderNotes").value.trim(),
        status:document.getElementById("editOrderStatus").value
      });
      resetOrderEditForm();
      await renderAdminOrderList();
    }catch(error){ if(status){ status.textContent = error.message; } }
  });
  document.getElementById("adminCategoryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.getElementById("adminCategoryStatus");
    const file = document.getElementById("categoryImage").files[0];
    if(!file && !editingCategoryId){ status.textContent = "Choose a category picture."; return; }
    const isEditingCategory = !!editingCategoryId;
    status.textContent = isEditingCategory ? "Updating category..." : "Saving category...";
    try{
      const payload = { name:document.getElementById("categoryName").value.trim(), slug:document.getElementById("categorySlug").value.trim(), description:document.getElementById("categoryDescriptionInput").value.trim() };
      if(file){ payload.image = await readImageFile(file); }
      if(editingCategoryId){ await apiPatch(`${API.categories}/${editingCategoryId}`, payload); }
      else{ await apiPost(API.categories, payload); }
      resetCategoryForm(); status.textContent = isEditingCategory ? "Category updated." : "Category saved."; await refreshAdminData();
    }catch(error){ status.textContent = error.message; }
  });
  document.getElementById("adminProductForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.getElementById("adminProductStatus");
    if(!selectedProductImages.length && !editingProductId){ status.textContent = "Choose at least one product picture."; return; }
    const isEditingProduct = !!editingProductId;
    status.textContent = isEditingProduct ? "Updating product..." : "Saving product...";
    try{
      const payload = { name:document.getElementById("productName").value.trim(), categoryId:document.getElementById("productCategory").value, audience:document.getElementById("productAudience").value, price:Number(document.getElementById("productPrice").value), stock:Number(document.getElementById("productStock").value || 0), stockBySize:document.getElementById("productStockBySize")?.value || "", sizes:document.getElementById("productSizes").value, description:document.getElementById("productDescription").value.trim() };
      if(selectedProductImages.length){ payload.images = selectedProductImages; }
      if(editingProductId){ await apiPatch(`${API.products}/${editingProductId}`, payload); }
      else{ await apiPost(API.products, payload); }
      resetProductForm(); status.textContent = isEditingProduct ? "Product updated." : "Product saved."; await refreshAdminData();
    }catch(error){ status.textContent = error.message; }
  });
  showDashboard();
}

function initHeroSlideshow(){
  const slides = Array.from(document.querySelectorAll(".hero-slide"));
  if(slides.length < 2){ return; }
  let index = slides.findIndex((slide) => slide.classList.contains("active"));
  if(index < 0){ index = 0; slides[0].classList.add("active"); }
  window.setInterval(() => {
    const current = slides[index];
    index = (index + 1) % slides.length;
    const next = slides[index];
    current.classList.remove("active");
    next.classList.add("active");
  }, 500);
}

window.history.scrollRestoration = "manual";
window.addEventListener("pagehide", saveScrollPosition);
window.addEventListener("beforeunload", saveScrollPosition);
window.addEventListener("scroll", () => {
  window.clearTimeout(window.__fashionScrollSaveTimer);
  window.__fashionScrollSaveTimer = window.setTimeout(saveScrollPosition, 120);
}, { passive:true });

window.addEventListener("load", () => {
  updateCartCount();
  initHeroSlideshow();
  renderHomeCategories();
  renderHomeProducts();
  renderCategoryPage();
  renderCartPage();
  initPaymentMethods();
  initTrackPage();
  initAdminPage();
  restoreScrollPosition();
});



