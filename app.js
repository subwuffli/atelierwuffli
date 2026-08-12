const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DEFAULT_LOGO='assets/atelier-wuffli-logo.jpeg';
const SUPABASE_URL='https://johkbmlozygtfjsqfkdu.supabase.co';
const SUPABASE_KEY='sb_publishable_DGpxSu1ppS0fY7nbE75RSg_rI7G8UAb';
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let state,currentView='dashboard',realtimeChannel=null,remoteRevision=0,isSaving=false,customerSort='number-asc',orderSort='number-desc',invoiceSort='number-desc',activeEditLock=null,lockHeartbeat=null;
const EDIT_SESSION_TOKEN=crypto.randomUUID();
const blankState=()=>({version:2,revision:0,settings:{name:'',address:'',iban:'',paymentDays:30,logo:'',orderText:'',invoiceText:''},customers:[],orders:[],invoices:[],lastExport:null});
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;
const today=()=>new Date().toISOString().slice(0,10);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money=n=>new Intl.NumberFormat('de-CH',{style:'currency',currency:'CHF'}).format(Number(n)||0);
const date=v=>v?new Intl.DateTimeFormat('de-CH').format(new Date(`${v}T12:00:00`)):'–';
const customerName=c=>c?(c.company||[c.firstName,c.lastName].filter(Boolean).join(' ')||'Ohne Namen'):'Unbekannt';
const address=c=>[c?.street,c?.zip&&c?.city?`${c.zip} ${c.city}`:c?.zip||c?.city].filter(Boolean).join(', ');

function normalizeState(data){
  const base=blankState();
  const next=data&&typeof data==='object'?data:{};
  return {
    ...base,
    ...next,
    version:2,
    revision:Number(next.revision)||0,
    settings:{...base.settings,...(next.settings||{})},
    customers:Array.isArray(next.customers)?next.customers:[],
    orders:Array.isArray(next.orders)?next.orders:[],
    invoices:Array.isArray(next.invoices)?next.invoices:[]
  };
}

async function saveToSupabase(){
  for(const order of state.orders)if(typeof order.number!=='string')order.number=await nextNumber('AF',order.date);
  for(const invoice of state.invoices)if(typeof invoice.number!=='string')invoice.number=await nextNumber('RE',invoice.date);
  const {data,error}=await supabaseClient.rpc('replace_erp_backup',{p_data:state,p_expected_revision:state.revision});
  if(error)throw error;
  state.revision=Number(data);
}

async function loadFromSupabase(){
  const {data,error}=await supabaseClient.rpc('export_erp_backup');
  if(error)throw error;
  return normalizeState(data);
}

async function save(){
  state=normalizeState(state);
  isSaving=true;
  try{
    await saveToSupabase();
  }catch(error){
    const details=[error?.message,error?.details,error?.hint,error?.code].filter(Boolean).join(' | ');
    alert(String(error.message).includes('CONFLICT')?'Ein anderer Benutzer hat die Daten inzwischen geändert. Bitte wiederhole die Änderung.':`Speichern in Supabase fehlgeschlagen: ${details||'Unbekannter Fehler'}`);
    state=await loadFromSupabase();render(currentView);
    throw error;
  }finally{
    isSaving=false;
    if(remoteRevision>state.revision&&!$('#modal').open)await reloadCloudData();
  }
}
function notice(msg){const n=$('#notice');n.textContent=msg;n.classList.remove('hidden');setTimeout(()=>n.classList.add('hidden'),3500)}
function setTitle(t){$('#page-title').textContent=t}
function modal(title,html){$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;$('#modal').showModal()}
async function closeModal(){await releaseCurrentEditLock();if($('#modal').open)$('#modal').close();if(remoteRevision>state.revision&&!isSaving)await reloadCloudData()}
function fields(obj,names){return names.map(([key,label,type='text',span=false,extra=''])=>`<label class="${span?'span-2':''}">${label}<input name="${key}" type="${type}" value="${esc(obj?.[key]||'')}" ${extra}></label>`).join('')}
function activeCustomers(){return state.customers.filter(c=>!c.archived)}
async function nextNumber(prefix,d=today()){const {data,error}=await supabaseClient.rpc('next_document_number',{p_prefix:prefix,p_date:d});if(error)throw error;return data}
async function nextCustomerNumber(){const {data,error}=await supabaseClient.rpc('next_customer_number');if(error)throw error;return data}


async function init(){
  bindGlobal();

  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if(error){
    console.error('Supabase Session konnte nicht geladen werden:', error);
    showLock();
    return;
  }

  if(session){
    await loadStateAfterLogin();
    unlockApp();
  }else{
    state=blankState();
    showLock();
  }
}

async function loadStateAfterLogin(){
  state=await loadFromSupabase();
  state.settings.logo||=DEFAULT_LOGO;
  if(repairEncoding(state)>0){await save();notice('Fehlerhafte Umlaute aus einem früheren Import wurden repariert.')}
}

function showLock(){
  $('#app').classList.add('hidden');
  $('#lock-screen').classList.remove('hidden');
  $('#lock-title').textContent='ERP anmelden';
  $('#lock-help').textContent='Melde dich mit deinem ERP-Benutzer an.';
  $('#email').value='';
  $('#password').value='';
  $('#lock-error').textContent='';
  $('#email').focus();
}

