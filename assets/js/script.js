let cart = JSON.parse(localStorage.getItem("cart")) || [];
let editingCategoryId = null;
let editingProductId = null;

const ADMIN_SESSION_KEY = "fashionAdminLoggedIn";
const ADMIN_TOKEN_KEY = "fashionAdminToken";
const STORE_WHATSAPP = String(window.FASHION_STORE_WHATSAPP || "212775089960").replace(/[^0-9]/g, "");
const API_BASE = (() => {
  const configuredApi = String(window.FASHION_API_BASE || "").replace(/\/$/, "");
  if(configuredApi){ return configuredApi; }
  const isLocalPreview = window.location.protocol === "file:" || (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port !== "3000");
  return isLocalPreview ? "http://localhost:3000" : "";
})();
const USE_BROWSER_STORE = !API_BASE && !["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.hostname !== "";
const STORE_KEYS = {
  categories:"fashionLocalCategories",
  products:"fashionLocalProducts",
  orders:"fashionLocalOrders"
};
const API = {
  adminLogin:`${API_BASE}/api/admin/login`,
  categories:`${API_BASE}/api/categories`,
  products:`${API_BASE}/api/products`,
  orders:`${API_BASE}/api/orders`
};
const ORDER_STATUSES = ["pending", "confirmed", "preparing", "delivered", "cancelled"];

function mediaUrl(path){
  if(!path){ return ""; }
  if(path.startsWith("http") || path.startsWith("assets/") || path.startsWith("data:image/")){ return path; }
  return `${API_BASE}/${path}`;
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
  return Object.assign({}, extra, { "x-admin-auth":localStorage.getItem(ADMIN_TOKEN_KEY) || "" });
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
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(message)}`;
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
    `Salam ${order.customer_name}, your Fashion Store order #${order.id} is confirmed.`,
    `Total: MAD ${order.total_price}`,
    "We will contact you soon for delivery details."
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
    return readStore(STORE_KEYS.products)
      .filter((product) => product.is_active !== 0)
      .filter((product) => !categorySlug || product.category_slug === categorySlug || product.category === categorySlug)
      .sort((a, b) => b.id - a.id);
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
    if(data.username === "admin" && data.password === "admin123"){
      return { ok:true, token:"browser-admin", username:"admin" };
    }
    throw new Error("Wrong username or password");
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
    if(!name || !Number.isFinite(price) || price <= 0 || !category){ throw new Error("Name, price, and category are required"); }
    if(!data.image){ throw new Error("Product image is required"); }
    const product = {
      id:Date.now(), name, category:category.slug, category_id:category.id, category_name:category.name, category_slug:category.slug,
      price, description:String(data.description || "").trim(), image:data.image,
      sizes:JSON.stringify(parseSizes(data.sizes)), stock:Number(data.stock || 0), is_active:1, created_at:new Date().toISOString()
    };
    writeStore(STORE_KEYS.products, products.concat(product));
    return product;
  }
  if(parsed.pathname.endsWith("/api/orders")){
    const orders = readStore(STORE_KEYS.orders);
    const items = Array.isArray(data.items) ? data.items : [];
    const total = items.reduce((sum, item) => sum + (Number(item.price) || 0) * Number(item.quantity || 1), 0);
    if(!data.customerName || !data.customerPhone || !data.customerAddress || !items.length){ throw new Error("Name, phone, address, and cart items are required"); }
    const order = {
      id:Date.now(), customer_name:data.customerName, customer_phone:data.customerPhone, customer_address:data.customerAddress,
      customer_notes:data.customerNotes || "", total_price:total, status:"pending", created_at:new Date().toISOString(),
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
        image:data.image || product.image,
        sizes:JSON.stringify(parseSizes(data.sizes ?? product.sizes)),
        stock:Number(data.stock ?? product.stock ?? 0)
      });
    });
    writeStore(STORE_KEYS.products, updated);
    return updated.find((product) => String(product.id) === String(id));
  }
  if(parsed.pathname.includes("/api/orders/")){
    const orders = readStore(STORE_KEYS.orders);
    const updated = orders.map((order) => String(order.id) === String(id) ? Object.assign({}, order, { status:data.status }) : order);
    writeStore(STORE_KEYS.orders, updated);
    return attachOrderHelpers(updated.find((order) => String(order.id) === String(id)));
  }
  throw new Error("Could not update.");
}

async function apiGet(url){
  if(USE_BROWSER_STORE){ return localGet(url); }
  const response = await fetch(url, { headers:adminHeaders() });
  if(!response.ok){ throw new Error("Could not load store data."); }
  return response.json();
}

