-- Live-Nachhaertung fuer die mit V0.0.49 eingefuehrten RPC-Funktionen.
-- Erst nach v0037, v0038, v0040, v0041 und v0042 ausfuehren.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname=any(array[
        'erp_bump_revision_v1','save_order_v1','save_invoice_v1',
        'save_expense_v1','save_settings_v1','export_erp_backup',
        'soft_delete_record_v1','restore_record_v1','get_audit_log_v1',
        'is_erp_member_v1','is_erp_admin_v1','get_security_status_v1',
        'create_backup_snapshot_v1','test_latest_backup_v1',
        'log_app_error_v1','get_operations_status_v1',
        'get_deleted_records_v1'
      ])
  loop
    execute format('revoke all on function %s from public, anon',fn.signature);
    execute format('grant execute on function %s to authenticated',fn.signature);
  end loop;
end $$;

notify pgrst,'reload schema';