function unlockApp(){
  $('#lock-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  subscribeToCloudChanges();
  render('dashboard');
}

function bindGlobal(){
  $('#unlock-form').addEventListener('submit',async e=>{
    e.preventDefault();

    const email=$('#email').value.trim();
    const password=$('#password').value;
    const err=$('#lock-error');

    err.textContent='';

    const { error }=await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if(error){
      err.textContent='Anmeldung fehlgeschlagen: '+error.message;
      return;
    }

    await loadStateAfterLogin();
    unlockApp();
  });

  $('#lock-button').onclick=async()=>{
    await releaseCurrentEditLock();
    if(realtimeChannel){await supabaseClient.removeChannel(realtimeChannel);realtimeChannel=null}
    await supabaseClient.auth.signOut();
    state=blankState();
    showLock();
  };

  $('#menu-button').onclick=()=>$('.sidebar').classList.toggle('open');

  $('#nav').onclick=e=>{
    const b=e.target.closest('[data-view]');
    if(b)render(b.dataset.view);
  };

  $('#quick-export').onclick=exportData;
  $('#reload-button').onclick=async()=>{
    if($('#modal').open&&!confirm('Das Formular ist noch geöffnet. Nicht gespeicherte Eingaben verwerfen und die Seite neu laden?'))return;
    await releaseCurrentEditLock();
    location.reload();
  };
  $('#import-file').onchange=importCloudData;
  $('#modal').addEventListener('close',()=>releaseCurrentEditLock());
}


function render(view){currentView=view;$$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('.sidebar').classList.remove('open');({dashboard:renderDashboard,customers:renderCloudCustomers,orders:renderSortableOrders,invoices:renderSortableInvoices,settings:renderCloudSettings}[view])()}

function renderDashboard(){setTitle('Übersicht');const open=state.invoices.filter(i=>i.status==='Offen'&&!i.archived);$('#content').innerHTML=`<div class="grid stats"><div class="card stat"><span class="muted">Aktive Kunden</span><strong>${activeCustomers().length}</strong></div><div class="card stat"><span class="muted">Aufträge in Arbeit</span><strong>${state.orders.filter(o=>o.status==='In Arbeit'&&!o.archived).length}</strong></div><div class="card stat"><span class="muted">Offene Rechnungen</span><strong>${open.length}</strong></div><div class="card stat"><span class="muted">Offener Betrag</span><strong>${money(open.reduce((s,i)=>s+i.total,0))}</strong></div></div><div class="section-head"><h2>Schnellstart</h2></div><div class="actions"><button class="primary" onclick="customerForm()">Neuer Kunde</button><button class="secondary" onclick="orderForm()">Neuer Auftrag</button><button class="secondary" onclick="exportData()">Sicherung exportieren</button></div><div class="section-head"><h2>Letzte Aufträge</h2></div>${ordersTable(state.orders.filter(o=>!o.archived).slice(-5).reverse())}`}

function renderCustomers(){setTitle('Kunden');$('#content').innerHTML=`<div class="section-head"><div class="actions"><button class="primary" onclick="customerForm()">Kunde erfassen</button></div><label class="inline"><input id="show-customer-archive" type="checkbox"> Archiv anzeigen</label></div>${customersTable(state.customers.filter(c=>!c.archived))}`;$('#show-customer-archive').onchange=e=>{e.target.closest('#content').querySelector('.table-wrap')?.remove();e.target.closest('#content').insertAdjacentHTML('beforeend',customersTable(state.customers.filter(c=>e.target.checked?c.archived:!c.archived)))}}
function customersTable(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>Kundennr.</th><th>Kunde</th><th>Kontakt</th><th>Adresse</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.number)}</td><td><strong>${esc(customerName(c))}</strong></td><td>${esc(c.email||'–')}<br><span class="muted">${esc(c.phone||'')}</span></td><td>${esc(address(c))}</td><td><div class="actions"><button class="secondary" onclick="customerForm('${c.id}')">Bearbeiten</button><button class="secondary" onclick="toggleArchive('customers','${c.id}')">${c.archived?'Aktivieren':'Archivieren'}</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Keine Kunden vorhanden.</div>'}
function customerForm(id){const c=state.customers.find(x=>x.id===id)||{};modal(id?'Kunde bearbeiten':'Kunde erfassen',`<form id="customer-form"><div class="form-grid">${fields(c,[['company','Firma'],['salutation','Anrede'],['firstName','Vorname'],['lastName','Nachname'],['email','E-Mail','email'],['phone','Telefon'],['street','Strasse / Rechnungsadresse','text',true],['zip','PLZ'],['city','Ort'],['notes','Interne Notiz','text',true]])}<div class="span-2"><h3>Lieferadressen</h3><div id="delivery-list"></div><button type="button" class="secondary" id="add-delivery">Lieferadresse hinzufügen</button></div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);let deliveries=[...(c.deliveries||[])];const draw=()=>{$('#delivery-list').innerHTML=deliveries.map((d,i)=>`<div class="line-item"><input data-d="label" data-i="${i}" placeholder="Bezeichnung" value="${esc(d.label)}"><input data-d="street" data-i="${i}" placeholder="Strasse" value="${esc(d.street)}"><input data-d="city" data-i="${i}" placeholder="PLZ Ort" value="${esc(d.city)}"><button type="button" class="danger" data-remove="${i}">×</button></div>`).join('')};draw();$('#add-delivery').onclick=()=>{deliveries.push({label:'',street:'',city:''});draw()};$('#delivery-list').oninput=e=>{if(e.target.dataset.d)deliveries[+e.target.dataset.i][e.target.dataset.d]=e.target.value};$('#delivery-list').onclick=e=>{if(e.target.dataset.remove!==undefined){deliveries.splice(+e.target.dataset.remove,1);draw()}};$('#customer-form').onsubmit=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e.target));if(id)Object.assign(c,o,{deliveries,updatedAt:new Date().toISOString()});else state.customers.push({...o,id:uid(),number:`KD-${String(state.customers.length+1).padStart(4,'0')}`,deliveries,archived:false,createdAt:new Date().toISOString()});await save();closeModal();renderCustomers();notice('Kunde gespeichert.')}}

function renderOrders(){setTitle('Aufträge');const archived=state.orders.filter(o=>o.archived);$('#content').innerHTML=`<div class="section-head"><button class="primary" onclick="orderForm()">Auftrag erfassen</button><label class="inline"><input id="show-order-archive" type="checkbox"> Archiv anzeigen (${archived.length})</label></div><div id="order-table">${ordersTable(state.orders.filter(o=>!o.archived).reverse())}</div>`;$('#show-order-archive').onchange=e=>$('#order-table').innerHTML=ordersTable(state.orders.filter(o=>e.target.checked?o.archived:!o.archived).reverse())}
function ordersTable(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>Nummer</th><th>Kunde</th><th>Art / Datum</th><th>Status</th><th>Betrag</th><th></th></tr></thead><tbody>${rows.map(o=>`<tr><td>${esc(o.number)}</td><td>${esc(o.customerSnapshot?.name)}</td><td>${esc(o.fulfilment)}<br><span class="muted">${date(o.fulfilmentDate)}</span></td><td><span class="badge ${o.status==='Abgeschlossen'?'ok':'warn'}">${o.status}</span></td><td>${money(o.total)}</td><td><div class="actions"><button class="secondary" onclick="orderForm('${o.id}')">Bearbeiten</button><button class="secondary" onclick="pdfDocument('order','${o.id}')">PDF</button><button class="secondary" onclick="printDocument('order','${o.id}')">Drucken</button>${!o.invoiceId?`<button class="primary" onclick="createInvoice('${o.id}')">Rechnung</button>`:''}<button class="secondary" onclick="toggleArchive('orders','${o.id}')">${o.archived?'Aktivieren':'Archivieren'}</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Keine Aufträge vorhanden.</div>'}
function customerOptions(selected){return activeCustomers().map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(c.number)} – ${esc(customerName(c))}</option>`).join('')}
function lineItemsEditor(items=[]){return `<div id="line-items" class="line-items"></div><button type="button" id="add-line" class="secondary">Position hinzufügen</button><div class="summary">Gesamt: <strong id="form-total">${money(0)}</strong></div>`}
function wireLines(items,onchange){const list=items.length?items:[{description:'',quantity:1,price:0}];items.splice(0,items.length,...list);const draw=()=>{$('#line-items').innerHTML=items.map((x,i)=>`<div class="line-item"><label>Beschreibung<input data-k="description" data-i="${i}" value="${esc(x.description)}" required></label><label>Menge<input data-k="quantity" data-i="${i}" type="number" min="0" step="0.01" value="${x.quantity}" required></label><label>Preis CHF<input data-k="price" data-i="${i}" type="number" step="0.01" value="${x.price}" required></label><button type="button" class="danger" data-remove="${i}">×</button></div>`).join('');calc()};const calc=()=>{items.forEach(x=>x.total=(Number(x.quantity)||0)*(Number(x.price)||0));$('#form-total').textContent=money(items.reduce((s,x)=>s+x.total,0));onchange?.()};$('#line-items').oninput=e=>{if(e.target.dataset.k){items[+e.target.dataset.i][e.target.dataset.k]=e.target.dataset.k==='description'?e.target.value:Number(e.target.value);calc()}};$('#line-items').onclick=e=>{if(e.target.dataset.remove!==undefined){items.splice(+e.target.dataset.remove,1);if(!items.length)items.push({description:'',quantity:1,price:0});draw()}};$('#add-line').onclick=()=>{items.push({description:'',quantity:1,price:0});draw()};draw()}
function orderForm(id){if(!activeCustomers().length){alert('Bitte zuerst einen Kunden erfassen.');render('customers');return}const o=state.orders.find(x=>x.id===id)||{date:today(),fulfilment:'Abholung',fulfilmentDate:today(),status:'In Arbeit',customerId:activeCustomers()[0].id,items:[]};modal(id?'Auftrag bearbeiten':'Auftrag erfassen',`<form id="order-form"><div class="form-grid"><label>Kunde<select name="customerId" required>${customerOptions(o.customerId)}</select></label><label>Auftragsdatum<input name="date" type="date" value="${o.date}" required></label><label>Erfüllungsart<select name="fulfilment"><option ${o.fulfilment==='Abholung'?'selected':''}>Abholung</option><option ${o.fulfilment==='Lieferung'?'selected':''}>Lieferung</option></select></label><label>Abhol-/Lieferdatum<input name="fulfilmentDate" type="date" value="${o.fulfilmentDate}" required></label><label>Status<select name="status"><option ${o.status==='In Arbeit'?'selected':''}>In Arbeit</option><option ${o.status==='Abgeschlossen'?'selected':''}>Abgeschlossen</option></select></label><label id="delivery-field">Lieferadresse<select name="deliveryIndex"></select></label><label class="span-2">Kundentext<textarea name="text">${esc(o.text||state.settings.orderText)}</textarea></label><label class="span-2">Interne Notiz<textarea name="notes">${esc(o.notes)}</textarea></label><div class="span-2"><h3>Positionen</h3>${lineItemsEditor(o.items)}</div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);const items=structuredClone(o.items||[]);wireLines(items);const form=$('#order-form'),delivery=()=>{const c=state.customers.find(x=>x.id===form.customerId.value),opts=(c?.deliveries||[]).map((d,i)=>`<option value="${i}" ${String(i)===String(o.deliveryIndex)?'selected':''}>${esc(d.label||d.street||`Adresse ${i+1}`)}</option>`).join('');form.deliveryIndex.innerHTML=opts||'<option value="">Keine Lieferadresse hinterlegt</option>';$('#delivery-field').classList.toggle('hidden',form.fulfilment.value!=='Lieferung')};form.customerId.onchange=delivery;form.fulfilment.onchange=delivery;delivery();form.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form)),c=state.customers.find(x=>x.id===data.customerId);if(data.fulfilment==='Lieferung'&&!(c.deliveries||[])[Number(data.deliveryIndex)]){alert('Für eine Lieferung muss beim Kunden eine Lieferadresse hinterlegt sein.');return}const snap={name:customerName(c),number:c.number,email:c.email,phone:c.phone,billing:{street:c.street,zip:c.zip,city:c.city},delivery:data.fulfilment==='Lieferung'?structuredClone(c.deliveries[Number(data.deliveryIndex)]):null};const total=items.reduce((s,x)=>s+x.total,0);if(id)Object.assign(o,data,{items,total,customerSnapshot:snap,updatedAt:new Date().toISOString()});else state.orders.push({...data,id:uid(),number:nextNumber('AF',data.date),items,total,customerSnapshot:snap,archived:false,createdAt:new Date().toISOString()});await save();closeModal();renderOrders();notice('Auftrag gespeichert.')}}

