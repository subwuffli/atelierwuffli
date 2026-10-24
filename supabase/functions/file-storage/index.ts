import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const allowedOrigins=new Set(["https://subwuffli.github.io"]);
const allowedFileTypes=new Set(["application/pdf","image/jpeg","image/png","image/webp"]);
const allowed={order:"orders",invoice:"invoices",receipt:"receipts",expense:"expenses"} as const;
const r2Endpoint=`https://${Deno.env.get("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,r2Bucket=Deno.env.get("R2_BUCKET")||"",r2=new AwsClient({service:"s3",region:"auto",retries:2,accessKeyId:Deno.env.get("R2_ACCESS_KEY_ID")||"",secretAccessKey:Deno.env.get("R2_SECRET_ACCESS_KEY")||""});
const r2Url=(key:string)=>`${r2Endpoint}/${encodeURIComponent(r2Bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
const r2Failure=(status:number)=>Object.assign(new Error(`R2_${status}`),{$metadata:{httpStatusCode:status}});
async function r2Fetch(key:string,init:RequestInit={}){const result=await r2.fetch(r2Url(key),init);if(!result.ok)throw r2Failure(result.status);return result}
const r2Head=(key:string)=>r2Fetch(key,{method:"HEAD"}),r2Get=(key:string,init:RequestInit={})=>r2Fetch(key,{...init,method:"GET"}),r2Put=(key:string,body:BodyInit,contentType:string)=>r2Fetch(key,{method:"PUT",headers:{"Content-Type":contentType},body}),r2Delete=(key:string)=>r2Fetch(key,{method:"DELETE"});
const r2Copy=(key:string,source:string)=>r2Fetch(key,{method:"PUT",headers:{"x-amz-copy-source":`/${r2Bucket}/${source.split("/").map(encodeURIComponent).join("/")}`}});
async function r2SignedUrl(key:string,init:RequestInit={}){const url=new URL(r2Url(key));url.searchParams.set("X-Amz-Expires","120");return (await r2.sign(url.toString(),{...init,aws:{signQuery:true}})).url.toString()}
const storageFailure=(code:string,cause:unknown)=>new Error(code,{cause}),storageFailureCodes=new Set(["BACKUP_MOVE_FAILED","R2_READ_FAILED","R2_WRITE_FAILED","R2_SIGN_FAILED","ATTACHMENT_LOOKUP_FAILED","ATTACHMENT_UPDATE_FAILED"]);
const corsHeaders=(req:Request)=>{const origin=req.headers.get("Origin")||"";return {"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-supabase-api-version","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Vary":"Origin",...(allowedOrigins.has(origin)?{"Access-Control-Allow-Origin":origin}:{})}};
const response=(req:Request,body:BodyInit|null,status=200,headers={})=>new Response(body,{status,headers:{...corsHeaders(req),...headers}});
const adminKey=(()=>{try{const keys=Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}"));return keys.find(key=>typeof key==="string"&&key.startsWith("sb_secret_"))||keys.find(key=>typeof key==="string")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""}catch{return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""}})();
const clean=(value:string)=>value.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120);
const storagePrefix=clean(Deno.env.get("R2_PREFIX")??(Deno.env.get("R2_BUCKET")?.endsWith("-test")?"test":""));
const hasSignature=(bytes:Uint8Array,...signature:number[])=>signature.every((value,index)=>bytes[index]===value);
const isAllowedFile=(file:File,bytes:Uint8Array)=>{if(!allowedFileTypes.has(file.type))return false;return file.type==="application/pdf"?hasSignature(bytes,37,80,68,70,45):file.type==="image/jpeg"?hasSignature(bytes,255,216,255):file.type==="image/png"?hasSignature(bytes,137,80,78,71,13,10,26,10):hasSignature(bytes,82,73,70,70)&&hasSignature(bytes.slice(8),87,69,66,80)};
const isMissingObject=(error:unknown)=>{const result=error as {name?:string;$metadata?:{httpStatusCode?:number}};return result?.$metadata?.httpStatusCode===404||result?.name==="NoSuchKey"||result?.name==="NotFound"};
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
type GeneratedPdfPayload={entityType:keyof typeof allowed;entityId:string;source:"generated_pdf";documentHash:string;byteSize:number};
const generatedPdfPayload=(value:unknown):GeneratedPdfPayload|null=>{const payload=value as Record<string,unknown>;return payload&&payload.source==="generated_pdf"&&typeof payload.entityType==="string"&&payload.entityType in allowed&&typeof payload.entityId==="string"&&typeof payload.documentHash==="string"&&/^[a-f0-9]{64}$/.test(payload.documentHash)&&Number.isInteger(payload.byteSize)&&Number(payload.byteSize)>=5&&Number(payload.byteSize)<=8_000_000?{entityType:payload.entityType as keyof typeof allowed,entityId:payload.entityId,source:"generated_pdf",documentHash:payload.documentHash,byteSize:Number(payload.byteSize)}:null};
async function generatedPdfDetails(payload:GeneratedPdfPayload,admin:ReturnType<typeof createClient>){const {data:parent,error:parentError}=await admin.from(allowed[payload.entityType]).select("id,deleted_at").eq("id",payload.entityId).maybeSingle();if(parentError)throw storageFailure("PARENT_LOOKUP_FAILED",parentError);if(!parent||parent.deleted_at)throw new Error("PARENT_NOT_FOUND");const names=await storageNames(payload.entityType,payload.entityId,admin),parts=names.number.split('-'),year=`20${parts[1]||'00'}`,month=parts[2]||'00',key=`${storagePrefix?`${storagePrefix}/`:""}${names.root}/${year}/${month}/${names.folder}/${names.number}-${payload.documentHash}.pdf`;return {key,fileName:`${names.number}.pdf`}}
async function reconcileGeneratedPdf(payload:GeneratedPdfPayload,admin:ReturnType<typeof createClient>){const {data:existing,error}=await admin.from("file_attachments").select("id,file_name,created_at,version,storage_key,deleted_at").eq("entity_type",payload.entityType).eq("entity_id",payload.entityId).eq("source","generated_pdf").eq("document_hash",payload.documentHash).order("created_at",{ascending:false}).limit(1).maybeSingle();if(error)throw storageFailure("ATTACHMENT_LOOKUP_FAILED",error);if(!existing)return {existing:null,reuseAttachmentId:""};try{await r2Head(existing.storage_key);if(!existing.deleted_at)return {existing,reuseAttachmentId:""};const {data:restored,error:restoreError}=await admin.from("file_attachments").update({deleted_at:null,deleted_by:null,delete_reason:null}).eq("id",existing.id).select("id,file_name,created_at,version").single();if(restoreError)throw storageFailure("ATTACHMENT_UPDATE_FAILED",restoreError);return {existing:restored,reuseAttachmentId:""}}catch(error){if(error instanceof Error&&error.message==="ATTACHMENT_UPDATE_FAILED")throw error;if(!isMissingObject(error))throw storageFailure("R2_READ_FAILED",error);if(!existing.deleted_at){const {error:markError}=await admin.from("file_attachments").update({deleted_at:new Date().toISOString(),delete_reason:"R2-Objekt fehlt"}).eq("id",existing.id);if(markError)throw storageFailure("ATTACHMENT_UPDATE_FAILED",markError)}return {existing:null,reuseAttachmentId:existing.id}}}
async function moveGeneratedPdfsToBackup(entityType:string,entityId:string,admin:ReturnType<typeof createClient>){
  const {data:older,error:olderError}=await admin.from("file_attachments").select("id,storage_key").eq("entity_type",entityType).eq("entity_id",entityId).eq("source","generated_pdf").is("deleted_at",null);
  if(olderError)throw storageFailure("BACKUP_MOVE_FAILED",olderError);
  for(const old of older||[]){
    if(old.storage_key.includes("/Backup/"))continue;
    try{await r2Head(old.storage_key)}catch(error){
      if(!isMissingObject(error))throw new Error("BACKUP_MOVE_FAILED",{cause:error});
      const {error:markError}=await admin.from("file_attachments").update({deleted_at:new Date().toISOString(),delete_reason:"R2-Objekt fehlt"}).eq("id",old.id);
      if(markError)throw new Error("BACKUP_MOVE_FAILED",{cause:markError});
      continue;
    }
    const backupKey=`${old.storage_key.slice(0,old.storage_key.lastIndexOf("/")+1)}Backup/${old.storage_key.slice(old.storage_key.lastIndexOf("/")+1)}`;
    try{
      await r2Copy(backupKey,old.storage_key);
      const {error:moveError}=await admin.from("file_attachments").update({storage_key:backupKey}).eq("id",old.id);
      if(moveError)throw moveError;
      await r2Delete(old.storage_key);
    }catch(error){
      await admin.from("file_attachments").update({storage_key:old.storage_key}).eq("id",old.id);
      throw new Error("BACKUP_MOVE_FAILED",{cause:error});
    }
  }
}
Deno.serve(async req=>{let uploadedKey="",reuseAttachmentId="",action="",userId="",logAdmin:ReturnType<typeof createClient>|null=null;try{
  const origin=req.headers.get("Origin")||"";
  if(req.method==="OPTIONS")return response(req,null,204);
  if(origin&&!allowedOrigins.has(origin))return response(req,JSON.stringify({error:"ORIGIN_NOT_ALLOWED"}),403,{"Content-Type":"application/json"});
  const token=req.headers.get("Authorization")||"",userClient=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_ANON_KEY")||"",{global:{headers:{Authorization:token}}});
  const {data:{user}}=await userClient.auth.getUser();
  if(!user)return response(req,JSON.stringify({error:"AUTH_REQUIRED"}),401,{"Content-Type":"application/json"});userId=user.id;
  const {data:isMember,error:memberError}=await userClient.rpc("is_erp_member_v1");
  if(memberError||!isMember)return response(req,JSON.stringify({error:"ERP_MEMBER_REQUIRED"}),403,{"Content-Type":"application/json"});
  if(!adminKey)return response(req,JSON.stringify({error:"SERVER_KEY_MISSING"}),500,{"Content-Type":"application/json"});
  const admin=createClient(Deno.env.get("SUPABASE_URL")||"",adminKey);logAdmin=admin;

  const url=new URL(req.url);action=url.searchParams.get("action")||"upload";
  if(action==="sign-generated-pdf"||action==="confirm-generated-pdf"){
    const payload=generatedPdfPayload(await req.json().catch(()=>null));
    if(!payload)return response(req,JSON.stringify({error:"INVALID_FILE"}),400,{"Content-Type":"application/json"});
    const details=await generatedPdfDetails(payload,admin),current=await reconcileGeneratedPdf(payload,admin);
    if(current.existing)return response(req,JSON.stringify({...current.existing,existing:true}),200,{"Content-Type":"application/json"});
    if(action==="sign-generated-pdf"){
      let uploadUrl="";try{uploadUrl=await r2SignedUrl(details.key,{method:"PUT",headers:{"Content-Type":"application/pdf"}})}catch(error){throw storageFailure("R2_SIGN_FAILED",error)}
      return response(req,JSON.stringify({uploadUrl,expiresIn:120}),200,{"Content-Type":"application/json"});
    }
    try{const object=await r2Head(details.key),header=await r2Get(details.key,{headers:{Range:"bytes=0-4"}}),bytes=new Uint8Array(await header.arrayBuffer());if(Number(object.headers.get("content-length"))!==payload.byteSize||!String(object.headers.get("content-type")||"").toLowerCase().startsWith("application/pdf")||!hasSignature(bytes,37,80,68,70,45))return response(req,JSON.stringify({error:"INVALID_DIRECT_UPLOAD"}),400,{"Content-Type":"application/json"})}catch(error){throw storageFailure("R2_WRITE_FAILED",error)}
    uploadedKey=details.key;
    await moveGeneratedPdfsToBackup(payload.entityType,payload.entityId,admin);
    const {count,error:countError}=await admin.from("file_attachments").select("id",{count:"exact",head:true}).eq("entity_type",payload.entityType).eq("entity_id",payload.entityId).eq("source","generated_pdf");if(countError)throw storageFailure("ATTACHMENT_LOOKUP_FAILED",countError);
    const attachment={file_name:details.fileName,content_type:"application/pdf",byte_size:payload.byteSize,storage_key:details.key,source:"generated_pdf",version:(count||0)+1,document_hash:payload.documentHash,created_by:user.id},result=current.reuseAttachmentId?await admin.from("file_attachments").update({...attachment,deleted_at:null,deleted_by:null,delete_reason:null}).eq("id",current.reuseAttachmentId).select("id,file_name,created_at,version").single():await admin.from("file_attachments").insert({entity_type:payload.entityType,entity_id:payload.entityId,...attachment}).select("id,file_name,created_at,version").single(),{data:saved,error}=result;
    if(error)throw storageFailure("ATTACHMENT_UPDATE_FAILED",error);
    uploadedKey="";
    return response(req,JSON.stringify(saved),201,{"Content-Type":"application/json"});
  }
  if(action==="download-url"){
    const id=url.searchParams.get("fileId")||"",{data:file,error:fileError}=await admin.from("file_attachments").select("file_name,content_type,storage_key").eq("id",id).is("deleted_at",null).maybeSingle();
    if(fileError)throw storageFailure("ATTACHMENT_LOOKUP_FAILED",fileError);if(!file)return response(req,JSON.stringify({error:"NOT_FOUND"}),404,{"Content-Type":"application/json"});
    try{await r2Head(file.storage_key);const downloadUrl=await r2SignedUrl(file.storage_key);return response(req,JSON.stringify({downloadUrl}),200,{"Content-Type":"application/json"})}catch(error){if(!isMissingObject(error))throw storageFailure("R2_READ_FAILED",error);const {error:markError}=await admin.from("file_attachments").update({deleted_at:new Date().toISOString(),delete_reason:"R2-Objekt fehlt"}).eq("storage_key",file.storage_key).is("deleted_at",null);if(markError)throw storageFailure("ATTACHMENT_UPDATE_FAILED",markError);return response(req,JSON.stringify({error:"MISSING_FILE"}),404,{"Content-Type":"application/json"})}
  }
  if(action==="download"){
    const id=url.searchParams.get("fileId")||"",{data:file}=await admin.from("file_attachments").select("file_name,content_type,storage_key").eq("id",id).is("deleted_at",null).maybeSingle();
    if(!file)return response(req,JSON.stringify({error:"NOT_FOUND"}),404,{"Content-Type":"application/json"});
    try{const object=await r2Get(file.storage_key);return response(req,object.body,200,{"Content-Type":file.content_type,"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`})}catch(error){if(!isMissingObject(error))throw storageFailure("R2_READ_FAILED",error);const {error:markError}=await admin.from("file_attachments").update({deleted_at:new Date().toISOString(),delete_reason:"R2-Objekt fehlt"}).eq("storage_key",file.storage_key).is("deleted_at",null);if(markError)return response(req,JSON.stringify({error:"MISSING_FILE_MARK_FAILED"}),500,{"Content-Type":"application/json"});return response(req,JSON.stringify({error:"MISSING_FILE"}),404,{"Content-Type":"application/json"})}
  }
  if(action==="exists"){
    const id=url.searchParams.get("fileId")||"",{data:file}=await admin.from("file_attachments").select("storage_key").eq("id",id).is("deleted_at",null).maybeSingle();
    if(!file)return response(req,JSON.stringify({error:"NOT_FOUND"}),404,{"Content-Type":"application/json"});
    try{await r2Head(file.storage_key);return response(req,null,204)}catch(error){if(!isMissingObject(error))throw storageFailure("R2_READ_FAILED",error);const {error:markError}=await admin.from("file_attachments").update({deleted_at:new Date().toISOString(),delete_reason:"R2-Objekt fehlt"}).eq("storage_key",file.storage_key).is("deleted_at",null);if(markError)return response(req,JSON.stringify({error:"MISSING_FILE_MARK_FAILED"}),500,{"Content-Type":"application/json"});return response(req,JSON.stringify({error:"MISSING_FILE"}),404,{"Content-Type":"application/json"})}
  }

  const form=await req.formData(),entityType=String(form.get("entityType")||""),entityId=String(form.get("entityId")||""),file=form.get("file");
  if(!(entityType in allowed)||!entityId||!(file instanceof File)||file.size>8_000_000)return response(req,JSON.stringify({error:"INVALID_FILE"}),400,{"Content-Type":"application/json"});
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!isAllowedFile(file,bytes))return response(req,JSON.stringify({error:"INVALID_FILE"}),400,{"Content-Type":"application/json"});
  const {data:parent,error:parentError}=await admin.from(allowed[entityType as keyof typeof allowed]).select("id,deleted_at").eq("id",entityId).maybeSingle();
  if(parentError)return response(req,JSON.stringify({error:"PARENT_LOOKUP_FAILED",detail:parentError.message}),500,{"Content-Type":"application/json"});
  if(!parent||parent.deleted_at)return response(req,JSON.stringify({error:"PARENT_NOT_FOUND"}),404,{"Content-Type":"application/json"});
  const source=String(form.get("source")||"upload"),documentHash=source==="generated_pdf"?String(form.get("documentHash")||""):null;if(source!=="upload"&&source!=="generated_pdf")return response(req,JSON.stringify({error:"INVALID_SOURCE"}),400,{"Content-Type":"application/json"});
  if(source==="generated_pdf"&&!/^[a-f0-9]{64}$/.test(documentHash||""))return response(req,JSON.stringify({error:"INVALID_DOCUMENT_HASH"}),400,{"Content-Type":"application/json"});
  if(documentHash){const {data:existing,error:existingError}=await admin.from("file_attachments").select("id,file_name,created_at,version,storage_key,deleted_at").eq("entity_type",entityType).eq("entity_id",entityId).eq("source",source).eq("document_hash",documentHash).order("created_at",{ascending:false}).limit(1).maybeSingle();if(existingError)throw storageFailure("ATTACHMENT_LOOKUP_FAILED",existingError);if(existing){try{await r2Head(existing.storage_key);if(!existing.deleted_at)return response(req,JSON.stringify({...existing,existing:true}),200,{"Content-Type":"application/json"});const {data:restored,error:restoreError}=await admin.from("file_attachments").update({deleted_at:null,deleted_by:null,delete_reason:null}).eq("id",existing.id).select("id,file_name,created_at,version").single();if(restoreError)throw storageFailure("ATTACHMENT_UPDATE_FAILED",restoreError);return response(req,JSON.stringify({...restored,existing:true}),200,{"Content-Type":"application/json"})}catch(error){if(error instanceof Error&&error.message==="ATTACHMENT_UPDATE_FAILED")throw error;if(!isMissingObject(error))throw storageFailure("R2_READ_FAILED",error);if(!existing.deleted_at){const {error:markError}=await admin.from("file_attachments").update({deleted_at:new Date().toISOString(),delete_reason:"R2-Objekt fehlt"}).eq("id",existing.id);if(markError)throw storageFailure("ATTACHMENT_UPDATE_FAILED",markError)}reuseAttachmentId=existing.id}}}
  const version=source==="generated_pdf"?(await admin.from("file_attachments").select("id",{count:"exact",head:true}).eq("entity_type",entityType).eq("entity_id",entityId).eq("source",source)).count!+1:null;
  const names=await storageNames(entityType as keyof typeof allowed,entityId,admin),safe=clean(file.name),parts=names.number.split('-'),year=`20${parts[1]||'00'}`,month=parts[2]||'00',suffix=entityType==="expense"&&source==="upload"?(safe.match(/\.[^.]+$/)?.[0]||""):(safe.startsWith(`${names.number}.`)?safe.slice(names.number.length):`-${safe}`),storedName=entityType==="expense"&&source==="upload"?`${names.number}${suffix}`:file.name,fileKey=source==="generated_pdf"?`${names.number}-${documentHash}.pdf`:`${names.number}-${crypto.randomUUID()}${suffix}`,key=`${storagePrefix?`${storagePrefix}/`:""}${names.root}/${year}/${month}/${names.folder}/${fileKey}`;
  uploadedKey=key;
  try{await r2Put(key,bytes,file.type)}catch(error){throw storageFailure("R2_WRITE_FAILED",error)}
  if(source==="generated_pdf")await moveGeneratedPdfsToBackup(entityType,entityId,admin);
  const attachment={file_name:storedName,content_type:file.type,byte_size:file.size,storage_key:key,source,version,document_hash:documentHash,created_by:user.id},result=reuseAttachmentId?await admin.from("file_attachments").update({...attachment,deleted_at:null,deleted_by:null,delete_reason:null}).eq("id",reuseAttachmentId).select("id,file_name,created_at,version").single():await admin.from("file_attachments").insert({entity_type:entityType,entity_id:entityId,...attachment}).select("id,file_name,created_at,version").single(),{data:saved,error}=result;
  if(error)throw storageFailure("ATTACHMENT_UPDATE_FAILED",error);
  return response(req,JSON.stringify(saved),201,{"Content-Type":"application/json"});
  }catch(error){
    if(uploadedKey)try{await r2Delete(uploadedKey)}catch(cleanupError){console.error("Neues R2-Objekt konnte nicht bereinigt werden",cleanupError)}
    const code=error instanceof Error&&storageFailureCodes.has(error.message)?error.message:"FILE_STORAGE_FAILED";
    const cause=error instanceof Error?String(error.cause instanceof Error?error.cause.message:error.message).slice(0,500):"unknown";
    if(logAdmin&&userId)try{await logAdmin.from("app_error_log").insert({user_id:userId,app_version:"edge:file-storage",message:"FILE_STORAGE_FAILED",context:{action,code,cause}})}catch(logError){console.error("Storage failure could not be logged",logError)}
    console.error("File storage request failed",{action,code,cause});
    return response(req,JSON.stringify({error:code}),500,{"Content-Type":"application/json"});
  }
});
