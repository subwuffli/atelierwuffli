const assert=require('node:assert/strict'),fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8'),css=fs.readFileSync('styles.css','utf8'),sql=fs.readFileSync('supabase/live-inventory-edit-photo-v0131.sql','utf8');
for(const marker of ['downloadStoredFile','inventory_photo','function openInventoryPhoto(itemId)','function inventoryItemForm(itemId=null)','minimumStockEnabled','update_inventory_item_v1','inventory-actions'])assert.ok(app.includes(marker),`Live-App fehlt: ${marker}`);
for(const marker of ['inventory-photo-view','tr.mobile-actions-expanded .inventory-actions'])assert.ok(css.includes(marker),`Live-CSS fehlt: ${marker}`);
for(const marker of ['minimum_stock_enabled','deleted_at timestamptz','update_inventory_item_v1','inventory_photo','file_attachments_one_inventory_photo_idx'])assert.ok(sql.includes(marker),`Live-Migration fehlt: ${marker}`);
console.log('live-inventory-promotion-check: ok');