function renderInvoices(){setTitle('Rechnungen');$('#content').innerHTML=`<div class="section-head"><p class="muted">Rechnungen werden aus Aufträgen erstellt.</p><label class="inline"><input id="show-invoice-archive" type="checkbox"> Archiv anzeigen</label></div><div id="invoice-table">${invoicesTable(state.invoices.filter(i=>!i.archived).reverse())}</div>`;$('#show-invoice-archive').onchange=e=>$('#invoice-table').innerHTML=invoicesTable(state.invoices.filter(i=>e.target.checked?i.archived:!i.archived).reverse())}
function invoicesTable(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>Nummer</th><th>Kunde</th><th>Fällig</th><th>Status</th><th>Betrag</th><th></th></tr></thead><tbody>${rows.map(i=>`<tr><td>${esc(i.number)}<br><span class="muted">${date(i.date)}</span></td><td>${esc(i.customerSnapshot?.name)}</td><td>${date(i.dueDate)}</td><td><span class="badge ${i.status==='Bezahlt'?'ok':i.status==='Storniert'?'danger':'warn'}">${i.status}</span></td><td>${money(i.total)}</td><td><div class="actions"><button class="secondary" onclick="invoiceForm('${i.id}')">Bearbeiten</button><button class="secondary" onclick="pdfDocument('invoice','${i.id}')">PDF</button><button class="secondary" onclick="printDocument('invoice','${i.id}')">Drucken</button><button class="secondary" onclick="toggleArchive('invoices','${i.id}')">${i.archived?'Aktivieren':'Archivieren'}</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Noch keine Rechnungen vorhanden.</div>'}
async function createInvoice(orderId){const o=state.orders.find(x=>x.id===orderId);if(!o||o.invoiceId)return;const d=today(),due=new Date(`${d}T12:00:00`);due.setDate(due.getDate()+Number(state.settings.paymentDays||30));const inv={id:uid(),number:nextNumber('RE',d),date:d,dueDate:due.toISOString().slice(0,10),orderId:o.id,orderNumber:o.number,customerId:o.customerId,customerSnapshot:structuredClone(o.customerSnapshot),items:structuredClone(o.items),total:o.total,status:'Offen',text:state.settings.invoiceText,archived:false,createdAt:new Date().toISOString()};state.invoices.push(inv);o.invoiceId=inv.id;await save();render('invoices');notice(`Rechnung ${inv.number} erstellt.`)}
function invoiceForm(id){const i=state.invoices.find(x=>x.id===id),items=structuredClone(i.items);modal('Rechnung bearbeiten',`<form id="invoice-form"><div class="form-grid"><label>Rechnungsnummer<input value="${esc(i.number)}" disabled></label><label>Rechnungsdatum<input name="date" type="date" value="${i.date}" required></label><label>Fälligkeitsdatum<input name="dueDate" type="date" value="${i.dueDate}" required></label><label>Status<select name="status"><option ${i.status==='Offen'?'selected':''}>Offen</option><option ${i.status==='Bezahlt'?'selected':''}>Bezahlt</option><option ${i.status==='Storniert'?'selected':''}>Storniert</option></select></label><label class="span-2">Rechnungstext<textarea name="text">${esc(i.text)}</textarea></label><div class="span-2"><h3>Positionen</h3>${lineItemsEditor(items)}</div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);wireLines(items);$('#invoice-form').onsubmit=async e=>{e.preventDefault();Object.assign(i,Object.fromEntries(new FormData(e.target)),{items,total:items.reduce((s,x)=>s+x.total,0),updatedAt:new Date().toISOString()});await save();closeModal();renderInvoices();notice('Rechnung gespeichert.')}}

function renderSettings(){setTitle('Einstellungen');const s=state.settings;$('#content').innerHTML=`<form id="settings-form" class="card settings-block"><h2>Rechnungsinformationen</h2><div class="form-grid">${fields(s,[['name','Name / Firma'],['iban','IBAN'],['address','Adresse','text',true]])}<label>Zahlungsfrist in Tagen<input name="paymentDays" type="number" min="0" value="${s.paymentDays}"></label><label>Logo<input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp"></label>${s.logo?`<img class="logo-preview" src="${s.logo}" alt="Aktuelles Logo">`:''}<label class="span-2">Standardtext Auftrag<textarea name="orderText">${esc(s.orderText)}</textarea></label><label class="span-2">Standardtext Rechnung<textarea name="invoiceText">${esc(s.invoiceText)}</textarea></label></div><div class="form-actions"><button class="primary">Einstellungen speichern</button></div></form><div class="card settings-block"><h2>Datensicherung</h2><p class="hint">Die Daten werden in Supabase gespeichert. Dieser Browser hält zusätzlich eine lokale Sicherung für den Offline- und Notfallbetrieb.</p><div class="backup-actions"><button class="primary" onclick="exportData()">Alle Daten exportieren</button><button class="secondary" onclick="document.querySelector('#import-file').click()">Daten ersetzen / importieren</button></div><p class="small muted">Letzter Export: ${state.lastExport?new Date(state.lastExport).toLocaleString('de-CH'):'Noch nie'}</p></div><div class="card settings-block danger-zone"><h2>Lokale Sicherung</h2><p>Damit wird nur die lokale Browser-Sicherung gelöscht. Die Daten in Supabase bleiben erhalten und werden nach dem Neuladen erneut abgerufen.</p><button class="danger" onclick="resetEverything()">Lokale Sicherung zurücksetzen</button></div>`;$('#settings-form').onsubmit=async e=>{e.preventDefault();Object.assign(s,Object.fromEntries(new FormData(e.target)),{paymentDays:Number(new FormData(e.target).get('paymentDays'))});await save();notice('Einstellungen gespeichert.')};$('#logo-file').onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>1_500_000){alert('Das Logo darf maximal 1,5 MB gross sein.');return}const r=new FileReader();r.onload=async()=>{s.logo=r.result;await save();renderSettings();notice('Logo gespeichert.')};r.readAsDataURL(f)}}

