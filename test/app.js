const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DEFAULT_LOGO='assets/atelier-wuffli-logo.jpeg';
const SUPABASE_URL='https://xiqbveuuhngeosqetfuo.supabase.co';
const SUPABASE_KEY='sb_publishable_b8fuZ9lkbj97c5OKVxqA7Q_7TzgqzpM';
const APP_VERSION='TEST V0.0.38.0';
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
if(window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true)document.documentElement.classList.add('standalone-app');
let state,currentView='dashboard',realtimeChannel=null,presenceChannel=null,presenceHeartbeat=null,versionHeartbeat=null,presenceUser=null,lastUserActivity=Date.now(),lastPresenceTrack=0,remoteRevision=0,isSaving=false,customerSort='number-asc',orderSort='number-desc',invoiceSort='number-desc',receiptSort='number-desc',financeMonth=new Date().toISOString().slice(0,7),activeEditLock=null,lockHeartbeat=null;
let lastEditLockConflict=null;
const EDIT_SESSION_TOKEN=crypto.randomUUID();
const DEVICE_ID=localStorage.getItem('atelier-wuffli-device-id')||crypto.randomUUID();localStorage.setItem('atelier-wuffli-device-id',DEVICE_ID);
const blankState=()=>({version:2,revision:0,settings:{firstName:'',companyName:'',street:'',postalCity:'',bankName:'',bankAddress:'',iban:'',mwstNumber:'',paymentDays:30,logo:'',orderText:'',invoiceText:''},customers:[],orders:[],invoices:[],expenses:[],lastExport:null});
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;
const today=()=>new Date().toISOString().slice(0,10);
const dueDateFromFulfilment=d=>{const due=new Date(`${d||today()}T12:00:00`);due.setDate(due.getDate()+Number(state?.settings?.paymentDays??30));return due.toISOString().slice(0,10)};
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money=n=>new Intl.NumberFormat('de-CH',{style:'currency',currency:'CHF'}).format(Number(n)||0);
const date=v=>v?new Intl.DateTimeFormat('de-CH').format(new Date(`${v}T12:00:00`)):'–';
const customerName=c=>c?(c.company||[c.firstName,c.lastName].filter(Boolean).join(' ')||'Ohne Namen'):'Unbekannt';
const address=c=>[c?.street,c?.zip&&c?.city?`${c.zip} ${c.city}`:c?.zip||c?.city].filter(Boolean).join(', ');
const businessName=s=>[s?.firstName,s?.companyName].filter(Boolean).join(' · ')||s?.name||'';
const businessIdentityLines=s=>[s?.companyName,s?.firstName].filter(Boolean).length?[s.companyName,s.firstName].filter(Boolean):[s?.name].filter(Boolean);
const businessAddressLines=s=>[s?.street,s?.postalCity].filter(Boolean).length?[s.street,s.postalCity].filter(Boolean):String(s?.address||'').split(/\r?\n/).filter(Boolean);
const businessAddress=s=>businessAddressLines(s).join(', ');

function normalizeState(data){
  const base=blankState();
  const next=data&&typeof data==='object'?data:{};
  const settings={...base.settings,...(next.settings||{})};
  if(!settings.companyName&&settings.name)settings.companyName=settings.name;
  if((!settings.street||!settings.postalCity)&&settings.address){const parts=String(settings.address).split(/\r?\n/).filter(Boolean);if(parts.length>1){settings.street||=parts[0];settings.postalCity||=parts.slice(1).join(' ')}else{const match=String(settings.address).match(/^(.*?\s+\d+[a-zA-Z]?)\s+(\d{4}\s+.+)$/);if(match){settings.street||=match[1];settings.postalCity||=match[2]}else settings.street||=settings.address}}
  return {
    ...base,
    ...next,
    version:2,
    revision:Number(next.revision)||0,
    settings,
    customers:Array.isArray(next.customers)?next.customers:[],
    orders:Array.isArray(next.orders)?next.orders:[],
    invoices:Array.isArray(next.invoices)?next.invoices:[],
    expenses:Array.isArray(next.expenses)?next.expenses:[]
  };
}

