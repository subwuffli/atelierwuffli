-- Ausschliesslich zuerst im Testprojekt ausführen.
-- V0.0.38: Revisionssichere Löschung und unveränderbares Audit-Log.

alter table public.customers add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid, add column if not exists delete_reason text;
alter table public.orders add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid, add column if not exists delete_reason text;
alter table public.invoices add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid, add column if not exists delete_reason text;
alter table public.receipts add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid, add column if not exists delete_reason text;
alter table public.expenses add column if not exists deleted_at timestamptz, add column if not exists deleted_by uuid, add column if not exists delete_reason text;

create index if not exists customers_deleted_at_idx on public.customers(deleted_at);
create index if not exists orders_deleted_at_idx on public.orders(deleted_at);
create index if not exists invoices_deleted_at_idx on public.invoices(deleted_at);
create index if not exists receipts_deleted_at_idx on public.receipts(deleted_at);
create index if not exists expenses_deleted_at_idx on public.expenses(deleted_at);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null check(action in ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default clock_timestamp()
);
create index if not exists audit_log_changed_at_idx on public.audit_log(changed_at desc);
create index if not exists audit_log_entity_idx on public.audit_log(entity_type,entity_id,changed_at desc);

alter table public.audit_log enable row level security;
drop policy if exists audit_log_authenticated_read on public.audit_log;
create policy audit_log_authenticated_read on public.audit_log for select to authenticated using(true);
revoke insert,update,delete on public.audit_log from anon,authenticated;
grant select on public.audit_log to authenticated;

create or replace function public.audit_row_change_v1()
returns trigger language plpgsql security definer set search_path=public as $$
declare old_row jsonb; new_row jsonb; row_id text;
begin
  old_row:=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  new_row:=case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  if tg_table_name='company_settings' then old_row:=old_row-'logo'; new_row:=new_row-'logo'; end if;
  row_id:=coalesce(new_row->>'id',old_row->>'id','main');
  insert into audit_log(entity_type,entity_id,action,old_data,new_data,changed_by)
  values(tg_table_name,row_id,tg_op,old_row,new_row,auth.uid());
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.prevent_audit_change_v1()
returns trigger language plpgsql as $$ begin raise exception 'AUDIT_LOG_IMMUTABLE'; end $$;

drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable before update or delete on public.audit_log for each row execute function public.prevent_audit_change_v1();

do $$
declare table_name text;
begin
  foreach table_name in array array['customers','delivery_addresses','orders','order_items','invoices','invoice_items','receipts','expenses','company_settings'] loop
    execute format('drop trigger if exists audit_%I on public.%I',table_name,table_name);
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.audit_row_change_v1()',table_name,table_name);
  end loop;
end $$;

create or replace function public.soft_delete_record_v1(p_entity_type text,p_entity_id uuid,p_reason text default '',p_session_token uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare affected integer:=0; revision_value bigint; dependent_count integer:=0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_entity_type not in ('customer','order','invoice','receipt','expense') then raise exception 'UNSUPPORTED_ENTITY'; end if;
  if p_session_token is not null and not exists(select 1 from edit_locks l where l.entity_type=p_entity_type and l.entity_id=p_entity_id and l.user_id=auth.uid() and l.session_token=p_session_token and l.expires_at>now()) then raise exception 'EDIT_LOCK_LOST'; end if;

  if p_entity_type='customer' then
    select count(*) into dependent_count from orders where customer_id=p_entity_id and deleted_at is null;
    if dependent_count>0 then raise exception 'CUSTOMER_HAS_ORDERS'; end if;
    update customers set deleted_at=clock_timestamp(),deleted_by=auth.uid(),delete_reason=coalesce(p_reason,''),updated_at=clock_timestamp() where id=p_entity_id and deleted_at is null;
  elsif p_entity_type='order' then
    select count(*) into dependent_count from invoices where order_id=p_entity_id and deleted_at is null;
    if dependent_count>0 then raise exception 'ORDER_HAS_INVOICE'; end if;
    update orders set deleted_at=clock_timestamp(),deleted_by=auth.uid(),delete_reason=coalesce(p_reason,''),updated_at=clock_timestamp() where id=p_entity_id and deleted_at is null;
  elsif p_entity_type='invoice' then
    update receipts set deleted_at=clock_timestamp(),deleted_by=auth.uid(),delete_reason=coalesce(p_reason,'') where invoice_id=p_entity_id and deleted_at is null;
    update invoices set deleted_at=clock_timestamp(),deleted_by=auth.uid(),delete_reason=coalesce(p_reason,''),updated_at=clock_timestamp() where id=p_entity_id and deleted_at is null;
  elsif p_entity_type='receipt' then
    update receipts set deleted_at=clock_timestamp(),deleted_by=auth.uid(),delete_reason=coalesce(p_reason,'') where id=p_entity_id and deleted_at is null;
  else
    update expenses set deleted_at=clock_timestamp(),deleted_by=auth.uid(),delete_reason=coalesce(p_reason,''),updated_at=clock_timestamp() where id=p_entity_id and deleted_at is null;
  end if;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'RECORD_NOT_FOUND_OR_DELETED'; end if;
  revision_value:=erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value,'entityType',p_entity_type,'id',p_entity_id,'deleted',true);
end $$;

