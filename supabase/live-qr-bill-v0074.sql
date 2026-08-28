-- LIVE V0.0.84.0: Schweizer QR-Rechnung. QR-Zahlungsdaten werden beim Erstellen einer Rechnung unveränderlich gespeichert.
-- QR-Zahlungsdaten werden beim Erstellen einer Rechnung unveränderlich gespeichert.

alter table public.company_settings add column if not exists qr_building_number text not null default '';
alter table public.invoices add column if not exists qr_data jsonb not null default '{}'::jsonb;

create or replace function public.qr_scor_reference_v1(p_number text)
returns text language plpgsql immutable strict set search_path=public as $$
declare clean text:=upper(regexp_replace(p_number,'[^A-Z0-9]','','g')); digits text:=''; ch text; remainder integer:=0; i integer;
begin
  if length(clean)<1 or length(clean)>21 then raise exception 'QR_REFERENCE_INPUT_INVALID'; end if;
  for i in 1..length(clean) loop
    ch:=substr(clean,i,1);
    digits:=digits||case when ch between 'A' and 'Z' then (ascii(ch)-55)::text else ch end;
  end loop;
  digits:=digits||'271500';
  for i in 1..length(digits) loop remainder:=(remainder*10+substr(digits,i,1)::integer)%97; end loop;
  return 'RF'||lpad((98-remainder)::text,2,'0')||clean;
end $$;

create or replace function public.qr_reference_v1(p_number text)
returns text language plpgsql immutable strict set search_path=public as $$
declare digits text:=lpad(regexp_replace(p_number,'[^0-9]','','g'),26,'0'); carry integer:=0; i integer; check_digit integer; mapping integer[]:=array[0,9,4,6,8,2,7,1,3,5];
begin
  for i in 1..26 loop carry:=mapping[((carry+substr(digits,i,1)::integer)%10)+1]; end loop;
  check_digit:=(10-carry)%10;
  return digits||check_digit::text;
end $$;

create or replace function public.qr_iban_valid_v1(p_account text)
returns boolean language plpgsql immutable strict set search_path=public as $$
declare account text:=upper(regexp_replace(p_account,'[[:space:]]','','g')); value text; digits text:=''; remainder integer:=0; i integer; ch text;
begin
  if account !~ '^(CH|LI)[0-9]{19}$' then return false; end if;
  value:=substr(account,5)||substr(account,1,4);
  for i in 1..length(value) loop ch:=substr(value,i,1);digits:=digits||case when ch between 'A' and 'Z' then (ascii(ch)-55)::text else ch end; end loop;
  for i in 1..length(digits) loop remainder:=(remainder*10+substr(digits,i,1)::integer)%97; end loop;
  return remainder=1;
end $$;

create or replace function public.qr_bill_data_v1(p_number text)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare s public.company_settings%rowtype; account text; name_value text; postal text[]; iid integer;
begin
  select * into s from company_settings where id='main';
  account:=upper(regexp_replace(coalesce(s.iban,''),'[[:space:]]','','g'));
  name_value:=coalesce(nullif(s.company_name,''),nullif(s.first_name,''),nullif(s.name,''));
  postal:=regexp_match(coalesce(s.postal_city,''),'^[[:space:]]*([^[:space:]]+)[[:space:]]+(.+?)[[:space:]]*$');
  if not qr_iban_valid_v1(account) or name_value is null or nullif(s.street,'') is null or nullif(s.qr_building_number,'') is null or postal is null then return '{}'::jsonb; end if;
  iid:=nullif(substr(account,5,5),'')::integer;
  return jsonb_build_object('account',account,'creditor',jsonb_build_object('name',name_value,'address',s.street,'buildingNumber',s.qr_building_number,'zip',postal[1],'city',postal[2],'country','CH'),'reference',case when iid between 30000 and 31999 then qr_reference_v1(p_number) else qr_scor_reference_v1(p_number) end,'message','Rechnung '||p_number);
end $$;