async function saveToSupabase(){
  for(const order of state.orders)if(typeof order.number!=='string')order.number=await nextNumber('AF',order.date);
  for(const invoice of state.invoices)if(typeof invoice.number!=='string')invoice.number=await nextNumber('RE',invoice.date);
  for(const invoice of state.invoices)if(invoice.receipt&&typeof invoice.receipt.number!=='string')invoice.receipt.number=await nextNumber('QU',invoice.receipt.date);
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
    await assertCurrentEditLock();
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
async function saveCustomerRecord(customer,expectedUpdatedAt=null,requireLock=false){
  isSaving=true;
  try{
    if(requireLock)await assertCurrentEditLock();
    const {data,error}=await supabaseClient.rpc('save_customer_v1',{p_customer:customer,p_expected_updated_at:expectedUpdatedAt||null,p_session_token:requireLock?EDIT_SESSION_TOKEN:null});
    if(error)throw error;
    state.revision=Number(data.revision);remoteRevision=Math.max(remoteRevision,state.revision);
    return data.customer;
  }catch(error){
    const message=String(error?.message||'');
    if(message.includes('CUSTOMER_CONFLICT'))throw new Error('Dieser Kunde wurde zwischenzeitlich geändert. Bitte schliesse das Formular und öffne ihn erneut.');
    if(message.includes('EDIT_LOCK_LOST'))throw new Error('Die Bearbeitungssperre ist abgelaufen. Bitte schliesse das Formular und öffne ihn erneut.');
    throw error;
  }finally{isSaving=false}
}
async function saveRecordRpc(functionName,payloadName,payload,expectedUpdatedAt=null,requireLock=false){
  isSaving=true;
  try{
    if(requireLock)await assertCurrentEditLock();
    const args={[payloadName]:payload,p_expected_updated_at:expectedUpdatedAt||null,p_session_token:requireLock?EDIT_SESSION_TOKEN:null};
    const {data,error}=await supabaseClient.rpc(functionName,args);if(error)throw error;
    remoteRevision=Math.max(remoteRevision,Number(data.revision)||0);
    state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;
    return data;
  }catch(error){
    const message=String(error?.message||'');
    if(message.includes('_CONFLICT'))throw new Error('Der Datensatz wurde zwischenzeitlich geändert. Bitte schliesse das Formular und öffne ihn erneut.');
    if(message.includes('EDIT_LOCK_LOST'))throw new Error('Die Bearbeitungssperre ist abgelaufen. Bitte schliesse das Formular und öffne ihn erneut.');
    throw error;
  }finally{isSaving=false}
}
const saveOrderRecord=(record,stamp=null,locked=false)=>saveRecordRpc('save_order_v1','p_order',record,stamp,locked);
const saveInvoiceRecord=(record,stamp=null,locked=false)=>saveRecordRpc('save_invoice_v1','p_invoice',record,stamp,locked);
const saveExpenseRecord=(record,stamp=null,locked=false)=>saveRecordRpc('save_expense_v1','p_expense',record,stamp,locked);
async function saveSettingsRecord(settings){
  isSaving=true;
  try{await assertCurrentEditLock();const {data,error}=await supabaseClient.rpc('save_settings_v1',{p_settings:settings,p_session_token:EDIT_SESSION_TOKEN});if(error)throw error;remoteRevision=Math.max(remoteRevision,Number(data.revision)||0);state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;return data}
  catch(error){if(String(error?.message||'').includes('EDIT_LOCK_LOST'))throw new Error('Die Bearbeitungssperre ist abgelaufen. Bitte öffne die Einstellungen erneut.');throw error}
  finally{isSaving=false}
}
async function restoreDeletedRecord(entityType,id){
  const {data,error}=await supabaseClient.rpc('restore_record_v1',{p_entity_type:entityType,p_entity_id:id});if(error)throw error;remoteRevision=Math.max(remoteRevision,Number(data.revision)||0);state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;render(currentView)
}
async function deleteRecord(entityType,id,label){
  if(!confirm(`${label} wirklich löschen? Der Eintrag bleibt im Änderungsprotokoll erhalten und kann unmittelbar rückgängig gemacht werden.`))return;
  try{
    if(!(await acquireEditLock(entityType,id))){alert(editLockConflictMessage(`Der Eintrag ${label}`));return}
    const {data,error}=await supabaseClient.rpc('soft_delete_record_v1',{p_entity_type:entityType,p_entity_id:id,p_reason:'Manuell in der App gelöscht',p_session_token:EDIT_SESSION_TOKEN});if(error)throw error;
    remoteRevision=Math.max(remoteRevision,Number(data.revision)||0);await releaseCurrentEditLock();state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;render(currentView);undoNotice(`${label} wurde gelöscht.`,()=>restoreDeletedRecord(entityType,id))
  }catch(error){await releaseCurrentEditLock();const message=String(error?.message||'');if(message.includes('CUSTOMER_HAS_ORDERS'))alert('Der Kunde kann nicht gelöscht werden, solange noch Aufträge zugeordnet sind.');else if(message.includes('ORDER_HAS_INVOICE'))alert('Der Auftrag kann nicht gelöscht werden, solange noch eine Rechnung zugeordnet ist.');else alert(`Löschen fehlgeschlagen: ${message}`)}
}
function auditChangedFields(entry){const before=entry.oldData||{},after=entry.newData||{},ignored=new Set(['updated_at','created_at']);return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!ignored.has(key)&&JSON.stringify(before[key])!==JSON.stringify(after[key])).join(', ')||'Keine Feldänderung'}
async function openAuditLog(){
  const {data,error}=await supabaseClient.rpc('get_audit_log_v1',{p_limit:150});if(error){alert(`Änderungsprotokoll konnte nicht geladen werden: ${error.message}`);return}const labels={customers:'Kunde',delivery_addresses:'Lieferadresse',orders:'Auftrag',order_items:'Auftragsposition',invoices:'Rechnung',invoice_items:'Rechnungsposition',receipts:'Quittung',expenses:'Ausgabe',company_settings:'Einstellungen'},actions={INSERT:'Erstellt',UPDATE:'Geändert',DELETE:'Physisch gelöscht'};
  modal('Änderungsprotokoll',`<div class="audit-list">${data.length?`<div class="table-wrap"><table><thead><tr><th>Zeit</th><th>Bereich</th><th>Aktion</th><th>Geänderte Werte</th><th>Benutzer</th></tr></thead><tbody>${data.map(entry=>`<tr><td>${new Date(entry.changedAt).toLocaleString('de-CH')}</td><td>${esc(labels[entry.entityType]||entry.entityType)}</td><td>${esc(actions[entry.action]||entry.action)}</td><td>${esc(auditChangedFields(entry))}</td><td>${esc(entry.changedBy?entry.changedBy.slice(0,8):'System')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Noch keine protokollierten Änderungen.</div>'}</div>`)
}
function notice(msg){const n=$('#notice');n.textContent=msg;n.classList.remove('hidden');setTimeout(()=>n.classList.add('hidden'),3500)}
function undoNotice(msg,onUndo){const n=$('#notice');n.innerHTML=`<span>${esc(msg)}</span> <button type="button" class="secondary" id="undo-action">Rückgängig</button>`;n.classList.remove('hidden');const button=$('#undo-action'),timer=setTimeout(()=>n.classList.add('hidden'),8000);button.onclick=async()=>{button.disabled=true;clearTimeout(timer);try{await onUndo();notice('Löschung rückgängig gemacht.')}catch(error){alert(`Wiederherstellung fehlgeschlagen: ${error.message}`)}}}
function setTitle(t){$('#page-title').textContent=t}
function modal(title,html){$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;$('#modal').showModal()}
async function closeModal(){await releaseCurrentEditLock();if($('#modal').open)$('#modal').close();if(remoteRevision>state.revision&&!isSaving)await reloadCloudData()}
function fields(obj,names){return names.map(([key,label,type='text',span=false,extra=''])=>`<label class="${span?'span-2':''}">${label}<input name="${key}" type="${type}" value="${esc(obj?.[key]||'')}" ${extra}></label>`).join('')}
function salutationSelect(value='',id=''){
  const normalized=String(value||'').trim().toLowerCase(),selected=normalized==='frau'||normalized==='sie'?'Sie':normalized==='herr'?'Herr':normalized==='divers'?'Divers':'';
  return `<select ${id?`id="${id}"`:'name="salutation"'}><option value="">Bitte auswählen</option>${['Herr','Sie','Divers'].map(option=>`<option value="${option}" ${selected===option?'selected':''}>${option}</option>`).join('')}</select>`
}
function customerGreeting(document){
  const snapshot=document?.customerSnapshot||{},customer=state.customers.find(entry=>entry.id===document?.customerId),salutation=String(snapshot.salutation||customer?.salutation||'').trim().toLowerCase(),firstName=String(snapshot.firstName||customer?.firstName||'').trim(),lastName=String(snapshot.lastName||customer?.lastName||'').trim(),name=firstName||lastName||String(snapshot.name||'').trim();
  if(!name)return 'Liebe Kundin, lieber Kunde,';
  if(salutation==='herr')return `Lieber ${name},`;
  if(salutation==='sie'||salutation==='frau')return `Liebe ${name},`;
  return `Guten Tag ${name},`
}
async function deliverPdf(doc,fileName){
  const blob=doc.output('blob'),file=new File([blob],fileName,{type:'application/pdf'}),mobile=window.matchMedia?.('(pointer: coarse)').matches||window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
  if(mobile){
    const blobUrl=URL.createObjectURL(blob),canShare=Boolean(navigator.share&&navigator.canShare?.({files:[file]})),overlay=document.createElement('div');overlay.className='pdf-preview-view';overlay.innerHTML=`<div class="pdf-preview-controls"><button type="button" class="secondary" data-pdf-close>Schliessen</button><strong>${esc(fileName)}</strong><button type="button" class="primary" data-pdf-action>${canShare?'PDF teilen':'PDF herunterladen'}</button></div><iframe title="PDF-Vorschau ${esc(fileName)}" src="${blobUrl}"></iframe>`;
    document.body.appendChild(overlay);
    const close=()=>{overlay.remove();URL.revokeObjectURL(blobUrl)};
    overlay.querySelector('[data-pdf-close]').onclick=close;
    overlay.querySelector('[data-pdf-action]').onclick=async()=>{if(!canShare){doc.save(fileName);return}try{await navigator.share({files:[file],title:fileName})}catch(error){if(error?.name!=='AbortError'){console.warn('PDF konnte nicht direkt geteilt werden:',error);doc.save(fileName)}}};
    return
  }
  const blobUrl=URL.createObjectURL(blob),opened=window.open(blobUrl,'_blank');if(!opened)doc.save(fileName);setTimeout(()=>URL.revokeObjectURL(blobUrl),60000)
}
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
  startUserPresence().catch(error=>console.warn('Benutzerstatus konnte nicht gestartet werden:',error));
  startVersionMonitor();
  render('dashboard');
}

async function checkAppVersion(){
  try{
    const response=await fetch(`VERSION?check=${Date.now()}`,{cache:'no-store'});if(!response.ok)return;
    const published=(await response.text()).trim();if(published&&published!==APP_VERSION)showVersionUpdate(published);
  }catch(error){console.warn('Versionsprüfung momentan nicht möglich:',error)}
}
function startVersionMonitor(){if(versionHeartbeat)return;checkAppVersion();versionHeartbeat=setInterval(checkAppVersion,60000)}
function showVersionUpdate(published){
  if($('#version-update'))return;
  const banner=document.createElement('div');banner.id='version-update';banner.className='version-update';banner.innerHTML=`<div><strong>Neue ERP-Version verfügbar</strong><span>${esc(published)} wurde veröffentlicht. Bitte starte die Sitzung neu.</span></div><button type="button" class="primary">Jetzt neu starten</button>`;
  document.body.appendChild(banner);banner.querySelector('button').onclick=async()=>{if($('#modal').open&&!confirm('Das Formular ist noch geöffnet. Nicht gespeicherte Eingaben verwerfen und die neue Version laden?'))return;banner.querySelector('button').disabled=true;await releaseCurrentEditLock();location.reload()};
}

const viewLabel=view=>({dashboard:'Übersicht',appointments:'Termine',customers:'Kunden',orders:'Aufträge',invoices:'Rechnungen',receipts:'Quittungen',expenses:'Ausgaben',income:'Einnahmen',settings:'Einstellungen'}[view]||view);
function deviceLabel(){const ua=navigator.userAgent||'';if(/iPad|Tablet/i.test(ua))return'Tablet';if(/iPhone|iPod/i.test(ua))return'iPhone';if(/Android/i.test(ua))return/Mobile/i.test(ua)?'Android-Smartphone':'Android-Tablet';if(/Macintosh|Mac OS/i.test(ua))return'Mac';if(/Windows/i.test(ua))return'Windows-PC';if(/Linux/i.test(ua))return'Linux-PC';return'Gerät'}
function presencePayload(){return{sessionId:EDIT_SESSION_TOKEN,deviceId:DEVICE_ID,device:deviceLabel(),userId:presenceUser?.id||EDIT_SESSION_TOKEN,email:presenceUser?.email||'Unbekannter Benutzer',name:presenceUser?.user_metadata?.full_name||presenceUser?.user_metadata?.name||presenceUser?.email?.split('@')[0]||'Benutzer',lastActive:new Date(lastUserActivity).toISOString(),view:currentView}}
async function trackUserPresence(force=false){if(!presenceChannel||!presenceUser)return;const now=Date.now();if(!force&&now-lastPresenceTrack<12000)return;lastPresenceTrack=now;await presenceChannel.track(presencePayload())}
function renderActiveUsers(){const list=$('#active-users-list'),count=$('#active-users-count');if(!list||!count)return;const raw=Object.values(presenceChannel?.presenceState?.()||{}).flat(),devices=new Map();raw.forEach(entry=>{const key=entry.deviceId||entry.sessionId||entry.presence_ref,previous=devices.get(key);if(!previous||String(entry.lastActive||'')>String(previous.lastActive||''))devices.set(key,entry)});const entries=[...devices.values()].sort((a,b)=>`${a.name||a.email} ${a.device||''}`.localeCompare(`${b.name||b.email} ${b.device||''}`,'de')),now=Date.now();count.textContent=String(entries.length);list.innerHTML=entries.length?entries.map(user=>{const inactive=now-new Date(user.lastActive||0).getTime()>120000,label=user.name||user.email||'Benutzer',device=user.device||'Gerät',email=user.email&&user.email!==label?user.email:'';return`<div class="active-user" title="${esc([email,device].filter(Boolean).join(' · '))}"><span class="presence-dot ${inactive?'inactive':'online'}"></span><span><strong>${esc(label)}</strong><small>${esc(device)}${email?` · ${esc(email)}`:''}</small><small>${inactive?'Inaktiv':'Online'}${user.view?` · ${esc(viewLabel(user.view))}`:''}</small></span></div>`}).join(''):'<span class="active-users-empty">Niemand online</span>'}
async function startUserPresence(){if(presenceChannel)return;const {data:{user}}=await supabaseClient.auth.getUser();if(!user)return;presenceUser=user;presenceChannel=supabaseClient.channel('erp-active-users',{config:{presence:{key:EDIT_SESSION_TOKEN}}}).on('presence',{event:'sync'},renderActiveUsers).on('presence',{event:'join'},renderActiveUsers).on('presence',{event:'leave'},renderActiveUsers).subscribe(async status=>{if(status==='SUBSCRIBED'){await trackUserPresence(true);renderActiveUsers()}});presenceHeartbeat=setInterval(()=>{trackUserPresence(true).catch(()=>{});renderActiveUsers()},60000)}
async function stopUserPresence(){if(presenceHeartbeat){clearInterval(presenceHeartbeat);presenceHeartbeat=null}if(presenceChannel){await presenceChannel.untrack().catch(()=>{});await supabaseClient.removeChannel(presenceChannel);presenceChannel=null}presenceUser=null;renderActiveUsers()}

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
    await stopUserPresence();
    if(realtimeChannel){await supabaseClient.removeChannel(realtimeChannel);realtimeChannel=null}
    await supabaseClient.auth.signOut();
    state=blankState();
    showLock();
  };

  $('#menu-button').onclick=()=>$('.sidebar').classList.toggle('open');
  $('#active-users-toggle').onclick=()=>{const panel=$('#active-users'),collapsed=panel.classList.toggle('collapsed');$('#active-users-toggle').setAttribute('aria-expanded',String(!collapsed))};
  ['pointerdown','keydown','input','touchstart'].forEach(eventName=>document.addEventListener(eventName,()=>{lastUserActivity=Date.now();trackUserPresence().catch(()=>{})},{passive:true}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastUserActivity=Date.now();trackUserPresence(true).catch(()=>{});renewCurrentEditLock().catch(()=>{})}});
  window.addEventListener('pagehide',()=>{releaseCurrentEditLock().catch(()=>{})});

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


function render(view){if(activeEditLock?.type==='settings'&&view!=='settings')releaseCurrentEditLock();currentView=view;trackUserPresence(true).catch(()=>{});$('#content').dataset.view=view;$$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('.sidebar').classList.remove('open');({dashboard:renderDashboard,appointments:renderAppointments,customers:renderCloudCustomers,orders:renderSortableOrders,invoices:renderSortableInvoices,receipts:renderReceipts,expenses:renderExpenses,income:renderIncome,settings:renderCloudSettings}[view])()}

function renderDashboard(){setTitle('Übersicht');const open=state.invoices.filter(i=>i.status==='Offen'&&!i.archived);$('#content').innerHTML=`<div class="grid stats"><div class="card stat"><span class="muted">Aktive Kunden</span><strong>${activeCustomers().length}</strong></div><div class="card stat"><span class="muted">Aufträge in Arbeit</span><strong>${state.orders.filter(o=>o.status==='In Arbeit'&&!o.archived).length}</strong></div><div class="card stat"><span class="muted">Offene Rechnungen</span><strong>${open.length}</strong></div><div class="card stat"><span class="muted">Offener Betrag</span><strong>${money(open.reduce((s,i)=>s+i.total,0))}</strong></div></div><div class="section-head"><h2>Schnellstart</h2></div><div class="actions"><button class="primary" onclick="customerForm()">Neuer Kunde</button><button class="secondary" onclick="orderForm()">Neuer Auftrag</button><button class="secondary" onclick="exportData()">Sicherung exportieren</button></div><div class="section-head"><h2>Letzte Aufträge</h2></div>${ordersTable(state.orders.filter(o=>!o.archived).slice(-5).reverse())}`}
function calendarWeek(value){const d=new Date(`${value}T12:00:00`),day=d.getDay()||7;d.setDate(d.getDate()+4-day);const year=d.getFullYear(),start=new Date(year,0,1),week=Math.ceil((((d-start)/86400000)+1)/7);return{year,week}}
const ROUTE_CACHE_KEY='atelier-wuffli-route-cache-v1';let lastGeocodeRequest=0;
function routeCache(){try{return JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY)||'{}')}catch{return{}}}
function saveRouteCache(cache){try{localStorage.setItem(ROUTE_CACHE_KEY,JSON.stringify(cache))}catch{}}
async function geocodeAddress(address){
  const key=address.trim().toLocaleLowerCase('de-CH'),cache=routeCache();if(cache[`geo:${key}`])return cache[`geo:${key}`];
  const wait=Math.max(0,1100-(Date.now()-lastGeocodeRequest));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));lastGeocodeRequest=Date.now();
  const response=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ch&q=${encodeURIComponent(address)}`,{headers:{Accept:'application/json'}});if(!response.ok)throw new Error('Adresssuche ist momentan nicht erreichbar.');const result=await response.json();if(!result.length)throw new Error(`Adresse nicht gefunden: ${address}`);const point={lat:Number(result[0].lat),lon:Number(result[0].lon),label:result[0].display_name};cache[`geo:${key}`]=point;saveRouteCache(cache);return point;
}
async function calculateDeliveryRoute(startAddress,targetAddress){
  const cache=routeCache(),key=`route:${startAddress}|${targetAddress}`.toLocaleLowerCase('de-CH');if(cache[key])return cache[key];
  const start=await geocodeAddress(startAddress),target=await geocodeAddress(targetAddress),response=await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${target.lon},${target.lat}?overview=false&steps=false`);if(!response.ok)throw new Error('Routenberechnung ist momentan nicht erreichbar.');const result=await response.json(),route=result.routes?.[0];if(result.code!=='Ok'||!route)throw new Error('Für diese Adressen wurde keine Fahrstrecke gefunden.');const value={distanceKm:route.distance/1000,durationMin:Math.round(route.duration/60),start,target};cache[key]=value;saveRouteCache(cache);return value;
}
function renderAppointments(){
  setTitle('Termine');
  const rows=state.orders.filter(o=>!o.archived&&o.status!=='Abgeschlossen'&&o.fulfilmentDate).sort((a,b)=>a.fulfilmentDate.localeCompare(b.fulfilmentDate)||String(a.number).localeCompare(String(b.number),'de-CH'));
  if(!rows.length){$('#content').innerHTML='<div class="card empty">Keine offenen Abhol- oder Liefertermine vorhanden.</div>';return}
  const groups=new Map();for(const order of rows){const {year,week}=calendarWeek(order.fulfilmentDate),key=`${year}-${week}`;if(!groups.has(key))groups.set(key,{year,week,orders:[]});groups.get(key).orders.push(order)}
  $('#content').innerHTML=[...groups.values()].map(group=>`<section class="appointment-week"><div class="section-head"><h2>Kalenderwoche ${group.week} · ${group.year}</h2><span class="muted">${group.orders.length} ${group.orders.length===1?'Termin':'Termine'}</span></div><div class="table-wrap"><table><thead><tr><th>Datum</th><th>Art</th><th>Kunde</th><th>Auftrag</th><th>Status</th><th></th></tr></thead><tbody>${group.orders.map(order=>`<tr><td><strong>${date(order.fulfilmentDate)}</strong></td><td><span class="badge ${order.fulfilment==='Lieferung'?'warn':'ok'}">${esc(order.fulfilment)}</span></td><td>${esc(order.customerSnapshot?.name||'')}</td><td>${esc(order.number)}</td><td>${esc(order.status)}</td><td><button class="secondary" onclick="orderForm('${order.id}')">Öffnen</button></td></tr>`).join('')}</tbody></table></div></section>`).join('');
}

