const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DEFAULT_LOGO='assets/atelier-wuffli-logo.jpeg';
const SUPABASE_URL='https://johkbmlozygtfjsqfkdu.supabase.co';
const SUPABASE_KEY='sb_publishable_DGpxSu1ppS0fY7nbE75RSg_rI7G8UAb';
const APP_VERSION='V0.0.86.0';
const appVersionElement=document.querySelector('#app-version');if(appVersionElement)appVersionElement.textContent=APP_VERSION;
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
if(window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true)document.documentElement.classList.add('standalone-app');
let state,currentView='dashboard',realtimeChannel=null,presenceChannel=null,presenceHeartbeat=null,versionHeartbeat=null,presenceUser=null,lastUserActivity=Date.now(),lastPresenceTrack=0,remoteRevision=0,isSaving=false,customerSort='number-asc',orderSort='number-desc',invoiceSort='number-desc',receiptSort='number-desc',financeMonth=new Date().toISOString().slice(0,7),activeEditLock=null,lockHeartbeat=null,preferencesUserId=null;
let lastEditLockConflict=null;
const LIST_COLUMN_OPTIONS={customers:[['number','Kundennummer'],['name','Kunde'],['contact','Kontakt'],['address','Adresse']],orders:[['number','Auftragsnummer'],['customer','Kunde'],['dates','Art / Termine'],['status','Status'],['total','Betrag']],invoices:[['number','Rechnungsnummer'],['customer','Kunde'],['due','Fällig am'],['status','Status'],['total','Betrag']],receipts:[['number','Quittungsnummer'],['invoice','Rechnung'],['customer','Kunde'],['date','Datum'],['total','Betrag']]};
const defaultListColumns=()=>Object.fromEntries(Object.entries(LIST_COLUMN_OPTIONS).map(([view,options])=>[view,options.map(([id])=>id)]));
let listColumns=defaultListColumns();
const EDIT_SESSION_TOKEN=crypto.randomUUID();
const DEVICE_ID=localStorage.getItem('atelier-wuffli-device-id')||crypto.randomUUID();localStorage.setItem('atelier-wuffli-device-id',DEVICE_ID);
const blankState=()=>({version:2,revision:0,settings:{firstName:'',companyName:'',street:'',postalCity:'',bankName:'',bankAddress:'',iban:'',qrBuildingNumber:'',mwstNumber:'',paymentDays:30,logo:'',orderText:'',invoiceText:'',positionTemplates:[]},customers:[],orders:[],invoices:[],expenses:[],lastExport:null});
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
  settings.positionTemplates=Array.isArray(settings.positionTemplates)?settings.positionTemplates:[];
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
  const {data:schedules,error:scheduleError}=await supabaseClient.from('orders').select('id,fulfilment_dates');
  if(scheduleError)throw scheduleError;
  const scheduleMap=new Map((schedules||[]).map(row=>[row.id,Array.isArray(row.fulfilment_dates)?row.fulfilment_dates:[]]));
  for(const order of data.orders||[]){const dates=scheduleMap.get(order.id)||[];order.fulfilmentDates=[...new Set((dates.length?dates:[order.fulfilmentDate]).filter(Boolean))].sort();order.fulfilmentDate=order.fulfilmentDates[0]||order.fulfilmentDate}
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
const saveOrderRecord=(record,stamp=null,locked=false)=>{const dates=Array.isArray(record.fulfilmentDates)?record.fulfilmentDates:JSON.parse(record.fulfilmentDates||'[]');return saveRecordRpc('save_order_subscription_v1','p_order',{...record,fulfilmentDates:dates},stamp,locked)};
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
async function restoreFromTrash(entityType,id){try{await restoreDeletedRecord(entityType,id);notice('Eintrag wiederhergestellt.')}catch(error){const message=String(error?.message||'');if(message.includes('RESTORE_CUSTOMER_FIRST'))alert('Bitte zuerst den zugehörigen Kunden wiederherstellen.');else if(message.includes('RESTORE_ORDER_FIRST'))alert('Bitte zuerst den zugehörigen Auftrag wiederherstellen.');else if(message.includes('RESTORE_INVOICE_FIRST'))alert('Bitte zuerst die zugehörige Rechnung wiederherstellen.');else alert(`Wiederherstellung fehlgeschlagen: ${message}`)}}
async function renderTrash(){setTitle('Papierkorb');$('#content').innerHTML='<div class="card empty">Papierkorb wird geladen …</div>';const {data,error}=await supabaseClient.rpc('get_deleted_records_v1');if(error){$('#content').innerHTML=`<div class="card empty">Papierkorb konnte nicht geladen werden: ${esc(error.message)}</div>`;return}const labels={customer:'Kunde',order:'Auftrag',invoice:'Rechnung',receipt:'Quittung',expense:'Ausgabe'};$('#content').innerHTML=`<div class="section-head"><div><h2>Gelöschte Einträge</h2><p class="muted">Diese Daten bleiben in Supabase erhalten und werden nicht in Listen, Summen oder PDFs einberechnet.</p></div><span class="badge">${data.length} Einträge</span></div>${data.length?`<div class="table-wrap"><table><thead><tr><th>Bereich</th><th>Nummer</th><th>Bezeichnung</th><th>Gelöscht am</th><th>Grund</th><th></th></tr></thead><tbody>${data.map(item=>`<tr><td>${esc(labels[item.entityType]||item.entityType)}</td><td>${esc(item.number||'–')}</td><td>${esc(item.title||'–')}${item.amount!=null?`<br><span class="muted">${money(item.amount)}</span>`:''}</td><td>${item.deletedAt?new Date(item.deletedAt).toLocaleString('de-CH'):'–'}</td><td>${esc(item.reason||'–')}</td><td><button type="button" class="primary" onclick="restoreFromTrash('${item.entityType}','${item.id}')">Wiederherstellen</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Der Papierkorb ist leer.</div>'}`}
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
async function openSecurityStatus(){const [{data:status,error},{data:aal,error:aalError}]=await Promise.all([supabaseClient.rpc('get_security_status_v1'),supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel()]);if(error){alert(`Sicherheitsstatus konnte nicht geladen werden: ${error.message}`);return}const mfaActive=!aalError&&aal?.currentLevel==='aal2';modal('Sicherheitsstatus',`<div class="security-status"><p><span class="badge ${status.member?'ok':'danger'}">${status.member?'Freigegeben':'Nicht freigegeben'}</span> ERP-Mitglied</p><p><strong>Rolle:</strong> ${esc(status.role||'–')}</p><p><strong>Mandant:</strong> ${esc(status.tenantId||'–')}</p><p><span class="badge ok">Aktiv</span> Unveränderbares Änderungsprotokoll</p><p><span class="badge ok">Aktiv</span> Physisches Löschen gesperrt</p><p><span class="badge ${mfaActive?'ok':'warn'}">${mfaActive?'Aktiv':'Noch nicht aktiv'}</span> Mehrstufige Anmeldung (MFA)</p><p class="hint">Die Verbindung zu Supabase erfolgt verschlüsselt über HTTPS. MFA-Einrichtung und zentrale Rate-Limits werden im nächsten Sicherheitsschritt ergänzt.</p></div>`)}
async function createSystemBackup(){const {data,error}=await supabaseClient.rpc('create_backup_snapshot_v1');if(error){alert(`Snapshot fehlgeschlagen: ${error.message}`);return}notice(`Datenbank-Snapshot Revision ${data.revision} erstellt.`)}
async function testSystemBackup(){const {data,error}=await supabaseClient.rpc('test_latest_backup_v1');if(error){alert(`Wiederherstellungstest fehlgeschlagen: ${error.message}`);return}notice(data.valid?`Backup geprüft: ${data.customers} Kunden, ${data.orders} Aufträge, ${data.invoices} Rechnungen.`:'Backup ist ungültig.')}
async function openOperationsStatus(){const {data,error}=await supabaseClient.rpc('get_operations_status_v1');if(error){alert(`Betriebsstatus konnte nicht geladen werden: ${error.message}`);return}modal('Betriebsstatus',`<div class="security-status"><p><span class="badge ${data.database==='online'?'ok':'danger'}">${esc(data.database||'unbekannt')}</span> Datenbank</p><p><strong>Datenrevision:</strong> ${esc(data.revision??'–')}</p><p><strong>Letzter Snapshot:</strong> ${data.lastBackup?new Date(data.lastBackup).toLocaleString('de-CH'):'Noch keiner'}</p><p><strong>Snapshot-Prüfung:</strong> ${esc(data.lastBackupStatus||'–')}</p><p><strong>Fehler letzte 24 h:</strong> ${esc(data.errors24h??'–')}</p><p><strong>Audit-Einträge:</strong> ${esc(data.auditEntries??'–')}</p><p class="hint">Der interne Snapshot schützt vor Bedienfehlern. Für einen vollständigen Katastrophenschutz bleibt ein regelmässiger externer JSON-Export erforderlich.</p></div>`)}
function logClientError(message,context={}){supabaseClient.rpc('log_app_error_v1',{p_version:APP_VERSION,p_message:String(message||'Unbekannter Fehler'),p_context:context}).catch(()=>{})}
function searchEntries(query){
  const needle=String(query||'').trim().toLocaleLowerCase('de-CH');if(!needle)return[];const contains=value=>String(value??'').toLocaleLowerCase('de-CH').includes(needle),itemsText=record=>(record.items||[]).map(item=>`${item.description} ${item.quantity} ${item.price} ${item.total}`).join(' '),results=[];
  for(const customer of state.customers)if([customer.number,customer.company,customer.firstName,customer.lastName,customer.email,customer.phone,customer.street,customer.zip,customer.city].some(contains))results.push({view:'customers',type:'Kunde',title:`${customer.number} · ${customerName(customer)}`,meta:address(customer)});
  for(const order of state.orders)if([order.number,order.customerSnapshot?.name,order.total,itemsText(order),order.notes,order.text].some(contains))results.push({view:'orders',type:'Auftrag',title:`${order.number} · ${order.customerSnapshot?.name||''}`,meta:`${date(order.fulfilmentDate)} · ${money(order.total)}`});
  for(const invoice of state.invoices){if([invoice.number,invoice.orderNumber,invoice.customerSnapshot?.name,invoice.total,invoice.paymentMethod,itemsText(invoice)].some(contains))results.push({view:'invoices',type:'Rechnung',title:`${invoice.number} · ${invoice.customerSnapshot?.name||''}`,meta:`${invoice.status} · ${money(invoice.total)}`});const receipt=invoice.receipt;if(receipt&&[receipt.number,receipt.invoiceNumber,receipt.orderNumber,receipt.customerSnapshot?.name,receipt.total,receipt.paymentMethod,itemsText(receipt)].some(contains))results.push({view:'receipts',type:'Quittung',title:`${receipt.number} · ${receipt.customerSnapshot?.name||''}`,meta:`${date(receipt.date)} · ${money(receipt.total)}`})}
  for(const expense of state.expenses)if([expense.description,expense.amount,expense.date].some(contains))results.push({view:'expenses',type:'Ausgabe',title:expense.description,meta:`${date(expense.date)} · ${money(expense.amount)}`});return results.slice(0,100)
}
function drawSearchResults(query){const target=$('#global-search-results');if(!target)return;const results=searchEntries(query);target.innerHTML=!query.trim()?'<p class="muted">Suche nach Kunde, Belegnummer, Artikel, Betrag oder Referenz.</p>':results.length?results.map(result=>`<button type="button" class="search-result" data-result-view="${result.view}"><span><small>${esc(result.type)}</small><strong>${esc(result.title)}</strong><em>${esc(result.meta)}</em></span><b>›</b></button>`).join(''):'<div class="card empty">Keine passenden Einträge gefunden.</div>'}
function openGlobalSearch(){modal('Globale Suche','<label class="search-field">Suchbegriff<input id="global-search-input" type="search" autocomplete="off" placeholder="Name, Nummer, Artikel, Betrag …"></label><div id="global-search-results" class="search-results"></div>');const input=$('#global-search-input');drawSearchResults('');input.oninput=()=>drawSearchResults(input.value);$('#global-search-results').onclick=e=>{const view=e.target.closest('[data-result-view]')?.dataset.resultView;if(view){closeModal();render(view)}};setTimeout(()=>input.focus(),0)}
function openQuickActions(){modal('Schnell erfassen','<div class="sheet-actions"><button type="button" class="primary" data-create="customer">Neuen Kunden erfassen</button><button type="button" class="secondary" data-create="order">Neuen Auftrag erfassen</button><button type="button" class="secondary" data-create="expense">Neue Ausgabe erfassen</button></div>');$('#modal-body').onclick=e=>{const action=e.target.closest('[data-create]')?.dataset.create;if(!action)return;closeModal();if(action==='customer')customerForm();else if(action==='order')orderForm();else expenseForm()}}
function openMoreMenu(){const destinations=[['customers','Kunden'],['orders','Aufträge'],['invoices','Rechnungen'],['receipts','Quittungen'],['expenses','Ausgaben'],['income','Einnahmen'],['settings','Einstellungen'],['trash','Papierkorb']];modal('Mehr',`<div class="more-grid">${destinations.map(([view,label])=>`<button type="button" class="secondary" data-more-view="${view}">${label}</button>`).join('')}</div>`);$('#modal-body').onclick=e=>{const view=e.target.closest('[data-more-view]')?.dataset.moreView;if(view){closeModal();render(view)}}}
function notice(msg){const n=$('#notice');n.textContent=msg;n.classList.remove('hidden');setTimeout(()=>n.classList.add('hidden'),3500)}
function showWorking(text){const overlay=document.createElement('div');overlay.className='working-overlay';overlay.innerHTML=`<span></span>${esc(text)}`;document.body.appendChild(overlay);return()=>overlay.remove()}
function undoNotice(msg,onUndo){const n=$('#notice');n.innerHTML=`<span>${esc(msg)}</span> <button type="button" class="secondary" id="undo-action">Rückgängig</button>`;n.classList.remove('hidden');const button=$('#undo-action'),timer=setTimeout(()=>n.classList.add('hidden'),8000);button.onclick=async()=>{button.disabled=true;clearTimeout(timer);try{await onUndo();notice('Löschung rückgängig gemacht.')}catch(error){alert(`Wiederherstellung fehlgeschlagen: ${error.message}`)}}}
function setTitle(t){$('#page-title').textContent=t}
function modal(title,html){$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;$('#modal-body').scrollTop=0;$('#modal').showModal()}
async function closeModal(){await releaseCurrentEditLock();if($('#modal').open)$('#modal').close();if(remoteRevision>state.revision&&!isSaving)await reloadCloudData()}
function fields(obj,names){return names.map(([key,label,type='text',span=false,extra=''])=>`<label class="${span?'span-2':''}">${label}<input name="${key}" type="${type}" value="${esc(obj?.[key]||'')}" ${extra}></label>`).join('')}
const OPENPLZ_API_BASE='https://openplzapi.org';
const debounce=(callback,delay=250)=>{let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>callback(...args),delay)}};
function mountAddressAutocomplete({zip,city,street}){let selectedPostalCode=zip.value.trim(),localityController=null,streetController=null;const addResults=(after,label)=>{const results=document.createElement('div');results.className='address-suggestions hidden';results.setAttribute('role','listbox');results.setAttribute('aria-label',label);after.closest('label')?.insertAdjacentElement('afterend',results);return results},localityResults=addResults(city,'PLZ- und Ortsvorschläge'),streetResults=addResults(street,'Strassenvorschläge'),hide=element=>{element.classList.add('hidden');element.innerHTML=''},show=(element,items,render,select)=>{element.innerHTML=items.map((item,index)=>`<button type="button" role="option" data-address-choice="${index}">${render(item)}</button>`).join('');element.classList.toggle('hidden',!items.length);element.querySelectorAll('[data-address-choice]').forEach(button=>button.addEventListener('click',()=>select(items[Number(button.dataset.addressChoice)])))};const request=async(path,kind)=>{const previous=kind==='locality'?localityController:streetController;previous?.abort();const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),7000);if(kind==='locality')localityController=controller;else streetController=controller;try{const response=await fetch(`${OPENPLZ_API_BASE}${path}`,{signal:controller.signal,headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`OpenPLZ ${response.status}`);return await response.json()}catch(error){if(error.name!=='AbortError')console.warn('OpenPLZ nicht erreichbar:',error);return []}finally{clearTimeout(timeout);if(kind==='locality'&&localityController===controller)localityController=null;if(kind==='street'&&streetController===controller)streetController=null}};const queryLocalities=debounce(async(source)=>{const value=source.value.trim();selectedPostalCode='';hide(streetResults);if(value.length<2){hide(localityResults);return}const parameter=source===zip||/\d/.test(value)?'postalCode':'name',rows=await request(`/ch/Localities?${parameter}=${encodeURIComponent(value)}&pageSize=12`,'locality');show(localityResults,rows,item=>`${esc(item.postalCode)} ${esc(item.name)}`,item=>{selectedPostalCode=String(item.postalCode||'');zip.value=selectedPostalCode;city.value=item.name||'';hide(localityResults);street.focus()})},250);const queryStreets=debounce(async()=>{const value=street.value.trim();if(!selectedPostalCode||value.length<2){hide(streetResults);return}const pattern=value.startsWith('^')?value:`^${value}`,rows=await request(`/ch/Streets?name=${encodeURIComponent(pattern)}&postalCode=${encodeURIComponent(selectedPostalCode)}&pageSize=12`,'street');show(streetResults,rows,item=>`${esc(item.name)} <span>${esc(item.postalCode||selectedPostalCode)} ${esc(item.locality||'')}</span>`,item=>{street.value=item.name||'';hide(streetResults)})},250);zip.addEventListener('input',()=>queryLocalities(zip));city.addEventListener('input',()=>queryLocalities(city));street.addEventListener('input',queryStreets);[zip,city,street].forEach(field=>field.addEventListener('focusout',()=>setTimeout(()=>{hide(localityResults);hide(streetResults)},160)))}
function salutationSelect(value='',id=''){
  const normalized=String(value||'').trim().toLowerCase(),selected=normalized==='frau'||normalized==='sie'?'Frau':normalized==='herr'?'Herr':normalized==='divers'?'Divers':'';
  return `<select ${id?`id="${id}"`:'name="salutation"'}><option value="">Bitte auswählen</option>${['Herr','Frau','Divers'].map(option=>`<option value="${option}" ${selected===option?'selected':''}>${option}</option>`).join('')}</select>`
}
function customerGreeting(document){
  const snapshot=document?.customerSnapshot||{},customer=state.customers.find(entry=>entry.id===document?.customerId),salutation=String(snapshot.salutation||customer?.salutation||'').trim().toLowerCase(),firstName=String(snapshot.firstName||customer?.firstName||'').trim(),lastName=String(snapshot.lastName||customer?.lastName||'').trim(),name=firstName||lastName||String(snapshot.name||'').trim();
  if(!name)return 'Liebe Kundin, lieber Kunde,';
  if(salutation==='herr')return `Lieber ${name},`;
  if(salutation==='sie'||salutation==='frau')return `Liebe ${name},`;
  return `Guten Tag ${name},`
}
const pdfHash=async(type,record)=>{const payload={type,number:record.number,date:record.date,dueDate:record.dueDate||'',orderNumber:record.orderNumber||'',invoiceNumber:record.invoiceNumber||'',fulfilment:record.fulfilment||'',fulfilmentDate:record.fulfilmentDate||'',total:record.total,text:record.text||'',paymentMethod:record.paymentMethod||'',qrData:record.qrData||{},qrLayout:type==='invoice'?'single-page-v3':'',customer:record.customerSnapshot||{},items:record.items||[],settings:{firstName:state.settings.firstName||'',companyName:state.settings.companyName||'',street:state.settings.street||'',postalCity:state.settings.postalCity||'',bankName:state.settings.bankName||'',bankAddress:state.settings.bankAddress||'',iban:state.settings.iban||'',logo:state.settings.logo||''}},bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))));return [...bytes].map(value=>value.toString(16).padStart(2,'0')).join('')};
async function qrBillPng(invoice){
  const QRBill=window.SwissQRBill?.svg?.SwissQRBill,qrData=invoice.qrData;
  if(!QRBill)throw new Error('Das QR-Rechnungsmodul wurde nicht geladen. Bitte die Seite neu laden.');
  if(!qrData?.account||!qrData?.creditor)return null;
  const svg=new QRBill({...qrData,creditor:{...qrData.creditor,account:qrData.account},amount:Number(invoice.total),currency:'CHF'},{language:'DE'}).toString(),blob=new Blob([svg],{type:'image/svg+xml'}),url=URL.createObjectURL(blob);
  try{return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas'),scale=6;canvas.width=210*scale;canvas.height=105*scale;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL('image/png'))};image.onerror=()=>reject(new Error('QR-Zahlteil konnte nicht gerendert werden.'));image.src=url})}finally{URL.revokeObjectURL(url)}
}
async function appendQrBill(doc,invoice,onCurrentPage=false){const png=await qrBillPng(invoice);if(!png)return;if(!onCurrentPage)doc.addPage();doc.addImage(png,'PNG',0,onCurrentPage?192:0,210,105,undefined,'FAST')}
async function ensureInvoiceQrData(invoice){
  if(invoice.qrData?.account&&invoice.qrData?.creditor)return invoice;
  if(!(await acquireEditLock('invoice',invoice.id)))throw new Error(editLockConflictMessage('Diese Rechnung'));
  try{
    await saveInvoiceRecord(invoice,invoice.updatedAt,true);
    const saved=state.invoices.find(entry=>entry.id===invoice.id);
    if(!saved?.qrData?.account||!saved.qrData?.creditor)throw new Error('QR-Zahlteil konnte nicht erzeugt werden. Bitte unter Einstellungen Firma/Name, IBAN, Strasse, Hausnummer sowie PLZ/Ort speichern.');
    return saved;
  }finally{await releaseCurrentEditLock()}
}
async function findGeneratedPdf(type,id,documentHash){const {data,error}=await supabaseClient.from('file_attachments').select('id,file_name').eq('entity_type',type).eq('entity_id',id).eq('source','generated_pdf').eq('document_hash',documentHash).is('deleted_at',null).maybeSingle();if(error)throw error;return data}
async function openStoredPdf(file){const {data:{session}}=await supabaseClient.auth.getSession();if(!session)throw new Error('Sitzung abgelaufen. Bitte neu anmelden.');const response=await fetch(`${SUPABASE_URL}/functions/v1/file-storage?action=download&fileId=${encodeURIComponent(file.id)}`,{headers:{Authorization:`Bearer ${session.access_token}`,apikey:SUPABASE_KEY}});if(!response.ok)throw new Error('Gespeichertes PDF konnte nicht geöffnet werden.');await deliverPdfBlob(await response.blob(),file.file_name)}
async function storeGeneratedPdf(type,record,doc,documentHash){
  const data=new FormData();data.append('entityType',type);data.append('entityId',record.id);data.append('source','generated_pdf');data.append('documentHash',documentHash);data.append('file',new File([doc.output('blob')],`${record.number}.pdf`,{type:'application/pdf'}));
  for(let attempt=0;attempt<3;attempt++){const {data:saved,error}=await supabaseClient.functions.invoke('file-storage',{body:data});if(!error)return saved;if(!/Failed to send a request to the Edge Function/i.test(error.message)||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)))}
}
async function uploadAttachment(type,id,file){const data=new FormData();data.append('entityType',type);data.append('entityId',id);data.append('source','upload');data.append('file',file);const {error}=await supabaseClient.functions.invoke('file-storage',{body:data});if(error){const detail=await error.context?.json?.().catch(()=>null);throw new Error(detail?.detail||detail?.error||detail?.message||error.message)}}
async function deliverPdfBlob(blob,fileName){
  const file=new File([blob],fileName,{type:'application/pdf'}),mobile=window.matchMedia?.('(max-width:900px)').matches||window.matchMedia?.('(pointer: coarse)').matches||window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
  if(mobile){
    const blobUrl=URL.createObjectURL(blob),canShare=Boolean(navigator.share&&navigator.canShare?.({files:[file]})),overlay=document.createElement('div');overlay.className='pdf-preview-view';overlay.innerHTML=`<div class="pdf-preview-controls"><button type="button" class="secondary" data-pdf-close>Schliessen</button><strong>${esc(fileName)}</strong><button type="button" class="primary" data-pdf-action>${canShare?'PDF teilen':'PDF herunterladen'}</button></div><iframe title="PDF-Vorschau ${esc(fileName)}" src="${blobUrl}"></iframe>`;
    document.body.appendChild(overlay);
    const close=()=>{overlay.remove();URL.revokeObjectURL(blobUrl)};
    overlay.querySelector('[data-pdf-close]').onclick=close;
    overlay.querySelector('[data-pdf-action]').onclick=async()=>{if(!canShare){const link=document.createElement('a');link.href=blobUrl;link.download=fileName;link.click();return}try{await navigator.share({files:[file],title:fileName})}catch(error){if(error?.name!=='AbortError'){console.warn('PDF konnte nicht direkt geteilt werden:',error);const link=document.createElement('a');link.href=blobUrl;link.download=fileName;link.click()}}};
    return
  }
  const blobUrl=URL.createObjectURL(blob),opened=window.open(blobUrl,'_blank');if(!opened){const link=document.createElement('a');link.href=blobUrl;link.download=fileName;link.click()}setTimeout(()=>URL.revokeObjectURL(blobUrl),60000)
}
const deliverPdf=(doc,fileName)=>deliverPdfBlob(doc.output('blob'),fileName);
function activeCustomers(){return state.customers.filter(c=>!c.archived)}
async function nextNumber(prefix,d=today()){const {data,error}=await supabaseClient.rpc('next_document_number',{p_prefix:prefix,p_date:d});if(error)throw error;return data}
async function nextCustomerNumber(){const {data,error}=await supabaseClient.rpc('next_customer_number');if(error)throw error;return data}
const userPreferences=()=>({customerSort,orderSort,invoiceSort,receiptSort,financeMonth,appointmentView,appointmentMonth,listColumns});
function normalizeListColumns(value){const defaults=defaultListColumns(),output={};for(const [view,allowed] of Object.entries(LIST_COLUMN_OPTIONS)){const requested=Array.isArray(value?.[view])?value[view]:defaults[view],valid=[...new Set(requested.filter(id=>allowed.some(([allowedId])=>allowedId===id)))];output[view]=valid.length?valid:defaults[view]}return output}
async function loadUserPreferences(){const {data:{user}}=await supabaseClient.auth.getUser();if(!user)return;preferencesUserId=user.id;const {data,error}=await supabaseClient.from('user_preferences').select('preferences').eq('user_id',user.id).maybeSingle();if(error){console.warn('Persönliche Einstellungen konnten nicht geladen werden:',error.message);return}const value=data?.preferences||{};if(['number-asc','number-desc','name-asc','name-desc'].includes(value.customerSort))customerSort=value.customerSort;if(['number-asc','number-desc','customer-asc','customer-desc','fulfilment-asc','fulfilment-desc','date-asc','date-desc','status-asc','status-desc'].includes(value.orderSort))orderSort=value.orderSort;if(['number-asc','number-desc','issued-asc','issued-desc','customer-asc','customer-desc','due-asc','due-desc','status-asc','status-desc'].includes(value.invoiceSort))invoiceSort=value.invoiceSort;if(['number-asc','number-desc','date-asc','date-desc','customer-asc','customer-desc','invoice-asc','invoice-desc'].includes(value.receiptSort))receiptSort=value.receiptSort;if(['list','calendar'].includes(value.appointmentView))appointmentView=value.appointmentView;if(/^\d{4}-\d{2}$/.test(value.financeMonth||''))financeMonth=value.financeMonth;if(/^\d{4}-\d{2}$/.test(value.appointmentMonth||''))appointmentMonth=value.appointmentMonth;listColumns=normalizeListColumns(value.listColumns)}
async function saveUserPreferences(){if(!preferencesUserId)return;const {error}=await supabaseClient.from('user_preferences').upsert({user_id:preferencesUserId,preferences:userPreferences(),updated_at:new Date().toISOString()});if(error)console.warn('Persönliche Einstellungen konnten nicht gespeichert werden:',error.message)}
const listOptionLabel=(view,id)=>LIST_COLUMN_OPTIONS[view]?.find(([optionId])=>optionId===id)?.[1]||id;
function listTable(view,rows,renderCells,renderActions,{documentType='',recordId=row=>row.id}={}){const columns=listColumns[view]||defaultListColumns()[view],headers=columns.map(id=>`<th>${esc(listOptionLabel(view,id))}</th>`).join('');return rows.length?`<div class="table-wrap"><table><thead><tr>${headers}<th></th></tr></thead><tbody>${rows.map(row=>`<tr${documentType?` data-document-type="${documentType}" data-record-id="${esc(recordId(row))}"`:''}>${columns.map(id=>`<td data-label="${esc(listOptionLabel(view,id))}">${renderCells(row,id)}</td>`).join('')}<td data-label="Aktionen">${renderActions(row)}</td></tr>`).join('')}</tbody></table></div>`:''}
function renderListSettingsEditor(){const target=$('#list-settings-editor');if(!target)return;target.innerHTML=Object.entries(LIST_COLUMN_OPTIONS).map(([view,options])=>`<section class="list-setting-group"><h3>${({customers:'Kunden',orders:'Aufträge',invoices:'Rechnungen',receipts:'Quittungen'})[view]}</h3><p class="hint">Sichtbare Felder auswählen und mit den Pfeilen anordnen.</p><div class="list-setting-options">${(listColumns[view]||[]).map((id,index)=>`<div class="list-setting-row"><label class="inline"><input type="checkbox" checked onchange="toggleListColumn('${view}','${id}',this.checked)"> ${esc(listOptionLabel(view,id))}</label><div class="actions"><button type="button" class="secondary" ${index===0?'disabled':''} onclick="moveListColumn('${view}',${index},-1)">↑</button><button type="button" class="secondary" ${index===listColumns[view].length-1?'disabled':''} onclick="moveListColumn('${view}',${index},1)">↓</button></div></div>`).join('')}<div class="list-setting-hidden">${options.filter(([id])=>!listColumns[view].includes(id)).map(([id,label])=>`<label class="inline"><input type="checkbox" onchange="toggleListColumn('${view}','${id}',this.checked)"> ${esc(label)}</label>`).join('')}</div></div></section>`).join('')}
function toggleListColumn(view,id,visible){const columns=[...(listColumns[view]||[])];if(visible){if(!columns.includes(id))columns.push(id)}else{if(columns.length===1){notice('Mindestens ein Feld muss sichtbar bleiben.');return}listColumns[view]=columns.filter(column=>column!==id);renderListSettingsEditor();return}listColumns[view]=columns;renderListSettingsEditor()}
function moveListColumn(view,index,direction){const columns=[...(listColumns[view]||[])],target=index+direction;if(target<0||target>=columns.length)return;[columns[index],columns[target]]=[columns[target],columns[index]];listColumns[view]=columns;renderListSettingsEditor()}
function openListSettings(){modal('Meine Listenansicht',`<p class="hint">Diese Einstellung gilt nur für dich und wird auch auf deinen anderen Geräten übernommen. Beim Öffnen eines Eintrags bleiben alle Informationen sichtbar.</p><div id="list-settings-editor"></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button type="button" class="primary" onclick="saveListSettings()">Speichern</button></div>`);renderListSettingsEditor()}
async function saveListSettings(){await saveUserPreferences();closeModal();if(['customers','orders','invoices','receipts'].includes(currentView))render(currentView);notice('Listenansicht gespeichert.')}


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
  await loadUserPreferences();
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
  $('#global-search-button').onclick=openGlobalSearch;
  $('#mobile-bottom-nav').onclick=e=>{const view=e.target.closest('[data-mobile-view]')?.dataset.mobileView,action=e.target.closest('[data-mobile-action]')?.dataset.mobileAction;if(view)render(view);else if(action==='create')openQuickActions();else if(action==='search')openGlobalSearch();else if(action==='more')openMoreMenu()};
  const setMobileRowActions=(row,opening)=>{row.parentElement.querySelectorAll('.mobile-actions-expanded').forEach(other=>{if(other!==row){other.classList.remove('mobile-actions-expanded');other.setAttribute('aria-expanded','false');const otherToggle=other.querySelector('.mobile-row-toggle');if(otherToggle){otherToggle.setAttribute('aria-expanded','false');otherToggle.textContent='Antippen für Aktionen ›'}}});row.classList.toggle('mobile-actions-expanded',opening);row.setAttribute('aria-expanded',String(opening));const toggle=row.querySelector('.mobile-row-toggle');if(toggle){toggle.setAttribute('aria-expanded',String(opening));toggle.textContent=opening?'Aktionen ausblenden ⌃':'Antippen für Aktionen ›'}};
  const prepareMobileRow=row=>{const actionCell=row.lastElementChild,actions=actionCell?.querySelector('.actions');if(!actions||!actions.querySelector('button'))return;if(!row.hasAttribute('tabindex')){row.tabIndex=0;row.setAttribute('aria-expanded','false')}if(!actionCell.querySelector('.mobile-row-toggle')){const toggle=document.createElement('button');toggle.type='button';toggle.className='mobile-row-toggle';toggle.textContent='Antippen für Aktionen ›';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Aktionen für diesen Eintrag anzeigen');actionCell.prepend(toggle)}};
  const toggleMobileRowActions=e=>{const row=e.target.closest('.table-wrap tbody tr');if(!row)return;const toggle=e.target.closest('.mobile-row-toggle');if(toggle){e.preventDefault();e.stopPropagation();setMobileRowActions(row,!row.classList.contains('mobile-actions-expanded'));return}if(e.target.closest('button,a,input,select,textarea'))return;if(['orders','invoices','receipts'].includes(currentView)){openDocumentFromRow(currentView,row);return}if(!window.matchMedia('(max-width:900px)').matches||!row.lastElementChild?.querySelector('button'))return;setMobileRowActions(row,!row.classList.contains('mobile-actions-expanded'))};
  $('#content').addEventListener('click',toggleMobileRowActions);
  $('#content').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.table-wrap tbody tr')){e.preventDefault();toggleMobileRowActions(e)}});
  const prepareMobileRows=()=>$$('.table-wrap tbody tr').forEach(prepareMobileRow);new MutationObserver(prepareMobileRows).observe($('#content'),{childList:true,subtree:true});prepareMobileRows();
  $('#reload-button').onclick=async()=>{
    if($('#modal').open&&!confirm('Das Formular ist noch geöffnet. Nicht gespeicherte Eingaben verwerfen und die Seite neu laden?'))return;
    await releaseCurrentEditLock();
    location.reload();
  };
  $('#import-file').onchange=importCloudData;
  $('#modal').addEventListener('close',()=>releaseCurrentEditLock());
}


function render(view){if(activeEditLock?.type==='settings'&&view!=='settings')releaseCurrentEditLock();currentView=view;trackUserPresence(true).catch(()=>{});$('#content').dataset.view=view;$$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$$('[data-mobile-view]').forEach(b=>b.classList.toggle('active',b.dataset.mobileView===view));$('.sidebar').classList.remove('open');({dashboard:renderDashboard,appointments:renderAppointments,customers:renderCloudCustomers,orders:renderSortableOrders,invoices:renderSortableInvoices,receipts:renderReceipts,expenses:renderExpenses,income:renderIncome,settings:renderCloudSettings,trash:renderTrash}[view])()}

function openDocumentFromRow(view,row){const id=row?.dataset.recordId;if(!id)return;if(view==='orders'){if(state.orders.some(entry=>entry.id===id))startDocumentDetail('order',id,view)}else if(view==='invoices'){if(state.invoices.some(entry=>entry.id===id))startDocumentDetail('invoice',id,view)}else if(view==='receipts'){if(state.invoices.some(entry=>entry.id===id))startDocumentDetail('receipt',id,view)}}
function detailValue(label,value){return `<div class="detail-value"><span>${esc(label)}</span><strong>${esc(value||'–')}</strong></div>`}
function documentDetailItems(items=[]){return items.length?`<div class="table-wrap detail-items"><table><thead><tr><th>Beschreibung</th><th>Menge</th><th>Einzelpreis</th><th>Betrag</th></tr></thead><tbody>${items.map(item=>`<tr><td>${esc(item.description)}</td><td>${esc(item.quantity)}</td><td>${money(item.price)}</td><td>${money(item.total)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Keine Positionen vorhanden.</div>'}
let documentDetailOrigin='orders',documentDetailHistory=[],activeDocumentDetail=null;
function startDocumentDetail(type,id,origin=currentView){documentDetailOrigin=origin;documentDetailHistory=[];activeDocumentDetail=null;showDocumentDetail(type,id)}
function navigateDocumentDetail(type,id){if(activeDocumentDetail)documentDetailHistory.push(activeDocumentDetail);showDocumentDetail(type,id)}
function closeDocumentDetail(){const previous=documentDetailHistory.pop();if(previous)showDocumentDetail(previous.type,previous.id);else render(documentDetailOrigin)}
function showDocumentDetail(type,id){
  const order=type==='order'?state.orders.find(entry=>entry.id===id):null;
  const invoice=type==='order'?state.invoices.find(entry=>entry.orderId===order?.id||entry.id===order?.invoiceId):state.invoices.find(entry=>entry.id===id);
  const linkedOrder=order||state.orders.find(entry=>entry.id===invoice?.orderId),receipt=invoice?.receipt||null,document=type==='order'?linkedOrder:type==='invoice'?invoice:receipt;
  if(!document)return;activeDocumentDetail={type,id};
  const title=type==='order'?'Auftrag':type==='invoice'?'Rechnung':'Quittung',snapshot=document.customerSnapshot||invoice?.customerSnapshot||linkedOrder?.customerSnapshot||{},billing=snapshot.billing||{},delivery=linkedOrder?.customerSnapshot?.delivery,items=document.items||invoice?.items||linkedOrder?.items||[],status=type==='receipt'?'Bezahlt':document.status||'',text=document.text||'',notes=type==='order'?document.notes||'':'';
  setTitle(`${title} ${document.number}`);$('#content').dataset.view='document-detail';
  const actions=type==='order'?`<button class="primary" onclick="orderForm('${linkedOrder.id}')">Auftrag bearbeiten</button><button class="secondary" onclick="pdfDocument('order','${linkedOrder.id}')">PDF</button><button class="secondary" onclick="printDocument('order','${linkedOrder.id}')">Drucken</button>${!invoice?`<button class="secondary" onclick="createInvoice('${linkedOrder.id}')">Rechnung erstellen</button>`:''}`:type==='invoice'?`<button class="primary" onclick="invoiceForm('${invoice.id}')">Rechnung bearbeiten</button><button class="secondary" onclick="pdfDocument('invoice','${invoice.id}')">PDF</button><button class="secondary" onclick="printDocument('invoice','${invoice.id}')">Drucken</button>${invoice.status==='Bezahlt'&&!receipt?`<button class="secondary" onclick="createReceipt('${invoice.id}')">Quittung erstellen</button>`:''}`:`<button class="primary" onclick="invoiceForm('${invoice.id}')">Zugehörige Rechnung bearbeiten</button><button class="secondary" onclick="pdfDocument('receipt','${invoice.id}')">PDF</button><button class="secondary" onclick="printDocument('receipt','${invoice.id}')">Drucken</button>`;
  const relations=[linkedOrder&&type!=='order'?`<button class="secondary" onclick="navigateDocumentDetail('order','${linkedOrder.id}')">Auftrag ${esc(linkedOrder.number)}</button>`:'',invoice&&type!=='invoice'?`<button class="secondary" onclick="navigateDocumentDetail('invoice','${invoice.id}')">Rechnung ${esc(invoice.number)}</button>`:'',receipt&&type!=='receipt'?`<button class="secondary" onclick="navigateDocumentDetail('receipt','${invoice.id}')">Quittung ${esc(receipt.number)}</button>`:''].filter(Boolean).join(''),relationSection=`<section class="card detail-card"><h2>Zugehörige Dokumente</h2>${relations?`<div class="actions">${relations}</div>`:`<p class="muted">Zu diesem ${title.toLowerCase()} sind noch keine weiteren Dokumente vorhanden.</p>`}</section>`;
  $('#content').innerHTML=`<div class="detail-toolbar"><button type="button" class="secondary" onclick="closeDocumentDetail()">← ${documentDetailHistory.length?'Zum vorherigen Dokument':'Zurück'}</button><div class="actions">${actions}</div></div><section class="card detail-card"><div class="section-head"><div><p class="eyebrow">${title.toUpperCase()}</p><h2>${esc(document.number)}</h2></div><span class="badge ${status==='Bezahlt'||status==='Abgeschlossen'?'ok':isOverdue(invoice)?'danger':'warn'}">${esc(status||'–')}</span></div><div class="detail-grid">${detailValue('Kunde',snapshot.name)}${detailValue('Kundennummer',snapshot.number)}${detailValue('E-Mail',snapshot.email)}${detailValue('Telefon',snapshot.phone)}${detailValue('Rechnungsadresse',[billing.street,billing.zip,billing.city].filter(Boolean).join(', '))}${type==='order'?detailValue('Auftragsdatum',date(linkedOrder.date)):detailValue(type==='invoice'?'Rechnungsdatum':'Quittungsdatum',date(document.date))}${type==='order'?detailValue('Abhol-/Liefertermin',`${linkedOrder.fulfilment} · ${date(linkedOrder.fulfilmentDate)}`):''}${delivery?detailValue('Lieferadresse',[delivery.label,delivery.street,delivery.city].filter(Boolean).join(', ')):''}${type!=='order'?detailValue('Fällig am',date(invoice.dueDate)):''}${type!=='order'?detailValue('Bezahlt am',date(invoice.paidDate||receipt?.date)):''}${type!=='order'?detailValue('Zahlungsart',invoice.paymentMethod):''}${detailValue('Gesamtbetrag',money(document.total))}</div></section><section><div class="section-head"><h2>Positionen</h2></div>${documentDetailItems(items)}</section>${text?`<section class="card detail-card"><h2>${type==='order'?'Kundentext':'Dokumenttext'}</h2><p>${esc(text).replace(/\n/g,'<br>')}</p></section>`:''}${notes?`<section class="card detail-card"><h2>Interne Notiz</h2><p>${esc(notes).replace(/\n/g,'<br>')}</p></section>`:''}${relationSection}`;
  if(type==='order'){
    const toolbar=$('#content .detail-toolbar .actions'),relationCard=$('#content .detail-card:last-child');
    if(invoice){relationCard.insertAdjacentHTML('beforebegin',`<section class="card detail-card billing-card"><div class="section-head"><h2>Rechnung und Zahlung</h2><span class="badge ${invoice.status==='Bezahlt'?'ok':isOverdue(invoice)?'danger':'warn'}">${esc(isOverdue(invoice)?'Überfällig':invoice.status)}</span></div><div class="detail-grid">${detailValue('Rechnung',invoice.number)}${detailValue('Rechnungsdatum',date(invoice.date))}${detailValue('Fällig am',date(invoice.dueDate))}${detailValue('Bezahlt am',date(invoice.paidDate))}${detailValue('Zahlungsart',invoice.paymentMethod)}${detailValue('Quittung',receipt?.number||'Noch nicht erstellt')}</div><div class="form-actions"><button class="primary" onclick="editOrderBilling('${linkedOrder.id}')">Rechnung und Zahlung bearbeiten</button></div></section>`)}
    else{const createButton=[...toolbar.querySelectorAll('button')].find(button=>button.textContent.includes('Rechnung erstellen'));if(createButton)createButton.onclick=()=>createInvoiceFromOrderDetail(linkedOrder.id)}
  }
}
async function createInvoiceFromOrderDetail(orderId){const order=state.orders.find(entry=>entry.id===orderId);if(!order)return;const issued=today(),invoice={id:uid(),number:'',date:issued,dueDate:dueDateFromFulfilment(order.fulfilmentDate),orderId:order.id,orderNumber:order.number,customerId:order.customerId,customerSnapshot:structuredClone(order.customerSnapshot),items:structuredClone(order.items),total:order.total,status:'Offen',paidDate:'',paymentMethod:'',text:state.settings.invoiceText,archived:false,createdAt:new Date().toISOString()};try{await saveInvoiceRecord(invoice);showDocumentDetail('order',orderId);notice(`Rechnung ${state.invoices.find(entry=>entry.orderId===orderId)?.number||''} erstellt.`)}catch(error){alert(`Rechnung konnte nicht erstellt werden: ${error.message}`)}}
async function editOrderBilling(orderId){
  let invoice=state.invoices.find(entry=>entry.orderId===orderId||entry.id===state.orders.find(order=>order.id===orderId)?.invoiceId);if(!invoice){await createInvoiceFromOrderDetail(orderId);invoice=state.invoices.find(entry=>entry.orderId===orderId);if(!invoice)return}
  try{if(!(await acquireEditLock('invoice',invoice.id))){alert(editLockConflictMessage('Diese Rechnung'));return}state=await loadFromSupabase();invoice=state.invoices.find(entry=>entry.id===invoice.id);const expectedUpdatedAt=invoice.updatedAt,hasReceipt=Boolean(invoice.receipt);modal(`Rechnung und Zahlung · ${invoice.orderNumber}`,`<form id="order-billing-form"><div class="form-grid"><label>Rechnungsnummer<input value="${esc(invoice.number)}" disabled></label><label>Rechnungsdatum<input name="date" type="date" value="${invoice.date}" required></label><label>Fälligkeitsdatum<input name="dueDate" type="date" value="${invoice.dueDate}" required></label><label>Status<select name="status"><option ${invoice.status==='Offen'?'selected':''}>Offen</option><option ${invoice.status==='Bezahlt'?'selected':''}>Bezahlt</option><option ${invoice.status==='Storniert'?'selected':''}>Storniert</option></select></label><label>Bezahlt am<input name="paidDate" type="date" value="${invoice.paidDate||invoice.receipt?.date||''}"></label><label>Zahlungsart<select name="paymentMethod"><option value="" ${!invoice.paymentMethod?'selected':''}>Nicht angegeben</option><option value="Überweisung" ${invoice.paymentMethod==='Überweisung'?'selected':''}>Überweisung</option><option value="Barzahlung" ${invoice.paymentMethod==='Barzahlung'?'selected':''}>Barzahlung</option><option value="TWINT" ${invoice.paymentMethod==='TWINT'?'selected':''}>TWINT</option><option value="Karte" ${invoice.paymentMethod==='Karte'?'selected':''}>Karte</option></select></label><label class="span-2">Rechnungstext<textarea name="text">${esc(invoice.text)}</textarea></label>${hasReceipt?'<p class="span-2 hint">Die bestehende Quittung wird automatisch mit diesen Angaben aktualisiert.</p>':`<label class="span-2 inline"><input name="createReceipt" type="checkbox"> Beim Speichern einer bezahlten Rechnung direkt eine Quittung erstellen</label>`}</div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);const form=$('#order-billing-form'),updatePaymentFields=()=>{const paid=form.status.value==='Bezahlt';form.paidDate.disabled=!paid;form.paymentMethod.disabled=!paid;if(paid&&!form.paidDate.value)form.paidDate.value=today();const receiptToggle=form.elements.createReceipt;if(receiptToggle){receiptToggle.disabled=!paid;if(!paid)receiptToggle.checked=false}};form.status.onchange=updatePaymentFields;updatePaymentFields();form.onsubmit=async event=>{event.preventDefault();const submit=form.querySelector('button.primary'),values=Object.fromEntries(new FormData(form)),candidate={...invoice,date:values.date,dueDate:values.dueDate,status:values.status,paidDate:values.status==='Bezahlt'?(values.paidDate||today()):'',paymentMethod:values.status==='Bezahlt'?values.paymentMethod:'',text:values.text};if(candidate.receipt)syncReceiptFromInvoice(candidate);else if(values.status==='Bezahlt'&&values.createReceipt)candidate.receipt={id:uid(),number:'',date:candidate.paidDate||today(),invoiceId:candidate.id,invoiceNumber:candidate.number,orderNumber:candidate.orderNumber,customerId:candidate.customerId,customerSnapshot:structuredClone(candidate.customerSnapshot),items:structuredClone(candidate.items),total:candidate.total,paymentMethod:candidate.paymentMethod||'',text:'Zahlung dankend erhalten.',createdAt:new Date().toISOString()};submit.disabled=true;submit.textContent='Wird gespeichert …';try{await saveInvoiceRecord(candidate,expectedUpdatedAt,true);await closeModal();showDocumentDetail('order',orderId);notice(candidate.receipt?'Rechnung, Zahlung und Quittung gespeichert.':'Rechnung und Zahlung gespeichert.')}catch(error){alert(`Rechnung konnte nicht gespeichert werden: ${error.message}`)}finally{submit.disabled=false;submit.textContent='Speichern'}}}catch(error){await releaseCurrentEditLock();alert(`Rechnung konnte nicht geöffnet werden: ${error.message}`)}}
function openDocumentDetail(type,id,returnView=currentView){const invoice=type==='order'?null:state.invoices.find(entry=>entry.id===id),order=type==='order'?state.orders.find(entry=>entry.id===id):state.orders.find(entry=>entry.id===invoice?.orderId),receipt=type==='receipt'?invoice?.receipt:type==='invoice'?invoice?.receipt:null,document=type==='order'?order:type==='invoice'?invoice:receipt;if(!document)return;const title=type==='order'?'Auftrag':type==='invoice'?'Rechnung':'Quittung',snapshot=document.customerSnapshot||invoice?.customerSnapshot||order?.customerSnapshot||{},billing=snapshot.billing||{},delivery=order?.customerSnapshot?.delivery,items=document.items||invoice?.items||order?.items||[],status=type==='receipt'?'Bezahlt':document.status||'',text=document.text||'',notes=type==='order'?document.notes||'':'';setTitle(`${title} ${document.number}`);$('#content').dataset.view='document-detail';const actions=type==='order'?`<button class="primary" onclick="orderForm('${order.id}')">Auftrag bearbeiten</button><button class="secondary" onclick="pdfDocument('order','${order.id}')">PDF</button><button class="secondary" onclick="printDocument('order','${order.id}')">Drucken</button>${!order.invoiceId?`<button class="secondary" onclick="createInvoice('${order.id}')">Rechnung erstellen</button>`:''}`:type==='invoice'?`<button class="primary" onclick="invoiceForm('${invoice.id}')">Rechnung bearbeiten</button><button class="secondary" onclick="pdfDocument('invoice','${invoice.id}')">PDF</button><button class="secondary" onclick="printDocument('invoice','${invoice.id}')">Drucken</button>${invoice.status==='Bezahlt'&&!invoice.receipt?`<button class="secondary" onclick="createReceipt('${invoice.id}')">Quittung erstellen</button>`:''}`:`<button class="primary" onclick="invoiceForm('${invoice.id}')">Zugehörige Rechnung bearbeiten</button><button class="secondary" onclick="pdfDocument('receipt','${invoice.id}')">PDF</button><button class="secondary" onclick="printDocument('receipt','${invoice.id}')">Drucken</button>`;const relations=[order&&type!=='order'?`<button class="secondary" onclick="openDocumentDetail('order','${order.id}','${returnView}')">Auftrag ${esc(order.number)}</button>`:'',invoice&&type!=='invoice'?`<button class="secondary" onclick="openDocumentDetail('invoice','${invoice.id}','${returnView}')">Rechnung ${esc(invoice.number)}</button>`:'',receipt&&type!=='receipt'?`<button class="secondary" onclick="openDocumentDetail('receipt','${invoice.id}','${returnView}')">Quittung ${esc(receipt.number)}</button>`:''].filter(Boolean).join('');$('#content').innerHTML=`<div class="detail-toolbar"><button type="button" class="secondary" onclick="render('${returnView}')">← Zurück</button><div class="actions">${actions}</div></div><section class="card detail-card"><div class="section-head"><div><p class="eyebrow">${title.toUpperCase()}</p><h2>${esc(document.number)}</h2></div><span class="badge ${status==='Bezahlt'||status==='Abgeschlossen'?'ok':isOverdue(invoice)?'danger':'warn'}">${esc(status||'–')}</span></div><div class="detail-grid">${detailValue('Kunde',snapshot.name)}${detailValue('Kundennummer',snapshot.number)}${detailValue('E-Mail',snapshot.email)}${detailValue('Telefon',snapshot.phone)}${detailValue('Rechnungsadresse',[billing.street,billing.zip,billing.city].filter(Boolean).join(', '))}${type==='order'?detailValue('Auftragsdatum',date(order.date)):detailValue(type==='invoice'?'Rechnungsdatum':'Quittungsdatum',date(document.date))}${type==='order'?detailValue('Abhol-/Liefertermin',`${order.fulfilment} · ${date(order.fulfilmentDate)}`):''}${delivery?detailValue('Lieferadresse',[delivery.label,delivery.street,delivery.city].filter(Boolean).join(', ')):''}${type!=='order'?detailValue('Fällig am',date(invoice.dueDate)):''}${type!=='order'?detailValue('Bezahlt am',date(invoice.paidDate||receipt?.date)):''}${type!=='order'?detailValue('Zahlungsart',invoice.paymentMethod):''}${detailValue('Gesamtbetrag',money(document.total))}</div></section><section><div class="section-head"><h2>Positionen</h2></div>${documentDetailItems(items)}</section>${text?`<section class="card detail-card"><h2>${type==='order'?'Kundentext':'Dokumenttext'}</h2><p>${esc(text).replace(/\n/g,'<br>')}</p></section>`:''}${notes?`<section class="card detail-card"><h2>Interne Notiz</h2><p>${esc(notes).replace(/\n/g,'<br>')}</p></section>`:''}${relations?`<section class="card detail-card"><h2>Zugehörige Dokumente</h2><div class="actions">${relations}</div></section>`:''}`}

function renderDashboard(){setTitle('Übersicht');const open=state.invoices.filter(i=>i.status==='Offen'&&!i.archived);$('#content').innerHTML=`<div class="grid stats"><button type="button" class="card stat dashboard-link" onclick="render('customers')"><span class="muted">Aktive Kunden</span><strong>${activeCustomers().length}</strong><span class="dashboard-link-hint">Kunden öffnen →</span></button><button type="button" class="card stat dashboard-link" onclick="render('orders')"><span class="muted">Aufträge in Arbeit</span><strong>${state.orders.filter(o=>o.status==='In Arbeit'&&!o.archived).length}</strong><span class="dashboard-link-hint">Aufträge öffnen →</span></button><button type="button" class="card stat dashboard-link" onclick="render('invoices')"><span class="muted">Offene Rechnungen</span><strong>${open.length}</strong><span class="dashboard-link-hint">Rechnungen öffnen →</span></button><button type="button" class="card stat dashboard-link" onclick="render('invoices')"><span class="muted">Offener Betrag</span><strong>${money(open.reduce((s,i)=>s+i.total,0))}</strong><span class="dashboard-link-hint">Rechnungen öffnen →</span></button></div><div class="section-head"><h2>Schnellstart</h2></div><div class="actions"><button class="primary" onclick="customerForm()">Neuer Kunde</button><button class="secondary" onclick="orderForm()">Neuer Auftrag</button><button class="secondary" onclick="exportData()">Sicherung exportieren</button></div><div class="section-head"><h2>Letzte Aufträge</h2></div>${ordersTable(state.orders.filter(o=>!o.archived).slice(-5).reverse())}`}
function calendarWeek(value){const d=new Date(`${value}T12:00:00`),day=d.getDay()||7;d.setDate(d.getDate()+4-day);const year=d.getFullYear(),start=new Date(year,0,1),week=Math.ceil((((d-start)/86400000)+1)/7);return{year,week}}
const renderDocumentDetailWithTabs=showDocumentDetail;
showDocumentDetail=function(type,id){
  renderDocumentDetailWithTabs(type,id);
  const invoice=type==='order'?state.invoices.find(entry=>entry.orderId===id||entry.id===state.orders.find(order=>order.id===id)?.invoiceId):state.invoices.find(entry=>entry.id===id),order=type==='order'?state.orders.find(entry=>entry.id===id):state.orders.find(entry=>entry.id===invoice?.orderId),receipt=invoice?.receipt,toolbar=$('#content .detail-toolbar');
  if(!toolbar||!order)return;
  const tab=(name,tabType,targetId,available)=>available?`<button type="button" class="document-tab ${type===tabType?'active':''}" role="tab" aria-selected="${type===tabType}" onclick="showDocumentDetail('${tabType}','${targetId}')">${name}</button>`:`<button type="button" class="document-tab unavailable" role="tab" aria-disabled="true" disabled>${name}</button>`;
  const tabs=`<div class="document-tabs" role="tablist" aria-label="Zugehörige Dokumente">${tab('Auftrag','order',order.id,true)}${tab('Rechnung','invoice',invoice?.id,Boolean(invoice))}${tab('Quittung','receipt',invoice?.id,Boolean(receipt))}</div>`;
  const actions=type==='order'?`<button class="primary" onclick="orderForm('${order.id}')">Bearbeiten</button><button class="secondary" onclick="pdfDocument('order','${order.id}')">PDF öffnen</button><button class="secondary document-detail-print" onclick="printDocument('order','${order.id}')">Drucken</button>${!invoice?`<button class="secondary" onclick="createInvoiceFromOrderDetail('${order.id}')">Rechnung erstellen</button>`:''}`:type==='invoice'?`<button class="primary" onclick="invoiceForm('${invoice.id}')">Bearbeiten</button><button class="secondary" onclick="pdfDocument('invoice','${invoice.id}')">PDF öffnen</button><button class="secondary document-detail-print" onclick="printDocument('invoice','${invoice.id}')">Drucken</button>${invoice.status==='Bezahlt'&&!receipt?`<button class="secondary" onclick="createReceipt('${invoice.id}')">Quittung erstellen</button>`:''}`:`<button class="primary" onclick="editOrderBilling('${order.id}')">Quittung bearbeiten</button><button class="secondary" onclick="pdfDocument('receipt','${invoice.id}')">PDF öffnen</button><button class="secondary document-detail-print" onclick="printDocument('receipt','${invoice.id}')">Drucken</button>`;
  toolbar.querySelector('.actions').innerHTML=actions;
  toolbar.querySelector('.document-tabs')?.remove();
  toolbar.querySelector('button.secondary')?.insertAdjacentHTML('afterend',tabs);
  [...document.querySelectorAll('#content .detail-card')].find(card=>card.querySelector('h2')?.textContent==='Zugehörige Dokumente')?.remove();
}

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
let appointmentView='list',appointmentMonth=today().slice(0,7);
const orderDates=order=>{let values=order?.fulfilmentDates;if(typeof values==='string'){try{values=JSON.parse(values)}catch{values=[]}}if(!Array.isArray(values)||!values.length)values=[order?.fulfilmentDate];return [...new Set(values.filter(Boolean))].sort()};
const orderDatesLabel=order=>orderDates(order).map(date).join(', ');
const openAppointments=()=>state.orders.filter(o=>!o.archived&&o.status!=='Abgeschlossen').flatMap(order=>orderDates(order).map(fulfilmentDate=>({...order,fulfilmentDate}))).sort((a,b)=>a.fulfilmentDate.localeCompare(b.fulfilmentDate)||String(a.number).localeCompare(String(b.number),'de-CH'));
function appointmentRows(rows){return rows.length?`<div class="table-wrap"><table><thead><tr><th>Datum</th><th>Art</th><th>Kunde</th><th>Auftrag</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(order=>`<tr><td><strong>${date(order.fulfilmentDate)}</strong></td><td><span class="badge ${order.fulfilment==='Lieferung'?'warn':'ok'}">${esc(order.fulfilment)}</span></td><td>${esc(order.customerSnapshot?.name||'')}</td><td>${esc(order.number)}</td><td>${esc(order.status)}</td><td><button class="secondary" onclick="orderForm('${order.id}')">Öffnen</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Keine offenen Termine an diesem Tag.</div>'}
function appointmentControls(){return `<div class="appointment-controls" role="group" aria-label="Termindarstellung"><button class="${appointmentView==='list'?'primary':'secondary'}" onclick="setAppointmentView('list')">Liste</button><button class="${appointmentView==='calendar'?'primary':'secondary'}" onclick="setAppointmentView('calendar')">Kalender</button></div>`}
function setAppointmentView(view){appointmentView=view;saveUserPreferences();renderAppointments()}
function moveAppointmentMonth(offset){const [year,month]=appointmentMonth.split('-').map(Number),next=new Date(year,month-1+offset,1);appointmentMonth=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`;saveUserPreferences();renderAppointments()}
function showAppointmentDay(day){const rows=openAppointments().filter(order=>order.fulfilmentDate===day);setTitle(`Termine am ${date(day)}`);$('#content').innerHTML=`<div class="section-head appointment-day-head"><button class="secondary" onclick="renderAppointments()">← Zurück zum Kalender</button><span class="muted">${rows.length} ${rows.length===1?'Termin':'Termine'}</span></div>${appointmentRows(rows)}`}
function renderAppointmentCalendar(rows){const [year,month]=appointmentMonth.split('-').map(Number),first=new Date(year,month-1,1),days=new Date(year,month,0).getDate(),leading=(first.getDay()+6)%7,monthLabel=new Intl.DateTimeFormat('de-CH',{month:'long',year:'numeric'}).format(first),counts=new Map();rows.forEach(order=>{if(order.fulfilmentDate.startsWith(appointmentMonth))counts.set(order.fulfilmentDate,(counts.get(order.fulfilmentDate)||0)+1)});const cells=Array.from({length:leading},()=>'<div class="calendar-day calendar-day-empty" aria-hidden="true"></div>');for(let day=1;day<=days;day++){const key=`${appointmentMonth}-${String(day).padStart(2,'0')}`,count=counts.get(key)||0,isToday=key===today();cells.push(`<button type="button" class="calendar-day ${count?'has-appointments':''} ${isToday?'is-today':''}" ${count?`onclick="showAppointmentDay('${key}')"`:''} ${count?'':`disabled`} aria-label="${date(key)}${count?`, ${count} ${count===1?'Termin':'Termine'}`:', keine Termine'}"><span class="calendar-day-number">${day}</span>${count?`<span class="calendar-count">${count}</span><span class="calendar-marker" aria-hidden="true"></span>`:''}</button>`)}return `<section class="appointment-calendar card"><div class="calendar-toolbar"><button class="secondary calendar-nav" onclick="moveAppointmentMonth(-1)" aria-label="Vorheriger Monat">←</button><h2>${esc(monthLabel)}</h2><button class="secondary calendar-nav" onclick="moveAppointmentMonth(1)" aria-label="Nächster Monat">→</button></div><div class="calendar-weekdays" aria-hidden="true">${['Mo','Di','Mi','Do','Fr','Sa','So'].map(day=>`<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div><p class="calendar-legend"><span class="calendar-marker" aria-hidden="true"></span> Tage mit offenen Abhol- oder Lieferterminen</p></section>`}
function renderAppointments(){setTitle('Termine');const rows=openAppointments();if(appointmentView==='calendar'){$('#content').innerHTML=`<div class="section-head appointment-view-head"><div><h2>Terminübersicht</h2><p class="muted">Markierte Tage enthalten offene Termine.</p></div>${appointmentControls()}</div>${renderAppointmentCalendar(rows)}`;return}const groups=new Map();for(const order of rows){const {year,week}=calendarWeek(order.fulfilmentDate),key=`${year}-${week}`;if(!groups.has(key))groups.set(key,{year,week,orders:[]});groups.get(key).orders.push(order)}$('#content').innerHTML=`<div class="section-head appointment-view-head"><div><h2>Offene Termine</h2><p class="muted">Nach Kalenderwoche und Datum geordnet.</p></div>${appointmentControls()}</div>${rows.length?[...groups.values()].map(group=>`<section class="appointment-week"><div class="section-head"><h2>Kalenderwoche ${group.week} · ${group.year}</h2><span class="muted">${group.orders.length} ${group.orders.length===1?'Termin':'Termine'}</span></div>${appointmentRows(group.orders)}</section>`).join(''):'<div class="card empty">Keine offenen Abhol- oder Liefertermine vorhanden.</div>'}`}

function renderCustomers(){setTitle('Kunden');$('#content').innerHTML=`<div class="section-head"><div class="actions"><button class="primary" onclick="customerForm()">Kunde erfassen</button></div><label class="inline"><input id="show-customer-archive" type="checkbox"> Archiv anzeigen</label></div>${customersTable(state.customers.filter(c=>!c.archived))}`;$('#show-customer-archive').onchange=e=>{e.target.closest('#content').querySelector('.table-wrap')?.remove();e.target.closest('#content').insertAdjacentHTML('beforeend',customersTable(state.customers.filter(c=>e.target.checked?c.archived:!c.archived)))}}
function customersTable(rows){const cells=(c,id)=>({number:esc(c.number),name:`<strong>${esc(customerName(c))}</strong>`,contact:`${esc(c.email||'–')}<br><span class="muted">${esc(c.phone||'')}</span>`,address:esc(address(c))})[id]||'';const actions=c=>`<div class="actions"><button class="secondary" onclick="customerForm('${c.id}')">Bearbeiten</button><button class="secondary" onclick="toggleArchive('customers','${c.id}')">${c.archived?'Aktivieren':'Archivieren'}</button><button class="danger" onclick="deleteRecord('customer','${c.id}','${esc(c.number)}')">Löschen</button></div>`;return listTable('customers',rows,cells,actions)||'<div class="card empty">Keine Kunden vorhanden.</div>'}
function customerForm(id){const c=state.customers.find(x=>x.id===id)||{};modal(id?'Kunde bearbeiten':'Kunde erfassen',`<form id="customer-form"><div class="form-grid">${fields(c,[['company','Firma'],['salutation','Anrede'],['firstName','Vorname'],['lastName','Nachname'],['email','E-Mail','email'],['phone','Telefon'],['zip','PLZ'],['city','Ort'],['street','Strasse / Rechnungsadresse','text',true],['notes','Interne Notiz','text',true]])}<div class="span-2"><h3>Lieferadressen</h3><div id="delivery-list"></div><button type="button" class="secondary" id="add-delivery">Lieferadresse hinzufügen</button></div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);let deliveries=[...(c.deliveries||[])];const draw=()=>{$('#delivery-list').innerHTML=deliveries.map((d,i)=>`<div class="line-item"><input data-d="label" data-i="${i}" placeholder="Bezeichnung" value="${esc(d.label)}"><input data-d="street" data-i="${i}" placeholder="Strasse" value="${esc(d.street)}"><input data-d="city" data-i="${i}" placeholder="PLZ Ort" value="${esc(d.city)}"><button type="button" class="danger" data-remove="${i}">×</button></div>`).join('')};draw();$('#add-delivery').onclick=()=>{deliveries.push({label:'',street:'',city:''});draw()};$('#delivery-list').oninput=e=>{if(e.target.dataset.d)deliveries[+e.target.dataset.i][e.target.dataset.d]=e.target.value};$('#delivery-list').onclick=e=>{if(e.target.dataset.remove!==undefined){deliveries.splice(+e.target.dataset.remove,1);draw()}};$('#customer-form').onsubmit=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e.target));if(id)Object.assign(c,o,{deliveries,updatedAt:new Date().toISOString()});else state.customers.push({...o,id:uid(),number:`KD-${String(state.customers.length+1).padStart(4,'0')}`,deliveries,archived:false,createdAt:new Date().toISOString()});await save();closeModal();renderCustomers();notice('Kunde gespeichert.')}}

function renderOrders(){setTitle('Aufträge');const archived=state.orders.filter(o=>o.archived);$('#content').innerHTML=`<div class="section-head"><button class="primary" onclick="orderForm()">Auftrag erfassen</button><label class="inline"><input id="show-order-archive" type="checkbox"> Archiv anzeigen (${archived.length})</label></div><div id="order-table">${ordersTable(state.orders.filter(o=>!o.archived).reverse())}</div>`;$('#show-order-archive').onchange=e=>$('#order-table').innerHTML=ordersTable(state.orders.filter(o=>e.target.checked?o.archived:!o.archived).reverse())}
function ordersTable(rows){const cells=(o,id)=>({number:esc(o.number),customer:esc(o.customerSnapshot?.name),dates:`${esc(o.fulfilment)}<br><span class="muted">${esc(orderDatesLabel(o))}</span>`,status:`<span class="badge ${o.status==='Abgeschlossen'?'ok':'warn'}">${esc(o.status)}</span>`,total:money(o.total)})[id]||'';const actions=o=>`<div class="actions"><button class="secondary" onclick="orderForm('${o.id}')">Bearbeiten</button><button class="secondary" onclick="pdfDocument('order','${o.id}')">PDF</button><button class="secondary" onclick="printDocument('order','${o.id}')">Drucken</button>${!o.invoiceId?`<button class="primary" onclick="createInvoice('${o.id}')">Rechnung</button>`:''}<button class="secondary" onclick="toggleArchive('orders','${o.id}')">${o.archived?'Aktivieren':'Archivieren'}</button><button class="danger" onclick="deleteRecord('order','${o.id}','${esc(o.number)}')">Löschen</button></div>`;return listTable('orders',rows,cells,actions,{documentType:'order'})||'<div class="card empty">Keine Aufträge vorhanden.</div>'}
function customerOptions(selected){
  const customers=[...activeCustomers()],assigned=state.customers.find(c=>c.id===selected);
  if(assigned&&!customers.some(c=>c.id===assigned.id))customers.unshift(assigned);
  return customers.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(c.number)} – ${esc(customerName(c))}${c.archived?' (archiviert)':''}</option>`).join('')
}
function lineItemsEditor(items=[],withTemplates=false){const templates=(state.settings.positionTemplates||[]).filter(template=>template.active!==false);return `<div id="line-items" class="line-items"></div>${withTemplates&&templates.length?`<label>Positionsvorlage<select id="add-template"><option value="">Vorlage auswählen …</option>${templates.map(template=>`<option value="${esc(template.id)}">${esc(template.name)} · ${money(template.price)}</option>`).join('')}</select></label>`:''}<button type="button" id="add-line" class="secondary">Position hinzufügen</button><div class="summary">Gesamt: <strong id="form-total">${money(0)}</strong></div>`}
function wireLines(items,onchange,withTemplates=false){const list=items.length?items:[{description:'',quantity:1,price:0}];items.splice(0,items.length,...list);const draw=()=>{$('#line-items').innerHTML=items.map((x,i)=>`<div class="line-item"><label>Beschreibung<input data-k="description" data-i="${i}" value="${esc(x.description)}" required></label><label>Menge<input data-k="quantity" data-i="${i}" type="number" min="0" step="0.01" value="${x.quantity}" required></label><label>Preis CHF<input data-k="price" data-i="${i}" type="number" step="0.01" value="${x.price}" required></label><button type="button" class="danger" data-remove="${i}">×</button></div>`).join('');calc()};const calc=()=>{items.forEach(x=>x.total=(Number(x.quantity)||0)*(Number(x.price)||0));$('#form-total').textContent=money(items.reduce((s,x)=>s+x.total,0));onchange?.()};$('#line-items').oninput=e=>{if(e.target.dataset.k){items[+e.target.dataset.i][e.target.dataset.k]=e.target.dataset.k==='description'?e.target.value:Number(e.target.value);calc()}};$('#line-items').onclick=e=>{if(e.target.dataset.remove!==undefined){items.splice(+e.target.dataset.remove,1);if(!items.length)items.push({description:'',quantity:1,price:0});draw()}};$('#add-line').onclick=()=>{items.push({description:'',quantity:1,price:0});draw()};if(withTemplates){const select=$('#add-template');if(select)select.onchange=()=>{const template=(state.settings.positionTemplates||[]).find(item=>item.id===select.value);if(template){items.push({description:template.name,quantity:1,price:Number(template.price)||0});draw()}select.value=''}}draw()}
function orderForm(id){if(!id&&!activeCustomers().length){alert('Bitte zuerst einen Kunden erfassen.');render('customers');return}const o=state.orders.find(x=>x.id===id)||{date:today(),fulfilment:'Abholung',fulfilmentDate:today(),status:'In Arbeit',customerId:activeCustomers()[0].id,items:[]};modal(id?'Auftrag bearbeiten':'Auftrag erfassen',`<form id="order-form"><div class="form-grid"><label>Kunde<select name="customerId" required>${customerOptions(o.customerId)}</select></label><label>Auftragsdatum<input name="date" type="date" value="${o.date}" required></label><label>Erfüllungsart<select name="fulfilment"><option ${o.fulfilment==='Abholung'?'selected':''}>Abholung</option><option ${o.fulfilment==='Lieferung'?'selected':''}>Lieferung</option></select></label><label>Abhol-/Lieferdatum<input name="fulfilmentDate" type="date" value="${o.fulfilmentDate}" required></label><label>Status<select name="status"><option ${o.status==='In Arbeit'?'selected':''}>In Arbeit</option><option ${o.status==='Abgeschlossen'?'selected':''}>Abgeschlossen</option></select></label><label id="delivery-field">Lieferadresse<select name="deliveryIndex"></select></label><label class="span-2">Kundentext<textarea name="text">${esc(o.text||state.settings.orderText)}</textarea></label><label class="span-2">Interne Notiz<textarea name="notes">${esc(o.notes)}</textarea></label><div class="span-2"><h3>Positionen</h3>${lineItemsEditor(o.items,true)}</div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);const items=structuredClone(o.items||[]);wireLines(items,null,true);const form=$('#order-form'),delivery=()=>{const c=state.customers.find(x=>x.id===form.customerId.value),opts=(c?.deliveries||[]).map((d,i)=>`<option value="${i}" ${String(i)===String(o.deliveryIndex)?'selected':''}>${esc(d.label||d.street||`Adresse ${i+1}`)}</option>`).join('');form.deliveryIndex.innerHTML=opts||'<option value="">Keine Lieferadresse hinterlegt</option>';$('#delivery-field').classList.toggle('hidden',form.fulfilment.value!=='Lieferung')};form.customerId.onchange=delivery;form.fulfilment.onchange=delivery;delivery();form.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form)),c=state.customers.find(x=>x.id===data.customerId);if(data.fulfilment==='Lieferung'&&!(c.deliveries||[])[Number(data.deliveryIndex)]){alert('Für eine Lieferung muss beim Kunden eine Lieferadresse hinterlegt sein.');return}const snap={name:customerName(c),number:c.number,email:c.email,phone:c.phone,billing:{street:c.street,zip:c.zip,city:c.city},delivery:data.fulfilment==='Lieferung'?structuredClone(c.deliveries[Number(data.deliveryIndex)]):null};const total=items.reduce((s,x)=>s+x.total,0);if(id)Object.assign(o,data,{items,total,customerSnapshot:snap,updatedAt:new Date().toISOString()});else state.orders.push({...data,id:uid(),number:nextNumber('AF',data.date),items,total,customerSnapshot:snap,archived:false,createdAt:new Date().toISOString()});await save();closeModal();renderOrders();notice('Auftrag gespeichert.')}}

