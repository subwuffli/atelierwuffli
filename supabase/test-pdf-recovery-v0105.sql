-- Test: Registriert nur eine bereits hochgeladene, deterministisch benannte PDF.
-- Eine vorhandene PDF wird nie ersetzt, weil deren R2-Backup den Edge-Function-Weg braucht.
create or replace function public.recover_generated_pdf_v1(
  p_entity_type text,
  p_entity_id uuid,
  p_document_hash text,
  p_byte_size bigint
)
returns table(id uuid,file_name text,created_at timestamptz,version integer)
language plpgsql security definer set search_path=public as $$
declare
  v_number text;
  v_folder text;
  v_root text:='auftraege';
  v_key text;
  v_version integer;
begin
  if not public.is_erp_member_v1() then raise exception 'ERP_MEMBER_REQUIRED'; end if;
  if p_entity_type not in ('order','invoice','receipt','expense') or p_document_hash !~ '^[a-f0-9]{64}$' or p_byte_size < 0 or p_byte_size > 8000000 then raise exception 'INVALID_RECOVERY_REQUEST'; end if;

  if p_entity_type='order' then
    select number,number into v_number,v_folder from public.orders where id=p_entity_id and deleted_at is null;
  elsif p_entity_type='invoice' then
    select number,coalesce(nullif(order_number,''),number) into v_number,v_folder from public.invoices where id=p_entity_id and deleted_at is null;
  elsif p_entity_type='receipt' then
    select r.number,coalesce(nullif(i.order_number,''),r.invoice_number,r.number) into v_number,v_folder from public.receipts r left join public.invoices i on i.id=r.invoice_id where r.id=p_entity_id and r.deleted_at is null;
  else
    v_root:='ausgaben';
    select number,number into v_number,v_folder from public.expenses where id=p_entity_id and deleted_at is null;
  end if;
  if v_number is null then raise exception 'PARENT_NOT_FOUND'; end if;

  return query select f.id,f.file_name,f.created_at,f.version from public.file_attachments f where f.entity_type=p_entity_type and f.entity_id=p_entity_id and f.source='generated_pdf' and f.document_hash=p_document_hash and f.deleted_at is null;
  if found then return; end if;
  if exists(select 1 from public.file_attachments f where f.entity_type=p_entity_type and f.entity_id=p_entity_id and f.source='generated_pdf' and f.deleted_at is null) then raise exception 'RECOVERY_REQUIRES_FUNCTION'; end if;

  v_number:=left(regexp_replace(v_number,'[^a-zA-Z0-9._-]','_','g'),120);
  v_folder:=left(regexp_replace(v_folder,'[^a-zA-Z0-9._-]','_','g'),120);
  v_key:=format('test/%s/20%s/%s/%s/%s-%s.pdf',v_root,split_part(v_number,'-',2),split_part(v_number,'-',3),v_folder,v_number,p_document_hash);
  select count(*)+1 into v_version from public.file_attachments where entity_type=p_entity_type and entity_id=p_entity_id and source='generated_pdf';
  return query insert into public.file_attachments(entity_type,entity_id,file_name,content_type,byte_size,storage_key,source,version,document_hash,created_by)
    select p_entity_type,p_entity_id,v_number||'.pdf','application/pdf',p_byte_size,v_key,'generated_pdf',v_version,p_document_hash,auth.uid()
    returning file_attachments.id,file_attachments.file_name,file_attachments.created_at,file_attachments.version;
end $$;

revoke all on function public.recover_generated_pdf_v1(text,uuid,text,bigint) from public;
grant execute on function public.recover_generated_pdf_v1(text,uuid,text,bigint) to authenticated;
notify pgrst,'reload schema';