function renderCustomers(){setTitle('Kunden');$('#content').innerHTML=`<div class="section-head"><div class="actions"><button class="primary" onclick="customerForm()">Kunde erfassen</button></div><label class="inline"><input id="show-customer-archive" type="checkbox"> Archiv anzeigen</label></div>${customersTable(state.customers.filter(c=>!c.archived))}`;$('#show-customer-archive').onchange=e=>{e.target.closest('#content').querySelector('.table-wrap')?.remove();e.target.closest('#content').insertAdjacentHTML('beforeend',customersTable(state.customers.filter(c=>e.target.checked?c.archived:!c.archived)))}}
function customersTable(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>Kundennr.</th><th>Kunde</th><th>Kontakt</th><th>Adresse</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.number)}</td><td><strong>${esc(customerName(c))}</strong></td><td>${esc(c.email||'–')}<br><span class="muted">${esc(c.phone||'')}</span></td><td>${esc(address(c))}</td><td><div class="actions"><button class="secondary" onclick="customerForm('${c.id}')">Bearbeiten</button><button class="secondary" onclick="toggleArchive('customers','${c.id}')">${c.archived?'Aktivieren':'Archivieren'}</button><button class="danger" onclick="deleteRecord('customer','${c.id}','${esc(c.number)}')">Löschen</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Keine Kunden vorhanden.</div>'}
function customerForm(id){const c=state.customers.find(x=>x.id===id)||{};modal(id?'Kunde bearbeiten':'Kunde erfassen',`<form id="customer-form"><div class="form-grid">${fields(c,[['company','Firma'],['salutation','Anrede'],['firstName','Vorname'],['lastName','Nachname'],['email','E-Mail','email'],['phone','Telefon'],['street','Strasse / Rechnungsadresse','text',true],['zip','PLZ'],['city','Ort'],['notes','Interne Notiz','text',true]])}<div class="span-2"><h3>Lieferadressen</h3><div id="delivery-list"></div><button type="button" class="secondary" id="add-delivery">Lieferadresse hinzufügen</button></div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);let deliveries=[...(c.deliveries||[])];const draw=()=>{$('#delivery-list').innerHTML=deliveries.map((d,i)=>`<div class="line-item"><input data-d="label" data-i="${i}" placeholder="Bezeichnung" value="${esc(d.label)}"><input data-d="street" data-i="${i}" placeholder="Strasse" value="${esc(d.street)}"><input data-d="city" data-i="${i}" placeholder="PLZ Ort" value="${esc(d.city)}"><button type="button" class="danger" data-remove="${i}">×</button></div>`).join('')};draw();$('#add-delivery').onclick=()=>{deliveries.push({label:'',street:'',city:''});draw()};$('#delivery-list').oninput=e=>{if(e.target.dataset.d)deliveries[+e.target.dataset.i][e.target.dataset.d]=e.target.value};$('#delivery-list').onclick=e=>{if(e.target.dataset.remove!==undefined){deliveries.splice(+e.target.dataset.remove,1);draw()}};$('#customer-form').onsubmit=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e.target));if(id)Object.assign(c,o,{deliveries,updatedAt:new Date().toISOString()});else state.customers.push({...o,id:uid(),number:`KD-${String(state.customers.length+1).padStart(4,'0')}`,deliveries,archived:false,createdAt:new Date().toISOString()});await save();closeModal();renderCustomers();notice('Kunde gespeichert.')}}

function renderOrders(){setTitle('Aufträge');const archived=state.orders.filter(o=>o.archived);$('#content').innerHTML=`<div class="section-head"><button class="primary" onclick="orderForm()">Auftrag erfassen</button><label class="inline"><input id="show-order-archive" type="checkbox"> Archiv anzeigen (${archived.length})</label></div><div id="order-table">${ordersTable(state.orders.filter(o=>!o.archived).reverse())}</div>`;$('#show-order-archive').onchange=e=>$('#order-table').innerHTML=ordersTable(state.orders.filter(o=>e.target.checked?o.archived:!o.archived).reverse())}
function ordersTable(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>Nummer</th><th>Kunde</th><th>Art / Datum</th><th>Status</th><th>Betrag</th><th></th></tr></thead><tbody>${rows.map(o=>`<tr><td>${esc(o.number)}</td><td>${esc(o.customerSnapshot?.name)}</td><td>${esc(o.fulfilment)}<br><span class="muted">${date(o.fulfilmentDate)}</span></td><td><span class="badge ${o.status==='Abgeschlossen'?'ok':'warn'}">${o.status}</span></td><td>${money(o.total)}</td><td><div class="actions"><button class="secondary" onclick="orderForm('${o.id}')">Bearbeiten</button><button class="secondary" onclick="pdfDocument('order','${o.id}')">PDF</button><button class="secondary" onclick="printDocument('order','${o.id}')">Drucken</button>${!o.invoiceId?`<button class="primary" onclick="createInvoice('${o.id}')">Rechnung</button>`:''}<button class="secondary" onclick="toggleArchive('orders','${o.id}')">${o.archived?'Aktivieren':'Archivieren'}</button><button class="danger" onclick="deleteRecord('order','${o.id}','${esc(o.number)}')">Löschen</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Keine Aufträge vorhanden.</div>'}
function customerOptions(selected){
  const customers=[...activeCustomers()],assigned=state.customers.find(c=>c.id===selected);
  if(assigned&&!customers.some(c=>c.id===assigned.id))customers.unshift(assigned);
  return customers.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(c.number)} – ${esc(customerName(c))}${c.archived?' (archiviert)':''}</option>`).join('')
}
function lineItemsEditor(items=[]){return `<div id="line-items" class="line-items"></div><button type="button" id="add-line" class="secondary">Position hinzufügen</button><div class="summary">Gesamt: <strong id="form-total">${money(0)}</strong></div>`}
function wireLines(items,onchange){const list=items.length?items:[{description:'',quantity:1,price:0}];items.splice(0,items.length,...list);const draw=()=>{$('#line-items').innerHTML=items.map((x,i)=>`<div class="line-item"><label>Beschreibung<input data-k="description" data-i="${i}" value="${esc(x.description)}" required></label><label>Menge<input data-k="quantity" data-i="${i}" type="number" min="0" step="0.01" value="${x.quantity}" required></label><label>Preis CHF<input data-k="price" data-i="${i}" type="number" step="0.01" value="${x.price}" required></label><button type="button" class="danger" data-remove="${i}">×</button></div>`).join('');calc()};const calc=()=>{items.forEach(x=>x.total=(Number(x.quantity)||0)*(Number(x.price)||0));$('#form-total').textContent=money(items.reduce((s,x)=>s+x.total,0));onchange?.()};$('#line-items').oninput=e=>{if(e.target.dataset.k){items[+e.target.dataset.i][e.target.dataset.k]=e.target.dataset.k==='description'?e.target.value:Number(e.target.value);calc()}};$('#line-items').onclick=e=>{if(e.target.dataset.remove!==undefined){items.splice(+e.target.dataset.remove,1);if(!items.length)items.push({description:'',quantity:1,price:0});draw()}};$('#add-line').onclick=()=>{items.push({description:'',quantity:1,price:0});draw()};draw()}
function orderForm(id){if(!id&&!activeCustomers().length){alert('Bitte zuerst einen Kunden erfassen.');render('customers');return}const o=state.orders.find(x=>x.id===id)||{date:today(),fulfilment:'Abholung',fulfilmentDate:today(),status:'In Arbeit',customerId:activeCustomers()[0].id,items:[]};modal(id?'Auftrag bearbeiten':'Auftrag erfassen',`<form id="order-form"><div class="form-grid"><label>Kunde<select name="customerId" required>${customerOptions(o.customerId)}</select></label><label>Auftragsdatum<input name="date" type="date" value="${o.date}" required></label><label>Erfüllungsart<select name="fulfilment"><option ${o.fulfilment==='Abholung'?'selected':''}>Abholung</option><option ${o.fulfilment==='Lieferung'?'selected':''}>Lieferung</option></select></label><label>Abhol-/Lieferdatum<input name="fulfilmentDate" type="date" value="${o.fulfilmentDate}" required></label><label>Status<select name="status"><option ${o.status==='In Arbeit'?'selected':''}>In Arbeit</option><option ${o.status==='Abgeschlossen'?'selected':''}>Abgeschlossen</option></select></label><label id="delivery-field">Lieferadresse<select name="deliveryIndex"></select></label><label class="span-2">Kundentext<textarea name="text">${esc(o.text||state.settings.orderText)}</textarea></label><label class="span-2">Interne Notiz<textarea name="notes">${esc(o.notes)}</textarea></label><div class="span-2"><h3>Positionen</h3>${lineItemsEditor(o.items)}</div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);const items=structuredClone(o.items||[]);wireLines(items);const form=$('#order-form'),delivery=()=>{const c=state.customers.find(x=>x.id===form.customerId.value),opts=(c?.deliveries||[]).map((d,i)=>`<option value="${i}" ${String(i)===String(o.deliveryIndex)?'selected':''}>${esc(d.label||d.street||`Adresse ${i+1}`)}</option>`).join('');form.deliveryIndex.innerHTML=opts||'<option value="">Keine Lieferadresse hinterlegt</option>';$('#delivery-field').classList.toggle('hidden',form.fulfilment.value!=='Lieferung')};form.customerId.onchange=delivery;form.fulfilment.onchange=delivery;delivery();form.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form)),c=state.customers.find(x=>x.id===data.customerId);if(data.fulfilment==='Lieferung'&&!(c.deliveries||[])[Number(data.deliveryIndex)]){alert('Für eine Lieferung muss beim Kunden eine Lieferadresse hinterlegt sein.');return}const snap={name:customerName(c),number:c.number,email:c.email,phone:c.phone,billing:{street:c.street,zip:c.zip,city:c.city},delivery:data.fulfilment==='Lieferung'?structuredClone(c.deliveries[Number(data.deliveryIndex)]):null};const total=items.reduce((s,x)=>s+x.total,0);if(id)Object.assign(o,data,{items,total,customerSnapshot:snap,updatedAt:new Date().toISOString()});else state.orders.push({...data,id:uid(),number:nextNumber('AF',data.date),items,total,customerSnapshot:snap,archived:false,createdAt:new Date().toISOString()});await save();closeModal();renderOrders();notice('Auftrag gespeichert.')}}

