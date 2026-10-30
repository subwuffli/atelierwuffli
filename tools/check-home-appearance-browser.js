// Offline browser check: every request is intercepted; no ERP database is contacted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const output=process.env.ERP_SCREENSHOT_DIR;
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100},colorScheme:'light',reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.savedPreferences={};window.preferenceWrites=[];
      window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'test-user'}}})},from:()=>({upsert:async value=>{if(window.failPreferenceSave)return {error:{message:'Offline'}};window.preferenceWrites.push(value);window.savedPreferences=value.preferences;return {error:null}},select:()=>({eq:()=>({maybeSingle:async()=>({data:{preferences:window.savedPreferences},error:null})})})})})};
    });
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='localhost')return route.fulfill({status:200,body:'',contentType:'application/javascript'});
      const relative=decodeURIComponent(url.pathname).replace(/^\/test\/?/,'')||'index.html';
      const file=path.resolve('test',relative);
      if(!file.startsWith(path.resolve('test')+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      let body=fs.readFileSync(file);
      if(relative==='app.js')body=body.toString().replace(/^init\(\)\.catch[^\n]+$/m,'');
      await route.fulfill({status:200,body,contentType:relative.endsWith('.js')?'application/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.html')?'text/html':'image/jpeg'});
    });
    await page.goto('http://localhost/test/');
    assert.deepEqual(errors,[],'Page initialization failed');
    await page.evaluate(()=>{
      state=blankState();preferencesUserId='test-user';
      const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      state.orders=[{id:'order-a',number:'AU-1',date:day,fulfilment:'Abholung',fulfilmentDate:day,customerSnapshot:{name:'Familie Meier'},status:'In Arbeit',total:620,items:[]},{id:'order-b',number:'AU-2',date:day,fulfilment:'Lieferung',fulfilmentDate:day,customerSnapshot:{name:'Frau Keller'},status:'In Arbeit',total:180,items:[]},{id:'order-c',number:'AU-3',date:day,status:'Abgeschlossen',customerSnapshot:{name:'Herr Baumann'},total:390,items:[]}];
      state.invoices=[{id:'invoice-a',number:'RE-1',status:'Offen',dueDate:'2020-01-01',total:840,customerSnapshot:{name:'Meier'}},{id:'invoice-b',number:'RE-2',status:'Bezahlt',total:180,customerSnapshot:{name:'Keller'}}];
      acquireEditLock=async()=>true;loadFromSupabase=async()=>state;releaseCurrentEditLock=async()=>{};
      bindGlobal();document.querySelector('#lock-screen').classList.add('hidden');document.querySelector('#app').classList.remove('hidden');render('dashboard');
    });
    await page.getByRole('heading',{name:'Heute im Atelier'}).waitFor();
    assert.equal(await page.locator('.home-appointment').count(),2);
    await page.locator('.home-metric').first().click();
    assert.equal(await page.locator('#order-status-filter').inputValue(),'working');assert.equal(await page.locator('#order-table tbody tr').count(),2);
    await page.evaluate(()=>render('dashboard'));await page.locator('.home-attention button').click();
    assert.equal(await page.locator('#invoice-status-filter').inputValue(),'overdue');assert.equal(await page.locator('#invoice-table tbody tr').count(),1);
    // Returning from details must retain the actual origin and list controls.
    await page.evaluate(()=>render('dashboard'));
    const homeOrderId=await page.locator('.home-order').first().getAttribute('data-home-order');
    await page.locator('.home-order').first().click();await page.locator('.detail-toolbar>button').first().click();
    await page.waitForFunction(id=>currentView==='dashboard'&&document.activeElement.dataset.homeOrder===id,homeOrderId);
    await page.evaluate(()=>erpHome.openList('orders','working'));
    await page.locator('#order-sort').selectOption('number-asc');
    const returnedOrderId=await page.locator('#order-table tbody tr').first().getAttribute('data-record-id');
    await page.locator('#order-table tbody tr').first().click();await page.locator('.detail-toolbar>button').first().click();
    await page.waitForFunction(id=>document.activeElement.dataset.recordId===id,returnedOrderId);
    assert.equal(await page.locator('#order-status-filter').inputValue(),'working');assert.equal(await page.locator('#order-sort').inputValue(),'number-asc');assert.equal(await page.locator('#order-table tbody tr').count(),2);
    const returnContrast=await page.evaluate(()=>{
      function lum(value){const c=value.match(/[\d.]+/g).slice(0,3).map(x=>+x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]}
      const ratios=[];const row=document.querySelector('#order-table tbody tr');row.classList.add('document-return-focus');
      for(const palette of ['atelier','salbei','marine','neutral'])for(const mode of ['light','dark']){erpAppearance.apply({palette,mode});const style=getComputedStyle(row.querySelector('td')),a=lum(style.color),b=lum(style.backgroundColor);ratios.push((Math.max(a,b)+.05)/(Math.min(a,b)+.05))}erpAppearance.apply();return ratios;
    });
    for(const ratio of returnContrast)assert.ok(ratio>=4.5,`Return highlight contrast ${ratio}`);
    await page.evaluate(()=>{state.invoices[0].orderId='order-a';state.invoices[0].orderNumber='AU-1';render('dashboard')});
    await page.locator('.home-order[data-home-order="order-a"]').click();
    await page.locator('.document-tabs').getByRole('tab',{name:'Rechnung',exact:true}).click();
    assert.equal(await page.locator('#page-title').innerText(),'Rechnung RE-1');
    await page.locator('.detail-toolbar>button').first().click();assert.equal(await page.locator('#page-title').innerText(),'Auftrag AU-1');
    await page.locator('.detail-toolbar>button').first().click();await page.getByRole('heading',{name:'Heute im Atelier'}).waitFor();
    await page.evaluate(()=>{window.originalTestOrders=state.orders;state.orders=[...state.orders,...Array.from({length:25},(_,index)=>({...state.orders[0],id:`scroll-${index}`,number:`AU-${100+index}`,status:'Abgeschlossen'}))];render('orders')});
    await page.locator('#order-table tbody tr').last().scrollIntoViewIfNeeded();
    const previousScroll=await page.evaluate(()=>scrollY);assert.ok(previousScroll>100);
    await page.locator('#order-table tbody tr').last().click();await page.locator('.detail-toolbar>button').first().click();
    await page.waitForFunction(y=>Math.abs(scrollY-y)<2,previousScroll);
    await page.evaluate(()=>{state.orders=window.originalTestOrders;render('dashboard')});
    // The mobile overlay owns focus, closes with Escape, and releases the background.
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>render('dashboard'));
    await page.locator('#menu-button').click();
    if(output)await page.screenshot({path:path.join(output,'erp-menu-v0128.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.sidebar')),true);
    assert.equal(await page.locator('main').evaluate(el=>el.inert),true);
    await page.locator('#lock-button').focus();await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sidebar-close');
    await page.keyboard.press('Escape');assert.equal(await page.locator('#menu-button').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('main').evaluate(el=>el.inert),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'menu-button');
    assert.equal(await page.locator('#nav .nav-group').count(),4);assert.equal(await page.locator('#nav [data-view]').count(),13);assert.equal(await page.locator('#quick-export').count(),0);
    // Actual customer forms: unmodified close, dirty Escape/cancel, and successful save bypass.
    await page.evaluate(()=>customerForm());await page.locator('#customer-form').waitFor();
    assert.equal(await page.locator('#modal').getAttribute('aria-labelledby'),'modal-title');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#modal').open);
    await page.evaluate(()=>customerForm());await page.locator('#customer-form [name="firstName"]').fill('Audit Test');
    await page.keyboard.press('Escape');await page.getByRole('alertdialog',{name:'Änderungen verwerfen?'}).waitFor();
    if(output)await page.screenshot({path:path.join(output,'erp-discard-v0128.png'),fullPage:true});
    await page.getByRole('button',{name:'Änderungen verwerfen',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Weiter bearbeiten',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.getByRole('button',{name:'Weiter bearbeiten',exact:true}).click();assert.equal(await page.locator('#customer-form [name="firstName"]').inputValue(),'Audit Test');
    await page.locator('#customer-form [name="firstName"]').fill('');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#modal').open);
    await page.evaluate(()=>customerForm());await page.locator('#customer-form [name="firstName"]').fill('Noch nicht speichern');
    await page.locator('#modal [aria-label="Schliessen"]').click();await page.getByRole('button',{name:'Änderungen verwerfen',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
    await page.evaluate(()=>customerForm());await page.locator('#customer-form [name="firstName"]').fill('Saved Test');
    await page.evaluate(()=>{saveCustomerRecord=async candidate=>({...candidate,number:'KD-TEST'})});
    await page.locator('#customer-form button.primary').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
    assert.equal(await page.locator('.discard-confirm').count(),0);
    await page.evaluate(()=>customerForm());await page.locator('#customer-form [name="firstName"]').fill('Speichertest');
    await page.evaluate(()=>{saveCustomerRecord=candidate=>new Promise(resolve=>{window.completeTestSave=()=>resolve({...candidate,number:'KD-BUSY'})})});
    await page.locator('#customer-form button.primary').click();await page.keyboard.press('Escape');
    assert.equal(await page.locator('#modal').evaluate(el=>el.open),true);assert.equal(await page.locator('.discard-confirm').count(),0);
    await page.evaluate(()=>completeTestSave());await page.waitForFunction(()=>!document.querySelector('#modal').open);
    assert.equal(await page.locator('#notice').getAttribute('role'),'status');
    await page.evaluate(()=>{window.testUndoCount=0;undoNotice('Testeintrag gelöscht.',async()=>{window.testUndoCount++})});
    await page.clock.install();await page.clock.fastForward(11000);assert.equal(await page.locator('#undo-action').isVisible(),true);
    await page.locator('#undo-action').click();assert.equal(await page.evaluate(()=>testUndoCount),1);await page.clock.resume();
    await page.evaluate(()=>{window.stopTestWorking=showWorking('Laden wird geprüft')});assert.equal(await page.locator('.working-overlay').getAttribute('role'),'status');assert.equal(await page.locator('.working-overlay span').evaluate(el=>getComputedStyle(el).animationName),'none');await page.evaluate(()=>stopTestWorking());
    await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>{window.stopTestWorking=showWorking('Laden wird geprüft')});assert.equal(await page.locator('.working-overlay span').evaluate(el=>getComputedStyle(el).animationName),'working-spin');await page.evaluate(()=>stopTestWorking());await page.emulateMedia({reducedMotion:'reduce'});
    await page.setViewportSize({width:1440,height:1100});
    await page.evaluate(()=>render('settings'));await page.locator('#appearance-form').waitFor();
    await page.locator('#appearance-form [name="palette"]').selectOption('marine');await page.locator('#appearance-form [name="mode"]').selectOption('dark');
    assert.equal(await page.evaluate(()=>erpAppearance.get().palette),'atelier');
    await page.getByRole('button',{name:'Darstellung speichern',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Darstellung gespeichert.'}).waitFor();
    assert.equal(await page.evaluate(()=>savedPreferences.appearance.palette),'marine');
    await page.evaluate(()=>loadUserPreferences());assert.equal(await page.evaluate(()=>document.documentElement.dataset.appearance),'dark');
    await page.evaluate(()=>{window.failPreferenceSave=true});await page.locator('#appearance-form [name="palette"]').selectOption('neutral');await page.getByRole('button',{name:'Darstellung speichern',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Offline'}).waitFor();assert.equal(await page.evaluate(()=>erpAppearance.get().palette),'marine');
    await page.evaluate(()=>render('dashboard'));
    const contrast=await page.evaluate(()=>{
      function luminance(rgb){const c=rgb.match(/[\d.]+/g).slice(0,3).map(x=>+x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]}
      const samples=[];
      for(const palette of ['atelier','salbei','marine','neutral'])for(const mode of ['light','dark']){
        erpAppearance.apply({palette,mode});
        for(const selector of ['.home-heading>.primary','.home-metric','.home-appointments','.home-attention']){
          const element=document.querySelector(selector),style=getComputedStyle(element),a=luminance(style.color),b=luminance(style.backgroundColor);
          samples.push({palette,mode,selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
        }
      }
      return samples;
    });
    for(const sample of contrast)assert.ok(sample.ratio>=4.5,JSON.stringify(sample));
    for(const width of [1440,768,390,320]){
      await page.setViewportSize({width,height:1100});
      await page.evaluate(()=>{erpAppearance.apply({palette:'marine',mode:'dark'});render('dashboard')});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);assert.equal(overflow,false,`Overflow at ${width}px`);
      if(output&&(width===1440||width===390))await page.screenshot({path:path.join(output,`erp-home-${width}.png`),fullPage:true});
      await page.evaluate(()=>render('settings'));await page.locator('#appearance-form').waitFor();
      await page.evaluate(()=>window.scrollTo(0,0));
      const settingsOverflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,class:el.className,text:el.textContent.slice(0,65)})).slice(0,8));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,`Settings overflow at ${width}px: ${JSON.stringify(settingsOverflow)}`);
    }
    await page.emulateMedia({colorScheme:'light'});await page.evaluate(()=>erpAppearance.apply({palette:'salbei',mode:'auto'}));
    const light=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);
    await page.emulateMedia({colorScheme:'dark'});const dark=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);assert.notEqual(light,dark);
    assert.deepEqual(errors,[]);
    console.log(`Browser checks passed: return origin/filter/sort/focus, mobile menu keyboard/Escape, form discard guard and successful save, accessible notices and persistent undo, reduced motion, personal preferences, ${contrast.length+returnContrast.length} contrast checks, 4 widths and automatic appearance. No external requests sent.`);
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