async function apiPost(url, data){
  if(USE_BROWSER_STORE){ return localPost(url, data); }
  const response = await fetch(url, { method:"POST", headers:adminHeaders({ "Content-Type":"application/json" }), body:JSON.stringify(data) });
  const result = await response.json().catch(() => ({}));
  if(!response.ok){ throw new Error(result.error || "Could not save."); }
  return result;
}

async function apiPatch(url, data){
  if(USE_BROWSER_STORE){ return localPatch(url, data); }
  const response = await fetch(url, { method:"PATCH", headers:adminHeaders({ "Content-Type":"application/json" }), body:JSON.stringify(data) });
  const result = await response.json().catch(() => ({}));
  if(!response.ok){ throw new Error(result.error || "Could not update."); }
  return result;
}

async function apiDelete(url){
  if(USE_BROWSER_STORE){ return localDelete(url); }
  const response = await fetch(url, { method:"DELETE", headers:adminHeaders() });
  const result = await response.json().catch(() => ({}));
  if(!response.ok){ throw new Error(result.error || "Could not delete."); }
  return result;
}

function getNav(){ return document.getElementById("navMenu") || document.querySelector("nav"); }
function toggleMenu(){ const nav = getNav(); if(nav){ nav.classList.toggle("active"); } }
function closeSearch(){ const searchPanel = document.getElementById("searchPanel"); const input = document.getElementById("searchInput"); if(input){ input.value = ""; } if(searchPanel){ searchPanel.style.display = "none"; } }
function searchProduct(event){ if(event.key !== "Enter"){ return; } const value = event.target.value.trim(); if(value){ window.location.href = `category.html?search=${encodeURIComponent(value)}`; } }

function readImageFile(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function parseSizes(value){
  if(Array.isArray(value)){ return value; }
  try{ const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; }
  catch(error){ return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
}

function cartItemKey(productId, size){ return `${productId || "manual"}:${size || ""}`; }

function addToCart(product, size = ""){
  const item = cart.find((entry) => cartItemKey(entry.productId, entry.size) === cartItemKey(product.id, size));
  if(item){ item.quantity = Number(item.quantity || 1) + 1; }
  else{
    cart.push({ productId:product.id, name:product.name, price:Number(product.price), size, quantity:1, image:product.image || "" });
  }
  saveCart();
  updateCartCount();
}

function createEmpty(message){
  const empty = document.createElement("p");
  empty.className = "product-empty";
  empty.textContent = message;
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
  const image = document.createElement("img");
  image.src = mediaUrl(product.image);
  image.alt = product.name;
  const title = document.createElement("h3");
  title.textContent = product.name;
  const price = document.createElement("p");
  price.textContent = `MAD ${product.price}`;
  const sizes = parseSizes(product.sizes);
  let select = null;
  if(sizes.length){
    select = document.createElement("select");
    select.className = "size-select";
    sizes.forEach((size) => {
      const option = document.createElement("option");
      option.value = size;
      option.textContent = size;
      select.appendChild(option);
    });
  }
  const stock = Number(product.stock || 0);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = stock <= 0 ? "Out of Stock" : "Add to Cart";
  button.disabled = stock <= 0;
  button.addEventListener("click", () => addToCart(product, select ? select.value : ""));
  card.append(image, title, price);
  if(product.description){ const description = document.createElement("small"); description.textContent = product.description; card.appendChild(description); }
  if(stock > 0){ const stockText = document.createElement("small"); stockText.textContent = `${stock} available`; card.appendChild(stockText); }
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

async function renderCategoryPage(){
  const container = document.getElementById("categoryProducts") || document.querySelector(".product-container[data-managed-products]");
  if(!container){ return; }
  const params = new URLSearchParams(window.location.search);
  const categorySlug = params.get("category") || currentLegacyCategory();
  const search = (params.get("search") || "").toLowerCase();
  const title = document.getElementById("categoryTitle");
  const description = document.getElementById("categoryDescription");
  container.innerHTML = "";
  const categories = await apiGet(API.categories).catch(() => []);
  let products = await apiGet(categorySlug ? `${API.products}?category=${encodeURIComponent(categorySlug)}` : API.products).catch(() => []);
  if(search){
    products = products.filter((product) => product.name.toLowerCase().includes(search));
    if(title){ title.textContent = `Search: ${search}`; }
    if(description){ description.textContent = "Products matching your search."; }
  }else{
    const category = categories.find((item) => item.slug === categorySlug);
    if(title){ title.textContent = category ? category.name : "Products"; }
    if(description){ description.textContent = category?.description || "Explore available products."; }
  }
  if(!products.length){ container.appendChild(createEmpty("Products are coming soon.")); return; }
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
  if(!cart.length){ container.appendChild(createEmpty("Your cart is empty.")); totalPrice.textContent = "Total: MAD 0"; return; }
  let total = 0;
  cart.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    const details = document.createElement("span");
    const quantity = Number(item.quantity || 1);
    details.textContent = `${item.name}${item.size ? ` / ${item.size}` : ""} x${quantity} - MAD ${Number(item.price) * quantity}`;
    const controls = document.createElement("div");
    controls.className = "cart-controls";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "-";
    minus.addEventListener("click", () => { item.quantity = Math.max(1, quantity - 1); saveCart(); updateCartCount(); renderCartPage(); });
    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.addEventListener("click", () => { item.quantity = quantity + 1; saveCart(); updateCartCount(); renderCartPage(); });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => { cart.splice(index, 1); saveCart(); updateCartCount(); renderCartPage(); });
    controls.append(minus, plus, remove);
    row.append(details, controls);
    container.appendChild(row);
    total += Number(item.price) * quantity;
  });
  totalPrice.textContent = `Total: MAD ${total}`;
}