async function toggleArchive(kind,id){const x=state[kind].find(x=>x.id===id);if(!x)return;if(!x.archived&&kind!=='customers'&&((kind==='orders'&&x.status!=='Abgeschlossen')||(kind==='invoices'&&x.status==='Offen'))){alert('Nur abgeschlossene Aufträge beziehungsweise bezahlte oder stornierte Rechnungen können archiviert werden.');return}x.archived=!x.archived;await save();render(currentView);notice(x.archived?'Archiviert.':'Wieder aktiviert.')}
async function exportData(){state.lastExport=new Date().toISOString();await save();const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`atelier-wuffli-backup-${today()}.json`;a.click();URL.revokeObjectURL(a.href);if(currentView==='settings')renderSettings();notice('Datensicherung exportiert.')}
async function importData(e){
  const f=e.target.files[0];
  e.target.value='';

  if(!f)return;

  try{
    const data=JSON.parse(await f.text());

    if(
      data.version!==1 ||
      !Array.isArray(data.customers) ||
      !Array.isArray(data.orders) ||
      !Array.isArray(data.invoices) ||
      !data.settings
    ){
      throw new Error('Ungültiges Format');
    }

    if(!confirm(
      `Import enthält ${data.customers.length} Kunden, ` +
      `${data.orders.length} Aufträge und ` +
      `${data.invoices.length} Rechnungen. ` +
      `Diese Daten nach Supabase übernehmen?`
    ))return;

    // Alte lokale Passwortdaten werden nicht mehr benötigt
    data.auth=null;

    state=data;

    // Lokale Sicherheitskopie behalten
    await save();

    render(currentView);
    notice('Backup erfolgreich nach Supabase übertragen.');
  }catch(err){
    console.error(err);
    alert(`Import fehlgeschlagen: ${err.message}`);
  }
}
async function resetEverything(){if(confirm('Aktuellen Datenstand neu aus Supabase laden? Nicht gespeicherte Eingaben gehen verloren.')){state=await loadFromSupabase();render(currentView);notice('Daten neu geladen.')}}
function docAddress(s){return esc(s||'').replaceAll('\n','<br>')}
function printDocument(type,id){const d=type==='order'?state.orders.find(x=>x.id===id):state.invoices.find(x=>x.id===id);if(!d)return;const s=state.settings,isInv=type==='invoice',items=d.items.map(x=>`<tr><td>${esc(x.description)}</td><td>${x.quantity}</td><td>${money(x.price)}</td><td>${money(x.total)}</td></tr>`).join('');const fulfil=!isInv?`<p><strong>${esc(d.fulfilment)}</strong> am ${date(d.fulfilmentDate)}${d.fulfilment==='Lieferung'&&d.customerSnapshot.delivery?`<br>${esc(d.customerSnapshot.delivery.label)}<br>${esc(d.customerSnapshot.delivery.street)}<br>${esc(d.customerSnapshot.delivery.city)}`:''}</p>`:'';const html=`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(d.number)}</title><style>@page{size:A4;margin:20mm}body{font:12px Arial;color:#222}header{display:flex;justify-content:space-between;min-height:120px}img{max-width:180px;max-height:80px}h1{font-size:24px;margin-top:40px}table{width:100%;border-collapse:collapse;margin-top:30px}th,td{text-align:left;padding:9px;border-bottom:1px solid #ccc}th:last-child,td:last-child{text-align:right}.total{text-align:right;font-size:18px;font-weight:bold;margin-top:20px}.footer{margin-top:45px;line-height:1.6}.muted{color:#666}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Als PDF speichern / Drucken</button><header><div>${s.logo?`<img src="${s.logo}">`:''}<p><strong>${esc(s.name)}</strong><br>${docAddress(s.address)}</p></div><div><strong>${esc(d.customerSnapshot.name)}</strong><br>${esc(d.customerSnapshot.billing.street||'')}<br>${esc([d.customerSnapshot.billing.zip,d.customerSnapshot.billing.city].filter(Boolean).join(' '))}</div></header><h1>${isInv?'Rechnung':'Auftrag'} ${esc(d.number)}</h1><p>Datum: ${date(d.date)}${isInv?`<br>Auftrag: ${esc(d.orderNumber||'–')}`:''}</p>${fulfil}<table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Einzelpreis</th><th>Betrag</th></tr></thead><tbody>${items}</tbody></table><p class="total">Gesamtbetrag: ${money(d.total)}</p><div class="footer">${docAddress(d.text)}${isInv?`<p>Zahlbar bis ${date(d.dueDate)}<br>IBAN: ${esc(s.iban)}<br>Referenz: ${esc(d.number)}</p>`:''}</div><script>setTimeout(()=>window.print(),400)<\/script></body></html>`;const w=window.open('','_blank');if(!w){alert('Bitte Pop-ups für die PDF-Ausgabe erlauben.');return}w.document.write(html);w.document.close()}

