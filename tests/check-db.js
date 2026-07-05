const { all } = require("../backend/db");

(async () => {
  try {
    const products = await all("SELECT id, name, price, image FROM products");
    console.log(JSON.stringify(products, null, 2));
    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
