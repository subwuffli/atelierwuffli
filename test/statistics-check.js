const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8'),match=source.match(/function orderStatistics\(orders,month=statisticsMonth,year=new Date\(\)\.getFullYear\(\)\)\{[\s\S]*?\n\}/);
assert.ok(match,'orderStatistics fehlt');
const context={monthKey:value=>String(value||'').slice(0,7),monthName:value=>String(value+1)};
vm.runInNewContext(`${match[0]}; result=orderStatistics;`,context);
const data=context.result([{date:'2026-09-01',status:'In Arbeit'},{date:'2026-09-02',status:'Abgeschlossen'},{date:'2025-09-15',status:'Abgeschlossen'},{date:'2024-01-03',status:'In Arbeit'},{date:'2026-09-03',status:'In Arbeit',archived:true}],'2026-09',2026);
assert.equal(data.open,1);assert.equal(data.completed,1);assert.equal(data.total,2);assert.deepEqual(JSON.parse(JSON.stringify(data.years)),[2026,2025,2024]);assert.deepEqual(JSON.parse(JSON.stringify(data.months[0])),{label:'1',values:[0,0,1]});assert.deepEqual(JSON.parse(JSON.stringify(data.months[8])),{label:'9',values:[2,1,0]});
console.log('statistics-check: ok');
