-- Quittungen für bezahlte Rechnungen (V0.0.12)
-- Einmal vollständig im Supabase SQL Editor ausführen.

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(), number text not null unique, receipt_date date not null,
  invoice_id uuid not null unique references public.invoices(id) on delete cascade, invoice_number text not null,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists receipts_date_idx on public.receipts(receipt_date);
alter table public.receipts enable row level security;
drop policy if exists authenticated_all on public.receipts;
create policy authenticated_all on public.receipts for all to authenticated using (true) with check (true);
grant select, insert, update, delete on table public.receipts to authenticated;
revoke all on table public.receipts from anon;

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
grant execute on function public.next_document_number(text,date) to authenticated;

create or replace function public.export_erp_backup()
returns jsonb language sql security invoker set search_path=public as $$
select jsonb_build_object(
  'version',2,'revision',(select revision from erp_meta where id='main'),
  'settings',(select jsonb_build_object('name',name,'address',address,'iban',iban,'paymentDays',payment_days,'logo',logo,'orderText',order_text,'invoiceText',invoice_text) from company_settings where id='main'),
  'customers',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'number',c.number,'company',c.company,'salutation',c.salutation,'firstName',c.first_name,'lastName',c.last_name,'email',c.email,'phone',c.phone,'street',c.street,'zip',c.zip,'city',c.city,'notes',c.notes,'archived',c.archived,'createdAt',c.created_at,'updatedAt',c.updated_at,'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'street',d.street,'city',d.city) order by d.sort_order) from delivery_addresses d where d.customer_id=c.id),'[]'::jsonb))) from customers c),'[]'::jsonb),
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'number',o.number,'date',o.order_date,'customerId',o.customer_id,'fulfilment',o.fulfilment,'fulfilmentDate',o.fulfilment_date,'deliveryIndex',o.delivery_index,'status',o.status,'text',o.text,'notes',o.notes,'total',o.total,'customerSnapshot',o.customer_snapshot,'archived',o.archived,'createdAt',o.created_at,'updatedAt',o.updated_at,'invoiceId',(select i.id from invoices i where i.order_id=o.id limit 1),'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'quantity',x.quantity,'price',x.price,'total',x.total) order by x.sort_order) from order_items x where x.order_id=o.id),'[]'::jsonb))) from orders o),'[]'::jsonb),
  'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'number',i.number,'date',i.invoice_date,'dueDate',i.due_date,'orderId',i.order_id,'orderNumber',i.order_number,'customerId',i.customer_id,'status',i.status,'text',i.text,'total',i.total,'customerSnapshot',i.customer_snapshot,'archived',i.archived,'createdAt',i.created_at,'updatedAt',i.updated_at,'receipt',(select r.data||jsonb_build_object('id',r.id,'number',r.number,'date',r.receipt_date,'invoiceId',r.invoice_id,'invoiceNumber',r.invoice_number,'createdAt',r.created_at) from receipts r where r.invoice_id=i.id),'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'quantity',x.quantity,'price',x.price,'total',x.total) order by x.sort_order) from invoice_items x where x.invoice_id=i.id),'[]'::jsonb))) from invoices i),'[]'::jsonb)
);
$$;
grant execute on function public.export_erp_backup() to authenticated;