function renderInvoices(){setTitle('Rechnungen');$('#content').innerHTML=`<div class="section-head"><p class="muted">Rechnungen werden aus Aufträgen erstellt.</p><label class="inline"><input id="show-invoice-archive" type="checkbox"> Archiv anzeigen</label></div><div id="invoice-table">${invoicesTable(state.invoices.filter(i=>!i.archived).reverse())}</div>`;$('#show-invoice-archive').onchange=e=>$('#invoice-table').innerHTML=invoicesTable(state.invoices.filter(i=>e.target.checked?i.archived:!i.archived).reverse())}
const isOverdue=i=>i.status==='Offen'&&Boolean(i.dueDate)&&i.dueDate<today();
function invoicesTable(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>Nummer</th><th>Kunde</th><th>Fällig</th><th>Status</th><th>Betrag</th><th></th></tr></thead><tbody>${rows.map(i=>`<tr class="${isOverdue(i)?'overdue-row':''}"><td>${esc(i.number)}<br><span class="muted">${date(i.date)}</span>${i.receipt?`<br><span class="muted">Quittung ${esc(i.receipt.number)}</span>`:''}</td><td>${esc(i.customerSnapshot?.name)}</td><td>${date(i.dueDate)}</td><td><span class="badge ${isOverdue(i)?'danger':i.status==='Bezahlt'?'ok':i.status==='Storniert'?'danger':'warn'}">${isOverdue(i)?'Überfällig':i.status}</span></td><td>${money(i.total)}</td><td><div class="actions"><button class="secondary" onclick="invoiceForm('${i.id}')">Bearbeiten</button><button class="secondary" onclick="pdfDocument('invoice','${i.id}')">PDF</button><button class="secondary" onclick="printDocument('invoice','${i.id}')">Drucken</button>${i.status==='Bezahlt'&&!i.receipt?`<button class="primary" onclick="createReceipt('${i.id}')">Quittung erstellen</button>`:''}<button class="secondary" onclick="toggleArchive('invoices','${i.id}')">${i.archived?'Aktivieren':'Archivieren'}</button><button class="danger" onclick="deleteRecord('invoice','${i.id}','${esc(i.number)}')">Löschen</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Noch keine Rechnungen vorhanden.</div>'}
function receiptsTable(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>Quittung</th><th>Rechnung</th><th>Kunde</th><th>Datum</th><th>Betrag</th><th></th></tr></thead><tbody>${rows.map(({invoice,receipt})=>`<tr><td>${esc(receipt.number)}</td><td>${esc(receipt.invoiceNumber||invoice.number)}</td><td>${esc(receipt.customerSnapshot?.name)}</td><td>${date(receipt.date)}</td><td>${money(receipt.total)}</td><td><div class="actions"><button class="secondary" onclick="pdfDocument('receipt','${invoice.id}')">PDF</button><button class="secondary" onclick="printDocument('receipt','${invoice.id}')">Drucken</button><button class="danger" onclick="deleteRecord('receipt','${receipt.id}','${esc(receipt.number)}')">Löschen</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Noch keine Quittungen vorhanden.</div>'}
function renderReceipts(){setTitle('Quittungen');$('#content').innerHTML=`<div class="section-head"><div class="actions"><span class="muted">Hier erscheinen die Quittungen bezahlter Rechnungen.</span><label>Sortierung<select id="receipt-sort"><option value="number-asc">Nummer aufsteigend</option><option value="number-desc">Nummer absteigend</option><option value="date-asc">Datum aufsteigend</option><option value="date-desc">Datum absteigend</option><option value="customer-asc">Kunde A–Z</option><option value="customer-desc">Kunde Z–A</option><option value="invoice-asc">Rechnung aufsteigend</option><option value="invoice-desc">Rechnung absteigend</option></select></label></div></div><div id="receipt-table"></div>`;$('#receipt-sort').value=receiptSort;const fields={number:x=>x.receipt.number,date:x=>x.receipt.date,customer:x=>x.receipt.customerSnapshot?.name||'',invoice:x=>x.receipt.invoiceNumber||x.invoice.number},draw=()=>{$('#receipt-table').innerHTML=receiptsTable(sortRows(state.invoices.filter(i=>i.receipt).map(invoice=>({invoice,receipt:invoice.receipt})),receiptSort,fields))};$('#receipt-sort').onchange=e=>{receiptSort=e.target.value;draw()};draw()}
async function createInvoice(orderId){const o=state.orders.find(x=>x.id===orderId);if(!o||o.invoiceId)return;const d=today(),inv={id:uid(),number:nextNumber('RE',d),date:d,dueDate:dueDateFromFulfilment(o.fulfilmentDate),orderId:o.id,orderNumber:o.number,customerId:o.customerId,customerSnapshot:structuredClone(o.customerSnapshot),items:structuredClone(o.items),total:o.total,status:'Offen',paidDate:'',paymentMethod:'',text:state.settings.invoiceText,archived:false,createdAt:new Date().toISOString()};state.invoices.push(inv);o.invoiceId=inv.id;await save();render('invoices');notice(`Rechnung ${inv.number} erstellt.`)}
async function createReceipt(invoiceId){const i=state.invoices.find(x=>x.id===invoiceId);if(!i||i.receipt)return;if(i.status!=='Bezahlt'){alert('Eine Quittung kann erst erstellt werden, wenn die Rechnung als bezahlt markiert ist.');return}const d=today();i.receipt={id:uid(),number:nextNumber('QU',d),date:d,invoiceId:i.id,invoiceNumber:i.number,orderNumber:i.orderNumber,customerId:i.customerId,customerSnapshot:structuredClone(i.customerSnapshot),items:structuredClone(i.items),total:i.total,paymentMethod:i.paymentMethod||'',text:'Zahlung dankend erhalten.',createdAt:new Date().toISOString()};await save();render('receipts');notice(`Quittung ${i.receipt.number} erstellt.`)}
function syncReceiptFromInvoice(invoice){if(!invoice?.receipt)return;Object.assign(invoice.receipt,{invoiceId:invoice.id,invoiceNumber:invoice.number,orderNumber:invoice.orderNumber,customerId:invoice.customerId,customerSnapshot:structuredClone(invoice.customerSnapshot),items:structuredClone(invoice.items),total:invoice.total,paymentMethod:invoice.paymentMethod||'',updatedAt:new Date().toISOString()})}
function invoiceForm(id){const i=state.invoices.find(x=>x.id===id),items=structuredClone(i.items);modal('Rechnung bearbeiten',`<form id="invoice-form"><div class="form-grid"><label>Rechnungsnummer<input value="${esc(i.number)}" disabled></label><label>Rechnungsdatum<input name="date" type="date" value="${i.date}" required></label><label>Fälligkeitsdatum<input name="dueDate" type="date" value="${i.dueDate}" required></label><label>Status<select name="status"><option ${i.status==='Offen'?'selected':''}>Offen</option><option ${i.status==='Bezahlt'?'selected':''}>Bezahlt</option><option ${i.status==='Storniert'?'selected':''}>Storniert</option></select></label><label>Bezahlt am<input name="paidDate" type="date" value="${i.paidDate||i.receipt?.date||''}"></label><label>Zahlungsart<select name="paymentMethod"><option value="" ${!i.paymentMethod?'selected':''}>Nicht angegeben</option><option value="Überweisung" ${i.paymentMethod==='Überweisung'?'selected':''}>Überweisung</option><option value="Barzahlung" ${i.paymentMethod==='Barzahlung'?'selected':''}>Barzahlung</option><option value="TWINT" ${i.paymentMethod==='TWINT'?'selected':''}>TWINT</option><option value="Karte" ${i.paymentMethod==='Karte'?'selected':''}>Karte</option></select></label><label class="span-2">Rechnungstext<textarea name="text">${esc(i.text)}</textarea></label><div class="span-2"><h3>Positionen</h3>${lineItemsEditor(items)}</div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);wireLines(items);$('#invoice-form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.paidDate=data.status==='Bezahlt'?(data.paidDate||i.paidDate||today()):'';Object.assign(i,data,{items,total:items.reduce((s,x)=>s+x.total,0),updatedAt:new Date().toISOString()});syncReceiptFromInvoice(i);await save();closeModal();renderInvoices();notice(i.receipt?'Rechnung und Quittung aktualisiert.':'Rechnung gespeichert.')}}

const monthKey=d=>String(d||'').slice(0,7);
const monthLabel=m=>new Intl.DateTimeFormat('de-CH',{month:'short',year:'2-digit'}).format(new Date(`${m}-01T12:00:00`));
function lastTwelveMonths(){const now=new Date(),months=[];for(let n=11;n>=0;n--){const d=new Date(now.getFullYear(),now.getMonth()-n,1);months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)}return months}
function financeChart(entries,dateOf,amountOf){const months=lastTwelveMonths(),totals=months.map(m=>entries.filter(x=>monthKey(dateOf(x))===m).reduce((s,x)=>s+Number(amountOf(x)||0),0)),max=Math.max(...totals,1);return `<div class="card finance-chart"><h2>Letzte 12 Monate</h2><div class="bar-chart">${months.map((m,i)=>`<div class="bar-column"><span class="bar-value">${totals[i]?money(totals[i]):'–'}</span><div class="bar" style="height:${Math.max(totals[i]?6:0,totals[i]/max*100)}%"></div><span class="bar-label">${monthLabel(m)}</span></div>`).join('')}</div></div>`}
function expenseForm(id){const x=state.expenses.find(e=>e.id===id)||{date:today(),amount:''};modal(id?'Ausgabe bearbeiten':'Neue Ausgabe',`<form id="expense-form"><div class="form-grid"><label>Datum<input name="date" type="date" value="${x.date}" required></label><label>Betrag CHF<input name="amount" type="number" min="0" step="0.01" value="${x.amount}" required></label><label class="span-2">Beschreibung<textarea name="description" required>${esc(x.description)}</textarea></label></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);$('#expense-form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.amount=Number(data.amount);if(id)Object.assign(x,data,{updatedAt:new Date().toISOString()});else state.expenses.push({...data,id:uid(),createdAt:new Date().toISOString()});await save();closeModal();financeMonth=monthKey(data.date);renderExpenses();notice('Ausgabe gespeichert.')}}
async function deleteExpense(id){const x=state.expenses.find(e=>e.id===id);if(x)await deleteRecord('expense',id,x.description||'Ausgabe')}
function renderExpenses(){setTitle('Ausgaben');const rows=state.expenses.filter(x=>monthKey(x.date)===financeMonth).sort((a,b)=>b.date.localeCompare(a.date)),total=rows.reduce((s,x)=>s+Number(x.amount),0);$('#content').innerHTML=`<div class="section-head"><div class="actions"><button class="primary" onclick="expenseForm()">Neue Ausgabe</button><label>Monat<input id="finance-month" type="month" value="${financeMonth}"></label><button class="secondary" onclick="pdfMonthlyReport('expenses','${financeMonth}')">Monatsbericht PDF</button></div></div><div class="grid stats finance-stats"><div class="card stat"><span class="muted">Ausgaben ${monthLabel(financeMonth)}</span><strong>${money(total)}</strong></div><div class="card stat"><span class="muted">Einträge</span><strong>${rows.length}</strong></div></div>${financeChart(state.expenses,x=>x.date,x=>x.amount)}<div class="section-head"><h2>Ausgaben ${monthLabel(financeMonth)}</h2></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Beschreibung</th><th>Betrag</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${date(x.date)}</td><td>${esc(x.description)}</td><td>${money(x.amount)}</td><td><div class="actions"><button class="secondary" onclick="expenseForm('${x.id}')">Bearbeiten</button><button class="danger" onclick="deleteExpense('${x.id}')">Löschen</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Keine Ausgaben in diesem Monat.</div>'}`;$('#finance-month').onchange=e=>{financeMonth=e.target.value;renderExpenses()}}
const incomeDate=i=>i.paidDate||i.receipt?.date||i.date;
function renderIncome(){setTitle('Einnahmen');const paid=state.invoices.filter(i=>i.status==='Bezahlt'),rows=paid.filter(i=>monthKey(incomeDate(i))===financeMonth).sort((a,b)=>incomeDate(b).localeCompare(incomeDate(a))),total=rows.reduce((s,i)=>s+Number(i.total),0);$('#content').innerHTML=`<div class="section-head"><div class="actions"><label>Monat<input id="finance-month" type="month" value="${financeMonth}"></label><button class="secondary" onclick="pdfMonthlyReport('income','${financeMonth}')">Monatsbericht PDF</button></div></div><div class="grid stats finance-stats"><div class="card stat"><span class="muted">Einnahmen ${monthLabel(financeMonth)}</span><strong>${money(total)}</strong></div><div class="card stat"><span class="muted">Bezahlte Rechnungen</span><strong>${rows.length}</strong></div></div>${financeChart(paid,incomeDate,i=>i.total)}<div class="section-head"><h2>Einnahmen ${monthLabel(financeMonth)}</h2></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Zahlungsdatum</th><th>Rechnung</th><th>Kunde</th><th>Betrag</th></tr></thead><tbody>${rows.map(i=>`<tr><td>${date(incomeDate(i))}</td><td>${esc(i.number)}</td><td>${esc(i.customerSnapshot?.name)}</td><td>${money(i.total)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Keine Einnahmen in diesem Monat.</div>'}`;$('#finance-month').onchange=e=>{financeMonth=e.target.value;renderIncome()}}
async function pdfMonthlyReport(kind,month){
  if(!window.jspdf?.jsPDF){alert('Die PDF-Funktion konnte nicht geladen werden.');return}
  const isExpense=kind==='expenses',rows=isExpense?state.expenses.filter(x=>monthKey(x.date)===month):state.invoices.filter(i=>i.status==='Bezahlt'&&monthKey(incomeDate(i))===month),total=rows.reduce((sum,x)=>sum+Number(isExpense?x.amount:x.total),0),{jsPDF}=window.jspdf,doc=new jsPDF({unit:'mm',format:'a4'}),s=state.settings,rose=[247,243,241],roseStrong=[205,198,194],ink=[54,47,52],muted=[105,86,94];
  const decorate=()=>{doc.setFillColor(255,255,255);doc.rect(0,0,210,297,'F')};
  const addLogo=async()=>{if(!s.logo)return;try{doc.addImage(await preparePdfLogo(s.logo),'PNG',151,12,42,42,'report-logo','FAST')}catch(error){console.warn('Logo konnte nicht ins PDF eingefügt werden:',error)}};
  decorate();await addLogo();doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(...muted);doc.text(doc.splitTextToSize([businessName(s),businessAddress(s)].filter(Boolean).join(' · '),105),20,25);doc.setFontSize(10);doc.text(monthLabel(month),190,62,{align:'right'});doc.text(`Erstellt am ${date(today())}`,190,69,{align:'right'});doc.setTextColor(...ink);doc.setFont('times','italic');doc.setFontSize(28);doc.text(isExpense?'Ausgaben':'Einnahmen',20,103);
  let y=142;doc.setFillColor(...rose);doc.roundedRect(15,y,180,10,2,2,'F');doc.setTextColor(...ink);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Datum',20,y+6.5);doc.text(isExpense?'Beschreibung':'Rechnung / Kunde',48,y+6.5);doc.text('Betrag',190,y+6.5,{align:'right'});y+=12;doc.setFont('helvetica','normal');
  for(const x of rows){const description=isExpense?String(x.description||''):`${x.number}  ${x.customerSnapshot?.name||''}`,parts=doc.splitTextToSize(description,115),height=Math.max(9,parts.length*4.5+3);if(y+height>255){doc.addPage();decorate();y=24}doc.text(date(isExpense?x.date:incomeDate(x)),20,y+4);doc.text(parts,48,y+4);doc.text(money(isExpense?x.amount:x.total),190,y+4,{align:'right'});doc.setDrawColor(222,217,214);doc.line(15,y+height,195,y+height);y+=height}
  y+=7;doc.setDrawColor(...roseStrong);doc.line(112,y,195,y);y+=9;doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('Monatstotal',116,y);doc.setFontSize(16);doc.text(money(total),190,y,{align:'right'});doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...muted);[...businessIdentityLines(s),...businessAddressLines(s)].filter(Boolean).forEach((line,index)=>doc.text(line,20,270+index*4.5));
  const file=`${isExpense?'Ausgaben':'Einnahmen'}-${month}.pdf`;await deliverPdf(doc,file)
}

function renderSettings(){setTitle('Einstellungen');const s=state.settings;$('#content').innerHTML=`<form id="settings-form" class="card settings-block"><h2>Rechnungsinformationen</h2><div class="form-grid">${fields(s,[['name','Name / Firma'],['iban','IBAN'],['address','Adresse','text',true]])}<label>Zahlungsfrist in Tagen<input name="paymentDays" type="number" min="0" value="${s.paymentDays}"></label><label>Logo<input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp"></label>${s.logo?`<img class="logo-preview" src="${s.logo}" alt="Aktuelles Logo">`:''}<label class="span-2">Standardtext Auftrag<textarea name="orderText">${esc(s.orderText)}</textarea></label><label class="span-2">Standardtext Rechnung<textarea name="invoiceText">${esc(s.invoiceText)}</textarea></label></div><div class="form-actions"><button class="primary">Einstellungen speichern</button></div></form><div class="card settings-block"><h2>Datensicherung</h2><p class="hint">Die Daten werden in Supabase gespeichert. Dieser Browser hält zusätzlich eine lokale Sicherung für den Offline- und Notfallbetrieb.</p><div class="backup-actions"><button class="primary" onclick="exportData()">Alle Daten exportieren</button><button class="secondary" onclick="document.querySelector('#import-file').click()">Daten ersetzen / importieren</button></div><p class="small muted">Letzter Export: ${state.lastExport?new Date(state.lastExport).toLocaleString('de-CH'):'Noch nie'}</p></div><div class="card settings-block danger-zone"><h2>Lokale Sicherung</h2><p>Damit wird nur die lokale Browser-Sicherung gelöscht. Die Daten in Supabase bleiben erhalten und werden nach dem Neuladen erneut abgerufen.</p><button class="danger" onclick="resetEverything()">Lokale Sicherung zurücksetzen</button></div>`;$('#settings-form').onsubmit=async e=>{e.preventDefault();Object.assign(s,Object.fromEntries(new FormData(e.target)),{paymentDays:Number(new FormData(e.target).get('paymentDays'))});await save();notice('Einstellungen gespeichert.')};$('#logo-file').onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>1_500_000){alert('Das Logo darf maximal 1,5 MB gross sein.');return}const r=new FileReader();r.onload=async()=>{s.logo=r.result;await save();renderSettings();notice('Logo gespeichert.')};r.readAsDataURL(f)}}

async function toggleArchive(kind,id){let x=state[kind].find(x=>x.id===id);if(!x)return;if(kind==='customers'){try{if(!(await acquireEditLock('customer',id))){alert(editLockConflictMessage('Dieser Kunde'));return}state=await loadFromSupabase();x=state.customers.find(customer=>customer.id===id);const expected=x.updatedAt,saved=await saveCustomerRecord({...x,archived:!x.archived},expected,true);Object.assign(x,saved);notice(x.archived?'Archiviert.':'Wieder aktiviert.')}catch(error){alert(`Kundenstatus konnte nicht gespeichert werden: ${error.message}`)}finally{await releaseCurrentEditLock()}render(currentView);return}if(!x.archived&&((kind==='orders'&&x.status!=='Abgeschlossen')||(kind==='invoices'&&x.status==='Offen'))){alert('Nur abgeschlossene Aufträge beziehungsweise bezahlte oder stornierte Rechnungen können archiviert werden.');return}x.archived=!x.archived;await save();render(currentView);notice(x.archived?'Archiviert.':'Wieder aktiviert.')}
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
  $('#content').innerHTML=`<form id="settings-form"><div class="card settings-block"><h2>Rechnungsinformationen</h2><div class="form-grid">${fields(s,[['firstName','Name'],['companyName','Firma'],['street','Strasse'],['postalCity','PLZ / Ort'],['mwstNumber','MWST-Nummer (für später)']])}<label>Zahlungsfrist in Tagen<input name="paymentDays" type="number" min="0" value="${s.paymentDays}"></label><label>Logo<input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp"></label>${s.logo?`<img class="logo-preview" src="${s.logo}" alt="Aktuelles Logo">`:''}<label class="span-2">Standardtext Auftrag<textarea name="orderText">${esc(s.orderText)}</textarea></label><label class="span-2">Standardtext Rechnung<textarea name="invoiceText">${esc(s.invoiceText)}</textarea></label></div></div><div class="card settings-block"><h2>Bankinformationen</h2><div class="form-grid">${fields(s,[['bankName','Name der Bank'],['iban','IBAN'],['bankAddress','Adresse der Bank','text',true]])}</div><div class="form-actions"><button class="primary">Einstellungen speichern</button></div></div></form><div class="card settings-block"><h2>Datensicherung</h2><p class="hint">Alle Geschäftsdaten werden zentral in Supabase gespeichert. Der Export enthält den vollständigen Datenbestand.</p><div class="backup-actions"><button class="primary" onclick="exportData()">Alle Daten exportieren</button><button class="secondary" onclick="document.querySelector('#import-file').click()">Daten vollständig ersetzen / importieren</button><button class="secondary" onclick="reloadCloudData()">Aus Supabase neu laden</button></div><p class="small muted">Datenrevision: ${state.revision}</p></div>`;
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
  if(activeEditLock?.type===type&&activeEditLock?.id===id&&!activeEditLock.lost)return true;
  await releaseCurrentEditLock();
  lastEditLockConflict=null;
  const {data,error}=await supabaseClient.rpc('acquire_edit_lock_v4',{p_entity_type:type,p_entity_id:id,p_session_token:EDIT_SESSION_TOKEN,p_device_label:deviceLabel()});
  if(error)throw error;if(!data?.acquired){lastEditLockConflict=data||null;return false}
  activeEditLock={type,id,heartbeatFailures:0,lost:false};
  lockHeartbeat=setInterval(renewCurrentEditLock,30000);
  return true;
}

async function renewCurrentEditLock(){
  const lock=activeEditLock;if(!lock||lock.lost)return;
  try{
    const {data,error}=await supabaseClient.rpc('acquire_edit_lock_v4',{p_entity_type:lock.type,p_entity_id:lock.id,p_session_token:EDIT_SESSION_TOKEN,p_device_label:deviceLabel()});
    if(error||!data?.acquired)throw error||new Error('Sperre wurde von Supabase nicht bestätigt.');
    lock.heartbeatFailures=0;
  }catch(error){
    lock.heartbeatFailures=(lock.heartbeatFailures||0)+1;
    console.error('Bearbeitungssperre konnte nicht erneuert werden:',error);
    if(lock.heartbeatFailures>=2)markEditLockLost();
  }
}

function editLockConflictMessage(subject){
  const info=lastEditLockConflict,device=info?.deviceLabel||'einem anderen Gerät',owner=info?.ownerLabel&&info.ownerLabel!=='Benutzer'?`${info.ownerLabel} auf `:'';
  return `${subject} wird gerade von ${owner}${device} bearbeitet. Bitte versuche es später erneut.`
}

function markEditLockLost(){
  const lock=activeEditLock;if(!lock||lock.lost)return;lock.lost=true;
  if(lockHeartbeat){clearInterval(lockHeartbeat);lockHeartbeat=null}
  const form=$('#modal form')||$('#settings-form');
  form?.querySelectorAll('input,select,textarea,button').forEach(control=>control.disabled=true);
  const closeButton=$('#modal .modal-shell>header button');if(closeButton)closeButton.disabled=false;
  alert('Die Bearbeitungssperre konnte nicht bestätigt werden. Das Formular wurde schreibgeschützt. Bitte schliessen und neu öffnen.');
}

async function assertCurrentEditLock(){
  const lock=activeEditLock;if(!lock)return;
  if(lock.lost)throw new Error('Die Bearbeitungssperre ist nicht mehr gültig. Bitte das Formular neu öffnen.');
  const {data,error}=await supabaseClient.rpc('owns_edit_lock_v3',{p_entity_type:lock.type,p_entity_id:lock.id,p_session_token:EDIT_SESSION_TOKEN});
  if(error||!data){markEditLockLost();throw error||new Error('Die Bearbeitungssperre ist abgelaufen. Bitte das Formular neu öffnen.')}
}

async function releaseCurrentEditLock(){
  if(lockHeartbeat){clearInterval(lockHeartbeat);lockHeartbeat=null}
  const lock=activeEditLock;if(!lock)return;activeEditLock=null;
  let lastError;
  for(let attempt=0;attempt<3;attempt++){
    try{const {error}=await supabaseClient.rpc('release_edit_lock_v3',{p_entity_type:lock.type,p_entity_id:lock.id,p_session_token:EDIT_SESSION_TOKEN});if(error)throw error;return}
    catch(error){lastError=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)))}
  }
  console.error('Bearbeitungssperre konnte nicht freigegeben werden und läuft automatisch ab:',lastError);
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
      if(!(await acquireEditLock('customer',id))){alert(editLockConflictMessage('Dieser Kunde'));return}
      const latest=await loadFromSupabase();
      state=latest;
      state.settings.logo||=DEFAULT_LOGO;
    }catch(error){
      console.error('Bearbeitungssperre nicht verfügbar:',error);
      await releaseCurrentEditLock();alert(`Bearbeitung nicht möglich: Die Sperre konnte nicht bestätigt werden (${error?.message||'Unbekannter Fehler'}). Bitte versuche es erneut.`);return;
    }
  }else{
    try{state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO}catch(error){alert(`Aktuelle Kundendaten konnten nicht geladen werden: ${error.message}`);return}
  }
  originalCustomerForm(id);
  const salutationInput=$('#customer-form input[name="salutation"]');
  if(salutationInput)salutationInput.outerHTML=salutationSelect(salutationInput.value);
  const form=$('#customer-form'),existing=id?state.customers.find(customer=>customer.id===id):null,expectedUpdatedAt=existing?.updatedAt||null;
  form.onsubmit=async event=>{
    event.preventDefault();const submit=form.querySelector('button.primary'),values=Object.fromEntries(new FormData(form)),deliveries=[...form.querySelectorAll('#delivery-list .line-item')].map(row=>({id:uid(),label:row.querySelector('[data-d="label"]')?.value.trim()||'',street:row.querySelector('[data-d="street"]')?.value.trim()||'',city:row.querySelector('[data-d="city"]')?.value.trim()||''})),candidate={...(existing||{}),...values,id:existing?.id||uid(),number:existing?.number||'',deliveries,archived:existing?.archived||false,createdAt:existing?.createdAt||new Date().toISOString()};
    submit.disabled=true;submit.textContent='Wird gespeichert …';
    try{const saved=await saveCustomerRecord(candidate,expectedUpdatedAt,Boolean(existing));if(existing)Object.assign(existing,saved);else state.customers.push(saved);await closeModal();renderCloudCustomers();notice('Kunde gespeichert.')}catch(error){alert(`Kunde konnte nicht gespeichert werden: ${error.message}`)}finally{submit.disabled=false;submit.textContent='Speichern'}
  };
};
const originalOrderForm=orderForm;
orderForm=async function(id){
  if(id){
    try{
      if(!(await acquireEditLock('order',id))){alert(editLockConflictMessage('Dieser Auftrag'));return}
      state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;
    }catch(error){
      console.error('Bearbeitungssperre nicht verfügbar:',error);
      await releaseCurrentEditLock();alert(`Bearbeitung nicht möglich: Die Sperre konnte nicht bestätigt werden (${error?.message||'Unbekannter Fehler'}). Bitte versuche es erneut.`);return;
    }
  }else{
    try{state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO}catch(error){alert(`Aktuelle Auftragsdaten konnten nicht geladen werden: ${error.message}`);return}
  }
  originalOrderForm(id);
  const form=$('#order-form');
  if(form){
    const originalSubmit=form.onsubmit,existing=id?state.orders.find(x=>x.id===id):null,expectedUpdatedAt=existing?.updatedAt||null;
    form.onsubmit=async event=>{
      const cloudSave=save,cloudClose=closeModal,submit=form.querySelector('button.primary');save=async()=>{};closeModal=async()=>{};submit.disabled=true;submit.textContent='Wird gespeichert …';
      try{await originalSubmit(event);const order=id?state.orders.find(x=>x.id===id):state.orders[state.orders.length-1];if(typeof order.number!=='string')order.number='';await saveOrderRecord(order,expectedUpdatedAt,Boolean(existing));await cloudClose();renderSortableOrders();const invoice=state.invoices.find(x=>x.orderId===order.id);notice(invoice?.receipt?'Auftrag, Rechnung und Quittung aktualisiert.':invoice?'Auftrag und verknüpfte Rechnung aktualisiert.':'Auftrag gespeichert.')}catch(error){alert(`Auftrag konnte nicht gespeichert werden: ${error.message}`)}finally{save=cloudSave;closeModal=cloudClose;submit.disabled=false;submit.textContent='Speichern'}
    };
  }
  if(form){
    const customerField=form.customerId.closest('label');
    customerField?.insertAdjacentHTML('beforeend','<button type="button" id="new-customer-inline" class="text-button">Neuen Kunden erfassen</button>');
    customerField?.insertAdjacentHTML('afterend',`<div id="new-customer-panel" class="span-2 inline-create-panel hidden"><div class="inline-create-head"><strong>Neuen Kunden erfassen</strong><button type="button" class="text-button" id="cancel-new-customer">Schliessen</button></div><div class="form-grid compact-grid"><label>Firma<input id="inline-company"></label><label>Anrede<input id="inline-salutation"></label><label>Vorname<input id="inline-first-name"></label><label>Nachname<input id="inline-last-name"></label><label>E-Mail<input id="inline-email" type="email"></label><label>Telefon<input id="inline-phone" type="tel"></label><label>Strasse / Rechnungsadresse<input id="inline-street"></label><label>PLZ<input id="inline-zip"></label><label>Ort<input id="inline-city"></label></div><div id="inline-customer-error" class="error small"></div><div class="actions inline-create-actions"><button type="button" class="primary" id="save-new-customer">Kunden speichern und auswählen</button></div></div>`);
    $('#inline-salutation').outerHTML=salutationSelect('','inline-salutation');
    const customerPanel=$('#new-customer-panel'),toggleCustomerPanel=show=>customerPanel.classList.toggle('hidden',!show);
    $('#new-customer-inline').onclick=()=>toggleCustomerPanel(true);$('#cancel-new-customer').onclick=()=>toggleCustomerPanel(false);
    $('#save-new-customer').onclick=async()=>{const button=$('#save-new-customer'),error=$('#inline-customer-error'),values={company:$('#inline-company').value.trim(),salutation:$('#inline-salutation').value.trim(),firstName:$('#inline-first-name').value.trim(),lastName:$('#inline-last-name').value.trim(),email:$('#inline-email').value.trim(),phone:$('#inline-phone').value.trim(),street:$('#inline-street').value.trim(),zip:$('#inline-zip').value.trim(),city:$('#inline-city').value.trim()};if(!values.company&&!values.firstName&&!values.lastName){error.textContent='Bitte Firma oder Vor- und Nachname eingeben.';return}if(!values.street){error.textContent='Bitte die Rechnungsadresse eingeben.';return}const highest=state.customers.reduce((max,customer)=>Math.max(max,Number(String(customer.number||'').match(/\d+/)?.[0]||0)),0),customer={...values,id:uid(),number:`KD-${String(highest+1).padStart(4,'0')}`,notes:'',deliveries:[],archived:false,createdAt:new Date().toISOString()};button.disabled=true;button.textContent='Kunde wird gespeichert …';error.textContent='';try{state.customers.push(customer);await save();form.customerId.innerHTML=customerOptions(customer.id);form.customerId.value=customer.id;form.customerId.dispatchEvent(new Event('change'));toggleCustomerPanel(false);notice(`Kunde ${customerName(customer)} wurde gespeichert und ausgewählt.`)}catch(saveError){state.customers=state.customers.filter(x=>x.id!==customer.id);error.textContent=saveError.message||'Der Kunde konnte nicht gespeichert werden.'}finally{button.disabled=false;button.textContent='Kunden speichern und auswählen'}};
    $('#save-new-customer').onclick=async()=>{
      const button=$('#save-new-customer'),error=$('#inline-customer-error'),customer={id:uid(),number:'',company:$('#inline-company').value.trim(),salutation:$('#inline-salutation').value.trim(),firstName:$('#inline-first-name').value.trim(),lastName:$('#inline-last-name').value.trim(),email:$('#inline-email').value.trim(),phone:$('#inline-phone').value.trim(),street:$('#inline-street').value.trim(),zip:$('#inline-zip').value.trim(),city:$('#inline-city').value.trim(),notes:'',deliveries:[],archived:false,createdAt:new Date().toISOString()};
      if(!customer.company&&!customer.firstName&&!customer.lastName){error.textContent='Bitte Firma oder Vor- und Nachname eingeben.';return}if(!customer.street){error.textContent='Bitte die Rechnungsadresse eingeben.';return}
      button.disabled=true;button.textContent='Kunde wird gespeichert …';error.textContent='';
      try{const saved=await saveCustomerRecord(customer);state.customers.push(saved);form.customerId.innerHTML=customerOptions(saved.id);form.customerId.value=saved.id;form.customerId.dispatchEvent(new Event('change'));toggleCustomerPanel(false);notice(`Kunde ${customerName(saved)} wurde gespeichert und ausgewählt.`)}catch(saveError){error.textContent=saveError.message||'Der Kunde konnte nicht gespeichert werden.'}finally{button.disabled=false;button.textContent='Kunden speichern und auswählen'}
    };
    const deliveryField=$('#delivery-field');
    deliveryField?.insertAdjacentHTML('beforeend','<button type="button" id="new-delivery-inline" class="text-button">Neue Lieferadresse ergänzen</button>');
    deliveryField?.insertAdjacentHTML('afterend','<div id="delivery-route" class="span-2 route-panel"><div class="actions"><button type="button" class="secondary" id="calculate-route">Entfernung berechnen</button></div><div id="route-result" class="route-result muted">Die Adressen werden erst nach einem Klick an OpenStreetMap und OSRM übermittelt.</div><small><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap-Mitwirkende</a></small></div>');
    const routePanel=$('#delivery-route'),routeResult=$('#route-result'),updateRoutePanel=()=>{const visible=form.fulfilment.value==='Lieferung';routePanel.classList.toggle('hidden',!visible);if(visible)routeResult.textContent='Die Adressen werden erst nach einem Klick an OpenStreetMap und OSRM übermittelt.'};
    form.fulfilment.addEventListener('change',updateRoutePanel);form.customerId.addEventListener('change',updateRoutePanel);form.deliveryIndex.addEventListener('change',()=>{routeResult.textContent='Lieferadresse geändert. Entfernung bitte neu berechnen.'});updateRoutePanel();
    $('#calculate-route').onclick=async()=>{const button=$('#calculate-route'),customer=state.customers.find(x=>x.id===form.customerId.value),target=(customer?.deliveries||[])[Number(form.deliveryIndex.value)],companyAddress=businessAddress(state.settings),startAddress=[companyAddress,'Schweiz'].filter(Boolean).join(', '),targetAddress=target?[target.street,target.city,'Schweiz'].filter(Boolean).join(', '):'';if(!companyAddress){routeResult.textContent='Bitte zuerst die Startadresse in den Einstellungen ergänzen.';return}if(!targetAddress){routeResult.textContent='Bitte eine vollständige Lieferadresse auswählen.';return}button.disabled=true;button.textContent='Route wird berechnet …';routeResult.textContent='Adressen werden gesucht und die Fahrstrecke wird berechnet.';try{const route=await calculateDeliveryRoute(startAddress,targetAddress),hours=Math.floor(route.durationMin/60),minutes=route.durationMin%60,duration=hours?`${hours} Std. ${minutes} Min.`:`${minutes} Min.`,mapUrl=`https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${route.start.lat}%2C${route.start.lon}%3B${route.target.lat}%2C${route.target.lon}`;routeResult.innerHTML=`<strong>${route.distanceKm.toFixed(1)} km</strong> · ca. <strong>${duration}</strong><br><a href="${mapUrl}" target="_blank" rel="noopener">Route auf OpenStreetMap öffnen</a>`}catch(error){routeResult.textContent=error.message||'Die Route konnte nicht berechnet werden.'}finally{button.disabled=false;button.textContent='Entfernung berechnen'}};
    $('#new-delivery-inline').onclick=async()=>{
      const customer=state.customers.find(x=>x.id===form.customerId.value);if(!customer)return;
      const label=prompt('Bezeichnung der Lieferadresse (z. B. Geschäft):');if(label===null)return;
      const street=prompt('Strasse und Hausnummer:');if(street===null)return;
      const city=prompt('PLZ und Ort:');if(city===null)return;
      const previous=structuredClone(customer),candidate={...customer,deliveries:[...(customer.deliveries||[]),{id:uid(),label:label.trim(),street:street.trim(),city:city.trim()}]};
      try{const saved=await saveCustomerRecord(candidate,customer.updatedAt||null);Object.assign(customer,saved);form.fulfilment.value='Lieferung';form.fulfilment.dispatchEvent(new Event('change'));form.deliveryIndex.value=String(customer.deliveries.length-1);notice('Lieferadresse gespeichert und ausgewählt.')}catch(error){Object.assign(customer,previous);alert(`Lieferadresse konnte nicht gespeichert werden: ${error.message}`)}
    };
  }
};
const originalInvoiceForm=invoiceForm;
invoiceForm=async function(id){
  if(id){
    try{
      if(!(await acquireEditLock('invoice',id))){alert(editLockConflictMessage('Diese Rechnung'));return}
      state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;
    }catch(error){
      console.error('Bearbeitungssperre nicht verfügbar:',error);
      await releaseCurrentEditLock();alert(`Bearbeitung nicht möglich: Die Sperre konnte nicht bestätigt werden (${error?.message||'Unbekannter Fehler'}). Bitte versuche es erneut.`);return;
    }
  }
  originalInvoiceForm(id);
  const form=$('#invoice-form'),invoice=state.invoices.find(x=>x.id===id),expectedUpdatedAt=invoice?.updatedAt||null;
  if(form){const originalSubmit=form.onsubmit;form.onsubmit=async event=>{const cloudSave=save,cloudClose=closeModal,submit=form.querySelector('button.primary');save=async()=>{};closeModal=async()=>{};submit.disabled=true;submit.textContent='Wird gespeichert …';try{await originalSubmit(event);await saveInvoiceRecord(invoice,expectedUpdatedAt,true);await cloudClose();renderSortableInvoices();notice(invoice.receipt?'Rechnung und Quittung aktualisiert.':'Rechnung gespeichert.')}catch(error){alert(`Rechnung konnte nicht gespeichert werden: ${error.message}`)}finally{save=cloudSave;closeModal=cloudClose;submit.disabled=false;submit.textContent='Speichern'}}}
};
const originalExpenseForm=expenseForm;
expenseForm=async function(id){
  if(id){
    try{
      if(!(await acquireEditLock('expense',id))){alert(editLockConflictMessage('Diese Ausgabe'));return}
      state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;
    }catch(error){console.error('Bearbeitungssperre nicht verfügbar:',error);await releaseCurrentEditLock();alert(`Bearbeitung nicht möglich: Die Sperre konnte nicht bestätigt werden (${error?.message||'Unbekannter Fehler'}). Bitte versuche es erneut.`);return}
  }else{
    try{state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO}catch(error){alert(`Aktuelle Ausgabendaten konnten nicht geladen werden: ${error.message}`);return}
  }
  originalExpenseForm(id);
  const form=$('#expense-form'),expense=id?state.expenses.find(x=>x.id===id):null,expectedUpdatedAt=expense?.updatedAt||null;
  if(form){const originalSubmit=form.onsubmit;form.onsubmit=async event=>{const cloudSave=save,cloudClose=closeModal,submit=form.querySelector('button.primary');save=async()=>{};closeModal=async()=>{};submit.disabled=true;submit.textContent='Wird gespeichert …';try{await originalSubmit(event);const record=id?state.expenses.find(x=>x.id===id):state.expenses[state.expenses.length-1];await saveExpenseRecord(record,expectedUpdatedAt,Boolean(expense));await cloudClose();financeMonth=monthKey(record.date);renderExpenses();notice('Ausgabe gespeichert.')}catch(error){alert(`Ausgabe konnte nicht gespeichert werden: ${error.message}`)}finally{save=cloudSave;closeModal=cloudClose;submit.disabled=false;submit.textContent='Speichern'}}}
};
const SETTINGS_LOCK_ID='00000000-0000-0000-0000-000000000001';
const originalRenderCloudSettings=renderCloudSettings;
renderCloudSettings=async function(){
  try{
    if(!(await acquireEditLock('settings',SETTINGS_LOCK_ID))){setTitle('Einstellungen');$('#content').innerHTML=`<div class="card empty">${esc(editLockConflictMessage('Die Einstellungen'))}</div>`;return}
    state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;originalRenderCloudSettings();
    $('#content').insertAdjacentHTML('beforeend','<div class="card settings-block"><h2>Nachvollziehbarkeit</h2><p class="hint">Alle Änderungen werden mit Zeitpunkt, Benutzer sowie altem und neuem Wert unveränderbar protokolliert.</p><button type="button" class="secondary" onclick="openAuditLog()">Änderungsprotokoll anzeigen</button></div>');
    const form=$('#settings-form');if(form)form.onsubmit=async event=>{event.preventDefault();const submit=form.querySelector('button.primary'),data=Object.fromEntries(new FormData(form));Object.assign(state.settings,data,{paymentDays:Number(data.paymentDays)});submit.disabled=true;submit.textContent='Wird gespeichert …';try{await saveSettingsRecord(state.settings);notice('Einstellungen gespeichert.')}catch(error){alert(`Einstellungen konnten nicht gespeichert werden: ${error.message}`)}finally{submit.disabled=false;submit.textContent='Einstellungen speichern'}};
    const logoInput=$('#logo-file');if(logoInput)logoInput.onchange=event=>{const file=event.target.files[0];if(!file)return;if(file.size>1_500_000){alert('Das Logo darf maximal 1,5 MB gross sein.');return}const reader=new FileReader();reader.onload=async()=>{try{state.settings.logo=reader.result;await saveSettingsRecord(state.settings);renderCloudSettings();notice('Logo gespeichert.')}catch(error){alert(`Logo konnte nicht gespeichert werden: ${error.message}`)}};reader.readAsDataURL(file)};
  }catch(error){console.error('Einstellungssperre nicht verfügbar:',error);await releaseCurrentEditLock();setTitle('Einstellungen');$('#content').innerHTML=`<div class="card empty">Die Einstellungen können momentan nicht sicher bearbeitet werden: ${esc(error?.message||'Unbekannter Fehler')}</div>`}
};
function syncInvoiceFromOrder(order){
  if(!order?.invoiceId)return;
  const invoice=state.invoices.find(x=>x.id===order.invoiceId);if(!invoice)return;
  Object.assign(invoice,{orderId:order.id,orderNumber:order.number,customerId:order.customerId,customerSnapshot:structuredClone(order.customerSnapshot),items:structuredClone(order.items),total:order.total,dueDate:dueDateFromFulfilment(order.fulfilmentDate),updatedAt:new Date().toISOString()});
  syncReceiptFromInvoice(invoice);
}