create or replace function public.restore_record_v1(p_entity_type text,p_entity_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare affected integer:=0; revision_value bigint;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_entity_type='customer' then update customers set deleted_at=null,deleted_by=null,delete_reason=null,updated_at=clock_timestamp() where id=p_entity_id and deleted_at is not null;
  elsif p_entity_type='order' then update orders set deleted_at=null,deleted_by=null,delete_reason=null,updated_at=clock_timestamp() where id=p_entity_id and deleted_at is not null;
  elsif p_entity_type='invoice' then
    update invoices set deleted_at=null,deleted_by=null,delete_reason=null,updated_at=clock_timestamp() where id=p_entity_id and deleted_at is not null;
    get diagnostics affected=row_count;
    update receipts set deleted_at=null,deleted_by=null,delete_reason=null where invoice_id=p_entity_id and deleted_at is not null;
  elsif p_entity_type='receipt' then update receipts set deleted_at=null,deleted_by=null,delete_reason=null where id=p_entity_id and deleted_at is not null;
  elsif p_entity_type='expense' then update expenses set deleted_at=null,deleted_by=null,delete_reason=null,updated_at=clock_timestamp() where id=p_entity_id and deleted_at is not null;
  else raise exception 'UNSUPPORTED_ENTITY'; end if;
  if p_entity_type<>'invoice' then get diagnostics affected=row_count; end if;
  if affected<>1 then raise exception 'RECORD_NOT_FOUND_OR_ACTIVE'; end if;
  revision_value:=erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value,'entityType',p_entity_type,'id',p_entity_id,'deleted',false);
end $$;

create or replace function public.get_audit_log_v1(p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path=public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'entityType',a.entity_type,'entityId',a.entity_id,'action',a.action,'oldData',a.old_data,'newData',a.new_data,'changedBy',a.changed_by,'changedAt',a.changed_at) order by a.changed_at desc),'[]'::jsonb)
from (select * from audit_log order by changed_at desc limit least(greatest(p_limit,1),500)) a;
$$;

create or replace function public.export_erp_backup()
returns jsonb language sql security invoker set search_path=public as $$
select jsonb_build_object(
  'version',3,'revision',(select revision from erp_meta where id='main'),
  'settings',(select jsonb_build_object('name',name,'address',address,'iban',iban,'firstName',first_name,'companyName',company_name,'street',street,'postalCity',postal_city,'bankName',bank_name,'bankAddress',bank_address,'mwstNumber',mwst_number,'paymentDays',payment_days,'logo',logo,'orderText',order_text,'invoiceText',invoice_text,'updatedAt',updated_at) from company_settings where id='main'),
  'customers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'number',c.number,'company',c.company,'salutation',c.salutation,'firstName',c.first_name,'lastName',c.last_name,'email',c.email,'phone',c.phone,'street',c.street,'zip',c.zip,'city',c.city,'notes',c.notes,'archived',c.archived,'createdAt',c.created_at,'updatedAt',c.updated_at,'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'street',d.street,'city',d.city) order by d.sort_order,d.id) from delivery_addresses d where d.customer_id=c.id),'[]'::jsonb)) order by c.created_at) from customers c where c.deleted_at is null),'[]'::jsonb),
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'number',o.number,'date',o.order_date,'customerId',o.customer_id,'fulfilment',o.fulfilment,'fulfilmentDate',o.fulfilment_date,'deliveryIndex',o.delivery_index,'status',o.status,'text',o.text,'notes',o.notes,'total',o.total,'customerSnapshot',o.customer_snapshot,'archived',o.archived,'createdAt',o.created_at,'updatedAt',o.updated_at,'invoiceId',(select i.id from invoices i where i.order_id=o.id and i.deleted_at is null limit 1),'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'quantity',x.quantity,'price',x.price,'total',x.total) order by x.sort_order,x.id) from order_items x where x.order_id=o.id),'[]'::jsonb)) order by o.created_at) from orders o where o.deleted_at is null),'[]'::jsonb),
  'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'number',i.number,'date',i.invoice_date,'dueDate',i.due_date,'orderId',i.order_id,'orderNumber',i.order_number,'customerId',i.customer_id,'status',i.status,'paidDate',i.paid_date,'paymentMethod',i.payment_method,'text',i.text,'total',i.total,'customerSnapshot',i.customer_snapshot,'archived',i.archived,'createdAt',i.created_at,'updatedAt',i.updated_at,'receipt',(select r.data||jsonb_build_object('id',r.id,'number',r.number,'date',r.receipt_date,'invoiceId',r.invoice_id,'invoiceNumber',r.invoice_number,'createdAt',r.created_at) from receipts r where r.invoice_id=i.id and r.deleted_at is null),'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'quantity',x.quantity,'price',x.price,'total',x.total) order by x.sort_order,x.id) from invoice_items x where x.invoice_id=i.id),'[]'::jsonb)) order by i.created_at) from invoices i where i.deleted_at is null),'[]'::jsonb),
  'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'date',e.expense_date,'amount',e.amount,'description',e.description,'createdAt',e.created_at,'updatedAt',e.updated_at) order by e.expense_date,e.created_at) from expenses e where e.deleted_at is null),'[]'::jsonb)
);
$$;

grant execute on function public.soft_delete_record_v1(text,uuid,text,uuid) to authenticated;
grant execute on function public.restore_record_v1(text,uuid) to authenticated;
grant execute on function public.get_audit_log_v1(integer) to authenticated;
revoke all on function public.soft_delete_record_v1(text,uuid,text,uuid) from anon;
revoke all on function public.restore_record_v1(text,uuid) from anon;
revoke all on function public.get_audit_log_v1(integer) from anon;
notify pgrst, 'reload schema';