create or replace function public.replace_erp_backup(p_data jsonb, p_expected_revision bigint default null)
returns bigint language plpgsql security invoker set search_path=public as $$
declare current_revision bigint; c jsonb; d jsonb; o jsonb; x jsonb; i jsonb; r jsonb;
begin
  select revision into current_revision from erp_meta where id='main' for update;
  if p_expected_revision is not null and current_revision <> p_expected_revision then raise exception 'CONFLICT: Daten wurden zwischenzeitlich von einem anderen Benutzer geändert'; end if;
  delete from receipts where true; delete from invoice_items where true; delete from invoices where true; delete from order_items where true; delete from orders where true; delete from delivery_addresses where true; delete from customers where true;
  update company_settings set name=coalesce(p_data#>>'{settings,name}',''),address=coalesce(p_data#>>'{settings,address}',''),iban=coalesce(p_data#>>'{settings,iban}',''),payment_days=coalesce((p_data#>>'{settings,paymentDays}')::int,30),logo=coalesce(p_data#>>'{settings,logo}',''),order_text=coalesce(p_data#>>'{settings,orderText}',''),invoice_text=coalesce(p_data#>>'{settings,invoiceText}',''),updated_at=now() where id='main';
  for c in select * from jsonb_array_elements(coalesce(p_data->'customers','[]')) loop
    insert into customers(id,number,company,salutation,first_name,last_name,email,phone,street,zip,city,notes,archived,created_at,updated_at) values((c->>'id')::uuid,c->>'number',coalesce(c->>'company',''),coalesce(c->>'salutation',''),coalesce(c->>'firstName',''),coalesce(c->>'lastName',''),coalesce(c->>'email',''),coalesce(c->>'phone',''),coalesce(c->>'street',''),coalesce(c->>'zip',''),coalesce(c->>'city',''),coalesce(c->>'notes',''),coalesce((c->>'archived')::boolean,false),coalesce((c->>'createdAt')::timestamptz,now()),coalesce((c->>'updatedAt')::timestamptz,now()));
    for d in select value from jsonb_array_elements(coalesce(c->'deliveries','[]')) loop insert into delivery_addresses(id,customer_id,label,street,city,sort_order) values(coalesce((d->>'id')::uuid,gen_random_uuid()),(c->>'id')::uuid,coalesce(d->>'label',''),coalesce(d->>'street',''),coalesce(d->>'city',''),0); end loop;
  end loop;
  for o in select * from jsonb_array_elements(coalesce(p_data->'orders','[]')) loop
    insert into orders(id,number,order_date,customer_id,fulfilment,fulfilment_date,delivery_index,status,text,notes,total,customer_snapshot,archived,created_at,updated_at) values((o->>'id')::uuid,o->>'number',(o->>'date')::date,(o->>'customerId')::uuid,o->>'fulfilment',(o->>'fulfilmentDate')::date,nullif(o->>'deliveryIndex','')::int,o->>'status',coalesce(o->>'text',''),coalesce(o->>'notes',''),coalesce((o->>'total')::numeric,0),coalesce(o->'customerSnapshot','{}'),coalesce((o->>'archived')::boolean,false),coalesce((o->>'createdAt')::timestamptz,now()),coalesce((o->>'updatedAt')::timestamptz,now()));
    for x in select * from jsonb_array_elements(coalesce(o->'items','[]')) loop insert into order_items(id,order_id,description,quantity,price,total) values(coalesce((x->>'id')::uuid,gen_random_uuid()),(o->>'id')::uuid,x->>'description',(x->>'quantity')::numeric,(x->>'price')::numeric,(x->>'total')::numeric); end loop;
  end loop;
  for i in select * from jsonb_array_elements(coalesce(p_data->'invoices','[]')) loop
    insert into invoices(id,number,invoice_date,due_date,order_id,order_number,customer_id,status,text,total,customer_snapshot,archived,created_at,updated_at) values((i->>'id')::uuid,i->>'number',(i->>'date')::date,(i->>'dueDate')::date,nullif(i->>'orderId','')::uuid,coalesce(i->>'orderNumber',''),(i->>'customerId')::uuid,i->>'status',coalesce(i->>'text',''),coalesce((i->>'total')::numeric,0),coalesce(i->'customerSnapshot','{}'),coalesce((i->>'archived')::boolean,false),coalesce((i->>'createdAt')::timestamptz,now()),coalesce((i->>'updatedAt')::timestamptz,now()));
    for x in select * from jsonb_array_elements(coalesce(i->'items','[]')) loop insert into invoice_items(id,invoice_id,description,quantity,price,total) values(coalesce((x->>'id')::uuid,gen_random_uuid()),(i->>'id')::uuid,x->>'description',(x->>'quantity')::numeric,(x->>'price')::numeric,(x->>'total')::numeric); end loop;
    r:=i->'receipt'; if r is not null and jsonb_typeof(r)='object' then insert into receipts(id,number,receipt_date,invoice_id,invoice_number,data,created_at) values((r->>'id')::uuid,r->>'number',(r->>'date')::date,(i->>'id')::uuid,coalesce(r->>'invoiceNumber',i->>'number'),r-'id'-'number'-'date'-'invoiceId'-'invoiceNumber'-'createdAt',coalesce((r->>'createdAt')::timestamptz,now())); end if;
  end loop;
  update erp_meta set revision=revision+1,updated_at=now(),updated_by=auth.uid() where id='main' returning revision into current_revision; return current_revision;
end $$;
grant execute on function public.replace_erp_backup(jsonb,bigint) to authenticated;