create or replace function public.save_invoice_v1(p_invoice jsonb,p_expected_updated_at timestamptz default null,p_session_token uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_entity_id uuid:=coalesce(nullif(p_invoice->>'id','')::uuid,gen_random_uuid());
  entity_number text; current_stamp timestamptz; saved_stamp timestamptz; revision_value bigint;
  item jsonb; item_index integer:=0; receipt_data jsonb; receipt_id uuid; receipt_number text; exists_already boolean:=false;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select number,updated_at into entity_number,current_stamp from invoices where id=v_entity_id for update; exists_already:=found;
  if exists_already then
    if p_session_token is not null and not exists(select 1 from edit_locks l where l.entity_type='invoice' and l.entity_id=v_entity_id and l.user_id=auth.uid() and l.session_token=p_session_token and l.expires_at>now()) then raise exception 'EDIT_LOCK_LOST'; end if;
    if p_expected_updated_at is null or current_stamp<>p_expected_updated_at then raise exception 'INVOICE_CONFLICT'; end if;
    update invoices set invoice_date=(p_invoice->>'date')::date,due_date=(p_invoice->>'dueDate')::date,order_id=nullif(p_invoice->>'orderId','')::uuid,order_number=coalesce(p_invoice->>'orderNumber',''),customer_id=(p_invoice->>'customerId')::uuid,status=p_invoice->>'status',paid_date=nullif(p_invoice->>'paidDate','')::date,payment_method=coalesce(p_invoice->>'paymentMethod',''),text=coalesce(p_invoice->>'text',''),total=coalesce((p_invoice->>'total')::numeric,0),customer_snapshot=coalesce(p_invoice->'customerSnapshot','{}'::jsonb),archived=coalesce((p_invoice->>'archived')::boolean,false),qr_data=case when qr_data='{}'::jsonb then qr_bill_data_v1(entity_number) else qr_data end,updated_at=clock_timestamp() where id=v_entity_id returning updated_at into saved_stamp;
  else
    entity_number:=next_document_number('RE',(p_invoice->>'date')::date);
    insert into invoices(id,number,invoice_date,due_date,order_id,order_number,customer_id,status,paid_date,payment_method,text,total,customer_snapshot,archived,qr_data,created_at,updated_at)
    values(v_entity_id,entity_number,(p_invoice->>'date')::date,(p_invoice->>'dueDate')::date,nullif(p_invoice->>'orderId','')::uuid,coalesce(p_invoice->>'orderNumber',''),(p_invoice->>'customerId')::uuid,p_invoice->>'status',nullif(p_invoice->>'paidDate','')::date,coalesce(p_invoice->>'paymentMethod',''),coalesce(p_invoice->>'text',''),coalesce((p_invoice->>'total')::numeric,0),coalesce(p_invoice->'customerSnapshot','{}'::jsonb),false,qr_bill_data_v1(entity_number),clock_timestamp(),clock_timestamp()) returning updated_at into saved_stamp;
  end if;
  delete from invoice_items where invoice_id=v_entity_id;
  for item in select value from jsonb_array_elements(coalesce(p_invoice->'items','[]'::jsonb)) loop
    insert into invoice_items(id,invoice_id,description,quantity,price,total,sort_order) values(coalesce(nullif(item->>'id','')::uuid,gen_random_uuid()),v_entity_id,coalesce(item->>'description',''),coalesce((item->>'quantity')::numeric,0),coalesce((item->>'price')::numeric,0),coalesce((item->>'total')::numeric,0),item_index);
    item_index:=item_index+1;
  end loop;
  receipt_data:=p_invoice->'receipt';
  if receipt_data is not null and jsonb_typeof(receipt_data)='object' then
    select id,number into receipt_id,receipt_number from receipts where invoice_id=v_entity_id;
    receipt_id:=coalesce(receipt_id,nullif(receipt_data->>'id','')::uuid,gen_random_uuid());
    receipt_number:=coalesce(receipt_number,nullif(receipt_data->>'number',''),next_document_number('QU',coalesce(nullif(receipt_data->>'date','')::date,(p_invoice->>'date')::date)));
    insert into receipts(id,number,receipt_date,invoice_id,invoice_number,data,created_at)
    values(receipt_id,receipt_number,coalesce(nullif(receipt_data->>'date','')::date,(p_invoice->>'date')::date),v_entity_id,entity_number,(receipt_data-'id'-'number'-'date'-'invoiceId'-'invoiceNumber'-'createdAt')||jsonb_build_object('invoiceNumber',entity_number),coalesce(nullif(receipt_data->>'createdAt','')::timestamptz,clock_timestamp()))
    on conflict(invoice_id) do update set receipt_date=excluded.receipt_date,invoice_number=excluded.invoice_number,data=excluded.data;
  end if;
  revision_value:=erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value,'id',v_entity_id,'number',entity_number,'updatedAt',saved_stamp,'receiptNumber',receipt_number);