createInvoice=async function(orderId){
  const order=state.orders.find(x=>x.id===orderId);if(!order||order.invoiceId)return;
  const issued=today(),invoice={id:uid(),number:'',date:issued,dueDate:dueDateFromFulfilment(order.fulfilmentDate),orderId:order.id,orderNumber:order.number,customerId:order.customerId,customerSnapshot:structuredClone(order.customerSnapshot),items:structuredClone(order.items),total:order.total,status:'Offen',paidDate:'',paymentMethod:'',text:state.settings.invoiceText,archived:false,createdAt:new Date().toISOString()};
  try{await saveInvoiceRecord(invoice);render('invoices');const saved=state.invoices.find(x=>x.orderId===orderId);notice(`Rechnung ${saved?.number||''} erstellt.`)}catch(error){alert(`Rechnung konnte nicht erstellt werden: ${error.message}`)}
};

createReceipt=async function(invoiceId){
  const invoice=state.invoices.find(x=>x.id===invoiceId);if(!invoice||invoice.receipt)return;if(invoice.status!=='Bezahlt'){alert('Eine Quittung kann erst erstellt werden, wenn die Rechnung als bezahlt markiert ist.');return}
  const receiptDate=today(),candidate={...invoice,receipt:{id:uid(),number:'',date:receiptDate,invoiceId:invoice.id,invoiceNumber:invoice.number,orderNumber:invoice.orderNumber,customerId:invoice.customerId,customerSnapshot:structuredClone(invoice.customerSnapshot),items:structuredClone(invoice.items),total:invoice.total,paymentMethod:invoice.paymentMethod||'',text:'Zahlung dankend erhalten.',createdAt:new Date().toISOString()}};
  try{if(!(await acquireEditLock('invoice',invoiceId))){alert(editLockConflictMessage('Diese Rechnung'));return}state=await loadFromSupabase();const latest=state.invoices.find(x=>x.id===invoiceId);candidate.updatedAt=latest.updatedAt;await saveInvoiceRecord(candidate,latest.updatedAt,true);await releaseCurrentEditLock();render('receipts');const saved=state.invoices.find(x=>x.id===invoiceId)?.receipt;notice(`Quittung ${saved?.number||''} erstellt.`)}catch(error){await releaseCurrentEditLock();alert(`Quittung konnte nicht erstellt werden: ${error.message}`)}
};

