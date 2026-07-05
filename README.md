# Fashion Store

A small store website with a Node/SQLite backend and an admin account for managing everything customers see.

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

Admin login:

```text
username: admin
password: admin123
```

## Admin Can Manage

- Categories
- Category images
- Products
- Product images
- Prices
- Stock
- Sizes
- Product descriptions

## Project Structure

```text
.
|-- assets/
|   |-- css/style.css
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
- Uploaded category and product images are saved in storage/uploads and served from /uploads/...
- Use http://localhost:3000, not double-clicked HTML files, when managing data.
## Hosted Database Setup

GitHub Pages is static, so the real SQLite database must run on a Node host.

1. Deploy this repository as a Node web service.
2. Keep these environment variables on the backend host:
   - `DB_PATH=/data/clothing_site.db`
   - `UPLOAD_DIR=/data/uploads`
   - `ADMIN_PASSWORD=admin123`
3. After deployment, copy the backend URL into `assets/js/config.js`:

```js
window.FASHION_API_BASE = "https://your-backend-url";
```

If `FASHION_API_BASE` is empty on GitHub Pages, the admin uses browser storage only.
