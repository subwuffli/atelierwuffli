import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GetObjectCommand, PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3.823.0";

const cors={"Access-Control-Allow-Origin":"https://subwuffli.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
const allowed={order:"orders",invoice:"invoices",receipt:"receipts",expense:"expenses"} as const;
const r2=new S3Client({region:"auto",endpoint:`https://${Deno.env.get("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,credentials:{accessKeyId:Deno.env.get("R2_ACCESS_KEY_ID")||"",secretAccessKey:Deno.env.get("R2_SECRET_ACCESS_KEY")||""}});
const response=(body:BodyInit|null,status=200,headers={})=>new Response(body,{status,headers:{...cors,...headers}});

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return response(null,204);
  const token=req.headers.get("Authorization")||"",userClient=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_ANON_KEY")||"",{global:{headers:{Authorization:token}}});
  const {data:{user}}=await userClient.auth.getUser();
  if(!user)return response(JSON.stringify({error:"AUTH_REQUIRED"}),401,{"Content-Type":"application/json"});
  const admin=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
  const {data:member}=await admin.from("erp_members").select("user_id").eq("user_id",user.id).eq("active",true).maybeSingle();
  if(!member)return response(JSON.stringify({error:"MEMBER_REQUIRED"}),403,{"Content-Type":"application/json"});

  const url=new URL(req.url),action=url.searchParams.get("action");
  if(action==="download"){
    const id=url.searchParams.get("fileId")||"",{data:file}=await admin.from("file_attachments").select("file_name,content_type,storage_key").eq("id",id).is("deleted_at",null).maybeSingle();
    if(!file)return response(JSON.stringify({error:"NOT_FOUND"}),404,{"Content-Type":"application/json"});
    const object=await r2.send(new GetObjectCommand({Bucket:Deno.env.get("R2_BUCKET"),Key:file.storage_key}));
    return response(await object.Body?.transformToByteArray()||new Uint8Array(),200,{"Content-Type":file.content_type,"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`});
  }

  const form=await req.formData(),entityType=String(form.get("entityType")||""),entityId=String(form.get("entityId")||""),file=form.get("file");
  if(!(entityType in allowed)||!entityId||!(file instanceof File)||file.size>8_000_000||(!file.type.startsWith("image/")&&file.type!=="application/pdf"))return response(JSON.stringify({error:"INVALID_FILE"}),400,{"Content-Type":"application/json"});
  const {data:parent}=await admin.from(allowed[entityType as keyof typeof allowed]).select("id,deleted_at").eq("id",entityId).maybeSingle();
  if(!parent||parent.deleted_at)return response(JSON.stringify({error:"PARENT_NOT_FOUND"}),404,{"Content-Type":"application/json"});
  const source=String(form.get("source")||"upload");if(source!=="upload"&&source!=="generated_pdf")return response(JSON.stringify({error:"INVALID_SOURCE"}),400,{"Content-Type":"application/json"});
  const version=source==="generated_pdf"?(await admin.from("file_attachments").select("id",{count:"exact",head:true}).eq("entity_type",entityType).eq("entity_id",entityId).eq("source",source)).count!+1:null;
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120),key=`test/${entityType}/${entityId}/${crypto.randomUUID()}-${safe}`;
  await r2.send(new PutObjectCommand({Bucket:Deno.env.get("R2_BUCKET"),Key:key,Body:new Uint8Array(await file.arrayBuffer()),ContentType:file.type}));
  const {data:saved,error}=await admin.from("file_attachments").insert({entity_type:entityType,entity_id:entityId,file_name:file.name,content_type:file.type,byte_size:file.size,storage_key:key,source,version,created_by:user.id}).select("id,file_name,created_at,version").single();
  if(error)throw error;
  return response(JSON.stringify(saved),201,{"Content-Type":"application/json"});
});
