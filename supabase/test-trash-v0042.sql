-- Ausschliesslich zuerst im Testprojekt ausführen.
-- V0.0.42: Papierkorb und abhängigkeitssichere Wiederherstellung.

create or replace function public.get_deleted_records_v1()
returns jsonb language sql stable security invoker set search_path=public as $$
select coalesce(jsonb_agg(row_data order by row_data->>'deletedAt' desc),'[]'::jsonb) from (
  select jsonb_build_object('entityType','customer','id',id,'number',number,'title',trim(concat_ws(' ',nullif(company,''),nullif(first_name,''),nullif(last_name,''))),'deletedAt',deleted_at,'deletedBy',deleted_by,'reason',delete_reason) row_data from customers where deleted_at is not null
  union all select jsonb_build_object('entityType','order','id',id,'number',number,'title',coalesce(customer_snapshot->>'name',''),'deletedAt',deleted_at,'deletedBy',deleted_by,'reason',delete_reason) from orders where deleted_at is not null
  union all select jsonb_build_object('entityType','invoice','id',id,'number',number,'title',coalesce(customer_snapshot->>'name',''),'deletedAt',deleted_at,'deletedBy',deleted_by,'reason',delete_reason) from invoices where deleted_at is not null
  union all select jsonb_build_object('entityType','receipt','id',id,'number',number,'title',coalesce(data#>>'{customerSnapshot,name}',invoice_number),'deletedAt',deleted_at,'deletedBy',deleted_by,'reason',delete_reason) from receipts where deleted_at is not null
  union all select jsonb_build_object('entityType','expense','id',id,'number','Ausgabe','title',description,'amount',amount,'deletedAt',deleted_at,'deletedBy',deleted_by,'reason',delete_reason) from expenses where deleted_at is not null
) deleted;
$$;

create or replace function public.restore_record_v1(p_entity_type text,p_entity_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare affected integer:=0; revision_value bigint; parent_id uuid;
begin
  if auth.uid() is null or not public.is_erp_member_v1() then raise exception 'AUTH_REQUIRED'; end if;
  if p_entity_type='customer' then
    update customers set deleted_at=null,deleted_by=null,delete_reason=null,updated_at=clock_timestamp() where id=p_entity_id and deleted_at is not null;
    get diagnostics affected=row_count;
  elsif p_entity_type='order' then
    select customer_id into parent_id from orders where id=p_entity_id and deleted_at is not null;
    if not exists(select 1 from customers where id=parent_id and deleted_at is null) then raise exception 'RESTORE_CUSTOMER_FIRST'; end if;
    update orders set deleted_at=null,deleted_by=null,delete_reason=null,updated_at=clock_timestamp() where id=p_entity_id and deleted_at is not null;
    get diagnostics affected=row_count;
  elsif p_entity_type='invoice' then
    select order_id into parent_id from invoices where id=p_entity_id and deleted_at is not null;
    if parent_id is not null and not exists(select 1 from orders where id=parent_id and deleted_at is null) then raise exception 'RESTORE_ORDER_FIRST'; end if;
    update invoices set deleted_at=null,deleted_by=null,delete_reason=null,updated_at=clock_timestamp() where id=p_entity_id and deleted_at is not null;
    get diagnostics affected=row_count;
    update receipts set deleted_at=null,deleted_by=null,delete_reason=null where invoice_id=p_entity_id and deleted_at is not null;
  elsif p_entity_type='receipt' then
    select invoice_id into parent_id from receipts where id=p_entity_id and deleted_at is not null;
    if not exists(select 1 from invoices where id=parent_id and deleted_at is null) then raise exception 'RESTORE_INVOICE_FIRST'; end if;
    update receipts set deleted_at=null,deleted_by=null,delete_reason=null where id=p_entity_id and deleted_at is not null;
    get diagnostics affected=row_count;
  elsif p_entity_type='expense' then
    update expenses set deleted_at=null,deleted_by=null,delete_reason=null,updated_at=clock_timestamp() where id=p_entity_id and deleted_at is not null;
    get diagnostics affected=row_count;
  else raise exception 'UNSUPPORTED_ENTITY'; end if;
  if affected<>1 then raise exception 'RECORD_NOT_FOUND_OR_ACTIVE'; end if;
  revision_value:=erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value,'entityType',p_entity_type,'id',p_entity_id,'deleted',false);
end $$;

grant execute on function public.get_deleted_records_v1() to authenticated;
grant execute on function public.restore_record_v1(text,uuid) to authenticated;
revoke all on function public.get_deleted_records_v1() from anon;
notify pgrst, 'reload schema';