function ownerOrderMessage(order){
  const lines = (order.items || []).map((item) => `${item.product_name || item.name}${item.size ? ` / ${item.size}` : ""} x${item.quantity || 1} - MAD ${Number(item.price) * Number(item.quantity || 1)}`);
  return [`New Order #${order.id}`, "", ...lines, "", `Name: ${order.customer_name}`, `Phone: ${order.customer_phone}`, `Address: ${order.customer_address}`, order.customer_notes ? `Notes: ${order.customer_notes}` : "", `Total: MAD ${order.total_price}`].filter(Boolean).join("\n");
}

async function sendOrder(){
  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const address = document.getElementById("customerAddress").value.trim();
  const notes = (document.getElementById("customerNotes")?.value || "").trim();
  const status = document.getElementById("orderStatus");
  if(!name || !phone || !address){ alert("Please fill all fields"); return; }
  cart = JSON.parse(localStorage.getItem("cart")) || [];
  if(!cart.length){ alert("Your cart is empty"); return; }
  if(status){ status.textContent = "Saving your order..."; }
  try{
    const order = await apiPost(API.orders, { customerName:name, customerPhone:phone, customerAddress:address, customerNotes:notes, items:cart });
    localStorage.removeItem("cart");
    cart = [];
    updateCartCount();
    renderCartPage();
    if(status){ status.textContent = `Order #${order.id} saved. WhatsApp is opening now.`; }
    window.open(whatsappUrl(STORE_WHATSAPP, ownerOrderMessage(order)), "_blank");
  }catch(error){
    if(status){ status.textContent = error.message; }
    else{ alert(error.message); }
  }
}

function initAdminTabs(){
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((item) => { item.classList.remove("active"); item.setAttribute("aria-selected", "false"); });
      document.querySelectorAll(".admin-panel").forEach((panel) => panel.classList.remove("active"));
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      document.getElementById(tab.dataset.panel).classList.add("active");
    });
  });
}

async function refreshCategorySelect(){
  const select = document.getElementById("productCategory");
  if(!select){ return; }
  const categories = await apiGet(API.categories).catch(() => []);
  select.innerHTML = "";
  if(!categories.length){ const option = document.createElement("option"); option.value = ""; option.textContent = "Add a category first"; select.appendChild(option); return; }
  categories.forEach((category) => { const option = document.createElement("option"); option.value = category.id; option.textContent = category.name; select.appendChild(option); });
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
    row.innerHTML = `<img src="${mediaUrl(category.image)}" alt=""><div><strong>${category.name}</strong><span>${category.slug}</span></div>`;
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
    const row = document.createElement("div");
    row.className = "admin-product-row";
    row.innerHTML = `<img src="${mediaUrl(product.image)}" alt=""><div><strong>${product.name}</strong><span>${product.category_name || product.category} / MAD ${product.price} / Stock ${product.stock || 0} / ${sizes}</span></div>`;
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
  return (order.items || []).map((item) => `${item.product_name}${item.size ? ` / ${item.size}` : ""} x${item.quantity} - MAD ${Number(item.price) * Number(item.quantity || 1)}`).join(" | ");
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
    details.innerHTML = `<div class="order-head"><strong>#${order.id} - ${order.customer_name}</strong><span>${order.status}</span></div><p>${order.customer_phone} / ${order.customer_address}</p><p>${orderItemsText(order)}</p><p><strong>Total: MAD ${order.total_price}</strong>${order.customer_notes ? ` / ${order.customer_notes}` : ""}</p>`;
    const actions = document.createElement("div");
    actions.className = "admin-order-actions";
    const select = document.createElement("select");
    ORDER_STATUSES.forEach((status) => { const option = document.createElement("option"); option.value = status; option.textContent = status; if(status === order.status){ option.selected = true; } select.appendChild(option); });
    select.addEventListener("change", async () => { await apiPatch(`${API.orders}/${order.id}`, { status:select.value }); await renderAdminOrderList(); });
    const link = document.createElement("a");
    link.href = order.whatsapp_url || whatsappUrl(order.customer_phone, localOrderMessage(order));
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Message Client";
    actions.append(select, link);
    card.append(details, actions);
    list.appendChild(card);
  });
}