function renderCloudSettings(){
  setTitle('Einstellungen');const s=state.settings;
  $('#content').innerHTML=`<form id="settings-form" class="card settings-block"><h2>Rechnungsinformationen</h2><div class="form-grid">${fields(s,[['name','Name / Firma'],['iban','IBAN'],['address','Adresse','text',true]])}<label>Zahlungsfrist in Tagen<input name="paymentDays" type="number" min="0" value="${s.paymentDays}"></label><label>Logo<input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp"></label>${s.logo?`<img class="logo-preview" src="${s.logo}" alt="Aktuelles Logo">`:''}<label class="span-2">Standardtext Auftrag<textarea name="orderText">${esc(s.orderText)}</textarea></label><label class="span-2">Standardtext Rechnung<textarea name="invoiceText">${esc(s.invoiceText)}</textarea></label></div><div class="form-actions"><button class="primary">Einstellungen speichern</button></div></form><div class="card settings-block"><h2>Datensicherung</h2><p class="hint">Alle Geschäftsdaten werden zentral in Supabase gespeichert. Der Export enthält den vollständigen Datenbestand.</p><div class="backup-actions"><button class="primary" onclick="exportData()">Alle Daten exportieren</button><button class="secondary" onclick="document.querySelector('#import-file').click()">Daten vollständig ersetzen / importieren</button><button class="secondary" onclick="reloadCloudData()">Aus Supabase neu laden</button></div><p class="small muted">Datenrevision: ${state.revision}</p></div>`;
  $('#settings-form').onsubmit=async e=>{e.preventDefault();Object.assign(s,Object.fromEntries(new FormData(e.target)),{paymentDays:Number(new FormData(e.target).get('paymentDays'))});await save();notice('Einstellungen gespeichert.')};
  $('#logo-file').onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>1_500_000){alert('Das Logo darf maximal 1,5 MB gross sein.');return}const r=new FileReader();r.onload=async()=>{s.logo=r.result;await save();renderCloudSettings();notice('Logo gespeichert.')};r.readAsDataURL(f)};
}
async function reloadCloudData(){state=await loadFromSupabase();render(currentView);notice('Aktueller Supabase-Datenstand geladen.')}

