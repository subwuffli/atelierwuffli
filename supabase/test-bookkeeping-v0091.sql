-- Ausschliesslich zuerst im Supabase-Testprojekt ausführen.
-- V0.0.91: Buchhaltungsbasis – Lieferanten, vollständige Ausgaben und Kassen-/Bankbewegungen.

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  email text not null default '',
  phone text not null default '',
  street text not null default '',
  zip text not null default '',
  city text not null default '',
  notes text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists suppliers_name_idx on public.suppliers(lower(name));

alter table public.expenses
  add column if not exists supplier_id uuid references public.suppliers(id),
  add column if not exists category text not null default 'Sonstiges',
  add column if not exists payment_status text not null default 'Bezahlt' check (payment_status in ('Offen','Bezahlt')),
  add column if not exists due_date date,
  add column if not exists paid_date date,
  add column if not exists payment_method text not null default '',
  add column if not exists vat_rate numeric(4,2) not null default 0 check (vat_rate in (0,2.6,3.8,8.1)),
  add column if not exists private_share numeric(12,2) not null default 0 check (private_share >= 0),
  add column if not exists payment_reconciled_at timestamptz;

alter table public.invoices add column if not exists payment_reconciled_at timestamptz;
alter table public.expenses drop constraint if exists expenses_private_share_check;
alter table public.expenses add constraint expenses_private_share_check check (private_share <= amount);
create index if not exists expenses_supplier_open_idx on public.expenses(supplier_id,due_date) where deleted_at is null and payment_status='Offen';
create index if not exists expenses_paid_date_idx on public.expenses(paid_date) where deleted_at is null and payment_status='Bezahlt';

create or replace function public.reset_invoice_payment_reconciliation_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status is distinct from new.status or old.paid_date is distinct from new.paid_date or old.payment_method is distinct from new.payment_method or old.total is distinct from new.total then
    new.payment_reconciled_at:=null;
  end if;
  return new;
end $$;

create or replace function public.reset_expense_payment_reconciliation_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.payment_status is distinct from new.payment_status or old.paid_date is distinct from new.paid_date or old.payment_method is distinct from new.payment_method or old.amount is distinct from new.amount then
    new.payment_reconciled_at:=null;
  end if;
  return new;
end $$;

drop trigger if exists reset_invoice_payment_reconciliation on public.invoices;
create trigger reset_invoice_payment_reconciliation before update on public.invoices
  for each row execute function public.reset_invoice_payment_reconciliation_v1();
drop trigger if exists reset_expense_payment_reconciliation on public.expenses;
create trigger reset_expense_payment_reconciliation before update on public.expenses
  for each row execute function public.reset_expense_payment_reconciliation_v1();

-- Frühere einfache Ausgaben waren bereits bezahlte Belege. Ihre Zahlungsart
-- bleibt bewusst leer, damit keine Zahlung künstlich einer Kasse oder Bank zugeordnet wird.
update public.expenses
set paid_date=coalesce(paid_date,expense_date)
where payment_status='Bezahlt' and paid_date is null;

alter table public.suppliers enable row level security;
drop policy if exists erp_members_all on public.suppliers;
create policy erp_members_all on public.suppliers for all to authenticated
  using (public.is_erp_member_v1()) with check (public.is_erp_member_v1());
grant select,insert,update on public.suppliers to authenticated;
revoke delete on public.suppliers from authenticated;
revoke all on public.suppliers from anon;

drop trigger if exists audit_suppliers on public.suppliers;
create trigger audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function public.audit_row_change_v1();

create or replace function public.save_supplier_v1(p_supplier jsonb,p_expected_updated_at timestamptz default null,p_session_token uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_entity_id uuid:=coalesce(nullif(p_supplier->>'id','')::uuid,gen_random_uuid());
  current_stamp timestamptz; saved_stamp timestamptz; revision_value bigint; exists_already boolean:=false;
begin
  if auth.uid() is null or not public.is_erp_member_v1() then raise exception 'AUTH_REQUIRED'; end if;
  select updated_at into current_stamp from suppliers where id=v_entity_id for update; exists_already:=found;
  if exists_already then
    if p_session_token is not null and not exists(select 1 from edit_locks where entity_type='supplier' and entity_id=v_entity_id and user_id=auth.uid() and session_token=p_session_token and expires_at>now()) then raise exception 'EDIT_LOCK_LOST'; end if;
    if p_expected_updated_at is null or current_stamp<>p_expected_updated_at then raise exception 'SUPPLIER_CONFLICT'; end if;
    update suppliers set name=trim(coalesce(p_supplier->>'name','')),email=coalesce(p_supplier->>'email',''),phone=coalesce(p_supplier->>'phone',''),street=coalesce(p_supplier->>'street',''),zip=coalesce(p_supplier->>'zip',''),city=coalesce(p_supplier->>'city',''),notes=coalesce(p_supplier->>'notes',''),archived=coalesce((p_supplier->>'archived')::boolean,false),updated_at=clock_timestamp() where id=v_entity_id returning updated_at into saved_stamp;
  else
    insert into suppliers(id,name,email,phone,street,zip,city,notes,archived,created_at,updated_at)
    values(v_entity_id,trim(coalesce(p_supplier->>'name','')),coalesce(p_supplier->>'email',''),coalesce(p_supplier->>'phone',''),coalesce(p_supplier->>'street',''),coalesce(p_supplier->>'zip',''),coalesce(p_supplier->>'city',''),coalesce(p_supplier->>'notes',''),coalesce((p_supplier->>'archived')::boolean,false),clock_timestamp(),clock_timestamp()) returning updated_at into saved_stamp;
  end if;
  revision_value:=erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value,'id',v_entity_id,'updatedAt',saved_stamp);
