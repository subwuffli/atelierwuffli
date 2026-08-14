-- V0.0.33: Besitzer und Geraet bei einer belegten Sperre anzeigen.

alter table public.edit_locks
  add column if not exists device_label text not null default 'Unbekanntes Gerät',
  add column if not exists owner_label text not null default 'Benutzer';

create or replace function public.acquire_edit_lock_v4(
  p_entity_type text,p_entity_id uuid,p_session_token uuid,p_device_label text
)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare current_lock edit_locks%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('acquired',false); end if;

  delete from edit_locks
  where entity_type=p_entity_type and entity_id=p_entity_id and expires_at<=now();

  insert into edit_locks(entity_type,entity_id,user_id,session_token,device_label,owner_label,acquired_at,renewed_at,expires_at)
  values(p_entity_type,p_entity_id,auth.uid(),p_session_token,coalesce(nullif(trim(p_device_label),''),'Unbekanntes Gerät'),coalesce(auth.jwt()->>'email','Benutzer'),now(),now(),now()+interval '3 minutes')
  on conflict(entity_type,entity_id) do nothing;

  update edit_locks
  set device_label=coalesce(nullif(trim(p_device_label),''),device_label),owner_label=coalesce(auth.jwt()->>'email',owner_label),renewed_at=now(),expires_at=now()+interval '3 minutes'
  where entity_type=p_entity_type and entity_id=p_entity_id and user_id=auth.uid() and session_token=p_session_token;

  select * into current_lock from edit_locks
  where entity_type=p_entity_type and entity_id=p_entity_id and expires_at>now();

  if current_lock.session_token=p_session_token and current_lock.user_id=auth.uid() then
    return jsonb_build_object('acquired',true,'deviceLabel',current_lock.device_label,'ownerLabel',current_lock.owner_label,'expiresAt',current_lock.expires_at);
  end if;
  return jsonb_build_object('acquired',false,'deviceLabel',current_lock.device_label,'ownerLabel',current_lock.owner_label,'expiresAt',current_lock.expires_at);
end $$;

grant execute on function public.acquire_edit_lock_v4(text,uuid,uuid,text) to authenticated;
revoke all on function public.acquire_edit_lock_v4(text,uuid,uuid,text) from anon;
notify pgrst, 'reload schema';