function subscribeToCloudChanges(){
  if(realtimeChannel)return;
  realtimeChannel=supabaseClient.channel('erp-revision').on('postgres_changes',{event:'UPDATE',schema:'public',table:'erp_meta',filter:'id=eq.main'},payload=>{
    remoteRevision=Number(payload.new?.revision)||0;
    setTimeout(async()=>{
      if(remoteRevision<=state.revision)return;
      if(isSaving||$('#modal').open){notice('Neue Daten von einem anderen Gerät verfügbar. Sie werden nach dem Speichern oder Schliessen geladen.');return}
      await reloadCloudData();
    },400);
  }).subscribe();
}

function sortedCustomers(rows){
  const result=[...rows],byName=(a,b)=>customerName(a).localeCompare(customerName(b),'de',{sensitivity:'base'}),byNumber=(a,b)=>(Number(String(a.number).replace(/\D/g,''))||0)-(Number(String(b.number).replace(/\D/g,''))||0);
  result.sort(customerSort==='name-asc'?byName:customerSort==='name-desc'?(a,b)=>byName(b,a):customerSort==='number-desc'?(a,b)=>byNumber(b,a):byNumber);
  return result;
}

function renderCloudCustomers(){
  setTitle('Kunden');
  $('#content').innerHTML=`<div class="section-head"><div class="actions"><button class="primary" onclick="customerForm()">Kunde erfassen</button><label>Sortierung<select id="customer-sort"><option value="number-asc">Kundennummer aufsteigend</option><option value="number-desc">Kundennummer absteigend</option><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option></select></label></div><label class="inline"><input id="show-customer-archive" type="checkbox"> Archiv anzeigen</label></div><div id="customer-table"></div>`;
  $('#customer-sort').value=customerSort;
  const draw=()=>{$('#customer-table').innerHTML=customersTable(sortedCustomers(state.customers.filter(c=>$('#show-customer-archive').checked?c.archived:!c.archived)))};
  $('#customer-sort').onchange=e=>{customerSort=e.target.value;draw()};$('#show-customer-archive').onchange=draw;draw();
}

function sortRows(rows,mode,fields){
  const [field,direction]=mode.split('-'),factor=direction==='desc'?-1:1,getter=fields[field];
  return [...rows].sort((a,b)=>{const av=getter(a),bv=getter(b);if(typeof av==='number'&&typeof bv==='number')return (av-bv)*factor;return String(av??'').localeCompare(String(bv??''),'de',{numeric:true,sensitivity:'base'})*factor});
}

function renderSortableOrders(){
  setTitle('Aufträge');
  $('#content').innerHTML=`<div class="section-head"><div class="actions"><button class="primary" onclick="orderForm()">Auftrag erfassen</button><label>Sortierung<select id="order-sort"><option value="number-asc">Nummer aufsteigend</option><option value="number-desc">Nummer absteigend</option><option value="customer-asc">Kunde A–Z</option><option value="customer-desc">Kunde Z–A</option><option value="fulfilment-asc">Erfüllungsart A–Z</option><option value="fulfilment-desc">Erfüllungsart Z–A</option><option value="date-asc">Liefer-/Abholdatum aufsteigend</option><option value="date-desc">Liefer-/Abholdatum absteigend</option><option value="status-asc">Status A–Z</option><option value="status-desc">Status Z–A</option></select></label></div><label class="inline"><input id="show-order-archive" type="checkbox"> Archiv anzeigen</label></div><div id="order-table"></div>`;
  $('#order-sort').value=orderSort;
  const fields={number:o=>o.number,customer:o=>o.customerSnapshot?.name||'',fulfilment:o=>o.fulfilment,date:o=>o.fulfilmentDate,status:o=>o.status};
  const draw=()=>{$('#order-table').innerHTML=ordersTable(sortRows(state.orders.filter(o=>$('#show-order-archive').checked?o.archived:!o.archived),orderSort,fields))};
  $('#order-sort').onchange=e=>{orderSort=e.target.value;draw()};$('#show-order-archive').onchange=draw;draw();
}

function renderSortableInvoices(){
  setTitle('Rechnungen');
  $('#content').innerHTML=`<div class="section-head"><div class="actions"><span class="muted">Rechnungen werden aus Aufträgen erstellt.</span><label>Sortierung<select id="invoice-sort"><option value="number-asc">Nummer aufsteigend</option><option value="number-desc">Nummer absteigend</option><option value="issued-asc">Rechnungsdatum aufsteigend</option><option value="issued-desc">Rechnungsdatum absteigend</option><option value="customer-asc">Kunde A–Z</option><option value="customer-desc">Kunde Z–A</option><option value="due-asc">Fälligkeit aufsteigend</option><option value="due-desc">Fälligkeit absteigend</option><option value="status-asc">Status A–Z</option><option value="status-desc">Status Z–A</option></select></label></div><label class="inline"><input id="show-invoice-archive" type="checkbox"> Archiv anzeigen</label></div><div id="invoice-table"></div>`;
  $('#invoice-sort').value=invoiceSort;
  const fields={number:i=>i.number,issued:i=>i.date,customer:i=>i.customerSnapshot?.name||'',due:i=>i.dueDate,status:i=>i.status};
  const draw=()=>{$('#invoice-table').innerHTML=invoicesTable(sortRows(state.invoices.filter(i=>$('#show-invoice-archive').checked?i.archived:!i.archived),invoiceSort,fields))};
  $('#invoice-sort').onchange=e=>{invoiceSort=e.target.value;draw()};$('#show-invoice-archive').onchange=draw;draw();
}

async function importCloudData(e){
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(![1,2].includes(Number(data.version))||!Array.isArray(data.customers)||!Array.isArray(data.orders)||!Array.isArray(data.invoices)||!data.settings)throw new Error('Ungültiges Backup-Format');
    if(!confirm(`Import enthält ${data.customers.length} Kunden, ${data.orders.length} Aufträge und ${data.invoices.length} Rechnungen. Der gesamte aktuelle Supabase-Datenbestand wird ersetzt. Fortfahren?`))return;
    const currentRevision=state.revision;
    repairEncoding(data);state=normalizeState(data);state.revision=currentRevision;
    await save();render(currentView);notice('Backup vollständig nach Supabase importiert.');
  }catch(error){console.error(error);alert(`Import fehlgeschlagen: ${error.message}`)}
}