toggleArchive=async function(kind,id){
  let record=state[kind]?.find(x=>x.id===id);if(!record)return;
  if(!record.archived&&((kind==='orders'&&record.status!=='Abgeschlossen')||(kind==='invoices'&&record.status==='Offen'))){alert('Nur abgeschlossene Aufträge beziehungsweise bezahlte oder stornierte Rechnungen können archiviert werden.');return}
  const entityType=kind==='customers'?'customer':kind==='orders'?'order':kind==='invoices'?'invoice':null;if(!entityType)return;
  try{if(!(await acquireEditLock(entityType,id))){alert(editLockConflictMessage(kind==='customers'?'Dieser Kunde':kind==='orders'?'Dieser Auftrag':'Diese Rechnung'));return}state=await loadFromSupabase();record=state[kind].find(x=>x.id===id);const candidate={...record,archived:!record.archived};if(kind==='customers')await saveCustomerRecord(candidate,record.updatedAt,true);else if(kind==='orders')await saveOrderRecord(candidate,record.updatedAt,true);else await saveInvoiceRecord(candidate,record.updatedAt,true);notice(candidate.archived?'Archiviert.':'Wieder aktiviert.')}catch(error){alert(`Archivstatus konnte nicht gespeichert werden: ${error.message}`)}finally{await releaseCurrentEditLock()}render(currentView)
};

