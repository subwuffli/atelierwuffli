-- Ausschliesslich nach dem erfolgreichen Test im Supabase-Liveprojekt ausführen.
-- Erzwingt konsistente Zahlungsdaten auch für API-Aufrufe und alte Clients.

create or replace function public.validate_payment_fields_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_table_name='invoices' then
    if new.status not in ('Offen','Bezahlt','Storniert') then
      raise exception 'INVALID_INVOICE_STATUS';
    end if;
    if new.status='Bezahlt' then
      if new.paid_date is null or nullif(trim(new.payment_method),'') is null then
        raise exception 'PAYMENT_DETAILS_REQUIRED';
      end if;
    elsif new.paid_date is not null or nullif(trim(new.payment_method),'') is not null then
      raise exception 'PAYMENT_DETAILS_NOT_ALLOWED';
    end if;
  elsif tg_table_name='expenses' then
    if new.payment_status not in ('Offen','Bezahlt') then
      raise exception 'INVALID_PAYMENT_STATUS';
    end if;
    if new.payment_status='Bezahlt' then
      if new.paid_date is null or nullif(trim(new.payment_method),'') is null then
        raise exception 'PAYMENT_DETAILS_REQUIRED';
      end if;
    elsif new.paid_date is not null or nullif(trim(new.payment_method),'') is not null then
      raise exception 'PAYMENT_DETAILS_NOT_ALLOWED';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_payment_fields_v1() from public,anon,authenticated;

drop trigger if exists validate_invoice_payment_fields on public.invoices;
create trigger validate_invoice_payment_fields before insert or update of status,paid_date,payment_method on public.invoices
  for each row execute function public.validate_payment_fields_v1();
drop trigger if exists validate_expense_payment_fields on public.expenses;
create trigger validate_expense_payment_fields before insert or update of payment_status,paid_date,payment_method on public.expenses
  for each row execute function public.validate_payment_fields_v1();

-- Keep the existing storage/locking implementation, but validate the raw RPC
-- payload before the expense RPC's legacy date fallback can fill missing data.
do $$
begin
  if to_regprocedure('public.save_invoice_unvalidated_v1(jsonb,timestamptz,uuid)') is null then
    alter function public.save_invoice_v1(jsonb,timestamptz,uuid) rename to save_invoice_unvalidated_v1;
  end if;
  if to_regprocedure('public.save_expense_unvalidated_v1(jsonb,timestamptz,uuid)') is null then
    alter function public.save_expense_v1(jsonb,timestamptz,uuid) rename to save_expense_unvalidated_v1;
  end if;
end $$;
revoke all on function public.save_invoice_unvalidated_v1(jsonb,timestamptz,uuid),public.save_expense_unvalidated_v1(jsonb,timestamptz,uuid) from public,anon,authenticated;

create or replace function public.save_invoice_v1(p_invoice jsonb,p_expected_updated_at timestamptz default null,p_session_token uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare status_value text:=coalesce(p_invoice->>'status',''); paid_value date:=nullif(p_invoice->>'paidDate','')::date; method_value text:=coalesce(p_invoice->>'paymentMethod','');
begin
  if auth.uid() is null or not public.is_erp_member_v1() then raise exception 'AUTH_REQUIRED'; end if;
  if status_value not in ('Offen','Bezahlt','Storniert') then raise exception 'INVALID_INVOICE_STATUS'; end if;
  if status_value='Bezahlt' then
    if paid_value is null or nullif(trim(method_value),'') is null then raise exception 'PAYMENT_DETAILS_REQUIRED'; end if;
  elsif paid_value is not null or nullif(trim(method_value),'') is not null then
    raise exception 'PAYMENT_DETAILS_NOT_ALLOWED';
  end if;
  return public.save_invoice_unvalidated_v1(p_invoice,p_expected_updated_at,p_session_token);
end $$;

create or replace function public.save_expense_v1(p_expense jsonb,p_expected_updated_at timestamptz default null,p_session_token uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare status_value text:=coalesce(p_expense->>'paymentStatus','Bezahlt'); paid_value date:=nullif(p_expense->>'paidDate','')::date; method_value text:=coalesce(p_expense->>'paymentMethod','');
begin
  if auth.uid() is null or not public.is_erp_member_v1() then raise exception 'AUTH_REQUIRED'; end if;
  if status_value not in ('Offen','Bezahlt') then raise exception 'INVALID_PAYMENT_STATUS'; end if;
  if status_value='Bezahlt' then
    if paid_value is null or nullif(trim(method_value),'') is null then raise exception 'PAYMENT_DETAILS_REQUIRED'; end if;
  elsif paid_value is not null or nullif(trim(method_value),'') is not null then
    raise exception 'PAYMENT_DETAILS_NOT_ALLOWED';
  end if;
  return public.save_expense_unvalidated_v1(p_expense,p_expected_updated_at,p_session_token);
end $$;

grant execute on function public.save_invoice_v1(jsonb,timestamptz,uuid),public.save_expense_v1(jsonb,timestamptz,uuid) to authenticated;
revoke all on function public.save_invoice_v1(jsonb,timestamptz,uuid),public.save_expense_v1(jsonb,timestamptz,uuid) from public,anon;
notify pgrst, 'reload schema';
