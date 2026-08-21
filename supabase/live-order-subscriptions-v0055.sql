-- V0.0.55: Mehrere Abhol-/Liefertermine pro Auftrag (Abo).
-- Additiv: Bestehende Aufträge behalten ihr bisheriges Primärdatum.

alter table public.orders
  add column if not exists fulfilment_dates jsonb not null default '[]'::jsonb;

update public.orders
set fulfilment_dates = jsonb_build_array(to_char(fulfilment_date, 'YYYY-MM-DD'))
where fulfilment_date is not null
  and fulfilment_dates = '[]'::jsonb;

create or replace function public.save_order_subscription_v1(
  p_order jsonb,
  p_expected_updated_at timestamptz default null,
  p_session_token uuid default null
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  result jsonb;
  normalized_dates jsonb;
begin
  normalized_dates := coalesce(p_order->'fulfilmentDates', jsonb_build_array(p_order->>'fulfilmentDate'));
  if jsonb_typeof(normalized_dates) <> 'array' or jsonb_array_length(normalized_dates) = 0 then
    raise exception 'APPOINTMENT_REQUIRED';
  end if;

  result := public.save_order_v1(
    p_order || jsonb_build_object('fulfilmentDate', normalized_dates->>0),
    p_expected_updated_at,
    p_session_token
  );
  update public.orders
  set fulfilment_dates = normalized_dates
  where id = (result->>'id')::uuid;
  return result;
end $$;

revoke all on function public.save_order_subscription_v1(jsonb,timestamptz,uuid) from public, anon;
grant execute on function public.save_order_subscription_v1(jsonb,timestamptz,uuid) to authenticated;
notify pgrst, 'reload schema';
