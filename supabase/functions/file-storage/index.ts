import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3.823.0";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const allowed={order:"orders",invoice:"invoices",receipt:"receipts",expense:"expenses"} as const;
const r2=new S3Client({region:"auto",endpoint:`https://${Deno.env.get("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,credentials:{accessKeyId:Deno.env.get("R2_ACCESS_KEY_ID")||"",secretAccessKey:Deno.env.get("R2_SECRET_ACCESS_KEY")||""}});
const response=(body:BodyInit|null,status=200,headers={})=>new Response(body,{status,headers:{...cors,...headers}});
const adminKey=(()=>{try{const keys=Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}"));return keys.find(key=>typeof key==="string"&&key.startsWith("sb_secret_"))||keys.find(key=>typeof key==="string")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""}catch{return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""}})();
const clean=(value:string)=>value.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120);
async function storageNames(type:keyof typeof allowed,id:string,admin:ReturnType<typeof createClient>){
  if(type==="expense"){
    const {data}=await admin.from("expenses").select("number").eq("id",id).single();
    return {root:"ausgaben",folder:clean(data?.number||id),number:clean(data?.number||id)};
  }
  const {data:document}=await admin.from(allowed[type]).select(type==="receipt"?"number,invoice_id,invoice_number":type==="invoice"?"number,order_number":"number").eq("id",id).single();
  let folder=document?.number||id;
  if(type==="invoice")folder=document?.order_number||folder;
  if(type==="receipt"){const {data:invoice}=await admin.from("invoices").select("order_number").eq("id",document?.invoice_id||"").maybeSingle();folder=invoice?.order_number||document?.invoice_number||folder}
  return {root:"auftraege",folder:clean(folder),number:clean(document?.number||id)};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return response(null,204);
  const token=req.headers.get("Authorization")||"",userClient=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_ANON_KEY")||"",{global:{headers:{Authorization:token}}});
  const {data:{user}}=await userClient.auth.getUser();
  if(!user)return response(JSON.stringify({error:"AUTH_REQUIRED"}),401,{"Content-Type":"application/json"});
  if(!adminKey)return response(JSON.stringify({error:"SERVER_KEY_MISSING"}),500,{"Content-Type":"application/json"});
  const admin=createClient(Deno.env.get("SUPABASE_URL")||"",adminKey);

  const url=new URL(req.url),action=url.searchParams.get("action");
  if(action==="download"){
    const id=url.searchParams.get("fileId")||"",{data:file}=await admin.from("file_attachments").select("file_name,content_type,storage_key").eq("id",id).is("deleted_at",null).maybeSingle();
    if(!file)return response(JSON.stringify({error:"NOT_FOUND"}),404,{"Content-Type":"application/json"});
    const object=await r2.send(new GetObjectCommand({Bucket:Deno.env.get("R2_BUCKET"),Key:file.storage_key}));
    return response(await object.Body?.transformToByteArray()||new Uint8Array(),200,{"Content-Type":file.content_type,"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`});
  }

  const form=await req.formData(),entityType=String(form.get("entityType")||""),entityId=String(form.get("entityId")||""),file=form.get("file");
  if(!(entityType in allowed)||!entityId||!(file instanceof File)||file.size>8_000_000||(!file.type.startsWith("image/")&&file.type!=="application/pdf"))return response(JSON.stringify({error:"INVALID_FILE"}),400,{"Content-Type":"application/json"});
  const {data:parent,error:parentError}=await admin.from(allowed[entityType as keyof typeof allowed]).select("id,deleted_at").eq("id",entityId).maybeSingle();
  if(parentError)return response(JSON.stringify({error:"PARENT_LOOKUP_FAILED",detail:parentError.message}),500,{"Content-Type":"application/json"});
  if(!parent||parent.deleted_at)return response(JSON.stringify({error:"PARENT_NOT_FOUND"}),404,{"Content-Type":"application/json"});
  const source=String(form.get("source")||"upload"),documentHash=source==="generated_pdf"?String(form.get("documentHash")||""):null;if(source!=="upload"&&source!=="generated_pdf")return response(JSON.stringify({error:"INVALID_SOURCE"}),400,{"Content-Type":"application/json"});
  if(source==="generated_pdf"&&!/^[a-f0-9]{64}$/.test(documentHash||""))return response(JSON.stringify({error:"INVALID_DOCUMENT_HASH"}),400,{"Content-Type":"application/json"});
  if(documentHash){const {data:existing}=await admin.from("file_attachments").select("id,file_name,created_at,version,storage_key").eq("entity_type",entityType).eq("entity_id",entityId).eq("source",source).eq("document_hash",documentHash).is("deleted_at",null).maybeSingle();if(existing){try{await r2.send(new HeadObjectCommand({Bucket:Deno.env.get("R2_BUCKET"),Key:existing.storage_key}));return response(JSON.stringify({...existing,existing:true}),200,{"Content-Type":"application/json"})}catch{await admin.from("file_attachments").update({deleted_at:new Date().toISOString()}).eq("id",existing.id)}}}
  const version=source==="generated_pdf"?(await admin.from("file_attachments").select("id",{count:"exact",head:true}).eq("entity_type",entityType).eq("entity_id",entityId).eq("source",source)).count!+1:null;
  const names=await storageNames(entityType as keyof typeof allowed,entityId,admin),safe=clean(file.name),parts=names.number.split('-'),year=`20${parts[1]||'00'}`,month=parts[2]||'00',suffix=safe.startsWith(`${names.number}.`)?safe.slice(names.number.length):`-${safe}`,key=`test/${names.root}/${year}/${month}/${names.folder}/${names.number}-${crypto.randomUUID()}${suffix}`;
  await r2.send(new PutObjectCommand({Bucket:Deno.env.get("R2_BUCKET"),Key:key,Body:new Uint8Array(await file.arrayBuffer()),ContentType:file.type}));
  const {data:saved,error}=await admin.from("file_attachments").insert({entity_type:entityType,entity_id:entityId,file_name:file.name,content_type:file.type,byte_size:file.size,storage_key:key,source,version,document_hash:documentHash,created_by:user.id}).select("id,file_name,created_at,version").single();
  if(error)throw error;
  return response(JSON.stringify(saved),201,{"Content-Type":"application/json"});
});
