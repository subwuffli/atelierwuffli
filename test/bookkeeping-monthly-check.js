const assert=require('node:assert/strict'),fs=require('node:fs');
for(const file of ['app.js','test/app.js']){
  const source=fs.readFileSync(file,'utf8'),label=`${file}: `;
  assert.match(source,/const inMonth=\(value,month=financeMonth\)=>String\(value\|\|''\)\.slice\(0,7\)===month/,label+'Monatsfilter fehlt');
  assert.match(source,/function monthlyReportData\(\)\{return reportData\(value=>inMonth\(value\)\)\}/,label+'Monatsdaten verwenden nicht den gemeinsamen Zahlungsdatenpfad');
  assert.match(source,/id="finance-month" type="month" value="\$\{financeMonth\}"/,label+'Monatsauswahl fehlt');
  assert.match(source,/<th>Auftrag<\/th><th>Rechnung<\/th><th>Zahlungsart<\/th><th>Betrag<\/th>/,label+'Auftragsliste der Monatsauswertung fehlt');
  assert.match(source,/invoice\.orderNumber\|\|'–'/,label+'Auftragsnummer wird nicht angezeigt');
  assert.match(source,/paymentLabel\(invoice\.paymentMethod\)/,label+'Zahlungsart wird nicht angezeigt');
  assert.match(source,/function pdfReport\(title,data,fileName,openItems,includeIncomeRows\)/,label+'Gemeinsamer PDF-Export fehlt');
  assert.match(source,/doc\.text\('Bezahlte Aufträge',20,y\)/,label+'Auftragsliste fehlt im PDF');
  assert.match(source,/\[\['Auftrag',20\],\['Rechnung',58\],\['Zahlungsart',102\],\['Betrag',190\]\]/,label+'PDF-Spalten der Auftragsliste fehlen');
  assert.match(source,/pdfReport\(`Monatsauswertung \$\{monthLabel\(financeMonth\)\}`,monthlyReportData\(\),`Monatsauswertung-\$\{financeMonth\}\.pdf`,false,true\)/,label+'PDF-Export der Monatsauswertung enthält keine Auftragsliste');
  assert.match(source,/financeMonth=event\.target\.value;saveUserPreferences\(\);renderBookkeeping\(\)/,label+'Ausgewählter Monat wird nicht gespeichert');
}
console.log('Monatsauswertung: OK');
