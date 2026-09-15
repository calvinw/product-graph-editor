create or replace function public.is_team_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_room_members
    where room_id = target_room_id and user_id = auth.uid()
  );
$$;

grant execute on function public.is_team_room_member(uuid) to authenticated;

create or replace function public.list_team_room_members(target_room_id uuid)
returns table (user_id uuid, role text, name text, email text)
language sql stable security definer set search_path = public
as $$
  select m.user_id, m.role,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.email) as name,
    u.email
  from public.team_room_members m
  join auth.users u on u.id = m.user_id
  where m.room_id = target_room_id
    and public.is_team_room_member(target_room_id)
  order by case when m.role = 'owner' then 0 else 1 end, name;
$$;

create or replace function public.remove_team_room_member(target_room_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.team_rooms where id = target_room_id and owner_id = auth.uid()) then
    raise exception 'Only the room owner can remove members';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'The room owner cannot remove themselves';
  end if;
  delete from public.team_room_members where room_id = target_room_id and user_id = target_user_id;
end;
$$;

create or replace function public.delete_team_room(target_room_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.team_rooms where id = target_room_id and owner_id = auth.uid()) then
    raise exception 'Only the room owner can delete this room';
  end if;
  delete from public.team_rooms where id = target_room_id;
end;
$$;

grant execute on function public.list_team_room_members(uuid), public.remove_team_room_member(uuid,uuid), public.delete_team_room(uuid) to authenticated;
