const assert=require('node:assert/strict'),fs=require('node:fs');
async function check(file){
  const source=fs.readFileSync(file,'utf8'),match=source.match(/async function appendQrBill\(doc,invoice,onCurrentPage=false\)\{[^\n]+\}/);
  assert(match,`${file}: appendQrBill fehlt`);
  assert(source.includes('let y=invoiceCompact?120:142'),`${file}: Rechnung ist nicht verdichtet`);
  assert(source.includes('else if(!isInv){doc.setFont'), `${file}: Rechnungsfuss wird nicht übersprungen`);
  assert(source.includes("['Auftragsnummer:',d.orderNumber||'–']"),`${file}: Auftragsnummer fehlt im Rechnungs-PDF`);
  assert(source.includes('for(let attempt=0;attempt<3;attempt++)'),`${file}: PDF-Upload wird nicht wiederholt`);
  assert(source.includes("doc.text('Vielen Dank!',65,y-7,{align:'center'})"),`${file}: Vielen-Dank-Schriftzug fehlt`);
  const appendQrBill=new Function('qrBillPng',`${match[0]};return appendQrBill`)(async()=> 'png'),doc={pages:0,images:[],addPage(){this.pages++},addImage(...args){this.images.push(args)}};
  await appendQrBill(doc,{},true);assert.equal(doc.pages,0);assert.equal(doc.images[0][2],0);assert.equal(doc.images[0][3],192);await appendQrBill(doc,{},false);assert.equal(doc.pages,1);assert.equal(doc.images[1][3],0);
}
(async()=>{for(const file of ['app.js','test/app.js'])await check(file);console.log('QR layout OK')})().catch(error=>{console.error(error);process.exit(1)});
