const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8'),match=source.match(/function orderStatistics\(orders,month=today\(\)\.slice\(0,7\)\)\{[\s\S]*?\n\}/);
assert.ok(match,'orderStatistics fehlt');
const context={monthKey:value=>String(value||'').slice(0,7),monthLabel:value=>value,lastMonths:()=>['2026-08','2026-09']};
vm.runInNewContext(`${match[0]}; result=orderStatistics;`,context);
const data=context.result([{date:'2026-09-01',status:'In Arbeit'},{date:'2026-09-02',status:'Abgeschlossen'},{date:'2026-08-15',status:'Abgeschlossen'},{date:'2026-09-03',status:'In Arbeit',archived:true}],'2026-09');
assert.deepEqual(JSON.parse(JSON.stringify(data)),{month:'2026-09',open:1,completed:1,total:2,months:[{label:'2026-08',value:1},{label:'2026-09',value:2}]});
console.log('statistics-check: ok');
