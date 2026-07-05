let cart = JSON.parse(localStorage.getItem("cart")) || [];

const ADMIN_SESSION_KEY = "fashionAdminLoggedIn";
const ADMIN_TOKEN_KEY = "fashionAdminToken";
const API_BASE = (() => {
  const isStaticPreview = window.location.protocol === "file:" || (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port !== "3000");
  return isStaticPreview ? "http://localhost:3000" : "";
})();
const API = {
  categories:`${API_BASE}/api/categories`,
  products:`${API_BASE}/api/products`
};

function mediaUrl(path){
  if(!path){ return ""; }
  if(path.startsWith("http") || path.startsWith("assets/")){ return path; }
  return `${API_BASE}/${path}`;
}

function saveCart(){
  localStorage.setItem("cart", JSON.stringify(cart));
}

function updateCartCount(){
  cart = JSON.parse(localStorage.getItem("cart")) || [];
  const cartCount = document.getElementById("cartCount");
  if(cartCount){ cartCount.innerText = cart.length; }
}

function adminHeaders(extra = {}){
  return Object.assign({}, extra, { "x-admin-auth":localStorage.getItem(ADMIN_TOKEN_KEY) || "" });
}

async function apiGet(url){
  const response = await fetch(url);
  if(!response.ok){ throw new Error("Could not load store data."); }
  return response.json();
}

async function apiPost(url, data){
  const response = await fetch(url, {
    method:"POST",
    headers:adminHeaders({ "Content-Type":"application/json" }),
    body:JSON.stringify(data)
  });
  const result = await response.json().catch(() => ({}));
  if(!response.ok){ throw new Error(result.error || "Could not save."); }
  return result;
}

async function apiDelete(url){
  const response = await fetch(url, { method:"DELETE", headers:adminHeaders() });
  const result = await response.json().catch(() => ({}));
  if(!response.ok){ throw new Error(result.error || "Could not delete."); }
  return result;
}

function getNav(){
  return document.getElementById("navMenu") || document.querySelector("nav");
}

function toggleMenu(){
  const nav = getNav();
  if(nav){ nav.classList.toggle("active"); }
}

function closeSearch(){
  const searchPanel = document.getElementById("searchPanel");
  const input = document.getElementById("searchInput");
  if(input){ input.value = ""; }
  if(searchPanel){ searchPanel.style.display = "none"; }
}

function searchProduct(event){
  if(event.key !== "Enter"){ return; }
  const value = event.target.value.trim();
  if(value){ window.location.href = `category.html?search=${encodeURIComponent(value)}`; }
}

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
  try{
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  }catch(error){
    return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function addToCart(product, price, size = ""){
  cart.push({ name:product, price:Number(price), size });
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
  price.textContent = `MAD${product.price}`;

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

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Add to Cart";
  button.addEventListener("click", () => addToCart(product.name, product.price, select ? select.value : ""));

  card.append(image, title, price);
  if(product.description){
    const description = document.createElement("small");
    description.textContent = product.description;
    card.appendChild(description);
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
  if(!categories.length){
    grid.appendChild(createEmpty("Collections are coming soon."));
    return;
  }
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

  if(!products.length){
    container.appendChild(createEmpty("Products are coming soon."));
    return;
  }

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

  if(!cart.length){
    container.appendChild(createEmpty("Your cart is empty."));
    totalPrice.textContent = "Total: MAD 0";
    return;
  }

  let total = 0;
  cart.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "cart-item";
    const details = document.createElement("span");
    details.textContent = `${item.name}${item.size ? ` / ${item.size}` : ""} - MAD ${item.price}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Remove";
    button.addEventListener("click", () => {
      cart.splice(index, 1);
      saveCart();
      updateCartCount();
      renderCartPage();
    });
    row.append(details, button);
    container.appendChild(row);
    total += Number(item.price) || 0;
  });

  totalPrice.textContent = `Total: MAD ${total}`;
}

function sendOrder(){
  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const address = document.getElementById("customerAddress").value.trim();

  if(!name || !phone || !address){ alert("Please fill all fields"); return; }
  cart = JSON.parse(localStorage.getItem("cart")) || [];
  if(!cart.length){ alert("Your cart is empty"); return; }

  let total = 0;
  const lines = cart.map((item) => {
    total += Number(item.price) || 0;
    return `${item.name}${item.size ? ` / ${item.size}` : ""} - MAD ${item.price}`;
  });
  const message = ["New Order", "", ...lines, "", `Name: ${name}`, `Phone: ${phone}`, `Address: ${address}`, `Total: MAD ${total}`].join("\n");
  window.open(`https://wa.me/212775089960?text=${encodeURIComponent(message)}`, "_blank");
}

function initAdminTabs(){
  document.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".admin-panel").forEach((panel) => panel.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.panel).classList.add("active");
    });
  });
}

