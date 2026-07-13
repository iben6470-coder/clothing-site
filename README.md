# Fashion Store

A small unisex city-focused store website with a Node/SQLite backend, no client accounts, and an admin dashboard for managing products, categories, and orders.

## Run

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Admin page:

```text
http://localhost:3000/admin.html
```

Local admin login is loaded from your private `.env` file. Do not put the admin password in HTML, JS, CSS, or README.

## Admin Can Manage

- Orders
- Order status
- WhatsApp client confirmation shortcuts
- Categories
- Category images
- Products
- Product images
- Prices
- Stock
- Sizes
- Product descriptions

## Customer Flow

- Customers browse categories and products.
- Customers add products to cart without creating an account.
- Customers fill name, phone, address, and optional delivery notes.
- The order is saved to the database.
- WhatsApp opens so the store owner can receive the order manually.
- The admin dashboard can open a ready WhatsApp confirmation message for the client.

## Project Structure

```text
.
|-- assets/
|   |-- css/style.css
|   |-- js/config.js
|   `-- js/script.js
|-- backend/
|   |-- server.js
|   `-- db.js
|-- database/
|   `-- clothing_site.db
|-- storage/
|   `-- uploads/
|-- tests/check-db.js
|-- index.html
|-- category.html
|-- cart.html
|-- support.html
|-- admin.html
|-- package.json
`-- README.md
```

## Notes

- Home categories are loaded from the database.
- Products are loaded from the database by category.
- Client orders are saved to the database and can still open WhatsApp for manual confirmation.
- Uploaded category and product images are saved in storage/uploads and served from /uploads/...
- Use http://localhost:3000, not double-clicked HTML files, when managing data.

## Hosted Database Setup

GitHub Pages is static, so the real SQLite database must run on a Node host.

1. Deploy this repository as a Node web service.
2. Keep these environment variables on the backend host:
   - `DB_PATH=/data/clothing_site.db`
   - `UPLOAD_DIR=/data/uploads`
   - `ADMIN_USERNAME=admin`
   - `ADMIN_PASSWORD=your-long-private-password`
   - `ADMIN_SECRET=your-long-random-secret`
   - `ALLOWED_ORIGINS=https://your-store-domain.com`
   - `CARD_PAYMENT_URL=https://your-secure-card-payment-link`
3. After deployment, copy the backend URL into `assets/js/config.js`:

```js
window.FASHION_API_BASE = "https://your-backend-url";
window.FASHION_STORE_WHATSAPP = "212775089960";
```

If `FASHION_API_BASE` is empty on a static host, admin/database features will not work. Use the Node backend for the real store.

## Security Notes

- Change the default local admin password before deployment.
- Keep `ADMIN_PASSWORD` and `ADMIN_SECRET` only in the host environment variables.
- Set `ALLOWED_ORIGINS` to your real website URL in production.
- Admin sessions expire automatically; log in again after they expire.
- Product/category uploads are limited to image files up to 5MB.
## Card Payments

- The site never stores card numbers.
- Customers can choose `Bank card` at checkout.
- Set `CARD_PAYMENT_URL` to your secure hosted payment page from your bank, CMI, Payzone, or another approved gateway.
- If `CARD_PAYMENT_URL` is empty, the order is saved and WhatsApp opens so you can send the payment link manually.