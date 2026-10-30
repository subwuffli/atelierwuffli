/* Personal appearance is stored with the existing user preferences, never business settings. */
window.erpAppearance=(()=>{
  const palettes={atelier:'Atelier Braun',salbei:'Salbei',marine:'Marineblau',neutral:'Neutral'};
  const modes={auto:'Automatisch (Geräteeinstellung)',light:'Hell',dark:'Dunkel'};
  let selected={palette:'atelier',mode:'auto'};
  const normalize=value=>({palette:Object.hasOwn(palettes,value?.palette)?value.palette:'atelier',mode:Object.hasOwn(modes,value?.mode)?value.mode:'auto'});
  function updateBrowserColor(){
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=getComputedStyle(document.documentElement).backgroundColor;
  }
  function preview(value){
    const normalized=normalize(value);
    document.documentElement.dataset.palette=normalized.palette;
    document.documentElement.dataset.appearance=normalized.mode;
    updateBrowserColor();
  }
  function apply(value){
    selected=normalize(value);
    preview(selected);
    return {...selected};
  }
  function mount(container,persist){
    container.querySelector('#appearance-settings')?.remove();
    const section=document.createElement('section');
    section.id='appearance-settings';section.className='card settings-block';
    section.innerHTML=`<h2>Erscheinungsbild</h2><p class="hint">Diese Auswahl gilt nur für deinen Benutzer und wird auf deinen anderen Geräten beim Anmelden geladen. Die Vorschau ändert sich sofort.</p><form id="appearance-form"><div class="form-grid"><label>Farbdesign<select name="palette">${Object.entries(palettes).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label>Darstellung<select name="mode">${Object.entries(modes).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label></div><div class="form-actions"><button type="button" class="secondary" data-appearance-cancel>Zurücksetzen</button><button type="submit" class="primary">Darstellung speichern</button></div><p data-appearance-status role="status" aria-live="polite"></p></form>`;
    container.prepend(section);
    const form=section.querySelector('form'),status=section.querySelector('[data-appearance-status]');
    const submit=form.querySelector('[type="submit"]'),cancel=form.querySelector('[data-appearance-cancel]');
    let saved={...selected};
    const sync=()=>{form.elements.palette.value=selected.palette;form.elements.mode.value=selected.mode};
    sync();
    form.onchange=()=>{preview({palette:form.elements.palette.value,mode:form.elements.mode.value});status.textContent='Vorschau – noch nicht gespeichert.'};
    cancel.onclick=()=>{apply(saved);sync();status.textContent='Gespeicherte Darstellung wiederhergestellt.'};
    form.onsubmit=async event=>{
      event.preventDefault();submit.disabled=true;cancel.disabled=true;
      for(const select of form.querySelectorAll('select'))select.disabled=true;
      status.textContent='Darstellung wird gespeichert …';
      try{apply({palette:form.elements.palette.value,mode:form.elements.mode.value});await persist();saved={...selected};status.textContent='Darstellung gespeichert.'}
      catch(error){apply(saved);sync();status.textContent=`Darstellung konnte nicht gespeichert werden: ${error.message||'Bitte erneut versuchen.'}`}
      finally{submit.disabled=false;cancel.disabled=false;for(const select of form.querySelectorAll('select'))select.disabled=false}
    };
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',updateBrowserColor);
  apply(selected);
  return Object.freeze({normalize,apply,mount,get:()=>({...selected})});
})();
