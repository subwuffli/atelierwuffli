const assert=require('node:assert/strict'),fs=require('node:fs');
const app=fs.readFileSync('test/app.js','utf8'),css=fs.readFileSync('test/styles.css','utf8'),html=fs.readFileSync('test/index.html','utf8');
assert.match(app,/compactDocument=false/);
for(const type of ['order','invoice','receipt'])assert.match(app,new RegExp(`documentType:'${type}'[\\s\\S]{0,120}compactDocument:true`));
assert.match(app,/const documentView=\{order:'orders',invoice:'invoices',receipt:'receipts'\}/);
assert.match(app,/document-more-actions/);
assert.match(css,/\.stats\{grid-template-columns:repeat\(auto-fit,minmax\(190px,1fr\)\)\}/);
assert.doesNotMatch(html,/SUPABASE CLOUD-DATENBANK/);
console.log('Compact document lists and responsive dashboard checks passed.');