end $$;

create or replace function public.save_expense_v1(p_expense jsonb,p_expected_updated_at timestamptz default null,p_session_token uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_entity_id uuid:=coalesce(nullif(p_expense->>'id','')::uuid,gen_random_uuid());
  current_stamp timestamptz; saved_stamp timestamptz; revision_value bigint; entity_number text; exists_already boolean:=false;
  status_value text:=coalesce(nullif(p_expense->>'paymentStatus',''),'Bezahlt');
  paid_value date:=nullif(p_expense->>'paidDate','')::date;
  amount_value numeric:=coalesce((p_expense->>'amount')::numeric,0);
  private_value numeric:=coalesce((p_expense->>'privateShare')::numeric,0);
begin
  if auth.uid() is null or not public.is_erp_member_v1() then raise exception 'AUTH_REQUIRED'; end if;
  if status_value not in ('Offen','Bezahlt') then raise exception 'INVALID_PAYMENT_STATUS'; end if;
  if private_value < 0 or private_value > amount_value then raise exception 'INVALID_PRIVATE_SHARE'; end if;
  if status_value='Bezahlt' then paid_value:=coalesce(paid_value,(p_expense->>'date')::date); else paid_value:=null; end if;
  select updated_at,number into current_stamp,entity_number from expenses where id=v_entity_id for update; exists_already:=found;
  if exists_already then
    if p_session_token is not null and not exists(select 1 from edit_locks where entity_type='expense' and entity_id=v_entity_id and user_id=auth.uid() and session_token=p_session_token and expires_at>now()) then raise exception 'EDIT_LOCK_LOST'; end if;
    if p_expected_updated_at is null or current_stamp<>p_expected_updated_at then raise exception 'EXPENSE_CONFLICT'; end if;
    update expenses set expense_date=(p_expense->>'date')::date,amount=amount_value,description=coalesce(p_expense->>'description',''),supplier_id=nullif(p_expense->>'supplierId','')::uuid,category=coalesce(nullif(p_expense->>'category',''),'Sonstiges'),payment_status=status_value,due_date=nullif(p_expense->>'dueDate','')::date,paid_date=paid_value,payment_method=case when status_value='Bezahlt' then coalesce(p_expense->>'paymentMethod','') else '' end,vat_rate=coalesce((p_expense->>'vatRate')::numeric,0),private_share=private_value,updated_at=clock_timestamp() where id=v_entity_id returning updated_at into saved_stamp;
  else
    entity_number:=next_document_number('AG',(p_expense->>'date')::date);
    insert into expenses(id,number,expense_date,amount,description,supplier_id,category,payment_status,due_date,paid_date,payment_method,vat_rate,private_share,created_at,updated_at)
    values(v_entity_id,entity_number,(p_expense->>'date')::date,amount_value,coalesce(p_expense->>'description',''),nullif(p_expense->>'supplierId','')::uuid,coalesce(nullif(p_expense->>'category',''),'Sonstiges'),status_value,nullif(p_expense->>'dueDate','')::date,paid_value,case when status_value='Bezahlt' then coalesce(p_expense->>'paymentMethod','') else '' end,coalesce((p_expense->>'vatRate')::numeric,0),private_value,clock_timestamp(),clock_timestamp()) returning updated_at into saved_stamp;
  end if;
  revision_value:=erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value,'id',v_entity_id,'number',entity_number,'updatedAt',saved_stamp);
end $$;