async function refreshAdminData(){
  await refreshCategorySelect();
  await renderAdminCategoryList();
  await renderAdminProductList();
  await renderAdminOrderList();
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
  const form = document.getElementById("adminProductForm");
  if(form){ form.reset(); }
  const imageInput = document.getElementById("productImage");
  if(imageInput){ imageInput.required = true; }
  const preview = document.getElementById("adminImagePreview");
  if(preview){ preview.hidden = true; preview.removeAttribute("src"); }
  const button = productSubmitButton();
  if(button){ button.textContent = "Add Product"; }
}

function startEditProduct(product){
  editingProductId = product.id;
  document.getElementById("productName").value = product.name || "";
  document.getElementById("productCategory").value = product.category_id || "";
  document.getElementById("productPrice").value = product.price || "";
  document.getElementById("productStock").value = product.stock || 0;
  document.getElementById("productSizes").value = parseSizes(product.sizes).join(", ");
  document.getElementById("productDescription").value = product.description || "";
  const imageInput = document.getElementById("productImage");
  if(imageInput){ imageInput.required = false; imageInput.value = ""; }
  const preview = document.getElementById("adminImagePreview");
  if(preview && product.image){ preview.src = mediaUrl(product.image); preview.hidden = false; }
  const button = productSubmitButton();
  if(button){ button.textContent = "Update Product"; }
  const status = document.getElementById("adminProductStatus");
  if(status){ status.textContent = "Editing product. Choose a new image only if you want to replace it."; }
  document.querySelector('[data-panel="productsPanel"]')?.click();
}
function initAdminPage(){
  const loginBox = document.getElementById("adminLogin");
  const dashboard = document.getElementById("adminDashboard");
  if(!loginBox || !dashboard){ return; }
  initAdminTabs();
  bindPreview("categoryImage", "categoryImagePreview");
  bindPreview("productImage", "adminImagePreview");
  const showDashboard = async () => {
    const isLoggedIn = localStorage.getItem(ADMIN_SESSION_KEY) === "true" && !!localStorage.getItem(ADMIN_TOKEN_KEY);
    loginBox.hidden = isLoggedIn;
    dashboard.hidden = !isLoggedIn;
    if(isLoggedIn){ await refreshAdminData(); }
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
  document.getElementById("adminLogoutBtn").addEventListener("click", async () => { localStorage.removeItem(ADMIN_SESSION_KEY); localStorage.removeItem(ADMIN_TOKEN_KEY); await showDashboard(); });
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
    const file = document.getElementById("productImage").files[0];
    if(!file && !editingProductId){ status.textContent = "Choose a product picture."; return; }
    const isEditingProduct = !!editingProductId;
    status.textContent = isEditingProduct ? "Updating product..." : "Saving product...";
    try{
      const payload = { name:document.getElementById("productName").value.trim(), categoryId:document.getElementById("productCategory").value, price:Number(document.getElementById("productPrice").value), stock:Number(document.getElementById("productStock").value || 0), sizes:document.getElementById("productSizes").value, description:document.getElementById("productDescription").value.trim() };
      if(file){ payload.image = await readImageFile(file); }
      if(editingProductId){ await apiPatch(`${API.products}/${editingProductId}`, payload); }
      else{ await apiPost(API.products, payload); }
      resetProductForm(); status.textContent = isEditingProduct ? "Product updated." : "Product saved."; await refreshAdminData();
    }catch(error){ status.textContent = error.message; }
  });
  showDashboard();
}

window.addEventListener("load", () => {
  updateCartCount();
  renderHomeCategories();
  renderCategoryPage();
  renderCartPage();
  initAdminPage();
});