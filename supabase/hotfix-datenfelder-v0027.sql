-- V0.0.27: Vollstaendige Persistenz aller aktuellen ERP-Formularfelder.
-- Einmal vollstaendig im Supabase SQL Editor ausfuehren.

alter table public.company_settings add column if not exists first_name text not null default '';
alter table public.company_settings add column if not exists company_name text not null default '';
alter table public.company_settings add column if not exists street text not null default '';
alter table public.company_settings add column if not exists postal_city text not null default '';
alter table public.company_settings add column if not exists bank_name text not null default '';
alter table public.company_settings add column if not exists bank_address text not null default '';
alter table public.company_settings add column if not exists mwst_number text not null default '';
alter table public.invoices add column if not exists payment_method text not null default '';

-- Falls eine bestehende Quittung die Zahlungsart bereits im JSON enthielt,
-- kann der bislang verworfene Rechnungswert daraus wiederhergestellt werden.
update public.invoices i
set payment_method=r.data->>'paymentMethod'
from public.receipts r
where r.invoice_id=i.id and i.payment_method=''
  and coalesce(r.data->>'paymentMethod','')<>'';

update public.receipts r
set data=jsonb_set(r.data,'{paymentMethod}',to_jsonb(i.payment_method),true)
from public.invoices i
where i.id=r.invoice_id and not (r.data ? 'paymentMethod');

-- Bestehende, bisher kombinierte Angaben einmalig uebernehmen.
update public.company_settings
set company_name = case when company_name='' then name else company_name end,
    street = case when street='' then address else street end
where id='main';

create or replace function public.export_erp_backup()
returns jsonb language sql security invoker set search_path=public as $$
select jsonb_build_object(
  'version',2,'revision',(select revision from erp_meta where id='main'),
  'settings',(select jsonb_build_object(
    'firstName',first_name,'companyName',company_name,'street',street,'postalCity',postal_city,
    'bankName',bank_name,'bankAddress',bank_address,'iban',iban,'mwstNumber',mwst_number,
    'paymentDays',payment_days,'logo',logo,'orderText',order_text,'invoiceText',invoice_text
  ) from company_settings where id='main'),
  'customers',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'number',c.number,'company',c.company,'salutation',c.salutation,'firstName',c.first_name,'lastName',c.last_name,
    'email',c.email,'phone',c.phone,'street',c.street,'zip',c.zip,'city',c.city,'notes',c.notes,'archived',c.archived,
    'createdAt',c.created_at,'updatedAt',c.updated_at,
    'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'street',d.street,'city',d.city) order by d.sort_order,d.id) from delivery_addresses d where d.customer_id=c.id),'[]'::jsonb)
  ) order by c.created_at,c.id) from customers c),'[]'::jsonb),
  'orders',coalesce((select jsonb_agg(jsonb_build_object(
    'id',o.id,'number',o.number,'date',o.order_date,'customerId',o.customer_id,'fulfilment',o.fulfilment,'fulfilmentDate',o.fulfilment_date,
    'deliveryIndex',o.delivery_index,'status',o.status,'text',o.text,'notes',o.notes,'total',o.total,'customerSnapshot',o.customer_snapshot,
    'archived',o.archived,'createdAt',o.created_at,'updatedAt',o.updated_at,
    'invoiceId',(select i.id from invoices i where i.order_id=o.id limit 1),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'quantity',x.quantity,'price',x.price,'total',x.total) order by x.sort_order,x.id) from order_items x where x.order_id=o.id),'[]'::jsonb)
  ) order by o.created_at,o.id) from orders o),'[]'::jsonb),
  'invoices',coalesce((select jsonb_agg(jsonb_build_object(
    'id',i.id,'number',i.number,'date',i.invoice_date,'dueDate',i.due_date,'orderId',i.order_id,'orderNumber',i.order_number,
    'customerId',i.customer_id,'status',i.status,'paidDate',i.paid_date,'paymentMethod',i.payment_method,'text',i.text,'total',i.total,
    'customerSnapshot',i.customer_snapshot,'archived',i.archived,'createdAt',i.created_at,'updatedAt',i.updated_at,
    'receipt',(select r.data||jsonb_build_object('id',r.id,'number',r.number,'date',r.receipt_date,'invoiceId',r.invoice_id,'invoiceNumber',r.invoice_number,'createdAt',r.created_at) from receipts r where r.invoice_id=i.id),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'description',x.description,'quantity',x.quantity,'price',x.price,'total',x.total) order by x.sort_order,x.id) from invoice_items x where x.invoice_id=i.id),'[]'::jsonb)
  ) order by i.created_at,i.id) from invoices i),'[]'::jsonb),
  'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'date',e.expense_date,'amount',e.amount,'description',e.description,'createdAt',e.created_at,'updatedAt',e.updated_at) order by e.expense_date,e.created_at,e.id) from expenses e),'[]'::jsonb)
);
$$;

