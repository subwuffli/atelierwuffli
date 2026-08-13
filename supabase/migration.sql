-- Atelier Wuffli ERP: relationales Mehrbenutzer-Schema
-- Einmal vollständig im Supabase SQL Editor ausführen.

create extension if not exists pgcrypto;

create table if not exists public.erp_meta (
  id text primary key default 'main' check (id = 'main'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.erp_meta (id) values ('main') on conflict do nothing;

create table if not exists public.company_settings (
  id text primary key default 'main' check (id = 'main'),
  name text not null default '', address text not null default '', iban text not null default '',
  first_name text not null default '', company_name text not null default '',
  street text not null default '', postal_city text not null default '',
  bank_name text not null default '', bank_address text not null default '', mwst_number text not null default '',
  payment_days integer not null default 30 check (payment_days >= 0),
  logo text not null default '', order_text text not null default '', invoice_text text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.company_settings (id) values ('main') on conflict do nothing;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(), number text not null unique,
  company text not null default '', salutation text not null default '', first_name text not null default '', last_name text not null default '',
  email text not null default '', phone text not null default '', street text not null default '', zip text not null default '', city text not null default '',
  notes text not null default '', archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.delivery_addresses (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null default '', street text not null default '', city text not null default '', sort_order integer not null default 0
);
create index if not exists delivery_addresses_customer_idx on public.delivery_addresses(customer_id);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(), number text not null unique, order_date date not null,
  customer_id uuid references public.customers(id), fulfilment text not null check (fulfilment in ('Abholung','Lieferung')),
  fulfilment_date date not null, delivery_index integer, status text not null check (status in ('In Arbeit','Abgeschlossen')),
  text text not null default '', notes text not null default '', total numeric(12,2) not null default 0,
  customer_snapshot jsonb not null default '{}'::jsonb, archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists orders_customer_idx on public.orders(customer_id);
create index if not exists orders_status_idx on public.orders(status, archived);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  description text not null, quantity numeric(12,3) not null, price numeric(12,2) not null, total numeric(12,2) not null, sort_order integer not null default 0
);
create index if not exists order_items_order_idx on public.order_items(order_id);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(), number text not null unique, invoice_date date not null,
  due_date date not null, order_id uuid references public.orders(id), order_number text not null default '', customer_id uuid references public.customers(id),
  status text not null check (status in ('Offen','Bezahlt','Storniert')), paid_date date, text text not null default '', total numeric(12,2) not null default 0,
  customer_snapshot jsonb not null default '{}'::jsonb, archived boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists invoices_customer_idx on public.invoices(customer_id);
create index if not exists invoices_status_idx on public.invoices(status, archived);
alter table public.invoices add column if not exists paid_date date;
alter table public.invoices add column if not exists payment_method text not null default '';

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null, quantity numeric(12,3) not null, price numeric(12,2) not null, total numeric(12,2) not null, sort_order integer not null default 0
);
create index if not exists invoice_items_invoice_idx on public.invoice_items(invoice_id);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(), number text not null unique, receipt_date date not null,
  invoice_id uuid not null unique references public.invoices(id) on delete cascade, invoice_number text not null,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists receipts_date_idx on public.receipts(receipt_date);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(), expense_date date not null, amount numeric(12,2) not null check (amount >= 0),
  description text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses(expense_date);

create table if not exists public.document_counters (
  prefix text not null, counter_date date not null, value integer not null default 0,
  primary key(prefix, counter_date)
);

create table if not exists public.edit_locks (
  entity_type text not null,
  entity_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  primary key(entity_type, entity_id)
);
alter table public.edit_locks add column if not exists session_token uuid not null default gen_random_uuid();

alter table public.erp_meta enable row level security;
alter table public.company_settings enable row level security;
alter table public.customers enable row level security;
alter table public.delivery_addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.receipts enable row level security;
alter table public.expenses enable row level security;
alter table public.document_counters enable row level security;
alter table public.edit_locks enable row level security;

do $$ declare t text; begin
  foreach t in array array['erp_meta','company_settings','customers','delivery_addresses','orders','order_items','invoices','invoice_items','receipts','expenses','document_counters','edit_locks'] loop
    execute format('drop policy if exists authenticated_all on public.%I', t);
    execute format('create policy authenticated_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- RLS legt fest, welche Zeilen sichtbar sind; GRANT erlaubt angemeldeten
-- Benutzern erst grundsätzlich den Tabellenzugriff.
grant select, insert, update, delete on table
  public.erp_meta,
  public.company_settings,
  public.customers,
  public.delivery_addresses,
  public.orders,
  public.order_items,
  public.invoices,
  public.invoice_items,
  public.receipts,
  public.expenses,
  public.document_counters
  ,public.edit_locks
to authenticated;

revoke all on table
  public.erp_meta,
  public.company_settings,
  public.customers,
  public.delivery_addresses,
  public.orders,
  public.order_items,
  public.invoices,
  public.invoice_items,
  public.receipts,
  public.expenses,
  public.document_counters
  ,public.edit_locks
from anon;

create or replace function public.next_document_number(p_prefix text, p_date date)
returns text language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
  if p_prefix not in ('AF','RE','QU') then raise exception 'Ungültiges Präfix'; end if;
  if p_prefix='AF' then
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from orders where order_date=p_date and number ~ '^AF-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  elsif p_prefix='RE' then
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from invoices where invoice_date=p_date and number ~ '^RE-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  else
    select coalesce(max(split_part(number,'-',5)::integer),0)+1 into n from receipts where receipt_date=p_date and number ~ '^QU-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}$';
  end if;
  insert into document_counters(prefix,counter_date,value) values(p_prefix,p_date,n)
  on conflict(prefix,counter_date) do update set value=document_counters.value+1 returning value into n;
  return p_prefix||'-'||to_char(p_date,'YY-MM-DD')||'-'||lpad(n::text,3,'0');
end $$;

create or replace function public.next_customer_number()
returns text language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
  select coalesce(max(substring(number from 4)::integer),0)+1 into n from customers where number ~ '^KD-[0-9]+$';
  insert into document_counters(prefix,counter_date,value) values('KD','2000-01-01',n)
  on conflict(prefix,counter_date) do update set value=document_counters.value+1 returning value into n;
  return 'KD-'||lpad(n::text,4,'0');
end $$;

create or replace function public.export_erp_backup()
returns jsonb language sql security invoker set search_path=public as $$
select jsonb_build_object(
  'version',2,'revision',(select revision from erp_meta where id='main'),
  'settings',(select jsonb_build_object('name',name,'address',address,'iban',iban,'paymentDays',payment_days,'logo',logo,'orderText',order_text,'invoiceText',invoice_text) from company_settings where id='main'),
  'customers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'number',c.number,'company',c.company,'salutation',c.salutation,'firstName',c.first_name,'lastName',c.last_name,'email',c.email,'phone',c.phone,'street',c.street,'zip',c.zip,'city',c.city,'notes',c.notes,'archived',c.archived,'createdAt',c.created_at,'updatedAt',c.updated_at,'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'street',d.street,'city',d.city) order by d.sort_order) from delivery_addresses d where d.customer_id=c.id),'[]'::jsonb))) from customers c),'[]'::jsonb),
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'number',o.number,'date',o.order_date,'customerId',o.customer_id,'fulfilment',o.fulfilment,'fulfilmentDate',o.fulfilment_date,'deliveryIndex',o.delivery_index,'status',o.status,'text',o.text,'notes',o.notes,'total',o.total,'customerSnapshot',o.customer_snapshot,'archived',o.archived,'createdAt',o.created_at,'updatedAt',o.updated_at,'invoiceId',(select i.id from invoices i where i.order_id=o.id limit 1),'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'quantity',x.quantity,'price',x.price,'total',x.total) order by x.sort_order) from order_items x where x.order_id=o.id),'[]'::jsonb))) from orders o),'[]'::jsonb),
  'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'number',i.number,'date',i.invoice_date,'dueDate',i.due_date,'orderId',i.order_id,'orderNumber',i.order_number,'customerId',i.customer_id,'status',i.status,'paidDate',i.paid_date,'text',i.text,'total',i.total,'customerSnapshot',i.customer_snapshot,'archived',i.archived,'createdAt',i.created_at,'updatedAt',i.updated_at,'receipt',(select r.data||jsonb_build_object('id',r.id,'number',r.number,'date',r.receipt_date,'invoiceId',r.invoice_id,'invoiceNumber',r.invoice_number,'createdAt',r.created_at) from receipts r where r.invoice_id=i.id),'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'quantity',x.quantity,'price',x.price,'total',x.total) order by x.sort_order) from invoice_items x where x.invoice_id=i.id),'[]'::jsonb))) from invoices i),'[]'::jsonb),
  'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'date',e.expense_date,'amount',e.amount,'description',e.description,'createdAt',e.created_at,'updatedAt',e.updated_at) order by e.expense_date,e.created_at) from expenses e),'[]'::jsonb)
);
$$;

