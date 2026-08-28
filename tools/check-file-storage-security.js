const assert=require('node:assert/strict'),fs=require('node:fs'),source=fs.readFileSync('supabase/functions/file-storage/index.ts','utf8');
const guard='const {data:isMember,error:memberError}=await userClient.rpc("is_erp_member_v1");';
assert(source.includes(guard),'ERP-Mitgliedschaft wird nicht geprüft');
assert(source.indexOf(guard)<source.indexOf('const admin=createClient'),'Service-Zugriff beginnt vor der Mitgliedschaftsprüfung');
console.log('Datei-Zugriff prüft ERP-Mitgliedschaft');