function renderInvoices(){setTitle('Rechnungen');$('#content').innerHTML=`<div class="section-head"><p class="muted">Rechnungen werden aus Aufträgen erstellt.</p><label class="inline"><input id="show-invoice-archive" type="checkbox"> Archiv anzeigen</label></div><div id="invoice-table">${invoicesTable(state.invoices.filter(i=>!i.archived).reverse())}</div>`;$('#show-invoice-archive').onchange=e=>$('#invoice-table').innerHTML=invoicesTable(state.invoices.filter(i=>e.target.checked?i.archived:!i.archived).reverse())}
const isOverdue=i=>Boolean(i)&&i.status==='Offen'&&Boolean(i.dueDate)&&i.dueDate<today();
function invoicesTable(rows){const cells=(i,id)=>({number:`${esc(i.number)}<br><span class="muted">${date(i.date)}</span>${i.receipt?`<br><span class="muted">Quittung ${esc(i.receipt.number)}</span>`:''}`,customer:esc(i.customerSnapshot?.name),due:date(i.dueDate),status:`<span class="badge ${isOverdue(i)?'danger':i.status==='Bezahlt'?'ok':i.status==='Storniert'?'danger':'warn'}">${isOverdue(i)?'Überfällig':esc(i.status)}</span>`,total:money(i.total)})[id]||'';const actions=i=>`<div class="actions"><button class="secondary" onclick="invoiceForm('${i.id}')">Bearbeiten</button><button class="secondary" onclick="pdfDocument('invoice','${i.id}')">PDF</button><button class="secondary" onclick="printDocument('invoice','${i.id}')">Drucken</button>${i.status==='Bezahlt'&&!i.receipt?`<button class="primary" onclick="createReceipt('${i.id}')">Quittung erstellen</button>`:''}<button class="secondary" onclick="toggleArchive('invoices','${i.id}')">${i.archived?'Aktivieren':'Archivieren'}</button><button class="danger" onclick="deleteRecord('invoice','${i.id}','${esc(i.number)}')">Löschen</button></div>`;return listTable('invoices',rows,cells,actions,{documentType:'invoice'})||'<div class="card empty">Noch keine Rechnungen vorhanden.</div>'}
function receiptsTable(rows){const cells=({invoice,receipt},id)=>({number:esc(receipt.number),invoice:esc(receipt.invoiceNumber||invoice.number),customer:esc(receipt.customerSnapshot?.name),date:date(receipt.date),total:money(receipt.total)})[id]||'';const actions=({invoice,receipt})=>`<div class="actions"><button class="secondary" onclick="pdfDocument('receipt','${invoice.id}')">PDF</button><button class="secondary" onclick="printDocument('receipt','${invoice.id}')">Drucken</button><button class="danger" onclick="deleteRecord('receipt','${receipt.id}','${esc(receipt.number)}')">Löschen</button></div>`;return listTable('receipts',rows,cells,actions,{documentType:'receipt',recordId:row=>row.invoice.id})||'<div class="card empty">Noch keine Quittungen vorhanden.</div>'}
function renderReceipts(){setTitle('Quittungen');$('#content').innerHTML=`<div class="section-head"><div class="actions"><span class="muted">Hier erscheinen die Quittungen bezahlter Rechnungen.</span><label>Sortierung<select id="receipt-sort"><option value="number-asc">Nummer aufsteigend</option><option value="number-desc">Nummer absteigend</option><option value="date-asc">Datum aufsteigend</option><option value="date-desc">Datum absteigend</option><option value="customer-asc">Kunde A–Z</option><option value="customer-desc">Kunde Z–A</option><option value="invoice-asc">Rechnung aufsteigend</option><option value="invoice-desc">Rechnung absteigend</option></select></label></div></div><div id="receipt-table"></div>`;$('#receipt-sort').value=receiptSort;const fields={number:x=>x.receipt.number,date:x=>x.receipt.date,customer:x=>x.receipt.customerSnapshot?.name||'',invoice:x=>x.receipt.invoiceNumber||x.invoice.number},draw=()=>{$('#receipt-table').innerHTML=receiptsTable(sortRows(state.invoices.filter(i=>i.receipt).map(invoice=>({invoice,receipt:invoice.receipt})),receiptSort,fields))};$('#receipt-sort').onchange=e=>{receiptSort=e.target.value;saveUserPreferences();draw()};draw()}
async function createInvoice(orderId){const o=state.orders.find(x=>x.id===orderId);if(!o||o.invoiceId)return;const d=today(),inv={id:uid(),number:nextNumber('RE',d),date:d,dueDate:dueDateFromFulfilment(o.fulfilmentDate),orderId:o.id,orderNumber:o.number,customerId:o.customerId,customerSnapshot:structuredClone(o.customerSnapshot),items:structuredClone(o.items),total:o.total,status:'Offen',paidDate:'',paymentMethod:'',text:state.settings.invoiceText,archived:false,createdAt:new Date().toISOString()};state.invoices.push(inv);o.invoiceId=inv.id;await save();render('invoices');notice(`Rechnung ${inv.number} erstellt.`)}
async function createReceipt(invoiceId){const i=state.invoices.find(x=>x.id===invoiceId);if(!i||i.receipt)return;if(i.status!=='Bezahlt'){alert('Eine Quittung kann erst erstellt werden, wenn die Rechnung als bezahlt markiert ist.');return}const d=today();i.receipt={id:uid(),number:nextNumber('QU',d),date:d,invoiceId:i.id,invoiceNumber:i.number,orderNumber:i.orderNumber,customerId:i.customerId,customerSnapshot:structuredClone(i.customerSnapshot),items:structuredClone(i.items),total:i.total,paymentMethod:i.paymentMethod||'',text:'Zahlung dankend erhalten.',createdAt:new Date().toISOString()};await save();render('receipts');notice(`Quittung ${i.receipt.number} erstellt.`)}
function syncReceiptFromInvoice(invoice){if(!invoice?.receipt)return;Object.assign(invoice.receipt,{invoiceId:invoice.id,invoiceNumber:invoice.number,orderNumber:invoice.orderNumber,customerId:invoice.customerId,customerSnapshot:structuredClone(invoice.customerSnapshot),items:structuredClone(invoice.items),total:invoice.total,paymentMethod:invoice.paymentMethod||'',updatedAt:new Date().toISOString()})}
function invoiceForm(id){const i=state.invoices.find(x=>x.id===id),items=structuredClone(i.items);modal('Rechnung bearbeiten',`<form id="invoice-form"><div class="form-grid"><label>Rechnungsnummer<input value="${esc(i.number)}" disabled></label><label>Rechnungsdatum<input name="date" type="date" value="${i.date}" required></label><label>Fälligkeitsdatum<input name="dueDate" type="date" value="${i.dueDate}" required></label><label>Status<select name="status"><option ${i.status==='Offen'?'selected':''}>Offen</option><option ${i.status==='Bezahlt'?'selected':''}>Bezahlt</option><option ${i.status==='Storniert'?'selected':''}>Storniert</option></select></label><label>Bezahlt am<input name="paidDate" type="date" value="${i.paidDate||i.receipt?.date||''}"></label><label>Zahlungsart<select name="paymentMethod"><option value="" ${!i.paymentMethod?'selected':''}>Nicht angegeben</option><option value="Überweisung" ${i.paymentMethod==='Überweisung'?'selected':''}>Überweisung</option><option value="Barzahlung" ${i.paymentMethod==='Barzahlung'?'selected':''}>Barzahlung</option><option value="TWINT" ${i.paymentMethod==='TWINT'?'selected':''}>TWINT</option><option value="Karte" ${i.paymentMethod==='Karte'?'selected':''}>Karte</option></select></label><label class="span-2">Rechnungstext<textarea name="text">${esc(i.text)}</textarea></label><div class="span-2"><h3>Positionen</h3>${lineItemsEditor(items)}</div></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);wireLines(items);$('#invoice-form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.paidDate=data.status==='Bezahlt'?(data.paidDate||i.paidDate||today()):'';Object.assign(i,data,{items,total:items.reduce((s,x)=>s+x.total,0),updatedAt:new Date().toISOString()});syncReceiptFromInvoice(i);await save();closeModal();renderInvoices();notice(i.receipt?'Rechnung und Quittung aktualisiert.':'Rechnung gespeichert.')}}

const monthKey=d=>String(d||'').slice(0,7);
const monthLabel=m=>new Intl.DateTimeFormat('de-CH',{month:'short',year:'2-digit'}).format(new Date(`${m}-01T12:00:00`));
function lastTwelveMonths(){const now=new Date(),months=[];for(let n=11;n>=0;n--){const d=new Date(now.getFullYear(),now.getMonth()-n,1);months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)}return months}
function financeChart(entries,dateOf,amountOf){const months=lastTwelveMonths(),totals=months.map(m=>entries.filter(x=>monthKey(dateOf(x))===m).reduce((s,x)=>s+Number(amountOf(x)||0),0)),max=Math.max(...totals,1);return `<div class="card finance-chart"><h2>Letzte 12 Monate</h2><div class="bar-chart">${months.map((m,i)=>`<div class="bar-column"><span class="bar-value">${totals[i]?money(totals[i]):'–'}</span><div class="bar" style="height:${Math.max(totals[i]?6:0,totals[i]/max*100)}%"></div><span class="bar-label">${monthLabel(m)}</span></div>`).join('')}</div></div>`}
function expenseForm(id){const x=state.expenses.find(e=>e.id===id)||{date:today(),amount:''};modal(id?'Ausgabe bearbeiten':'Neue Ausgabe',`<form id="expense-form"><div class="form-grid"><label>Datum<input name="date" type="date" value="${x.date}" required></label><label>Betrag CHF<input name="amount" type="number" min="0" step="0.01" value="${x.amount}" required></label><label class="span-2">Beschreibung<textarea name="description" required>${esc(x.description)}</textarea></label></div><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Abbrechen</button><button class="primary">Speichern</button></div></form>`);$('#expense-form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.amount=Number(data.amount);if(id)Object.assign(x,data,{updatedAt:new Date().toISOString()});else state.expenses.push({...data,id:uid(),createdAt:new Date().toISOString()});await save();closeModal();financeMonth=monthKey(data.date);saveUserPreferences();renderExpenses();notice('Ausgabe gespeichert.')}}
async function deleteExpense(id){const x=state.expenses.find(e=>e.id===id);if(x)await deleteRecord('expense',id,x.description||'Ausgabe')}
function renderExpenses(){setTitle('Ausgaben');const rows=state.expenses.filter(x=>monthKey(x.date)===financeMonth).sort((a,b)=>b.date.localeCompare(a.date)),total=rows.reduce((s,x)=>s+Number(x.amount),0);$('#content').innerHTML=`<div class="section-head"><div class="actions"><button class="primary" onclick="expenseForm()">Neue Ausgabe</button><label>Monat<input id="finance-month" type="month" value="${financeMonth}"></label><button class="secondary" onclick="pdfMonthlyReport('expenses','${financeMonth}')">Monatsbericht PDF</button></div></div><div class="grid stats finance-stats"><div class="card stat"><span class="muted">Ausgaben ${monthLabel(financeMonth)}</span><strong>${money(total)}</strong></div><div class="card stat"><span class="muted">Einträge</span><strong>${rows.length}</strong></div></div>${financeChart(state.expenses,x=>x.date,x=>x.amount)}<div class="section-head"><h2>Ausgaben ${monthLabel(financeMonth)}</h2></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Nummer</th><th>Datum</th><th>Beschreibung</th><th>Betrag</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.number||'–')}</td><td>${date(x.date)}</td><td>${esc(x.description)}</td><td>${money(x.amount)}</td><td><div class="actions"><button class="secondary" onclick="expenseForm('${x.id}')">Bearbeiten</button><button class="danger" onclick="deleteExpense('${x.id}')">Löschen</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Keine Ausgaben in diesem Monat.</div>'}`;$('#finance-month').onchange=e=>{financeMonth=e.target.value;saveUserPreferences();renderExpenses()}}
const incomeDate=i=>i.paidDate||i.receipt?.date||i.date;
function renderIncome(){setTitle('Einnahmen');const paid=state.invoices.filter(i=>i.status==='Bezahlt'),rows=paid.filter(i=>monthKey(incomeDate(i))===financeMonth).sort((a,b)=>incomeDate(b).localeCompare(incomeDate(a))),total=rows.reduce((s,i)=>s+Number(i.total),0);$('#content').innerHTML=`<div class="section-head"><div class="actions"><label>Monat<input id="finance-month" type="month" value="${financeMonth}"></label><button class="secondary" onclick="pdfMonthlyReport('income','${financeMonth}')">Monatsbericht PDF</button></div></div><div class="grid stats finance-stats"><div class="card stat"><span class="muted">Einnahmen ${monthLabel(financeMonth)}</span><strong>${money(total)}</strong></div><div class="card stat"><span class="muted">Bezahlte Rechnungen</span><strong>${rows.length}</strong></div></div>${financeChart(paid,incomeDate,i=>i.total)}<div class="section-head"><h2>Einnahmen ${monthLabel(financeMonth)}</h2></div>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Zahlungsdatum</th><th>Rechnung</th><th>Kunde</th><th>Betrag</th></tr></thead><tbody>${rows.map(i=>`<tr><td>${date(incomeDate(i))}</td><td>${esc(i.number)}</td><td>${esc(i.customerSnapshot?.name)}</td><td>${money(i.total)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Keine Einnahmen in diesem Monat.</div>'}`;$('#finance-month').onchange=e=>{financeMonth=e.target.value;saveUserPreferences();renderIncome()}}
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
  $('#customer-sort').onchange=e=>{customerSort=e.target.value;saveUserPreferences();draw()};$('#show-customer-archive').onchange=draw;draw();
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
  $('#order-sort').onchange=e=>{orderSort=e.target.value;saveUserPreferences();draw()};$('#show-order-archive').onchange=draw;draw();
}

function renderSortableInvoices(){
  setTitle('Rechnungen');
  $('#content').innerHTML=`<div class="section-head"><div class="actions"><span class="muted">Rechnungen werden aus Aufträgen erstellt.</span><label>Sortierung<select id="invoice-sort"><option value="number-asc">Nummer aufsteigend</option><option value="number-desc">Nummer absteigend</option><option value="issued-asc">Rechnungsdatum aufsteigend</option><option value="issued-desc">Rechnungsdatum absteigend</option><option value="customer-asc">Kunde A–Z</option><option value="customer-desc">Kunde Z–A</option><option value="due-asc">Fälligkeit aufsteigend</option><option value="due-desc">Fälligkeit absteigend</option><option value="status-asc">Status A–Z</option><option value="status-desc">Status Z–A</option></select></label></div><label class="inline"><input id="show-invoice-archive" type="checkbox"> Archiv anzeigen</label></div><div id="invoice-table"></div>`;
  $('#invoice-sort').value=invoiceSort;
  const fields={number:i=>i.number,issued:i=>i.date,customer:i=>i.customerSnapshot?.name||'',due:i=>i.dueDate,status:i=>i.status};
  const draw=()=>{$('#invoice-table').innerHTML=invoicesTable(sortRows(state.invoices.filter(i=>$('#show-invoice-archive').checked?i.archived:!i.archived),invoiceSort,fields))};
  $('#invoice-sort').onchange=e=>{invoiceSort=e.target.value;saveUserPreferences();draw()};$('#show-invoice-archive').onchange=draw;draw();
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
  mountAddressAutocomplete({zip:form.elements.zip,city:form.elements.city,street:form.elements.street});
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
      try{await originalSubmit(event);const order=id?state.orders.find(x=>x.id===id):state.orders[state.orders.length-1];if(typeof order.number!=='string')order.number='';await saveOrderRecord(order,expectedUpdatedAt,Boolean(existing));await cloudClose();renderSortableOrders();const invoice=state.invoices.find(x=>x.orderId===order.id);notice(invoice?.receipt?'Auftrag, Rechnung und Quittung aktualisiert.':invoice?'Auftrag und verknüpfte Rechnung aktualisiert.':'Auftrag gespeichert.')}catch(error){console.error('Auftrag konnte nicht gespeichert werden:',error);logClientError(error?.message||error,{action:'save_order_subscription'});let box=$('#order-save-error');if(!box){box=document.createElement('p');box.id='order-save-error';box.className='error span-2';form.querySelector('.form-actions')?.before(box)}box.textContent=`Auftrag konnte nicht gespeichert werden: ${error?.message||'Unbekannter Fehler'}`}finally{save=cloudSave;closeModal=cloudClose;submit.disabled=false;submit.textContent='Speichern'}
    };
  }
  if(form){
    const customerField=form.customerId.closest('label');
    customerField?.insertAdjacentHTML('beforeend','<button type="button" id="new-customer-inline" class="text-button">Neuen Kunden erfassen</button>');
    customerField?.insertAdjacentHTML('afterend',`<div id="new-customer-panel" class="span-2 inline-create-panel hidden"><div class="inline-create-head"><strong>Neuen Kunden erfassen</strong><button type="button" class="text-button" id="cancel-new-customer">Schliessen</button></div><div class="form-grid compact-grid"><label>Firma<input id="inline-company"></label><label>Anrede<input id="inline-salutation"></label><label>Vorname<input id="inline-first-name"></label><label>Nachname<input id="inline-last-name"></label><label>E-Mail<input id="inline-email" type="email"></label><label>Telefon<input id="inline-phone" type="tel"></label><label>PLZ<input id="inline-zip" inputmode="numeric"></label><label>Ort<input id="inline-city"></label><label class="span-2">Strasse / Rechnungsadresse<input id="inline-street"></label></div><div id="inline-customer-error" class="error small"></div><div class="actions inline-create-actions"><button type="button" class="primary" id="save-new-customer">Kunden speichern und auswählen</button></div></div>`);
    $('#inline-salutation').outerHTML=salutationSelect('','inline-salutation');
    mountAddressAutocomplete({zip:$('#inline-zip'),city:$('#inline-city'),street:$('#inline-street')});
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
  if(form){form.querySelector('.form-actions')?.insertAdjacentHTML('beforebegin','<label class="span-2">Belege anhängen <input name="attachments" type="file" accept="application/pdf,image/*" multiple><span class="hint">PDF oder Bild, maximal 8 MB pro Datei.</span></label>');const originalSubmit=form.onsubmit;form.onsubmit=async event=>{event.preventDefault();const files=[...form.elements.attachments.files];if(files.some(file=>file.size>8_000_000)){alert('Ein Beleg darf maximal 8 MB gross sein.');return}const cloudSave=save,cloudClose=closeModal,submit=form.querySelector('button.primary');let record;save=async()=>{};closeModal=async()=>{};submit.disabled=true;submit.textContent='Wird gespeichert …';try{await originalSubmit(event);record=id?state.expenses.find(x=>x.id===id):state.expenses[state.expenses.length-1];const saved=await saveExpenseRecord(record,expectedUpdatedAt,Boolean(expense));record.id=saved.id;for(const file of files)await uploadAttachment('expense',saved.id,file);await cloudClose();financeMonth=monthKey(record.date);saveUserPreferences();renderExpenses();notice(files.length?'Ausgabe und Beleg gespeichert.':'Ausgabe gespeichert.')}catch(error){alert(record?`Ausgabe gespeichert, Beleg konnte nicht hochgeladen werden: ${error.message}`:`Ausgabe konnte nicht gespeichert werden: ${error.message}`)}finally{save=cloudSave;closeModal=cloudClose;submit.disabled=false;submit.textContent='Speichern'}}}
};
const SETTINGS_LOCK_ID='00000000-0000-0000-0000-000000000001';
const originalRenderCloudSettings=renderCloudSettings;
renderCloudSettings=async function(){
  try{
    if(!(await acquireEditLock('settings',SETTINGS_LOCK_ID))){setTitle('Einstellungen');$('#content').innerHTML=`<div class="card empty">${esc(editLockConflictMessage('Die Einstellungen'))}</div>`;return}
    state=await loadFromSupabase();state.settings.logo||=DEFAULT_LOGO;originalRenderCloudSettings();
    const streetInput=$('#settings-form input[name="street"]'),streetLabel=streetInput?.closest('label');if(streetLabel){streetLabel.firstChild.nodeValue='Strasse (ohne Hausnummer)';streetLabel.insertAdjacentHTML('afterend',`<label>Hausnummer<input name="qrBuildingNumber" value="${esc(state.settings.qrBuildingNumber||'')}"><span class="hint">Für die QR-Rechnung separat erfassen.</span></label>`)}
    [...document.querySelectorAll('.backup-actions button')].find(button=>button.textContent.includes('importieren'))?.remove();
    $('#content').insertAdjacentHTML('beforeend','<div class="card settings-block"><h2>Positionsvorlagen</h2><p class="hint">Lege häufig verwendete Positionen mit Standardpreis fest. Beim Auftrag wird eine Kopie eingefügt und kann danach frei angepasst werden. Die Vorlagen gelten für alle Benutzer.</p><button type="button" class="secondary" onclick="openPositionTemplates()">Vorlagen bearbeiten</button></div>');
    $('#content').insertAdjacentHTML('beforeend','<div class="card settings-block"><h2>Meine Listenansicht</h2><p class="hint">Lege für Kunden, Aufträge, Rechnungen und Quittungen fest, welche Informationen in deiner Liste erscheinen und in welcher Reihenfolge. Diese Auswahl gilt nur für deinen Benutzer.</p><button type="button" class="secondary" onclick="openListSettings()">Listenansicht anpassen</button></div>');
    $('#content').insertAdjacentHTML('beforeend','<div class="card settings-block"><h2>Nachvollziehbarkeit</h2><p class="hint">Alle Änderungen werden mit Zeitpunkt, Benutzer sowie altem und neuem Wert unveränderbar protokolliert.</p><button type="button" class="secondary" onclick="openAuditLog()">Änderungsprotokoll anzeigen</button></div>');
    $('#content').insertAdjacentHTML('beforeend','<div class="card settings-block"><h2>Sicherheit</h2><p class="hint">Zugriff nur für freigegebene ERP-Mitglieder; physisches Löschen ist auf Datenbankebene gesperrt.</p><button type="button" class="secondary" onclick="openSecurityStatus()">Sicherheitsstatus anzeigen</button></div>');
    $('#content').insertAdjacentHTML('beforeend','<div class="card settings-block"><h2>Betrieb und Datensicherung</h2><p class="hint">Interne Datenbank-Snapshots, Wiederherstellungstest, Monitoring und zentrale Fehlerprotokolle.</p><div class="backup-actions"><button type="button" class="primary" onclick="createSystemBackup()">Snapshot erstellen</button><button type="button" class="secondary" onclick="testSystemBackup()">Wiederherstellung prüfen</button><button type="button" class="secondary" onclick="openOperationsStatus()">Betriebsstatus</button></div></div>');
    const form=$('#settings-form');if(form)form.onsubmit=async event=>{event.preventDefault();const submit=form.querySelector('button.primary'),data=Object.fromEntries(new FormData(form));Object.assign(state.settings,data,{paymentDays:Number(data.paymentDays)});submit.disabled=true;submit.textContent='Wird gespeichert …';try{await saveSettingsRecord(state.settings);notice('Einstellungen gespeichert.')}catch(error){alert(`Einstellungen konnten nicht gespeichert werden: ${error.message}`)}finally{submit.disabled=false;submit.textContent='Einstellungen speichern'}};
    const logoInput=$('#logo-file');if(logoInput)logoInput.onchange=event=>{const file=event.target.files[0];if(!file)return;if(file.size>1_500_000){alert('Das Logo darf maximal 1,5 MB gross sein.');return}const reader=new FileReader();reader.onload=async()=>{try{state.settings.logo=reader.result;await saveSettingsRecord(state.settings);renderCloudSettings();notice('Logo gespeichert.')}catch(error){alert(`Logo konnte nicht gespeichert werden: ${error.message}`)}};reader.readAsDataURL(file)};
  }catch(error){console.error('Einstellungssperre nicht verfügbar:',error);await releaseCurrentEditLock();setTitle('Einstellungen');$('#content').innerHTML=`<div class="card empty">Die Einstellungen können momentan nicht sicher bearbeitet werden: ${esc(error?.message||'Unbekannter Fehler')}</div>`}
};
function openPositionTemplates(){const templates=structuredClone(state.settings.positionTemplates||[]),draw=()=>{$('#position-template-list').innerHTML=templates.length?templates.map((template,index)=>`<div class="line-item template-row"><label>Bezeichnung<input data-template="name" data-index="${index}" value="${esc(template.name)}" required></label><label>Preis CHF<input data-template="price" data-index="${index}" type="number" min="0" step="0.01" value="${Number(template.price)||0}" required></label><label class="inline">Aktiv<input data-template="active" data-index="${index}" type="checkbox" ${template.active!==false?'checked':''}></label><button type="button" class="danger" data-remove-template="${index}" aria-label="Vorlage entfernen">×</button></div>`).join(''):'<p class="hint">Noch keine Positionsvorlagen vorhanden.</p>'};modal('Positionsvorlagen',`<form id="position-template-form"><p class="hint">Vorlagen werden nur beim Einfügen in den Auftrag verwendet. Bereits gespeicherte Positionen bleiben unverändert.</p><div id="position-template-list"></div><button type="button" class="secondary" id="add-position-template">Vorlage hinzufügen</button><div class="form-actions"><button type="button" class="secondary" id="cancel-position-templates">Abbrechen</button><button class="primary">Speichern</button></div></form>`);draw();$('#position-template-list').oninput=event=>{const field=event.target.dataset.template;if(!field)return;const template=templates[Number(event.target.dataset.index)];template[field]=field==='price'?Number(event.target.value):event.target.value};$('#position-template-list').onchange=event=>{if(event.target.dataset.template==='active')templates[Number(event.target.dataset.index)].active=event.target.checked};$('#position-template-list').onclick=event=>{if(event.target.dataset.removeTemplate!==undefined){templates.splice(Number(event.target.dataset.removeTemplate),1);draw()}};$('#add-position-template').onclick=()=>{templates.push({id:uid(),name:'',price:0,active:true});draw()};$('#cancel-position-templates').onclick=async()=>{await closeModal();renderCloudSettings()};$('#position-template-form').onsubmit=async event=>{event.preventDefault();if(templates.some(template=>!String(template.name||'').trim())){alert('Bitte gib jeder Vorlage eine Bezeichnung.');return}state.settings.positionTemplates=templates.map(template=>({...template,name:String(template.name).trim(),price:Number(template.price)||0,active:template.active!==false}));try{await saveSettingsRecord(state.settings);await closeModal();renderCloudSettings();notice('Positionsvorlagen gespeichert.')}catch(error){alert(`Vorlagen konnten nicht gespeichert werden: ${error.message}`)}}}
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
  const exportState={...state,lastExport:new Date().toISOString()},blob=new Blob([JSON.stringify(exportState,null,2)],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`atelier-wuffli-backup-${today()}.json`;link.click();URL.revokeObjectURL(link.href);notice('Datensicherung exportiert.')
};

