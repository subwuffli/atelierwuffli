-- Einmal im Supabase SQL Editor ausführen.
do $$ begin
  alter publication supabase_realtime add table public.erp_meta;
exception when duplicate_object then null;
end $$;