end $$;

create or replace function public.save_settings_v1(p_settings jsonb,p_session_token uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare revision_value bigint; saved_stamp timestamptz; lock_id constant uuid:='00000000-0000-0000-0000-000000000001';
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from edit_locks where entity_type='settings' and entity_id=lock_id and user_id=auth.uid() and session_token=p_session_token and expires_at>now()) then raise exception 'EDIT_LOCK_LOST'; end if;
  update company_settings set name=coalesce(p_settings->>'name',''),address=coalesce(p_settings->>'address',''),iban=coalesce(p_settings->>'iban',''),first_name=coalesce(p_settings->>'firstName',''),company_name=coalesce(p_settings->>'companyName',''),street=coalesce(p_settings->>'street',''),postal_city=coalesce(p_settings->>'postalCity',''),bank_name=coalesce(p_settings->>'bankName',''),bank_address=coalesce(p_settings->>'bankAddress',''),qr_building_number=coalesce(p_settings->>'qrBuildingNumber',''),mwst_number=coalesce(p_settings->>'mwstNumber',''),payment_days=coalesce((p_settings->>'paymentDays')::integer,30),logo=coalesce(p_settings->>'logo',''),order_text=coalesce(p_settings->>'orderText',''),invoice_text=coalesce(p_settings->>'invoiceText',''),position_templates=coalesce(p_settings->'positionTemplates','[]'::jsonb),updated_at=clock_timestamp() where id='main' returning updated_at into saved_stamp;
  update invoices set qr_data=qr_bill_data_v1(number),updated_at=clock_timestamp() where qr_data='{}'::jsonb and qr_bill_data_v1(number)<>'{}'::jsonb;
  revision_value:=erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value,'updatedAt',saved_stamp);
end $$;

alter function public.export_erp_backup() rename to export_erp_backup_v0074;
create function public.export_erp_backup()
returns jsonb language sql security invoker set search_path=public as $$
with data as (select public.export_erp_backup_v0074() as payload)
select jsonb_set(
  jsonb_set(payload,'{settings,qrBuildingNumber}',to_jsonb((select qr_building_number from public.company_settings where id='main')),true),
  '{invoices}',
  coalesce((
    select jsonb_agg(entry.value||jsonb_build_object('qrData',coalesce(i.qr_data,'{}'::jsonb)) order by entry.ordinality)
    from jsonb_array_elements(coalesce(payload->'invoices','[]'::jsonb)) with ordinality as entry(value,ordinality)
    left join public.invoices i on i.id=(entry.value->>'id')::uuid
  ),'[]'::jsonb),
  true
)
from data;
$$;
grant execute on function public.qr_scor_reference_v1(text),public.qr_reference_v1(text),public.qr_iban_valid_v1(text),public.qr_bill_data_v1(text),public.save_invoice_v1(jsonb,timestamptz,uuid),public.save_settings_v1(jsonb,uuid),public.export_erp_backup() to authenticated;
revoke all on function public.qr_scor_reference_v1(text),public.qr_reference_v1(text),public.qr_iban_valid_v1(text),public.qr_bill_data_v1(text) from anon;
notify pgrst, 'reload schema';

