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
    console.log(`Browser checks passed: filtered navigation, personal preference save/reload/failure, ${contrast.length} contrast checks, 4 widths, automatic appearance. No external requests sent.`);
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
