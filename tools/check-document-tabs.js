const assert=require('node:assert/strict'),fs=require('node:fs');
const app=fs.readFileSync('test/app.js','utf8'),css=fs.readFileSync('test/styles.css','utf8');
assert(app.includes('renderDocumentDetailWithTabs=showDocumentDetail'),'Detailansicht wird nicht zentral erweitert');
assert(app.includes("tab('Auftrag','order'"),'Auftrag-Reiter fehlt');
assert(app.includes("tab('Rechnung','invoice'"),'Rechnung-Reiter fehlt');
assert(app.includes("tab('Quittung','receipt'"),'Quittung-Reiter fehlt');
assert(app.includes('PDF öffnen'),'PDF-Aktion fehlt');
assert(css.includes('.document-detail-print{display:none!important}'),'Drucken bleibt auf Mobilgeräten sichtbar');
console.log('Dokument-Reiter OK');
