-- Reparatur für bestehende Installationen: im Supabase SQL Editor ausführen.
grant select, insert, update, delete on table
  public.erp_meta,
  public.company_settings,
  public.customers,
  public.delivery_addresses,
  public.orders,
  public.order_items,
  public.invoices,
  public.invoice_items,
  public.document_counters
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
  public.document_counters
from anon;

notify pgrst, 'reload schema';
