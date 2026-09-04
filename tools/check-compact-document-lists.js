const assert=require('node:assert/strict'),fs=require('node:fs');
for(const root of ['test','.']){
  const file=name=>fs.readFileSync(`${root==='.'?'':`${root}/`}${name}`,'utf8'),app=file('app.js'),css=file('styles.css'),html=file('index.html'),version=file('VERSION').trim(),number=version.replace(/^TEST V|^V/,'');
  assert.match(app,/compactDocument=false/);
  for(const type of ['order','invoice','receipt'])assert.match(app,new RegExp(`documentType:'${type}'[\\s\\S]{0,120}compactDocument:true`));
  assert.match(app,/const documentView=\{order:'orders',invoice:'invoices',receipt:'receipts'\}/);
  assert.match(app,/document-more-actions/);
  assert.match(css,/\.stats\{grid-template-columns:repeat\(auto-fit,minmax\(190px,1fr\)\)\}/);
  assert.doesNotMatch(html,/SUPABASE CLOUD-DATENBANK/);
  assert.match(app,new RegExp(`APP_VERSION='${version}'`));
  for(const asset of ['styles.css','app.js'])assert.match(html,new RegExp(`${asset.replace('.', '\\.') }\\?v=${number}`));
}
console.log('Document workflow and responsive dashboard checks passed for test and live.');
