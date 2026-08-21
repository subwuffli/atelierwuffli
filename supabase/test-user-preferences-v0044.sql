-- Testumgebung: persönliche Einstellungen je angemeldetem Benutzer.
-- Es werden nur UI-Präferenzen gespeichert, keine Geschäfts- oder Adressdaten.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "users read own preferences" on public.user_preferences;
drop policy if exists "users insert own preferences" on public.user_preferences;
drop policy if exists "users update own preferences" on public.user_preferences;

create policy "users read own preferences" on public.user_preferences
  for select to authenticated using (auth.uid() = user_id);
create policy "users insert own preferences" on public.user_preferences
  for insert to authenticated with check (auth.uid() = user_id);
create policy "users update own preferences" on public.user_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.user_preferences to authenticated;
revoke all on public.user_preferences from anon;