async function refreshCategorySelect(){
  const select = document.getElementById("productCategory");
  if(!select){ return; }
  const categories = await apiGet(API.categories).catch(() => []);
  select.innerHTML = "";
  if(!categories.length){
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Add a category first";
    select.appendChild(option);
    return;
  }
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    select.appendChild(option);
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
    row.innerHTML = `<img src="${mediaUrl(category.image)}" alt=""><div><strong>${category.name}</strong><span>${category.slug}</span></div>`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete";
    button.addEventListener("click", async () => {
      await apiDelete(`${API.categories}/${category.id}`);
      await refreshAdminData();
    });
    row.appendChild(button);
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
    row.innerHTML = `<img src="${mediaUrl(product.image)}" alt=""><div><strong>${product.name}</strong><span>${product.category_name || product.category} / MAD${product.price} / ${sizes}</span></div>`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete";
    button.addEventListener("click", async () => {
      await apiDelete(`${API.products}/${product.id}`);
      await refreshAdminData();
    });
    row.appendChild(button);
    list.appendChild(row);
  });
}

async function refreshAdminData(){
  await refreshCategorySelect();
  await renderAdminCategoryList();
  await renderAdminProductList();
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

function initAdminPage(){
  const loginBox = document.getElementById("adminLogin");
  const dashboard = document.getElementById("adminDashboard");
  if(!loginBox || !dashboard){ return; }

  initAdminTabs();
  bindPreview("categoryImage", "categoryImagePreview");
  bindPreview("productImage", "adminImagePreview");

  const showDashboard = async () => {
    const isLoggedIn = localStorage.getItem(ADMIN_SESSION_KEY) === "true";
    loginBox.hidden = isLoggedIn;
    dashboard.hidden = !isLoggedIn;
    if(isLoggedIn){ await refreshAdminData(); }
  };

  document.getElementById("adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = document.getElementById("adminUsername").value.trim();
    const password = document.getElementById("adminPassword").value.trim();
    const status = document.getElementById("adminLoginStatus");
    if(username === "admin" && password === "admin123"){
      localStorage.setItem(ADMIN_SESSION_KEY, "true");
      localStorage.setItem(ADMIN_TOKEN_KEY, password);
      status.textContent = "";
      await showDashboard();
    }else{
      status.textContent = "Wrong username or password.";
    }
  });

  document.getElementById("adminLogoutBtn").addEventListener("click", async () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    await showDashboard();
  });

  document.getElementById("adminCategoryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.getElementById("adminCategoryStatus");
    const file = document.getElementById("categoryImage").files[0];
    if(!file){ status.textContent = "Choose a category picture."; return; }
    status.textContent = "Saving category...";
    try{
      await apiPost(API.categories, {
        name:document.getElementById("categoryName").value.trim(),
        slug:document.getElementById("categorySlug").value.trim(),
        description:document.getElementById("categoryDescriptionInput").value.trim(),
        image:await readImageFile(file)
      });
      event.target.reset();
      document.getElementById("categoryImagePreview").hidden = true;
      status.textContent = "Category saved.";
      await refreshAdminData();
    }catch(error){ status.textContent = error.message; }
  });

  document.getElementById("adminProductForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.getElementById("adminProductStatus");
    const file = document.getElementById("productImage").files[0];
    if(!file){ status.textContent = "Choose a product picture."; return; }
    status.textContent = "Saving product...";
    try{
      await apiPost(API.products, {
        name:document.getElementById("productName").value.trim(),
        categoryId:document.getElementById("productCategory").value,
        price:Number(document.getElementById("productPrice").value),
        stock:Number(document.getElementById("productStock").value || 0),
        sizes:document.getElementById("productSizes").value,
        description:document.getElementById("productDescription").value.trim(),
        image:await readImageFile(file)
      });
      event.target.reset();
      document.getElementById("adminImagePreview").hidden = true;
      status.textContent = "Product saved.";
      await refreshAdminData();
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