(function(){
  const configuredApi = String(window.FASHION_API_BASE || "").replace(/\/$/, "");
  const isLocalPreview = window.location.protocol === "file:" || (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port !== "3000");
  const apiBase = configuredApi || (isLocalPreview ? "http://localhost:3000" : "");
  const shell = document.getElementById("productDetail");
  if(!shell){ return; }

  function escapeHtml(value){ return String(value ?? "").replace(/[&<>"'`]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;", "`":"&#96;" }[char])); }
  function mediaUrl(path){ if(!path){ return ""; } if(path.startsWith("http") || path.startsWith("assets/") || path.startsWith("data:image/")){ return path; } return `${apiBase}/${path}`; }
  function parseJsonList(value){ try{ const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; }catch(error){ return []; } }
  function productImages(product){ const images = parseJsonList(product.images); if(product.image && !images.includes(product.image)){ images.unshift(product.image); } return images.filter(Boolean); }
  function normalizeSize(value){ return String(value || "").trim().toUpperCase(); }
  function parseSizes(value){ if(Array.isArray(value)){ return value.map(normalizeSize).filter(Boolean); } try{ const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.map(normalizeSize).filter(Boolean) : []; }catch(error){ return String(value || "").split(",").map(normalizeSize).filter(Boolean); } }
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
          const size = normalizeSize(parts[0]);
          const qty = Math.max(0, Math.floor(Number(parts.slice(1).join(":").trim())));
          if(size && Number.isFinite(qty)){ map[size] = qty; }
        });
        return map;
      }
    }
    if(!raw || typeof raw !== "object" || Array.isArray(raw)){ return {}; }
    return Object.keys(raw).reduce((map, key) => { const size = normalizeSize(key); const qty = Math.max(0, Math.floor(Number(raw[key] || 0))); if(size && Number.isFinite(qty)){ map[size] = qty; } return map; }, {});
  }
  function sizesFor(product){ return Array.from(new Set(parseSizes(product.sizes).concat(Object.keys(parseStockBySize(product.stock_by_size))).map(normalizeSize).filter(Boolean))); }
  function stockFor(product, size){ const map = parseStockBySize(product.stock_by_size); if(Object.keys(map).length){ return Math.max(0, Number(map[normalizeSize(size)] || 0)); } return Math.max(0, Number(product.stock || 0)); }
  function totalStock(product){ const map = parseStockBySize(product.stock_by_size); const values = Object.values(map); return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) : Math.max(0, Number(product.stock || 0)); }
  function formatMad(value){ const amount = Number(value || 0); return `MAD ${Number.isInteger(amount) ? amount : amount.toFixed(2)}`; }
  function cartKey(productId, size){ return `${productId}:${normalizeSize(size)}`; }
  function updateCount(){ const items = JSON.parse(localStorage.getItem("cart") || "[]"); const count = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0); const cartCount = document.getElementById("cartCount"); if(cartCount){ cartCount.textContent = count; } }
  function addToCart(product, size){
    const selected = normalizeSize(size);
    const stock = stockFor(product, selected);
    if(stock <= 0){ return false; }
    const cart = JSON.parse(localStorage.getItem("cart") || "[]");
    const item = cart.find((entry) => cartKey(entry.productId, entry.size) === cartKey(product.id, selected));
    if(item){ if(Number(item.quantity || 1) >= stock){ return false; } item.quantity = Number(item.quantity || 1) + 1; item.stock = stock; }
    else{ cart.push({ productId:product.id, name:product.name, price:Number(product.price), size:selected, quantity:1, stock, image:productImages(product)[0] || product.image || "" }); }
    localStorage.setItem("cart", JSON.stringify(cart));
    updateCount();
    return true;
  }

  async function apiGet(path){ const response = await fetch(`${apiBase}${path}`); const result = await response.json().catch(() => ({})); if(!response.ok){ throw new Error(result.error || "Could not load product."); } return result; }

  async function render(){
    const id = new URLSearchParams(window.location.search).get("id");
    if(!id){ shell.innerHTML = '<p class="product-empty">Product not found.</p>'; return; }
    try{
      const product = await apiGet(`/api/products/${encodeURIComponent(id)}`);
      const images = productImages(product);
      const sizes = sizesFor(product);
      const stockMap = parseStockBySize(product.stock_by_size);
      document.title = `${product.name} | Fashion Store`;
      shell.innerHTML = `
        <section class="product-detail-grid">
          <div class="product-detail-media">${images.map((src, index) => `<img src="${escapeHtml(mediaUrl(src))}" alt="${escapeHtml(product.name)} view ${index + 1}">`).join("")}</div>
          <article class="product-detail-info">
            <a class="product-detail-back" href="index.html">Back to Home</a>
            <span class="track-kicker">${escapeHtml(product.category_name || product.category || "New drop")}</span>
            <h1>${escapeHtml(product.name)}</h1>
            <p class="product-detail-price">${formatMad(product.price)}</p>
            <p>${escapeHtml(String(product.description || "Fresh piece from the current collection.").replace(/\*\*/g, ""))}</p>
            <label class="product-detail-size">Size<select id="detailSize">${sizes.length ? sizes.map((size) => `<option value="${escapeHtml(size)}" ${stockFor(product, size) <= 0 ? "disabled" : ""}>${escapeHtml(size)}${stockMap[size] !== undefined ? ` / ${stockFor(product, size)} left` : ""}</option>`).join("") : '<option value="">One size</option>'}</select></label>
            <p class="stock-note" id="detailStock"></p>
            <button type="button" id="detailAdd" class="detail-add-btn">Add to Bag</button>
            <a class="product-details-link" href="cart.html">Go to Cart</a>
          </article>
        </section>
        <section class="product-detail-reviews" id="detailReviews"><h2>Customer Reviews</h2><p>Loading reviews...</p></section>`;
      const select = document.getElementById("detailSize");
      const add = document.getElementById("detailAdd");
      const note = document.getElementById("detailStock");
      const sync = () => { const available = select ? stockFor(product, select.value) : totalStock(product); note.textContent = available > 0 ? `${available} available` : "Out of stock"; note.className = available <= 3 ? "stock-note low-stock" : "stock-note"; add.disabled = available <= 0; add.textContent = available <= 0 ? "Out of Stock" : "Add to Bag"; };
      select?.addEventListener("change", sync);
      add.addEventListener("click", () => { if(addToCart(product, select ? select.value : "")){ add.textContent = "Added to Bag"; setTimeout(sync, 1000); } });
      sync();
      const reviews = await apiGet(`/api/reviews?productId=${encodeURIComponent(product.id)}`).catch(() => []);
      const reviewShell = document.getElementById("detailReviews");
      reviewShell.innerHTML = `<h2>Customer Reviews</h2>${reviews.length ? reviews.map((item) => `<article class="customer-review"><div><strong>${escapeHtml(item.customer_name || "Customer")}</strong><span>${escapeHtml(item.rating || 5)}/5</span></div>${item.comment ? `<p>${escapeHtml(item.comment)}</p>` : ""}${item.image ? `<img src="${escapeHtml(mediaUrl(item.image))}" alt="Customer product photo">` : ""}</article>`).join("") : "<p>No approved reviews yet.</p>"}`;
    }catch(error){
      shell.innerHTML = `<p class="product-empty">${escapeHtml(error.message)}</p>`;
    }
  }
  render();
})();

