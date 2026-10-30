const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const homeContext={window:{}};
vm.runInNewContext(fs.readFileSync('test/home.js','utf8'),homeContext);
const home=homeContext.window.erpHome;
const orders=[{id:'old',date:'2026-10-01',number:'AU-1',status:'In Arbeit'},{id:'new',date:'2026-10-30',number:'AU-3',status:'Abgeschlossen'},{id:'hidden',date:'2026-10-31',status:'In Arbeit',archived:true}];
const invoices=[{id:'overdue',status:'Offen',dueDate:'2026-10-29',total:'100.50'},{id:'due',status:'Offen',dueDate:'2026-10-30',total:50},{id:'paid',status:'Bezahlt',dueDate:'2026-10-01',total:700},{id:'hidden',status:'Offen',dueDate:'2026-10-01',total:900,archived:true}];
const model=home.summary(orders,invoices,'2026-10-30');
assert.equal(model.working.length,1);assert.equal(model.open.length,2);assert.equal(model.total,150.5);
assert.deepEqual(Array.from(model.overdue,x=>x.id),['overdue']);assert.deepEqual(Array.from(model.recent,x=>x.id),['new','old']);
assert.equal(orders[0].id,'old','Dashboard must not reorder business state');
assert.equal(home.matchesOrder(orders[0],'working'),true);assert.equal(home.matchesOrder(orders[1],'working'),false);
assert.equal(home.matchesInvoice(invoices[2],'open'),false);assert.equal(home.matchesInvoice(invoices[0],'open'),true);
assert.equal(home.summary([],[],'2026-10-30').total,0);

const controls={palette:{value:'atelier'},mode:{value:'auto'}};
const status={},submit={},cancel={};
const form={elements:controls,querySelector:q=>q==='[type="submit"]'?submit:cancel,querySelectorAll:()=>Object.values(controls)};
const section={querySelector:q=>q==='form'?form:status};
const root={dataset:{}},meta={};
const context={window:{matchMedia:()=>({addEventListener(){}})},document:{documentElement:root,querySelector:()=>meta,createElement:()=>section},getComputedStyle:()=>({backgroundColor:'rgb(251, 249, 246)'})};
vm.runInNewContext(fs.readFileSync('test/appearance.js','utf8'),context);
const appearance=context.window.erpAppearance,plain=value=>JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(appearance.normalize({palette:'__proto__',mode:'invalid'})),{palette:'atelier',mode:'auto'});
for(const palette of ['atelier','salbei','marine','neutral'])for(const mode of ['auto','light','dark']){
  appearance.apply({palette,mode});assert.equal(root.dataset.palette,palette);assert.equal(root.dataset.appearance,mode);
}
appearance.apply();const copy=appearance.get();copy.palette='marine';assert.equal(appearance.get().palette,'atelier');
const container={querySelector:()=>null,prepend(){}};
(async()=>{
  let stored;
  appearance.mount(container,async()=>{stored=appearance.get()});
  controls.palette.value='marine';controls.mode.value='dark';form.onchange();
  assert.equal(root.dataset.palette,'marine');assert.equal(appearance.get().palette,'atelier','Unsaved preview must not enter other preference writes');
  cancel.onclick();assert.equal(root.dataset.palette,'atelier');
  controls.palette.value='salbei';controls.mode.value='dark';form.onchange();
  await form.onsubmit({preventDefault(){}});assert.equal(stored.palette,'salbei');assert.equal(appearance.get().mode,'dark');
  appearance.mount(container,async()=>{throw Error('Offline')});
  controls.palette.value='neutral';form.onchange();await form.onsubmit({preventDefault(){}});
  assert.equal(root.dataset.palette,'salbei');assert.equal(appearance.get().palette,'salbei');assert.match(status.textContent,/Offline/);assert.equal(submit.disabled,false);
  console.log('home-appearance-check: summary, filtering, all themes, unsaved preview, saving and failure recovery passed');
})().catch(error=>{console.error(error);process.exitCode=1});