async function preparePdfLogo(source){
  if(!source)return '';
  const data=source.startsWith('data:')?source:await fetch(source).then(response=>response.blob()).then(blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)}));
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const pad=Math.round(Math.min(image.width,image.height)*.12),fade=Math.max(8,Math.round(pad*.85)),canvas=document.createElement('canvas');canvas.width=image.width+pad*2;canvas.height=image.height+pad*2;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,pad,pad);const edges=[[pad,pad,fade,image.height,0,0,fade,0],[pad+image.width-fade,pad,fade,image.height,fade,0,0,0],[pad,pad,image.width,fade,0,0,0,fade],[pad,pad+image.height-fade,image.width,fade,0,fade,0,0]];for(const [x,y,w,h,x0,y0,x1,y1] of edges){const gradient=context.createLinearGradient(x+x0,y+y0,x+x1,y+y1);gradient.addColorStop(0,'rgba(255,255,255,1)');gradient.addColorStop(1,'rgba(255,255,255,0)');context.fillStyle=gradient;context.fillRect(x,y,w,h)}resolve(canvas.toDataURL('image/png'))};image.onerror=reject;image.src=data});
}

async function pdfDocument(type,id){
  let invoice=state.invoices.find(x=>x.id===id),d=type==='order'?state.orders.find(x=>x.id===id):type==='receipt'?invoice?.receipt:invoice;if(!d)return;
  const done=showWorking('PDF wird erstellt und gespeichert …');try{
  if(type==='invoice'){invoice=await ensureInvoiceQrData(invoice);d=invoice}
  const documentHash=await pdfHash(type,d),existingPdf=await findGeneratedPdf(type,d.id,documentHash);if(existingPdf){try{await openStoredPdf(existingPdf);return}catch(error){console.warn('Gespeichertes PDF fehlt, es wird neu erzeugt.',error)}}
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
    const meta=isReceipt?[['Belegnummer:',d.number],['Datum:',date(d.date)],['Rechnung:',d.invoiceNumber||'–'],['Auftrag:',d.orderNumber||'–']]:isInv?[['Datum:',date(d.date)],['Rechnungsnummer:',d.number],['Auftragsnummer:',d.orderNumber||'–'],['Fällig am:',date(d.dueDate)],['Kundennummer:',d.customerSnapshot?.number||'–']]:[['Datum:',date(d.date)],['Auftragsnummer:',d.number],[`${d.fulfilment||'Erfüllung'}:`,date(d.fulfilmentDate)],['Kundennummer:',d.customerSnapshot?.number||'–']];
    doc.setFontSize(9);meta.forEach(([label,value],index)=>{const y=(isInv?59:62)+index*(isInv?5.5:7);doc.setTextColor(...muted);doc.text(String(label),130,y);doc.setTextColor(...ink);doc.text(String(value),190,y,{align:'right'})});
    const invoiceCompact=isInv;doc.setFont('times','italic');doc.setFontSize(29);doc.text(title,20,invoiceCompact?91:103);doc.setFont('times','italic');doc.setFontSize(14);doc.text(isReceipt?'Zahlung dankend erhalten.':'Liebe Kundin, lieber Kunde,',20,invoiceCompact?100:117);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...muted);doc.text(isReceipt?'Der folgende Rechnungsbetrag wurde vollständig bezahlt.':isInv?'Vielen Dank für deine Bestellung. Wir berechnen dir folgende Leistungen und Produkte:':'Vielen Dank für deinen Auftrag. Folgende Leistungen und Produkte sind vorgesehen:',20,invoiceCompact?108:127);
    let y=invoiceCompact?120:142;doc.setFillColor(...rose);doc.roundedRect(15,y,180,10,2,2,'F');doc.setTextColor(...ink);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Beschreibung',20,y+6.5);doc.text('Menge',130,y+6.5);doc.text('Einzelpreis',151,y+6.5);doc.text('Betrag',190,y+6.5,{align:'right'});y+=12;doc.setFont('helvetica','normal');
    for(const item of d.items){const lines=doc.splitTextToSize(String(item.description||''),102),height=Math.max(9,lines.length*4.5+3);if(y+height>238){doc.addPage();decorate();y=24;doc.setFillColor(...rose);doc.rect(15,y,180,10,'F');doc.setFont('helvetica','bold');doc.text('Beschreibung',20,y+6.5);doc.text('Menge',130,y+6.5);doc.text('Einzelpreis',151,y+6.5);doc.text('Betrag',190,y+6.5,{align:'right'});doc.setFont('helvetica','normal');y+=12}doc.text(lines,20,y+4);doc.text(String(item.quantity),130,y+4);doc.text(money(item.price),151,y+4);doc.text(money(item.total),190,y+4,{align:'right'});doc.setDrawColor(222,217,214);doc.line(15,y+height,195,y+height);y+=height}
    y+=7;doc.setDrawColor(...roseStrong);doc.line(112,y,195,y);y+=9;doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('Gesamtbetrag',116,y);doc.setFontSize(16);doc.text(money(d.total),190,y,{align:'right'});y+=7;
    if(isInv){doc.setTextColor(...ink);doc.setFont('times','italic');doc.setFontSize(20);doc.text('Vielen Dank!',65,y-7,{align:'center'})}
    const qrOnCurrentPage=isInv&&y<=188,companyLines=[...businessIdentityLines(s),...businessAddressLines(s)].filter(Boolean);
    if(isReceipt){doc.setFillColor(...rose);doc.roundedRect(112,y,83,12,2,2,'F');doc.setFontSize(12);doc.text('Bezahlt',117,y+8.5);doc.text(money(d.total),190,y+8.5,{align:'right'});doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Quittungsinformationen',20,225);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...muted);[...companyLines,`Rechnung: ${d.invoiceNumber||'–'}`,`Bezahlt am ${date(d.date)}`,`Zahlungsart: ${d.paymentMethod||'–'}`].forEach((line,index)=>doc.text(line,20,233+index*4.5))}
    else if(!isInv){doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text('Auftragsinformationen',20,225);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...muted);const info=[...companyLines,`${d.fulfilment||'Erfüllung'} am ${date(d.fulfilmentDate)}`];if(d.text)info.push(...doc.splitTextToSize(String(d.text),75));info.forEach((line,index)=>doc.text(line,20,233+index*4.5))}
    if(!isInv&&!qrOnCurrentPage){doc.setTextColor(...ink);doc.setFont('times','italic');doc.setFontSize(isReceipt?24:20);doc.text('Vielen Dank!',105,270,{align:'center'})}
    if(isInv)await appendQrBill(doc,d,qrOnCurrentPage);
    const saved=await storeGeneratedPdf(type,d,doc,documentHash);await openStoredPdf(saved);return;
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
  const saved=await storeGeneratedPdf(type,d,doc,documentHash);await openStoredPdf(saved);
  }catch(error){console.error('PDF konnte nicht erstellt werden:',error);alert(`PDF konnte nicht erstellt werden: ${error.message||'Unbekannter Fehler'}`)}finally{done()}
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
const subscriptionOrderForm=orderForm;
orderForm=async function(id){
  await subscriptionOrderForm(id);
  const form=$('#order-form');if(!form)return;
  const order=id?state.orders.find(entry=>entry.id===id):null,dateInput=form.elements.fulfilmentDate,dateLabel=dateInput?.closest('label');if(!dateInput||!dateLabel)return;
  const dates=[...new Set((orderDates(order).length?orderDates(order):[dateInput.value||today()]))],hidden=document.createElement('input');hidden.type='hidden';hidden.name='fulfilmentDates';
  const panel=document.createElement('div');panel.className='span-2 subscription-dates';panel.innerHTML='<div class="section-head"><div><h3>Abhol-/Liefertermine</h3><p class="hint">Für ein Abo können mehrere Termine erfasst werden.</p></div><button type="button" class="secondary" id="add-fulfilment-date">Termin hinzufügen</button></div><div id="fulfilment-date-list"></div>';
  dateLabel.replaceWith(panel);form.appendChild(dateInput);dateInput.type='hidden';form.appendChild(hidden);
  const draw=()=>{dates.sort();hidden.value=JSON.stringify(dates);dateInput.value=dates[0]||'';panel.querySelector('#fulfilment-date-list').innerHTML=dates.map((value,index)=>`<div class="subscription-date-row"><label>Termin ${index+1}<input type="date" value="${value}" data-subscription-date="${index}" required></label><button type="button" class="danger" data-remove-subscription-date="${index}" ${dates.length===1?'disabled':''}>×</button></div>`).join('')};
  panel.querySelector('#add-fulfilment-date').onclick=()=>{const last=dates.at(-1)||today(),next=new Date(`${last}T12:00:00`);next.setDate(next.getDate()+7);dates.push(next.toISOString().slice(0,10));draw()};
  panel.onclick=event=>{const index=event.target.dataset.removeSubscriptionDate;if(index===undefined)return;dates.splice(Number(index),1);draw()};
  panel.oninput=event=>{const index=event.target.dataset.subscriptionDate;if(index===undefined)return;dates[Number(index)]=event.target.value;hidden.value=JSON.stringify(dates.filter(Boolean));dateInput.value=[...dates].filter(Boolean).sort()[0]||''};draw();
};
renderCustomers=renderCloudCustomers;
renderOrders=renderSortableOrders;
renderInvoices=renderSortableInvoices;
Object.assign(window,{customerForm,orderForm,invoiceForm,createInvoice,createReceipt,expenseForm,deleteExpense,pdfMonthlyReport,printDocument,pdfDocument,toggleArchive,exportData,closeModal,resetEverything,reloadCloudData,openPositionTemplates});
window.addEventListener('error',event=>logClientError(event.message,{source:event.filename||'',line:event.lineno||0,column:event.colno||0}));
window.addEventListener('unhandledrejection',event=>logClientError(event.reason?.message||event.reason||'Unbehandelter Promise-Fehler',{type:'unhandledrejection'}));
init().catch(err=>{console.error(err);alert(`Supabase konnte nicht geladen werden. ${err?.message||'Bitte Internetverbindung und Datenbankeinrichtung prüfen.'}`)});