exportData=async function(){
  const exportState={...state,lastExport:new Date().toISOString()},blob=new Blob([JSON.stringify(exportState,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`atelier-wuffli-test-backup-${today()}.json`;link.click();URL.revokeObjectURL(link.href);notice('Test-Datensicherung exportiert.')
};

async function preparePdfLogo(source){
  if(!source)return '';
  const data=source.startsWith('data:')?source:await fetch(source).then(response=>response.blob()).then(blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)}));
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const pad=Math.round(Math.min(image.width,image.height)*.12),fade=Math.max(8,Math.round(pad*.85)),canvas=document.createElement('canvas');canvas.width=image.width+pad*2;canvas.height=image.height+pad*2;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,pad,pad);const edges=[[pad,pad,fade,image.height,0,0,fade,0],[pad+image.width-fade,pad,fade,image.height,fade,0,0,0],[pad,pad,image.width,fade,0,0,0,fade],[pad,pad+image.height-fade,image.width,fade,0,fade,0,0]];for(const [x,y,w,h,x0,y0,x1,y1] of edges){const gradient=context.createLinearGradient(x+x0,y+y0,x+x1,y+y1);gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(1,'rgba(255,255,255,0)');context.fillStyle=gradient;context.fillRect(x,y,w,h)}resolve(canvas.toDataURL('image/png'))};image.onerror=reject;image.src=data});
}

