const assert=require('node:assert/strict'),fs=require('node:fs'),source=fs.readFileSync('test/app.js','utf8');
assert.match(source,/const inMonth=\(value,month=financeMonth\)=>String\(value\|\|''\)\.slice\(0,7\)===month/,'Monatsfilter fehlt');
assert.match(source,/function monthlyReportData\(\)\{return reportData\(value=>inMonth\(value\)\)\}/,'Monatsdaten verwenden nicht den gemeinsamen Zahlungsdatenpfad');
assert.match(source,/id="finance-month" type="month" value="\$\{financeMonth\}"/,'Monatsauswahl fehlt');
assert.match(source,/function pdfReport\(title,data,fileName,openItems\)/,'Gemeinsamer PDF-Export fehlt');
assert.match(source,/const pdfMonthlyBookkeepingReport=\(\)=>pdfReport\(`Monatsauswertung \$\{monthLabel\(financeMonth\)\}`/,'PDF-Export der Monatsauswertung fehlt');
assert.match(source,/financeMonth=event\.target\.value;saveUserPreferences\(\);renderBookkeeping\(\)/,'Ausgewählter Monat wird nicht gespeichert');
console.log('Monatsauswertung: OK');