async function acquireEditLock(type,id){
  await releaseCurrentEditLock();
  const {data,error}=await supabaseClient.rpc('acquire_edit_lock_v2',{p_entity_type:type,p_entity_id:id,p_session_token:EDIT_SESSION_TOKEN});
  if(error)throw error;if(!data)return false;
  activeEditLock={type,id};
  lockHeartbeat=setInterval(async()=>{if(activeEditLock)await supabaseClient.rpc('acquire_edit_lock_v2',{p_entity_type:activeEditLock.type,p_entity_id:activeEditLock.id,p_session_token:EDIT_SESSION_TOKEN})},60000);
  return true;
}

async function releaseCurrentEditLock(){
  if(lockHeartbeat){clearInterval(lockHeartbeat);lockHeartbeat=null}
  const lock=activeEditLock;activeEditLock=null;if(!lock)return;
  const {error}=await supabaseClient.rpc('release_edit_lock_v2',{p_entity_type:lock.type,p_entity_id:lock.id,p_session_token:EDIT_SESSION_TOKEN});
  if(error)console.error('Bearbeitungssperre konnte nicht freigegeben werden:',error);
}

function repairEncoding(value){
  const replacements={'Ã¤':'ä','Ã¶':'ö','Ã¼':'ü','Ã„':'Ä','Ã–':'Ö','Ãœ':'Ü','ÃŸ':'ß','Â ':' ','Â':'' ,'â€“':'–','â€”':'—','â€ž':'„','â€œ':'“','â€™':'’','â€˜':'‘','â€¦':'…','â‚¬':'€'};
  let changes=0;
  const walk=input=>{
    if(typeof input==='string'){let output=input;for(const [wrong,right] of Object.entries(replacements))output=output.split(wrong).join(right);if(output!==input)changes++;return output}
    if(Array.isArray(input)){for(let i=0;i<input.length;i++)input[i]=walk(input[i]);return input}
    if(input&&typeof input==='object'){for(const key of Object.keys(input))input[key]=walk(input[key]);return input}
    return input;
  };
  walk(value);return changes;
}

const originalCustomerForm=customerForm;
customerForm=async function(id){
  if(id){
    try{
      if(!(await acquireEditLock('customer',id))){alert('Dieser Kunde wird gerade auf einem anderen Gerät bearbeitet. Bitte versuche es später erneut.');return}
      const latest=await loadFromSupabase();
      state=latest;
      state.settings.logo||=DEFAULT_LOGO;
    }catch(error){
      console.error('Bearbeitungssperre nicht verfügbar:',error);
      alert(`Bearbeitungssperre nicht verfügbar: ${error?.message||'Unbekannter Fehler'}. Die Bearbeitung bleibt möglich; beim Speichern wird auf Konflikte geprüft.`);
    }
  }else{
    try{state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO}catch(error){alert(`Aktuelle Kundendaten konnten nicht geladen werden: ${error.message}`);return}
  }
  originalCustomerForm(id);
};
const originalOrderForm=orderForm;
orderForm=async function(id){
  if(id){
    try{
      if(!(await acquireEditLock('order',id))){alert('Dieser Auftrag wird gerade auf einem anderen Gerät bearbeitet. Bitte versuche es später erneut.');return}
      state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;
    }catch(error){
      console.error('Bearbeitungssperre nicht verfügbar:',error);
      alert(`Bearbeitungssperre nicht verfügbar: ${error?.message||'Unbekannter Fehler'}. Die Bearbeitung bleibt möglich; beim Speichern wird auf Konflikte geprüft.`);
    }
  }else{
    try{state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO}catch(error){alert(`Aktuelle Auftragsdaten konnten nicht geladen werden: ${error.message}`);return}
  }
  originalOrderForm(id);
  const form=$('#order-form');
  if(id&&form){
    const originalSubmit=form.onsubmit;
    form.onsubmit=async event=>{
      const cloudSave=save;save=async()=>{};
      try{await originalSubmit(event);const order=state.orders.find(x=>x.id===id);syncInvoiceFromOrder(order);await cloudSave();notice(order?.invoiceId?'Auftrag und verknüpfte Rechnung aktualisiert.':'Auftrag gespeichert.')}finally{save=cloudSave}
    };
  }
  if(form){
    const deliveryField=$('#delivery-field');
    deliveryField?.insertAdjacentHTML('beforeend','<button type="button" id="new-delivery-inline" class="text-button">Neue Lieferadresse ergänzen</button>');
    $('#new-delivery-inline').onclick=()=>{
      const customer=state.customers.find(x=>x.id===form.customerId.value);if(!customer)return;
      const label=prompt('Bezeichnung der Lieferadresse (z. B. Geschäft):');if(label===null)return;
      const street=prompt('Strasse und Hausnummer:');if(street===null)return;
      const city=prompt('PLZ und Ort:');if(city===null)return;
      customer.deliveries||=[];customer.deliveries.push({id:uid(),label:label.trim(),street:street.trim(),city:city.trim()});
      form.fulfilment.value='Lieferung';form.fulfilment.dispatchEvent(new Event('change'));form.deliveryIndex.value=String(customer.deliveries.length-1);
      notice('Lieferadresse ergänzt. Sie wird zusammen mit dem Auftrag gespeichert.');
    };
  }
};
const originalInvoiceForm=invoiceForm;
invoiceForm=async function(id){
  if(id){
    try{
      if(!(await acquireEditLock('invoice',id))){alert('Diese Rechnung wird gerade auf einem anderen Gerät bearbeitet. Bitte versuche es später erneut.');return}
      state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;
    }catch(error){
      console.error('Bearbeitungssperre nicht verfügbar:',error);
      alert(`Bearbeitungssperre nicht verfügbar: ${error?.message||'Unbekannter Fehler'}. Die Bearbeitung bleibt möglich; beim Speichern wird auf Konflikte geprüft.`);
    }
  }
  originalInvoiceForm(id);
};
function syncInvoiceFromOrder(order){
  if(!order?.invoiceId)return;
  const invoice=state.invoices.find(x=>x.id===order.invoiceId);if(!invoice)return;
  Object.assign(invoice,{orderId:order.id,orderNumber:order.number,customerId:order.customerId,customerSnapshot:structuredClone(order.customerSnapshot),items:structuredClone(order.items),total:order.total,updatedAt:new Date().toISOString()});
}

