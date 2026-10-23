-- Test: Registriert nur eine bereits hochgeladene, deterministisch benannte PDF.
-- Bei einem Edge-Ausfall bleibt die alte R2-Datei erhalten; nur ihr Datensatz wird ausgeblendet.
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
    select o.number,o.number into v_number,v_folder from public.orders o where o.id=p_entity_id and o.deleted_at is null;
  elsif p_entity_type='invoice' then
    select i.number,coalesce(nullif(i.order_number,''),i.number) into v_number,v_folder from public.invoices i where i.id=p_entity_id and i.deleted_at is null;
  elsif p_entity_type='receipt' then
    select r.number,coalesce(nullif(i.order_number,''),r.invoice_number,r.number) into v_number,v_folder from public.receipts r left join public.invoices i on i.id=r.invoice_id where r.id=p_entity_id and r.deleted_at is null;
  else
    v_root:='ausgaben';
    select e.number,e.number into v_number,v_folder from public.expenses e where e.id=p_entity_id and e.deleted_at is null;
  end if;
  if v_number is null then raise exception 'PARENT_NOT_FOUND'; end if;

  return query select f.id,f.file_name,f.created_at,f.version from public.file_attachments f where f.entity_type=p_entity_type and f.entity_id=p_entity_id and f.source='generated_pdf' and f.document_hash=p_document_hash and f.deleted_at is null;
  if found then return; end if;
  update public.file_attachments f set deleted_at=clock_timestamp(),deleted_by=auth.uid(),delete_reason='Automatische PDF-Wiederherstellung während Speicherstörung'
    where f.entity_type=p_entity_type and f.entity_id=p_entity_id and f.source='generated_pdf' and f.deleted_at is null;

  v_number:=left(regexp_replace(v_number,'[^a-zA-Z0-9._-]','_','g'),120);
  v_folder:=left(regexp_replace(v_folder,'[^a-zA-Z0-9._-]','_','g'),120);
  v_key:=format('test/%s/20%s/%s/%s/%s-%s.pdf',v_root,split_part(v_number,'-',2),split_part(v_number,'-',3),v_folder,v_number,p_document_hash);
  select count(*)+1 into v_version from public.file_attachments where entity_type=p_entity_type and entity_id=p_entity_id and source='generated_pdf';
  return query update public.file_attachments f set file_name=v_number||'.pdf',content_type='application/pdf',byte_size=p_byte_size,version=v_version,document_hash=p_document_hash,created_by=auth.uid(),deleted_at=null,deleted_by=null,delete_reason=null
    where f.storage_key=v_key and f.entity_type=p_entity_type and f.entity_id=p_entity_id and f.source='generated_pdf' and f.deleted_at is not null
    returning f.id,f.file_name,f.created_at,f.version;
  if found then return; end if;
  if exists(select 1 from public.file_attachments f where f.storage_key=v_key) then raise exception 'STORAGE_KEY_COLLISION'; end if;
  return query insert into public.file_attachments(entity_type,entity_id,file_name,content_type,byte_size,storage_key,source,version,document_hash,created_by)
    select p_entity_type,p_entity_id,v_number||'.pdf','application/pdf',p_byte_size,v_key,'generated_pdf',v_version,p_document_hash,auth.uid()
    returning file_attachments.id,file_attachments.file_name,file_attachments.created_at,file_attachments.version;
end $$;

revoke all on function public.recover_generated_pdf_v1(text,uuid,text,bigint) from public;
grant execute on function public.recover_generated_pdf_v1(text,uuid,text,bigint) to authenticated;
notify pgrst,'reload schema';
