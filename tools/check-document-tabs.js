const assert=require('node:assert/strict'),fs=require('node:fs');
for(const appFile of ['app.js','test/app.js']){
  const app=fs.readFileSync(appFile,'utf8');
  assert(app.includes('renderDocumentDetailWithTabs=showDocumentDetail'),`${appFile}: Detailansicht wird nicht zentral erweitert`);
  assert(app.includes("tab('Auftrag','order'"),`${appFile}: Auftrag-Reiter fehlt`);
  assert(app.includes("tab('Rechnung','invoice'"),`${appFile}: Rechnung-Reiter fehlt`);
  assert(app.includes("tab('Quittung','receipt'"),`${appFile}: Quittung-Reiter fehlt`);
  assert(app.includes('PDF öffnen'),`${appFile}: PDF-Aktion fehlt`);
  assert(!app.includes('>Rechnung & Zahlung</button>'),`${appFile}: Überflüssige Rechnung-und-Zahlung-Aktion ist noch vorhanden`);
  if(appFile==='test/app.js'){
    assert(app.includes('documentListReturn={view:origin,id}'),`${appFile}: Rückkehrziel aus der Dokumentliste fehlt`);
    assert(app.includes("row.scrollIntoView({block:'center'})"),`${appFile}: Rückkehrzeile wird nicht sichtbar gemacht`);
    assert(app.includes("row.classList.add('document-return-focus')"),`${appFile}: Rückkehrzeile wird nicht hervorgehoben`);
    assert(app.includes('showDocumentDetail(type,id);window.scrollTo(0,0)'),`${appFile}: Detailansicht startet nicht oben`);
  }
}
for(const cssFile of ['styles.css','test/styles.css'])assert(fs.readFileSync(cssFile,'utf8').includes('.document-detail-print{display:none!important}'),`${cssFile}: Drucken bleibt auf Mobilgeräten sichtbar`);
assert(fs.readFileSync('test/styles.css','utf8').includes('.document-return-focus'),`test/styles.css: Rückkehrmarkierung fehlt`);
console.log('Dokument-Reiter OK');
