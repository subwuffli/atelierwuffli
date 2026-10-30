const assert=require('node:assert/strict'),fs=require('node:fs');
const app=fs.readFileSync('test/app.js','utf8'),html=fs.readFileSync('test/index.html','utf8'),css=fs.readFileSync('test/styles.css','utf8');

for(const marker of [
  "inventory:renderInventory",
  "function renderInventory()",
  "function inventoryItemForm()",
  "function inventoryMovementForm(itemId,type)",
  "function toggleInventoryArchive(itemId,archived)",
  "from('inventory_stock_v1').select('*').order('name')",
  "record_inventory_movement_v1",
  "create_inventory_item_v1",
  "set_inventory_item_archived_v1",
  "['inventory','Inventar']"
]) assert.ok(app.includes(marker),`Inventar-Merkmal fehlt: ${marker}`);
assert.match(html,/data-view="inventory">Inventar<\/button>/);
assert.match(css,/inventory-low-stock/);
assert.match(app,/if\(type==='out'&&quantity>available\)/,'UI muss einen lokalen Negativbestandschutz zeigen');
assert.doesNotMatch(app,/inventory_items[^\n]{0,120}\.update\(/i,'Bestand darf nicht direkt überschrieben werden');
console.log('inventory-ui-check: ok');
