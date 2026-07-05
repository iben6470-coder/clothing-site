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