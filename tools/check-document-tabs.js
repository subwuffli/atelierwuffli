const assert=require('node:assert/strict'),fs=require('node:fs');
for(const appFile of ['app.js','test/app.js']){
  const app=fs.readFileSync(appFile,'utf8');
  assert(app.includes('renderDocumentDetailWithTabs=showDocumentDetail'),`${appFile}: Detailansicht wird nicht zentral erweitert`);
  assert(app.includes("tab('Auftrag','order'"),`${appFile}: Auftrag-Reiter fehlt`);
  assert(app.includes("tab('Rechnung','invoice'"),`${appFile}: Rechnung-Reiter fehlt`);
  assert(app.includes("tab('Quittung','receipt'"),`${appFile}: Quittung-Reiter fehlt`);
  assert(app.includes('PDF öffnen'),`${appFile}: PDF-Aktion fehlt`);
  assert(!app.includes('>Rechnung & Zahlung</button>'),`${appFile}: Überflüssige Rechnung-und-Zahlung-Aktion ist noch vorhanden`);
}
for(const cssFile of ['styles.css','test/styles.css'])assert(fs.readFileSync(cssFile,'utf8').includes('.document-detail-print{display:none!important}'),`${cssFile}: Drucken bleibt auf Mobilgeräten sichtbar`);
console.log('Dokument-Reiter OK');