async function pdfDocument(type,id){
  const invoice=state.invoices.find(x=>x.id===id),d=type==='order'?state.orders.find(x=>x.id===id):type==='receipt'?invoice?.receipt:invoice;if(!d)return;
  if(!window.jspdf?.jsPDF){alert('Die PDF-Funktion konnte nicht geladen werden. Bitte Internetverbindung prüfen und die Seite neu laden.');return}
  const {jsPDF}=window.jspdf,doc=new jsPDF({unit:'mm',format:'a4'}),s=state.settings,isInv=type==='invoice',isReceipt=type==='receipt';
  const pdfText=doc.text.bind(doc);doc.text=(text,...args)=>pdfText(text==='Liebe Kundin, lieber Kunde,'?customerGreeting(d):text,...args);
  {
    const rose=[247,243,241],roseStrong=[205,198,194],ink=[54,47,52],muted=[105,86,94];
    const decorate=()=>{doc.setFillColor(255,255,255);doc.rect(0,0,210,297,'F')};
    const addLogo=async()=>{if(!s.logo)return;try{doc.addImage(await preparePdfLogo(s.logo),'PNG',151,12,42,42,'logo','FAST')}catch(error){console.warn('Logo konnte nicht ins PDF eingefügt werden:',error)}};
    decorate();await addLogo();doc.setTextColor(...ink);
    const customer=[d.customerSnapshot?.name,d.customerSnapshot?.billing?.street,[d.customerSnapshot?.billing?.zip,d.customerSnapshot?.billing?.city].filter(Boolean).join(' ')].filter(Boolean),title=isReceipt?'Quittung':isInv?'Rechnung':'Auftrag';
    doc.setTextColor(...ink);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text(isReceipt?'Quittung für':'Rechnungsempfänger',20,36);doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(customer.map(String),20,43);
    const meta=isReceipt?[['Belegnummer:',d.number],['Datum:',date(d.date)],['Rechnung:',d.invoiceNumber||'–'],['Auftrag:',d.orderNumber||'–']]:isInv?[['Datum:',date(d.date)],['Rechnungsnummer:',d.number],['Fällig am:',date(d.dueDate)],['Kundennummer:',d.customerSnapshot?.number||'–']]:[['Datum:',date(d.date)],['Auftragsnummer:',d.number],[`${d.fulfilment||'Erfüllung'}:`,date(d.fulfilmentDate)],['Kundennummer:',d.customerSnapshot?.number||'–']];
    doc.setFontSize(9);meta.forEach(([label,value],index)=>{const y=62+index*7;doc.setTextColor(...muted);doc.text(String(label),130,y);doc.setTextColor(...ink);doc.text(String(value),190,y,{align:'right'})});
    doc.setFont('times','italic');doc.setFontSize(29);doc.text(title,20,103);doc.setFont('times','italic');doc.setFontSize(14);doc.text(isReceipt?'Zahlung dankend erhalten.':'Liebe Kundin, lieber Kunde,',20,117);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...muted);doc.text(isReceipt?'Der folgende Rechnungsbetrag wurde vollständig bezahlt.':isInv?'Vielen Dank für deine Bestellung. Wir berechnen dir folgende Leistungen und Produkte:':'Vielen Dank für deinen Auftrag. Folgende Leistungen und Produkte sind vorgesehen:',20,127);
    let y=142;doc.setFillColor(...rose);doc.roundedRect(15,y,180,10,2,2,'F');doc.setTextColor(...ink);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Beschreibung',20,y+6.5);doc.text('Menge',130,y+6.5);doc.text('Einzelpreis',151,y+6.5);doc.text('Betrag',190,y+6.5,{align:'right'});y+=12;doc.setFont('helvetica','normal');
    for(const item of d.items){const lines=doc.splitTextToSize(String(item.description||''),102),height=Math.max(9,lines.length*4.5+3);if(y+height>238){doc.addPage();decorate();y=24;doc.setFillColor(...rose);doc.rect(15,y,180,10,'F');doc.setFont('helvetica','bold');doc.text('Beschreibung',20,y+6.5);doc.text('Menge',130,y+6.5);doc.text('Einzelpreis',151,y+6.5);doc.text('Betrag',190,y+6.5,{align:'right'});doc.setFont('helvetica','normal');y+=12}doc.text(lines,20,y+4);doc.text(String(item.quantity),130,y+4);doc.text(money(item.price),151,y+4);doc.text(money(item.total),190,y+4,{align:'right'});doc.setDrawColor(222,217,214);doc.line(15,y+height,195,y+height);y+=height}
    y+=7;doc.setDrawColor(...roseStrong);doc.line(112,y,195,y);y+=9;doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('Gesamtbetrag',116,y);doc.setFontSize(16);doc.text(money(d.total),190,y,{align:'right'});y+=7;
    const companyLines=[...businessIdentityLines(s),...businessAddressLines(s)].filter(Boolean),bankLines=[s.bankName,...String(s.bankAddress||'').split(/\r?\n/).filter(Boolean),s.iban?`IBAN: ${s.iban}`:''].filter(Boolean);
    if(isReceipt){doc.setFillColor(...rose);doc.roundedRect(112,y,83,12,2,2,'F');doc.setFontSize(12);doc.text('Bezahlt',117,y+8.5);doc.text(money(d.total),190,y+8.5,{align:'right'});doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Quittungsinformationen',20,225);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...muted);[...companyLines,`Rechnung: ${d.invoiceNumber||'–'}`,`Bezahlt am ${date(d.date)}`,`Zahlungsart: ${d.paymentMethod||'–'}`].forEach((line,index)=>doc.text(line,20,233+index*4.5))}
    else if(isInv){doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Rechnungsinformationen',20,225);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...muted);[...companyLines,`Zahlbar bis ${date(d.dueDate)}`,`Referenz: ${d.number}`].forEach((line,index)=>doc.text(line,20,233+index*4.5));if(bankLines.length){doc.setTextColor(...ink);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Bankinformationen',112,225);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...muted);bankLines.forEach((line,index)=>doc.text(line,112,233+index*4.5))}}
    else{doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Auftragsinformationen',20,225);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...muted);const info=[...companyLines,`${d.fulfilment||'Erfüllung'} am ${date(d.fulfilmentDate)}`];if(d.text)info.push(...doc.splitTextToSize(String(d.text),75));info.forEach((line,index)=>doc.text(line,20,233+index*4.5))}
    doc.setTextColor(...ink);doc.setFont('times','italic');doc.setFontSize(isReceipt?24:20);doc.text('Vielen Dank!',105,270,{align:'center'});
    await deliverPdf(doc,`${d.number}.pdf`);return;
  }
  let y=18;
  if(s.logo){try{const logoData=s.logo.startsWith('data:')?s.logo:await fetch(s.logo).then(r=>r.blob()).then(blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)}));doc.addImage(logoData,undefined,15,y,34,34,'logo','FAST')}catch(error){console.warn('Logo konnte nicht ins PDF eingefügt werden:',error)}}
  doc.setFontSize(10);doc.text(String(s.name||'Atelier Wuffli'),55,y+5);doc.text(doc.splitTextToSize(String(s.address||''),65),55,y+11);
  doc.text(String(d.customerSnapshot?.name||''),135,y+5);doc.text(String(d.customerSnapshot?.billing?.street||''),135,y+11);doc.text(`${d.customerSnapshot?.billing?.zip||''} ${d.customerSnapshot?.billing?.city||''}`.trim(),135,y+17);
  y=62;doc.setFontSize(20);doc.text(`${isReceipt?'Quittung':isInv?'Rechnung':'Auftrag'} ${d.number}`,15,y);y+=9;doc.setFontSize(10);doc.text(`Datum: ${date(d.date)}`,15,y);
  if(isReceipt){doc.text(`Rechnung: ${d.invoiceNumber||'–'}`,70,y);doc.text(`Auftrag: ${d.orderNumber||'–'}`,135,y)}else if(isInv){doc.text(`Auftrag: ${d.orderNumber||'–'}`,70,y);doc.text(`Fällig: ${date(d.dueDate)}`,135,y)}else{doc.text(`${d.fulfilment}: ${date(d.fulfilmentDate)}`,90,y)}
  y+=12;doc.setFillColor(245,242,239);doc.rect(15,y,180,8,'F');doc.text('Beschreibung',17,y+5.5);doc.text('Menge',125,y+5.5);doc.text('Einzelpreis',145,y+5.5);doc.text('Betrag',181,y+5.5,{align:'right'});y+=10;
  for(const item of d.items){const lines=doc.splitTextToSize(String(item.description||''),100),height=Math.max(8,lines.length*5);if(y+height>276){doc.addPage();y=20}doc.text(lines,17,y+4);doc.text(String(item.quantity),125,y+4);doc.text(money(item.price),145,y+4);doc.text(money(item.total),193,y+4,{align:'right'});doc.setDrawColor(220);doc.line(15,y+height,195,y+height);y+=height+2}
  y+=5;doc.setFontSize(13);doc.text(`Gesamtbetrag: ${money(d.total)}`,193,y,{align:'right'});y+=12;doc.setFontSize(10);
  if(d.text){doc.text(doc.splitTextToSize(String(d.text),175),15,y);y+=15}
  if(isReceipt){doc.setFontSize(12);doc.text('Der Rechnungsbetrag wurde vollständig bezahlt.',15,y);doc.setFontSize(10);doc.text(`Rechnung: ${d.invoiceNumber}`,15,y+8)}else if(isInv){doc.text(`Zahlbar bis ${date(d.dueDate)}`,15,y);doc.text(`IBAN: ${s.iban||''}`,15,y+6);doc.text(`Referenz: ${d.number}`,15,y+12)}
  await deliverPdf(doc,`${d.number}.pdf`);
}
printDocument=async function(type,id){
  const invoice=state.invoices.find(x=>x.id===id),d=type==='order'?state.orders.find(x=>x.id===id):type==='receipt'?invoice?.receipt:invoice;if(!d)return;
  const s=state.settings,isInv=type==='invoice',isReceipt=type==='receipt',rows=d.items.map(x=>`<tr><td>${esc(x.description)}</td><td>${x.quantity}</td><td>${money(x.price)}</td><td>${money(x.total)}</td></tr>`).join('');
  const fulfil=type==='order'?`<p><strong>${esc(d.fulfilment)}</strong> am ${date(d.fulfilmentDate)}</p>`:'';
  const printLogo=s.logo?await preparePdfLogo(s.logo).catch(()=>s.logo):'',companyHtml=[...businessIdentityLines(s),...businessAddressLines(s)].filter(Boolean).map(esc).join('<br>'),bankHtml=[s.bankName,...String(s.bankAddress||'').split(/\r?\n/).filter(Boolean),s.iban?`IBAN: ${s.iban}`:''].filter(Boolean).map(esc).join('<br>'),info=isReceipt?`<strong>Quittungsinformationen</strong><br>${companyHtml}<br>Rechnung: ${esc(d.invoiceNumber)}<br>Bezahlt am ${date(d.date)}<br>Zahlungsart: ${esc(d.paymentMethod||'–')}`:isInv?`<strong>Rechnungsinformationen</strong><br>${companyHtml}<br>Zahlbar bis ${date(d.dueDate)}<br>Referenz: ${esc(d.number)}${bankHtml?`<br><br><strong>Bankinformationen</strong><br>${bankHtml}`:''}`:`<strong>Auftragsinformationen</strong><br>${companyHtml}<br>${esc(d.fulfilment)} am ${date(d.fulfilmentDate)}`;
  const overlay=document.createElement('div');overlay.id='mobile-print-view';overlay.className='mobile-print-view';overlay.innerHTML=`<div class="print-controls"><button class="secondary" id="close-print">Zurück zur App</button><button class="primary" id="start-print">Drucken / als PDF speichern</button></div><div class="print-sheet"><header><div>${printLogo?`<img src="${printLogo}">`:''}</div><div><strong>${esc(d.customerSnapshot.name)}</strong><br>${esc(d.customerSnapshot.billing.street||'')}<br>${esc([d.customerSnapshot.billing.zip,d.customerSnapshot.billing.city].filter(Boolean).join(' '))}</div></header><h1>${isReceipt?'Quittung':isInv?'Rechnung':'Auftrag'}</h1><p>Nummer: ${esc(d.number)}<br>Datum: ${date(d.date)}${isReceipt?`<br>Rechnung: ${esc(d.invoiceNumber)}<br>Auftrag: ${esc(d.orderNumber||'–')}`:''}</p>${fulfil}<table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Einzelpreis</th><th>Betrag</th></tr></thead><tbody>${rows}</tbody></table><p class="total">Gesamtbetrag: ${money(d.total)}</p><div class="footer"><p>${info}</p><p class="thanks">Vielen Dank!</p></div></div>`;
  if(!isReceipt)overlay.querySelector('h1')?.insertAdjacentHTML('afterend',`<p class="document-greeting">${esc(customerGreeting(d))}</p>`);
  document.body.appendChild(overlay);$('#close-print').onclick=()=>overlay.remove();$('#start-print').onclick=()=>window.print();
};
renderCustomers=renderCloudCustomers;
renderOrders=renderSortableOrders;
renderInvoices=renderSortableInvoices;
Object.assign(window,{customerForm,orderForm,invoiceForm,createInvoice,createReceipt,expenseForm,deleteExpense,pdfMonthlyReport,printDocument,pdfDocument,toggleArchive,exportData,closeModal,resetEverything,reloadCloudData});
init().catch(err=>{console.error(err);alert(`Supabase konnte nicht geladen werden. ${err?.message||'Bitte Internetverbindung und Datenbankeinrichtung prüfen.'}`)});
