window.erpInteraction=(()=>{
  let baseline='',touched=false,trackedDialog=null,confirmation=null;
  const controlsSnapshot=()=>JSON.stringify([...document.querySelectorAll('#modal-body form input,#modal-body form select,#modal-body form textarea')].filter(control=>!['button','submit','reset'].includes(control.type)).map(control=>[control.name,control.type,control.type==='file'?[...control.files].map(file=>[file.name,file.size,file.lastModified]):control.type==='checkbox'||control.type==='radio'?control.checked:control.multiple?[...control.selectedOptions].map(option=>option.value):control.value]));
  function trackModal(){
    trackedDialog=document.getElementById('modal');touched=false;baseline=controlsSnapshot();
    const capture=()=>{if(!touched&&trackedDialog?.open)baseline=controlsSnapshot()};
    queueMicrotask(capture);requestAnimationFrame(capture);
  }
  function dirty(){return Boolean(trackedDialog?.open&&trackedDialog.querySelector('form')&&controlsSnapshot()!==baseline)}
  function trapTab(event,container){
    if(event.key!=='Tab')return;
    const elements=[...container.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')].filter(element=>!element.disabled&&element.getClientRects().length&&!element.closest('[inert]'));
    const first=elements[0],last=elements.at(-1);if(!first)return;
    if(!container.contains(document.activeElement)||(event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last)){event.preventDefault();(event.shiftKey?last:first).focus()}
  }
  async function mayClose({saved=false}={}){
    if(saved)return true;
    const dialog=document.getElementById('modal');
    if([...dialog.querySelectorAll('form button:disabled')].some(button=>/Wird gespeichert/i.test(button.textContent))){
      let status=dialog.querySelector('[data-close-status]');if(!status){status=document.createElement('p');status.dataset.closeStatus='';status.setAttribute('role','status');dialog.querySelector('#modal-body').appendChild(status)}status.textContent='Die Speicherung läuft. Bitte warte auf die Bestätigung.';return false;
    }
    if(!dirty())return true;
    if(confirmation)return confirmation.promise;
    const previousFocus=document.activeElement,shell=dialog.querySelector('.modal-shell'),box=document.createElement('section');
    box.className='discard-confirm';box.setAttribute('role','alertdialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','discard-title');box.setAttribute('aria-describedby','discard-description');
    box.innerHTML='<div class="discard-card"><h2 id="discard-title">Änderungen verwerfen?</h2><p id="discard-description">Deine Eingaben wurden noch nicht gespeichert.</p><div class="actions"><button type="button" class="primary" data-keep-editing>Weiter bearbeiten</button><button type="button" class="danger" data-discard>Änderungen verwerfen</button></div></div>';
    shell.inert=true;dialog.appendChild(box);
    let resolve;const promise=new Promise(done=>{resolve=done});
    const finish=discard=>{box.remove();shell.inert=false;confirmation=null;if(previousFocus?.isConnected)previousFocus.focus();resolve(discard)};
    confirmation={promise,box,finish};box.querySelector('[data-keep-editing]').onclick=()=>finish(false);box.querySelector('[data-discard]').onclick=()=>finish(true);box.querySelector('[data-keep-editing]').focus();
    return promise;
  }
  function setMenu(open,restoreFocus=true){
    const sidebar=document.querySelector('.sidebar'),button=document.getElementById('menu-button'),mobile=matchMedia('(max-width:900px)').matches;
    open=Boolean(open&&mobile);
    const wasOpen=sidebar.classList.contains('open');sidebar.classList.toggle('open',open);document.body.classList.toggle('mobile-menu-open',open);button.setAttribute('aria-expanded',String(open));
    document.querySelector('main').inert=open;document.getElementById('mobile-bottom-nav').inert=open;document.getElementById('sidebar-backdrop').hidden=!open;
    if(open){sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');sidebar.setAttribute('aria-label','Hauptnavigation');(sidebar.querySelector('[aria-current="page"]')||sidebar.querySelector('button')).focus()}
    else{sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');sidebar.removeAttribute('aria-label');if(wasOpen&&restoreFocus&&mobile)button.focus()}
  }
  function notice(message,onUndo){
    const region=document.getElementById('notice'),text=document.createElement('span'),dismiss=document.createElement('button');
    text.textContent=message;region.replaceChildren(text);region.classList.remove('hidden');
    if(onUndo){const undo=document.createElement('button');undo.type='button';undo.className='secondary';undo.id='undo-action';undo.textContent='Rückgängig';region.appendChild(undo);undo.onclick=async()=>{undo.disabled=true;try{await onUndo();notice('Löschung rückgängig gemacht.');region.querySelector('[data-dismiss-notice]').focus()}catch(error){text.textContent=`Wiederherstellung fehlgeschlagen: ${error.message}`;undo.disabled=false}}}
    dismiss.type='button';dismiss.className='text-button';dismiss.dataset.dismissNotice='';dismiss.setAttribute('aria-label','Meldung schliessen');dismiss.textContent='Schliessen';dismiss.onclick=()=>{region.classList.add('hidden');document.getElementById('page-title').focus()};region.appendChild(dismiss);
  }
  function captureReturn(view,id){
    const active=document.activeElement;
    return {view,id,scrollY:window.scrollY,homeClass:active?.classList.contains('home-appointment')?'home-appointment':'home-order',controls:[...document.querySelectorAll('#content select[id],#content input[id]')].map(control=>({id:control.id,value:control.value,checked:control.checked}))};
  }
  function restoreReturn(target){
    if(!target||target.view!==currentView)return;
    for(const saved of target.controls){const control=document.getElementById(saved.id);if(!control)continue;const changed=control.value!==saved.value||control.checked!==saved.checked;control.value=saved.value;if(control.type==='checkbox')control.checked=saved.checked;if(changed)control.dispatchEvent(new Event('change',{bubbles:true}))}
    requestAnimationFrame(()=>{
      const selector=target.view==='dashboard'?`.${target.homeClass}[data-home-order]`:'#content [data-record-id]';
      const row=[...document.querySelectorAll(selector)].find(element=>(element.dataset.recordId||element.dataset.homeOrder)===target.id);
      if(row){row.focus({preventScroll:true});row.classList.add('document-return-focus');setTimeout(()=>row.classList.remove('document-return-focus'),1800)}
      window.scrollTo(0,target.scrollY);
    });
  }
  function install(){
    const dialog=document.getElementById('modal');
    dialog.addEventListener('input',()=>{touched=true});dialog.addEventListener('change',()=>{touched=true});
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(confirmation)confirmation.finish(false);else closeModal()});
    document.addEventListener('keydown',event=>{
      if(confirmation){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();confirmation.finish(false)}else trapTab(event,confirmation.box);return}
      const sidebar=document.querySelector('.sidebar');if(sidebar.classList.contains('open')&&!dialog.open){if(event.key==='Escape'){event.preventDefault();setMenu(false)}else trapTab(event,sidebar)}
    },true);
    document.getElementById('sidebar-close').onclick=()=>setMenu(false);document.getElementById('sidebar-backdrop').onclick=()=>setMenu(false);
    matchMedia('(max-width:900px)').addEventListener('change',()=>setMenu(false,false));
    window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue=''}});
  }
  return Object.freeze({trackModal,dirty,mayClose,setMenu,notice,captureReturn,restoreReturn,install});
})();
