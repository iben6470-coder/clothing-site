let cart = JSON.parse(localStorage.getItem("cart")) || [];

const ADMIN_PRODUCTS_KEY = "fashionAdminProducts";
const ADMIN_SESSION_KEY = "fashionAdminLoggedIn";
const SERVER_MODE = window.location.protocol !== "file:";

function saveCart(){
  localStorage.setItem("cart", JSON.stringify(cart));
}

function addToCart(product, price){
  cart.push({ name: product, price: Number(price) });
  saveCart();
  updateCartCount();
}

function updateCartCount(){
  cart = JSON.parse(localStorage.getItem("cart")) || [];
  const cartCount = document.getElementById("cartCount");

  if(cartCount){
    cartCount.innerText = cart.length;
  }
}

function getNav(){
  return document.getElementById("navMenu") || document.querySelector("nav");
}

function toggleMenu(){
  const nav = getNav();
  const searchPanel = document.getElementById("searchPanel");

  if(nav){
    nav.classList.toggle("active");
  }

  if(searchPanel && nav && nav.classList.contains("active")){
    searchPanel.style.display = "none";
  }
}

function toggleSearch(){
  const nav = getNav();
  const searchPanel = document.getElementById("searchPanel");

  if(nav){
    nav.classList.remove("active");
  }

  if(searchPanel){
    const isOpen = searchPanel.style.display === "flex";
    searchPanel.style.display = isOpen ? "none" : "flex";

    if(!isOpen){
      const input = document.getElementById("searchInput");
      if(input){ input.focus(); }
    }
  }
}

function closeSearch(){
  const searchPanel = document.getElementById("searchPanel");
  const input = document.getElementById("searchInput");

  if(input){
    input.value = "";
  }

  if(searchPanel){
    searchPanel.style.display = "none";
  }
}

function searchProduct(event){
  if(event.key !== "Enter"){
    return;
  }

  const input = document.getElementById("searchInput");
  const value = input ? input.value.toLowerCase().trim() : "";

  if(value.includes("shirt") || value.includes("tshirt") || value.includes("t-shirt")){
    window.location.href = "tshirts.html";
  }else if(value.includes("jean")){
    window.location.href = "jeans.html";
  }else if(value.includes("jacket")){
    window.location.href = "jackets.html";
  }else if(value.includes("shoe") || value.includes("sneaker")){
    window.location.href = "shoes.html";
  }
}

function getLocalAdminProducts(){
  return JSON.parse(localStorage.getItem(ADMIN_PRODUCTS_KEY)) || [];
}

function saveLocalAdminProducts(products){
  localStorage.setItem(ADMIN_PRODUCTS_KEY, JSON.stringify(products));
}

async function getAdminProducts(){
  if(SERVER_MODE){
    try{
      const response = await fetch("/api/products");
      if(response.ok){
        return await response.json();
      }
    }catch(error){
      console.warn("Database API unavailable, using browser storage.");
    }
  }

  return getLocalAdminProducts();
}

async function createAdminProduct(product){
  if(SERVER_MODE){
    const response = await fetch("/api/products", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify(product)
    });

    if(response.ok){
      return await response.json();
    }

    const result = await response.json().catch(function(){ return {}; });
    throw new Error(result.error || "Could not save product in database.");
  }

  const products = getLocalAdminProducts();
  const savedProduct = Object.assign({}, product, { id: Date.now().toString() });
  products.push(savedProduct);
  saveLocalAdminProducts(products);
  return savedProduct;
}

async function deleteAdminProduct(id){
  if(SERVER_MODE){
    const response = await fetch(`/api/products/${id}`, { method:"DELETE" });
    if(response.ok){
      return;
    }
    throw new Error("Could not delete product from database.");
  }

  const updated = getLocalAdminProducts().filter(function(product){
    return product.id !== id;
  });
  saveLocalAdminProducts(updated);
}

function currentCategoryFromPage(){
  const page = window.location.pathname.split("/").pop().replace(".html", "");
  if(["tshirts", "jeans", "jackets", "shoes"].includes(page)){
    return page;
  }
  return "";
}

