const assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('supabase/test-inventory-edit-photo-v0129.sql','utf8'),app=fs.readFileSync('test/app.js','utf8'),storage=fs.readFileSync('supabase/functions/file-storage/index.ts','utf8');

for(const marker of ['minimum_stock_enabled boolean not null default false','update_inventory_item_v1','where id=p_item_id and not archived','create_inventory_item_v1','p_minimum_stock_enabled boolean default false','inventory_photo','file_attachments_one_inventory_photo_idx'])assert.ok(sql.includes(marker),`Migration fehlt: ${marker}`);
for(const marker of ["function inventoryItemForm(itemId=null)",'update_inventory_item_v1','minimumStockEnabled','capture="environment"',"uploadAttachment('inventory',recordId,photo,'inventory_photo')",'Foto vorhanden'])assert.ok(app.includes(marker),`Inventar-UI fehlt: ${marker}`);
assert.doesNotMatch(app,/update\s+inventory_items/i,'Der Browser darf Inventar nicht direkt ändern');
for(const marker of ['inventory:"inventory_items"','root:"inventar"','source!=="generated_pdf"&&source!=="inventory_photo"','entityType==="inventory"?parent.archived','source==="inventory_photo"'])assert.ok(storage.includes(marker),`Dateispeicher fehlt: ${marker}`);
console.log('inventory-edit-photo-check: ok');