const originalPrintDocument=printDocument;
async function pdfDocument(type,id){
  const d=type==='order'?state.orders.find(x=>x.id===id):state.invoices.find(x=>x.id===id);if(!d)return;
  if(!window.jspdf?.jsPDF){alert('Die PDF-Funktion konnte nicht geladen werden. Bitte Internetverbindung prüfen und die Seite neu laden.');return}
  const {jsPDF}=window.jspdf,doc=new jsPDF({unit:'mm',format:'a4'}),s=state.settings,isInv=type==='invoice';
  let y=18;
  if(s.logo){try{const logoData=s.logo.startsWith('data:')?s.logo:await fetch(s.logo).then(r=>r.blob()).then(blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)}));doc.addImage(logoData,undefined,15,y,34,34,'logo','FAST')}catch(error){console.warn('Logo konnte nicht ins PDF eingefügt werden:',error)}}
  doc.setFontSize(10);doc.text(String(s.name||'Atelier Wuffli'),55,y+5);doc.text(doc.splitTextToSize(String(s.address||''),65),55,y+11);
  doc.text(String(d.customerSnapshot?.name||''),135,y+5);doc.text(String(d.customerSnapshot?.billing?.street||''),135,y+11);doc.text(`${d.customerSnapshot?.billing?.zip||''} ${d.customerSnapshot?.billing?.city||''}`.trim(),135,y+17);
  y=62;doc.setFontSize(20);doc.text(`${isInv?'Rechnung':'Auftrag'} ${d.number}`,15,y);y+=9;doc.setFontSize(10);doc.text(`Datum: ${date(d.date)}`,15,y);
  if(isInv){doc.text(`Auftrag: ${d.orderNumber||'–'}`,70,y);doc.text(`Fällig: ${date(d.dueDate)}`,135,y)}else{doc.text(`${d.fulfilment}: ${date(d.fulfilmentDate)}`,90,y)}
  y+=12;doc.setFillColor(245,242,239);doc.rect(15,y,180,8,'F');doc.text('Beschreibung',17,y+5.5);doc.text('Menge',125,y+5.5);doc.text('Einzelpreis',145,y+5.5);doc.text('Betrag',181,y+5.5,{align:'right'});y+=10;
  for(const item of d.items){const lines=doc.splitTextToSize(String(item.description||''),100),height=Math.max(8,lines.length*5);if(y+height>276){doc.addPage();y=20}doc.text(lines,17,y+4);doc.text(String(item.quantity),125,y+4);doc.text(money(item.price),145,y+4);doc.text(money(item.total),193,y+4,{align:'right'});doc.setDrawColor(220);doc.line(15,y+height,195,y+height);y+=height+2}
  y+=5;doc.setFontSize(13);doc.text(`Gesamtbetrag: ${money(d.total)}`,193,y,{align:'right'});y+=12;doc.setFontSize(10);
  if(d.text){doc.text(doc.splitTextToSize(String(d.text),175),15,y);y+=15}
  if(isInv){doc.text(`Zahlbar bis ${date(d.dueDate)}`,15,y);doc.text(`IBAN: ${s.iban||''}`,15,y+6);doc.text(`Referenz: ${d.number}`,15,y+12)}
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true,fileName=`${d.number}.pdf`;
  if(standalone){doc.save(fileName);return}
  const blobUrl=URL.createObjectURL(doc.output('blob')),opened=window.open(blobUrl,'_blank');if(!opened)doc.save(fileName);setTimeout(()=>URL.revokeObjectURL(blobUrl),60000);
}
printDocument=function(type,id){
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
  if(!standalone){originalPrintDocument(type,id);return}
  const d=type==='order'?state.orders.find(x=>x.id===id):state.invoices.find(x=>x.id===id);if(!d)return;
  const s=state.settings,isInv=type==='invoice',rows=d.items.map(x=>`<tr><td>${esc(x.description)}</td><td>${x.quantity}</td><td>${money(x.price)}</td><td>${money(x.total)}</td></tr>`).join('');
  const fulfil=!isInv?`<p><strong>${esc(d.fulfilment)}</strong> am ${date(d.fulfilmentDate)}</p>`:'';
  const overlay=document.createElement('div');overlay.id='mobile-print-view';overlay.className='mobile-print-view';overlay.innerHTML=`<div class="print-controls"><button class="secondary" id="close-print">Zurück zur App</button><button class="primary" id="start-print">Drucken / als PDF speichern</button></div><div class="print-sheet"><header><div>${s.logo?`<img src="${s.logo}">`:''}<p><strong>${esc(s.name)}</strong><br>${docAddress(s.address)}</p></div><div><strong>${esc(d.customerSnapshot.name)}</strong><br>${esc(d.customerSnapshot.billing.street||'')}<br>${esc([d.customerSnapshot.billing.zip,d.customerSnapshot.billing.city].filter(Boolean).join(' '))}</div></header><h1>${isInv?'Rechnung':'Auftrag'} ${esc(d.number)}</h1><p>Datum: ${date(d.date)}</p>${fulfil}<table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Einzelpreis</th><th>Betrag</th></tr></thead><tbody>${rows}</tbody></table><p class="total">Gesamtbetrag: ${money(d.total)}</p><div class="footer">${docAddress(d.text)}${isInv?`<p>Zahlbar bis ${date(d.dueDate)}<br>IBAN: ${esc(s.iban)}<br>Referenz: ${esc(d.number)}</p>`:''}</div></div>`;
  document.body.appendChild(overlay);$('#close-print').onclick=()=>overlay.remove();$('#start-print').onclick=()=>window.print();
};
renderCustomers=renderCloudCustomers;
renderOrders=renderSortableOrders;
renderInvoices=renderSortableInvoices;
Object.assign(window,{customerForm,orderForm,invoiceForm,createInvoice,printDocument,pdfDocument,toggleArchive,exportData,closeModal,resetEverything,reloadCloudData});
init().catch(err=>{console.error(err);alert(`Supabase konnte nicht geladen werden. ${err?.message||'Bitte Internetverbindung und Datenbankeinrichtung prüfen.'}`)});
