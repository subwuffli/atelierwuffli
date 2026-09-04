const assert=require('node:assert/strict'),fs=require('node:fs'),source=fs.readFileSync('supabase/functions/file-storage/index.ts','utf8'),testHtml=fs.readFileSync('test/index.html','utf8'),liveHtml=fs.readFileSync('index.html','utf8');
const guard='const {data:isMember,error:memberError}=await userClient.rpc("is_erp_member_v1");';
assert(source.includes(guard),'ERP-Mitgliedschaft wird nicht geprüft');
assert(source.indexOf(guard)<source.indexOf('const admin=createClient'),'Service-Zugriff beginnt vor der Mitgliedschaftsprüfung');
assert.doesNotMatch(source,/Access-Control-Allow-Origin":"\*"/,'CORS erlaubt noch jede Herkunft');
assert.match(source,/const allowedOrigins=new Set\(\["https:\/\/subwuffli\.github\.io"\]\)/,'ERP-Herkunft ist nicht festgelegt');
assert.match(source,/ORIGIN_NOT_ALLOWED/,'Fremde Browser-Herkünfte werden nicht abgewiesen');
assert.match(source,/const allowedFileTypes=new Set\(\["application\/pdf","image\/jpeg","image\/png","image\/webp"\]\)/,'Dateitypen sind nicht auf die erlaubte Liste begrenzt');
assert.match(source,/const isAllowedFile=/,'Dateisignatur wird nicht geprüft');
assert.doesNotMatch(source,/startsWith\("image\/"\)/,'Beliebige Bildtypen sind noch erlaubt');
for(const [name,html,supabaseOrigin] of [['Test',testHtml,'https://xiqbveuuhngeosqetfuo.supabase.co'],['Live',liveHtml,'https://johkbmlozygtfjsqfkdu.supabase.co']]){
  assert.match(html,/Content-Security-Policy/,`${name}-CSP fehlt`);
  for(const origin of [supabaseOrigin,'https://openplzapi.org','https://nominatim.openstreetmap.org','https://router.project-osrm.org'])assert(html.includes(origin),`${name}-CSP blockiert ${origin}`);
  assert.match(html,/object-src 'none'/,`${name}-CSP sperrt Plugin-Inhalte nicht`);
}
console.log('Dateizugriff, CORS und CSP sind abgesichert.');