create or replace function public.replace_erp_backup(p_data jsonb, p_expected_revision bigint default null)
returns bigint language plpgsql security invoker set search_path=public as $$
declare current_revision bigint; c jsonb; d jsonb; o jsonb; x jsonb; i jsonb; r jsonb; e jsonb;
begin
  select revision into current_revision from erp_meta where id='main' for update;
  if p_expected_revision is not null and current_revision <> p_expected_revision then
    raise exception 'CONFLICT: Daten wurden zwischenzeitlich von einem anderen Benutzer geändert';
  end if;
  delete from receipts where true;
  delete from expenses where true;
  delete from invoice_items where true;
  delete from invoices where true;
  delete from order_items where true;
  delete from orders where true;
  delete from delivery_addresses where true;
  delete from customers where true;
  update company_settings set name=coalesce(p_data#>>'{settings,name}',''),address=coalesce(p_data#>>'{settings,address}',''),iban=coalesce(p_data#>>'{settings,iban}',''),payment_days=coalesce((p_data#>>'{settings,paymentDays}')::int,30),logo=coalesce(p_data#>>'{settings,logo}',''),order_text=coalesce(p_data#>>'{settings,orderText}',''),invoice_text=coalesce(p_data#>>'{settings,invoiceText}',''),updated_at=now() where id='main';
  for c in select * from jsonb_array_elements(coalesce(p_data->'customers','[]')) loop
    insert into customers(id,number,company,salutation,first_name,last_name,email,phone,street,zip,city,notes,archived,created_at,updated_at) values((c->>'id')::uuid,c->>'number',coalesce(c->>'company',''),coalesce(c->>'salutation',''),coalesce(c->>'firstName',''),coalesce(c->>'lastName',''),coalesce(c->>'email',''),coalesce(c->>'phone',''),coalesce(c->>'street',''),coalesce(c->>'zip',''),coalesce(c->>'city',''),coalesce(c->>'notes',''),coalesce((c->>'archived')::boolean,false),coalesce((c->>'createdAt')::timestamptz,now()),coalesce((c->>'updatedAt')::timestamptz,now()));
    for d in select value from jsonb_array_elements(coalesce(c->'deliveries','[]')) loop
      insert into delivery_addresses(id,customer_id,label,street,city,sort_order) values(coalesce((d->>'id')::uuid,gen_random_uuid()),(c->>'id')::uuid,coalesce(d->>'label',''),coalesce(d->>'street',''),coalesce(d->>'city',''),0);
    end loop;
  end loop;
  for o in select * from jsonb_array_elements(coalesce(p_data->'orders','[]')) loop
    insert into orders(id,number,order_date,customer_id,fulfilment,fulfilment_date,delivery_index,status,text,notes,total,customer_snapshot,archived,created_at,updated_at) values((o->>'id')::uuid,o->>'number',(o->>'date')::date,(o->>'customerId')::uuid,o->>'fulfilment',(o->>'fulfilmentDate')::date,nullif(o->>'deliveryIndex','')::int,o->>'status',coalesce(o->>'text',''),coalesce(o->>'notes',''),coalesce((o->>'total')::numeric,0),coalesce(o->'customerSnapshot','{}'),coalesce((o->>'archived')::boolean,false),coalesce((o->>'createdAt')::timestamptz,now()),coalesce((o->>'updatedAt')::timestamptz,now()));
    for x in select * from jsonb_array_elements(coalesce(o->'items','[]')) loop insert into order_items(id,order_id,description,quantity,price,total) values(coalesce((x->>'id')::uuid,gen_random_uuid()),(o->>'id')::uuid,x->>'description',(x->>'quantity')::numeric,(x->>'price')::numeric,(x->>'total')::numeric); end loop;
  end loop;
  for i in select * from jsonb_array_elements(coalesce(p_data->'invoices','[]')) loop
    insert into invoices(id,number,invoice_date,due_date,order_id,order_number,customer_id,status,paid_date,text,total,customer_snapshot,archived,created_at,updated_at) values((i->>'id')::uuid,i->>'number',(i->>'date')::date,(i->>'dueDate')::date,nullif(i->>'orderId','')::uuid,coalesce(i->>'orderNumber',''),(i->>'customerId')::uuid,i->>'status',nullif(i->>'paidDate','')::date,coalesce(i->>'text',''),coalesce((i->>'total')::numeric,0),coalesce(i->'customerSnapshot','{}'),coalesce((i->>'archived')::boolean,false),coalesce((i->>'createdAt')::timestamptz,now()),coalesce((i->>'updatedAt')::timestamptz,now()));
    for x in select * from jsonb_array_elements(coalesce(i->'items','[]')) loop insert into invoice_items(id,invoice_id,description,quantity,price,total) values(coalesce((x->>'id')::uuid,gen_random_uuid()),(i->>'id')::uuid,x->>'description',(x->>'quantity')::numeric,(x->>'price')::numeric,(x->>'total')::numeric); end loop;
    r:=i->'receipt';
    if r is not null and jsonb_typeof(r)='object' then
      insert into receipts(id,number,receipt_date,invoice_id,invoice_number,data,created_at) values((r->>'id')::uuid,r->>'number',(r->>'date')::date,(i->>'id')::uuid,coalesce(r->>'invoiceNumber',i->>'number'),r-'id'-'number'-'date'-'invoiceId'-'invoiceNumber'-'createdAt',coalesce((r->>'createdAt')::timestamptz,now()));
    end if;
  end loop;
  for e in select * from jsonb_array_elements(coalesce(p_data->'expenses','[]')) loop
    insert into expenses(id,expense_date,amount,description,created_at,updated_at) values((e->>'id')::uuid,(e->>'date')::date,coalesce((e->>'amount')::numeric,0),coalesce(e->>'description',''),coalesce((e->>'createdAt')::timestamptz,now()),coalesce((e->>'updatedAt')::timestamptz,now()));
  end loop;
  update erp_meta set revision=revision+1,updated_at=now(),updated_by=auth.uid() where id='main' returning revision into current_revision;
  return current_revision;
end $$;

grant execute on function public.next_document_number(text,date) to authenticated;
grant execute on function public.next_customer_number() to authenticated;
grant execute on function public.export_erp_backup() to authenticated;
grant execute on function public.replace_erp_backup(jsonb,bigint) to authenticated;

drop function if exists public.acquire_edit_lock(text,uuid);
drop function if exists public.release_edit_lock(text,uuid);

create or replace function public.acquire_edit_lock_v2(p_entity_type text, p_entity_id uuid, p_session_token uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare acquired boolean;
begin
  delete from edit_locks where entity_type=p_entity_type and entity_id=p_entity_id and expires_at<now();
  insert into edit_locks(entity_type,entity_id,user_id,session_token,expires_at)
  values(p_entity_type,p_entity_id,auth.uid(),p_session_token,now()+interval '15 minutes')
  on conflict(entity_type,entity_id) do nothing;
  update edit_locks set expires_at=now()+interval '15 minutes'
  where entity_type=p_entity_type and entity_id=p_entity_id and session_token=p_session_token;
  select exists(select 1 from edit_locks where entity_type=p_entity_type and entity_id=p_entity_id and session_token=p_session_token) into acquired;
  return acquired;
end $$;

create or replace function public.release_edit_lock_v2(p_entity_type text, p_entity_id uuid, p_session_token uuid)
returns void language sql security invoker set search_path=public as $$
  delete from edit_locks where entity_type=p_entity_type and entity_id=p_entity_id and user_id=auth.uid() and session_token=p_session_token;
$$;

grant execute on function public.acquire_edit_lock_v2(text,uuid,uuid) to authenticated;
grant execute on function public.release_edit_lock_v2(text,uuid,uuid) to authenticated;

-- Realtime nur für die kleine Revisionszeile aktivieren. Clients laden bei
-- einer Änderung den aktuellen relationalen Datenstand neu.
do $$ begin
  alter publication supabase_realtime add table public.erp_meta;
exception when duplicate_object then null;
end $$;

-- Vorhandenen Datenstand aus der früheren JSON-Tabelle einmalig übernehmen.
do $$ declare legacy jsonb; begin
  if to_regclass('public.erp_data') is not null then
    execute 'select data from public.erp_data where id = ''main''' into legacy;
    if legacy is not null and not exists (select 1 from public.customers) then
      perform public.replace_erp_backup(legacy, null);
    end if;
  end if;
end $$;