create or replace function public.replace_erp_backup(p_data jsonb, p_expected_revision bigint default null)
returns bigint language plpgsql security invoker set search_path=public as $$
declare current_revision bigint; c jsonb; d jsonb; o jsonb; x jsonb; i jsonb; r jsonb; e jsonb; position_index integer;
begin
  select revision into current_revision from erp_meta where id='main' for update;
  if p_expected_revision is not null and current_revision <> p_expected_revision then
    raise exception 'CONFLICT: Daten wurden zwischenzeitlich von einem anderen Benutzer geaendert';
  end if;
  delete from receipts where true; delete from expenses where true; delete from invoice_items where true; delete from invoices where true;
  delete from order_items where true; delete from orders where true; delete from delivery_addresses where true; delete from customers where true;

  update company_settings set
    first_name=coalesce(p_data#>>'{settings,firstName}',''), company_name=coalesce(p_data#>>'{settings,companyName}',''),
    street=coalesce(p_data#>>'{settings,street}',''), postal_city=coalesce(p_data#>>'{settings,postalCity}',''),
    bank_name=coalesce(p_data#>>'{settings,bankName}',''), bank_address=coalesce(p_data#>>'{settings,bankAddress}',''),
    iban=coalesce(p_data#>>'{settings,iban}',''), mwst_number=coalesce(p_data#>>'{settings,mwstNumber}',''),
    payment_days=coalesce((p_data#>>'{settings,paymentDays}')::int,30), logo=coalesce(p_data#>>'{settings,logo}',''),
    order_text=coalesce(p_data#>>'{settings,orderText}',''), invoice_text=coalesce(p_data#>>'{settings,invoiceText}',''), updated_at=now()
  where id='main';

  for c in select value from jsonb_array_elements(coalesce(p_data->'customers','[]'::jsonb)) loop
    insert into customers(id,number,company,salutation,first_name,last_name,email,phone,street,zip,city,notes,archived,created_at,updated_at)
    values((c->>'id')::uuid,c->>'number',coalesce(c->>'company',''),coalesce(c->>'salutation',''),coalesce(c->>'firstName',''),coalesce(c->>'lastName',''),coalesce(c->>'email',''),coalesce(c->>'phone',''),coalesce(c->>'street',''),coalesce(c->>'zip',''),coalesce(c->>'city',''),coalesce(c->>'notes',''),coalesce((c->>'archived')::boolean,false),coalesce((c->>'createdAt')::timestamptz,now()),coalesce((c->>'updatedAt')::timestamptz,now()));
    position_index:=0;
    for d in select value from jsonb_array_elements(coalesce(c->'deliveries','[]'::jsonb)) loop
      insert into delivery_addresses(id,customer_id,label,street,city,sort_order) values(coalesce((d->>'id')::uuid,gen_random_uuid()),(c->>'id')::uuid,coalesce(d->>'label',''),coalesce(d->>'street',''),coalesce(d->>'city',''),position_index); position_index:=position_index+1;
    end loop;
  end loop;
  for o in select value from jsonb_array_elements(coalesce(p_data->'orders','[]'::jsonb)) loop
    insert into orders(id,number,order_date,customer_id,fulfilment,fulfilment_date,delivery_index,status,text,notes,total,customer_snapshot,archived,created_at,updated_at)
    values((o->>'id')::uuid,o->>'number',(o->>'date')::date,(o->>'customerId')::uuid,o->>'fulfilment',(o->>'fulfilmentDate')::date,nullif(o->>'deliveryIndex','')::int,o->>'status',coalesce(o->>'text',''),coalesce(o->>'notes',''),coalesce((o->>'total')::numeric,0),coalesce(o->'customerSnapshot','{}'::jsonb),coalesce((o->>'archived')::boolean,false),coalesce((o->>'createdAt')::timestamptz,now()),coalesce((o->>'updatedAt')::timestamptz,now()));
    position_index:=0;
    for x in select value from jsonb_array_elements(coalesce(o->'items','[]'::jsonb)) loop insert into order_items(id,order_id,description,quantity,price,total,sort_order) values(coalesce((x->>'id')::uuid,gen_random_uuid()),(o->>'id')::uuid,x->>'description',(x->>'quantity')::numeric,(x->>'price')::numeric,(x->>'total')::numeric,position_index); position_index:=position_index+1; end loop;
  end loop;
  for i in select value from jsonb_array_elements(coalesce(p_data->'invoices','[]'::jsonb)) loop
    insert into invoices(id,number,invoice_date,due_date,order_id,order_number,customer_id,status,paid_date,payment_method,text,total,customer_snapshot,archived,created_at,updated_at)
    values((i->>'id')::uuid,i->>'number',(i->>'date')::date,(i->>'dueDate')::date,nullif(i->>'orderId','')::uuid,coalesce(i->>'orderNumber',''),(i->>'customerId')::uuid,i->>'status',nullif(i->>'paidDate','')::date,coalesce(i->>'paymentMethod',''),coalesce(i->>'text',''),coalesce((i->>'total')::numeric,0),coalesce(i->'customerSnapshot','{}'::jsonb),coalesce((i->>'archived')::boolean,false),coalesce((i->>'createdAt')::timestamptz,now()),coalesce((i->>'updatedAt')::timestamptz,now()));
    position_index:=0;
    for x in select value from jsonb_array_elements(coalesce(i->'items','[]'::jsonb)) loop insert into invoice_items(id,invoice_id,description,quantity,price,total,sort_order) values(coalesce((x->>'id')::uuid,gen_random_uuid()),(i->>'id')::uuid,x->>'description',(x->>'quantity')::numeric,(x->>'price')::numeric,(x->>'total')::numeric,position_index); position_index:=position_index+1; end loop;
    r:=i->'receipt';
    if r is not null and jsonb_typeof(r)='object' then insert into receipts(id,number,receipt_date,invoice_id,invoice_number,data,created_at) values((r->>'id')::uuid,r->>'number',(r->>'date')::date,(i->>'id')::uuid,coalesce(r->>'invoiceNumber',i->>'number'),r-'id'-'number'-'date'-'invoiceId'-'invoiceNumber'-'createdAt',coalesce((r->>'createdAt')::timestamptz,now())); end if;
  end loop;
  for e in select value from jsonb_array_elements(coalesce(p_data->'expenses','[]'::jsonb)) loop
    insert into expenses(id,expense_date,amount,description,created_at,updated_at) values((e->>'id')::uuid,(e->>'date')::date,coalesce((e->>'amount')::numeric,0),coalesce(e->>'description',''),coalesce((e->>'createdAt')::timestamptz,now()),coalesce((e->>'updatedAt')::timestamptz,now()));
  end loop;
  update erp_meta set revision=revision+1,updated_at=now(),updated_by=auth.uid() where id='main' returning revision into current_revision;
  return current_revision;
end $$;

grant execute on function public.export_erp_backup() to authenticated;
grant execute on function public.replace_erp_backup(jsonb,bigint) to authenticated;
