-- Live: globale Positionsvorlagen; bestehende Geschäftsbelege bleiben unverändert.
alter table public.company_settings add column if not exists position_templates jsonb not null default '[]'::jsonb;

create or replace function public.save_settings_v1(p_settings jsonb,p_session_token uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare revision_value bigint; saved_stamp timestamptz; lock_id constant uuid:='00000000-0000-0000-0000-000000000001';
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from edit_locks where entity_type='settings' and entity_id=lock_id and user_id=auth.uid() and session_token=p_session_token and expires_at>now()) then raise exception 'EDIT_LOCK_LOST'; end if;
  update company_settings set name=coalesce(p_settings->>'name',''),address=coalesce(p_settings->>'address',''),iban=coalesce(p_settings->>'iban',''),first_name=coalesce(p_settings->>'firstName',''),company_name=coalesce(p_settings->>'companyName',''),street=coalesce(p_settings->>'street',''),postal_city=coalesce(p_settings->>'postalCity',''),bank_name=coalesce(p_settings->>'bankName',''),bank_address=coalesce(p_settings->>'bankAddress',''),mwst_number=coalesce(p_settings->>'mwstNumber',''),payment_days=coalesce((p_settings->>'paymentDays')::integer,30),logo=coalesce(p_settings->>'logo',''),order_text=coalesce(p_settings->>'orderText',''),invoice_text=coalesce(p_settings->>'invoiceText',''),position_templates=coalesce(p_settings->'positionTemplates','[]'::jsonb),updated_at=clock_timestamp() where id='main' returning updated_at into saved_stamp;
  revision_value:=erp_bump_revision_v1(); return jsonb_build_object('revision',revision_value,'updatedAt',saved_stamp);
end $$;

alter function public.export_erp_backup() rename to export_erp_backup_v0053;
create function public.export_erp_backup() returns jsonb language sql security invoker set search_path=public as $$
select jsonb_set(public.export_erp_backup_v0053(),'{settings,positionTemplates}',(select position_templates from public.company_settings where id='main'),true);
$$;

revoke all on function public.save_settings_v1(jsonb,uuid) from public, anon;
revoke all on function public.export_erp_backup() from public, anon;
grant execute on function public.save_settings_v1(jsonb,uuid) to authenticated;
grant execute on function public.export_erp_backup() to authenticated;
notify pgrst, 'reload schema';
