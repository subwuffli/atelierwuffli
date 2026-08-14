-- V0.0.35: Kunden und ihre Lieferadressen datensatzweise speichern.

create or replace function public.save_customer_v1(
  p_customer jsonb,
  p_expected_updated_at timestamptz default null,
  p_session_token uuid default null
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  v_customer_id uuid:=coalesce(nullif(p_customer->>'id','')::uuid,gen_random_uuid());
  customer_number text;
  current_updated_at timestamptz;
  saved_updated_at timestamptz;
  revision_value bigint;
  delivery jsonb;
  position_index integer:=0;
  customer_exists boolean:=false;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select number,updated_at into customer_number,current_updated_at
  from customers where id=v_customer_id for update;
  customer_exists:=found;

  if customer_exists then
    if p_session_token is not null and not exists(select 1 from edit_locks where entity_type='customer' and entity_id=v_customer_id and user_id=auth.uid() and session_token=p_session_token and expires_at>now()) then
      raise exception 'EDIT_LOCK_LOST';
    end if;
    if p_expected_updated_at is null or current_updated_at<>p_expected_updated_at then
      raise exception 'CUSTOMER_CONFLICT';
    end if;
    update customers set
      company=coalesce(p_customer->>'company',''),salutation=coalesce(p_customer->>'salutation',''),
      first_name=coalesce(p_customer->>'firstName',''),last_name=coalesce(p_customer->>'lastName',''),
      email=coalesce(p_customer->>'email',''),phone=coalesce(p_customer->>'phone',''),
      street=coalesce(p_customer->>'street',''),zip=coalesce(p_customer->>'zip',''),city=coalesce(p_customer->>'city',''),
      notes=coalesce(p_customer->>'notes',''),archived=coalesce((p_customer->>'archived')::boolean,false),updated_at=clock_timestamp()
    where id=v_customer_id returning updated_at into saved_updated_at;
  else
    customer_number:=next_customer_number();
    insert into customers(id,number,company,salutation,first_name,last_name,email,phone,street,zip,city,notes,archived,created_at,updated_at)
    values(v_customer_id,customer_number,coalesce(p_customer->>'company',''),coalesce(p_customer->>'salutation',''),coalesce(p_customer->>'firstName',''),coalesce(p_customer->>'lastName',''),coalesce(p_customer->>'email',''),coalesce(p_customer->>'phone',''),coalesce(p_customer->>'street',''),coalesce(p_customer->>'zip',''),coalesce(p_customer->>'city',''),coalesce(p_customer->>'notes',''),coalesce((p_customer->>'archived')::boolean,false),now(),now())
    returning updated_at into saved_updated_at;
  end if;

  delete from delivery_addresses where customer_id=v_customer_id;
  for delivery in select value from jsonb_array_elements(coalesce(p_customer->'deliveries','[]'::jsonb)) loop
    insert into delivery_addresses(id,customer_id,label,street,city,sort_order)
    values(coalesce(nullif(delivery->>'id','')::uuid,gen_random_uuid()),v_customer_id,coalesce(delivery->>'label',''),coalesce(delivery->>'street',''),coalesce(delivery->>'city',''),position_index);
    position_index:=position_index+1;
  end loop;

  update erp_meta set revision=revision+1,updated_at=now(),updated_by=auth.uid()
  where id='main' returning revision into revision_value;

  return jsonb_build_object(
    'revision',revision_value,
    'customer',jsonb_build_object(
      'id',v_customer_id,'number',customer_number,'company',coalesce(p_customer->>'company',''),'salutation',coalesce(p_customer->>'salutation',''),
      'firstName',coalesce(p_customer->>'firstName',''),'lastName',coalesce(p_customer->>'lastName',''),'email',coalesce(p_customer->>'email',''),
      'phone',coalesce(p_customer->>'phone',''),'street',coalesce(p_customer->>'street',''),'zip',coalesce(p_customer->>'zip',''),
      'city',coalesce(p_customer->>'city',''),'notes',coalesce(p_customer->>'notes',''),'archived',coalesce((p_customer->>'archived')::boolean,false),
      'createdAt',coalesce(p_customer->>'createdAt',saved_updated_at::text),'updatedAt',saved_updated_at,
      'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'street',d.street,'city',d.city) order by d.sort_order,d.id) from delivery_addresses d where d.customer_id=v_customer_id),'[]'::jsonb)
    )
  );
end $$;

grant execute on function public.save_customer_v1(jsonb,timestamptz,uuid) to authenticated;
revoke all on function public.save_customer_v1(jsonb,timestamptz,uuid) from anon;
notify pgrst, 'reload schema';
