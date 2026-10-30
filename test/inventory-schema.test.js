const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'test-inventory-v0106.sql'), 'utf8');
for (const contract of [
  /item_number text not null/i,
  /name text not null/i,
  /unit text not null default 'Stück'/i,
  /minimum_stock numeric[^\n]+check \(minimum_stock >= 0\)/i,
  /archived boolean not null default false/i,
  /movement_type in \('opening','in','out'\)/i,
  /quantity numeric[^\n]+check \(quantity > 0\)/i,
  /created_by uuid not null references auth\.users/i,
  /source_type text[\s\S]+source_id uuid/i,
  /for update/i,
  /raise exception 'INSUFFICIENT_STOCK'/i,
  /create or replace function public\.is_erp_writer_v1\(\)/i,
  /role in \('admin','user'\)/i,
  /p_prefix not in \('AF','RE','QU','AG','AR'\)/i,
  /item_number ~ \('\^AR-' \|\| to_char\(p_date,'YY-MM-DD'\)/i,
  /record_inventory_movement_v1[\s\S]+security definer/i,
  /create_inventory_item_v1[\s\S]+security definer/i,
  /set_inventory_item_archived_v1[\s\S]+security definer/i,
  /grant execute on function public\.create_inventory_item_v1/i,
  /grant select on public\.inventory_stock_v1 to authenticated/i,
  /revoke insert,update,delete on public\.inventory_movements from authenticated,anon/i,
  /security_invoker=true/i,
]) assert.match(sql, contract);
assert.doesNotMatch(sql, /update\s+public\.inventory_items\s+set\s+(?:stock|quantity)\s*=/i);
assert.match(sql,/revoke all on public\.inventory_items from authenticated,anon;\s+grant select on public\.inventory_items to authenticated/i);
console.log('Inventory SQL contract assertions passed.');