create or replace function public.set_payment_reconciled_v1(p_entity_type text,p_entity_id uuid,p_reconciled boolean,p_session_token uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare revision_value bigint; affected integer:=0;
begin
  if auth.uid() is null or not public.is_erp_member_v1() then raise exception 'AUTH_REQUIRED'; end if;
  if p_entity_type not in ('invoice','expense') then raise exception 'UNSUPPORTED_ENTITY'; end if;
  if not exists(select 1 from edit_locks where entity_type=p_entity_type and entity_id=p_entity_id and user_id=auth.uid() and session_token=p_session_token and expires_at>now()) then raise exception 'EDIT_LOCK_LOST'; end if;
  if p_entity_type='invoice' then
    update invoices set payment_reconciled_at=case when p_reconciled then clock_timestamp() else null end,updated_at=clock_timestamp() where id=p_entity_id and status='Bezahlt' and deleted_at is null;
  else
    update expenses set payment_reconciled_at=case when p_reconciled then clock_timestamp() else null end,updated_at=clock_timestamp() where id=p_entity_id and payment_status='Bezahlt' and deleted_at is null;
  end if;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'PAYMENT_NOT_FOUND_OR_UNPAID'; end if;
  revision_value:=erp_bump_revision_v1();
  return jsonb_build_object('revision',revision_value,'reconciled',p_reconciled);
end $$;

create or replace function public.export_erp_backup()
returns jsonb language sql security invoker set search_path=public as $$
select jsonb_build_object(
  'version',3,'revision',(select revision from erp_meta where id='main'),
  'settings',(select jsonb_build_object('name',name,'address',address,'iban',iban,'firstName',first_name,'companyName',company_name,'street',street,'postalCity',postal_city,'bankName',bank_name,'bankAddress',bank_address,'qrBuildingNumber',qr_building_number,'mwstNumber',mwst_number,'paymentDays',payment_days,'logo',logo,'orderText',order_text,'invoiceText',invoice_text,'positionTemplates',position_templates,'updatedAt',updated_at) from company_settings where id='main'),
  'customers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'number',c.number,'company',c.company,'salutation',c.salutation,'firstName',c.first_name,'lastName',c.last_name,'email',c.email,'phone',c.phone,'street',c.street,'zip',c.zip,'city',c.city,'notes',c.notes,'archived',c.archived,'createdAt',c.created_at,'updatedAt',c.updated_at,'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'street',d.street,'city',d.city) order by d.sort_order,d.id) from delivery_addresses d where d.customer_id=c.id),'[]'::jsonb)) order by c.created_at) from customers c where c.deleted_at is null),'[]'::jsonb),
  'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'email',s.email,'phone',s.phone,'street',s.street,'zip',s.zip,'city',s.city,'notes',s.notes,'archived',s.archived,'createdAt',s.created_at,'updatedAt',s.updated_at) order by lower(s.name),s.created_at) from suppliers s),'[]'::jsonb),
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'number',o.number,'date',o.order_date,'customerId',o.customer_id,'fulfilment',o.fulfilment,'fulfilmentDate',o.fulfilment_date,'deliveryIndex',o.delivery_index,'status',o.status,'text',o.text,'notes',o.notes,'total',o.total,'customerSnapshot',o.customer_snapshot,'archived',o.archived,'createdAt',o.created_at,'updatedAt',o.updated_at,'invoiceId',(select i.id from invoices i where i.order_id=o.id and i.deleted_at is null limit 1),'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'quantity',x.quantity,'price',x.price,'total',x.total) order by x.sort_order,x.id) from order_items x where x.order_id=o.id),'[]'::jsonb)) order by o.created_at) from orders o where o.deleted_at is null),'[]'::jsonb),
  'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'number',i.number,'date',i.invoice_date,'dueDate',i.due_date,'orderId',i.order_id,'orderNumber',i.order_number,'customerId',i.customer_id,'status',i.status,'paidDate',i.paid_date,'paymentMethod',i.payment_method,'paymentReconciledAt',i.payment_reconciled_at,'text',i.text,'total',i.total,'customerSnapshot',i.customer_snapshot,'qrData',i.qr_data,'archived',i.archived,'createdAt',i.created_at,'updatedAt',i.updated_at,'receipt',(select r.data||jsonb_build_object('id',r.id,'number',r.number,'date',r.receipt_date,'invoiceId',r.invoice_id,'invoiceNumber',r.invoice_number,'createdAt',r.created_at) from receipts r where r.invoice_id=i.id and r.deleted_at is null),'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'quantity',x.quantity,'price',x.price,'total',x.total) order by x.sort_order,x.id) from invoice_items x where x.invoice_id=i.id),'[]'::jsonb)) order by i.created_at) from invoices i where i.deleted_at is null),'[]'::jsonb),
  'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'number',e.number,'date',e.expense_date,'amount',e.amount,'description',e.description,'supplierId',e.supplier_id,'category',e.category,'paymentStatus',e.payment_status,'dueDate',e.due_date,'paidDate',e.paid_date,'paymentMethod',e.payment_method,'vatRate',e.vat_rate,'privateShare',e.private_share,'paymentReconciledAt',e.payment_reconciled_at,'createdAt',e.created_at,'updatedAt',e.updated_at) order by e.expense_date,e.created_at) from expenses e where e.deleted_at is null),'[]'::jsonb)
);
$$;

grant execute on function public.save_supplier_v1(jsonb,timestamptz,uuid),public.save_expense_v1(jsonb,timestamptz,uuid),public.set_payment_reconciled_v1(text,uuid,boolean,uuid),public.export_erp_backup() to authenticated;
revoke all on function public.save_supplier_v1(jsonb,timestamptz,uuid),public.save_expense_v1(jsonb,timestamptz,uuid),public.set_payment_reconciled_v1(text,uuid,boolean,uuid),public.export_erp_backup() from anon;
notify pgrst, 'reload schema';
