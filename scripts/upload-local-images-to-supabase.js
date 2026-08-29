// One-time migration: upload the locally stored images (storage/uploads) to
// Supabase Storage and update the database references to the new public URLs.
//
// Usage: node scripts/upload-local-images-to-supabase.js "<service_role key>"
// Requires DATABASE_URL and SUPABASE_URL (from .env or environment).
const path = require("path");
const fs = require("fs");
const { Client } = require("pg");

function envValue(key){
  const envPath = path.join(__dirname, "..", ".env");
  if(!fs.existsSync(envPath)){ return process.env[key] || ""; }
  for(const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)){
    const index = line.indexOf("=");
    if(index > 0 && line.slice(0, index).trim() === key){
      return (process.env[key] || line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""));
    }
  }
  return process.env[key] || "";
}

const SUPABASE_URL = String(process.env.SUPABASE_URL || envValue("SUPABASE_URL") || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = String(process.argv[2] || process.env.SUPABASE_SERVICE_KEY || envValue("SUPABASE_SERVICE_KEY") || "").trim();
const DATABASE_URL = String(process.env.DATABASE_URL || envValue("DATABASE_URL") || "").trim();
const BUCKET = String(process.env.SUPABASE_STORAGE_BUCKET || "store-uploads").trim();
const UPLOAD_DIR = path.join(__dirname, "..", "storage", "uploads");

if(!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !DATABASE_URL){
  console.error("Need SUPABASE_URL, SUPABASE_SERVICE_KEY (argv[1] or env/.env) and DATABASE_URL.");
  process.exit(1);
}

function parseImageList(value){
  if(!value){ return []; }
  if(value.startsWith("[")){
    try{ const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
    catch(error){ return []; }
  }
  return [value];
}

async function uploadFile(filename){
  const localPath = path.join(UPLOAD_DIR, filename);
  const buffer = fs.readFileSync(localPath);
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/octet-stream", "x-upsert": "true" },
    body: buffer
  });
  if(!response.ok){
    throw new Error(`upload failed for ${filename} (${response.status}) ${await response.text().catch(() => "")}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filename}`;
}

(async () => {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Make sure the public bucket exists.
  const check = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
  if(!check.ok){
    const create = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: BUCKET, public: true })
    });
    if(!create.ok && create.status !== 409){
      throw new Error(`could not create bucket ${BUCKET} (${create.status})`);
    }
  }
  console.log(`Bucket ready: ${BUCKET}`);

  const targets = [
    { table: "categories", columns: ["image"] },
    { table: "products", columns: ["image", "images"] },
    { table: "product_reviews", columns: ["image"] }
  ];

  let uploaded = 0;
  const urlCache = {};

  for(const target of targets){
    const rows = (await client.query(`SELECT id, ${target.columns.join(", ")} FROM ${target.table}`)).rows;
    for(const row of rows){
      let changed = false;
      for(const column of target.columns){
        const value = row[column];
        if(!value){ continue; }
        const items = column === "images" ? parseImageList(value) : [value];
        const updated = [];
        let touched = false;
        for(const item of items){
          if(!item.startsWith("uploads/")){ updated.push(item); continue; }
          const filename = path.basename(item);
          if(!fs.existsSync(path.join(UPLOAD_DIR, filename))){
            console.warn(`  ! local file missing for ${target.table}#${row.id}: ${item}`);
            updated.push(item);
            continue;
          }
          if(!urlCache[filename]){ urlCache[filename] = await uploadFile(filename); uploaded += 1; }
          updated.push(urlCache[filename]);
          touched = true;
        }
        if(touched){
          const next = column === "images" ? JSON.stringify(updated) : (updated[0] || "");
          await client.query(`UPDATE ${target.table} SET ${column} = $1 WHERE id = $2`, [next, row.id]);
          changed = true;
        }
      }
      if(changed){ console.log(`- ${target.table}#${row.id} updated`); }
    }
  }

  console.log(`\nDone. Uploaded ${uploaded} image file(s) to Supabase Storage.`);
  await client.end();
  process.exit(0);
})().catch((error) => { console.error("MIGRATION FAILED:", error.message); process.exit(1); });
