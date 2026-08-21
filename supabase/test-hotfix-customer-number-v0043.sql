-- Testumgebung: Kundennummer nach einem Import sicher fortführen.
create or replace function public.next_customer_number()
returns text language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
  select coalesce(max(substring(number from 4)::integer),0)+1
    into n from customers where number ~ '^KD-[0-9]+$';
  insert into document_counters(prefix,counter_date,value)
    values('KD','2000-01-01',n)
  on conflict(prefix,counter_date) do update
    set value=greatest(document_counters.value+1,excluded.value)
  returning value into n;
  return 'KD-'||lpad(n::text,4,'0');
end $$;

grant execute on function public.next_customer_number() to authenticated;
revoke all on function public.next_customer_number() from anon;