function createProductCard(product){
  const card = document.createElement("div");
  card.className = "product admin-added-product";

  const image = document.createElement("img");
  image.src = product.image;
  image.alt = product.name;

  const title = document.createElement("h3");
  title.textContent = product.name;

  const price = document.createElement("p");
  price.textContent = `MAD${product.price}`;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Add to Cart";
  button.addEventListener("click", function(){
    addToCart(product.name, Number(product.price));
  });

  card.append(image, title, price, button);
  return card;
}

async function renderCustomProducts(){
  const category = currentCategoryFromPage();
  if(!category){ return; }

  const container = document.querySelector(".product-container");
  if(!container){ return; }

  const products = await getAdminProducts();
  products
    .filter(function(product){ return product.category === category; })
    .forEach(function(product){ container.appendChild(createProductCard(product)); });
}

function readImageFile(file){
  return new Promise(function(resolve, reject){
    const reader = new FileReader();
    reader.onload = function(){ resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function initAdminPage(){
  const loginBox = document.getElementById("adminLogin");
  const dashboard = document.getElementById("adminDashboard");
  if(!loginBox || !dashboard){ return; }

  const loginForm = document.getElementById("adminLoginForm");
  const logoutBtn = document.getElementById("adminLogoutBtn");
  const productForm = document.getElementById("adminProductForm");
  const imageInput = document.getElementById("productImage");
  const preview = document.getElementById("adminImagePreview");
  const modeText = document.getElementById("adminStorageMode");

  if(modeText){
    modeText.textContent = SERVER_MODE ? "Database mode: data/products.json" : "Browser storage mode: run node server.js for database.";
  }

  async function showDashboard(){
    const isLoggedIn = localStorage.getItem(ADMIN_SESSION_KEY) === "true";
    loginBox.hidden = isLoggedIn;
    dashboard.hidden = !isLoggedIn;

    if(isLoggedIn){
      await renderAdminProductList();
    }
  }

  loginForm.addEventListener("submit", function(event){
    event.preventDefault();
    const username = document.getElementById("adminUsername").value.trim();
    const password = document.getElementById("adminPassword").value.trim();
    const status = document.getElementById("adminLoginStatus");

    if(username === "admin" && password === "admin123"){
      localStorage.setItem(ADMIN_SESSION_KEY, "true");
      status.textContent = "";
      showDashboard();
    }else{
      status.textContent = "Wrong username or password.";
    }
  });

  logoutBtn.addEventListener("click", function(){
    localStorage.removeItem(ADMIN_SESSION_KEY);
    showDashboard();
  });

  imageInput.addEventListener("change", async function(){
    const file = imageInput.files[0];
    if(!file){
      preview.hidden = true;
      return;
    }

    preview.src = await readImageFile(file);
    preview.hidden = false;
  });

  productForm.addEventListener("submit", async function(event){
    event.preventDefault();
    const status = document.getElementById("adminProductStatus");
    const file = imageInput.files[0];

    if(!file){
      status.textContent = "Choose a picture first.";
      return;
    }

    status.textContent = "Saving product...";

    try{
      const product = {
        name: document.getElementById("productName").value.trim(),
        price: Number(document.getElementById("productPrice").value),
        category: document.getElementById("productCategory").value,
        image: await readImageFile(file)
      };

      await createAdminProduct(product);
      productForm.reset();
      preview.hidden = true;
      status.textContent = "Product saved in database.";
      await renderAdminProductList();
    }catch(error){
      status.textContent = error.message;
    }
  });

  showDashboard();
}

async function renderAdminProductList(){
  const list = document.getElementById("adminProductList");
  if(!list){ return; }

  const products = await getAdminProducts();
  if(products.length === 0){
    list.innerHTML = '<p class="admin-empty">No products added yet.</p>';
    return;
  }

  list.innerHTML = "";
  products.forEach(function(product){
    const item = document.createElement("div");
    item.className = "admin-product-row";

    const image = document.createElement("img");
    image.src = product.image;
    image.alt = product.name;

    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = product.name;
    const meta = document.createElement("span");
    meta.textContent = `${product.category} | MAD${product.price}`;
    info.append(name, meta);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete";
    button.addEventListener("click", async function(){
      await deleteAdminProduct(product.id);
      await renderAdminProductList();
    });

    item.append(image, info, button);
    list.appendChild(item);
  });
}

window.addEventListener("load", function(){
  updateCartCount();
  renderCustomProducts();
  initAdminPage();
});