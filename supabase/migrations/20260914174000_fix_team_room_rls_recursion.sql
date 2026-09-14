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

drop policy if exists "members read rooms" on public.team_rooms;
drop policy if exists "members read memberships" on public.team_room_members;
drop policy if exists "members read files" on public.team_room_files;
drop policy if exists "members write files" on public.team_room_files;

create policy "members read rooms" on public.team_rooms for select
  using (public.is_team_room_member(id));
create policy "members read memberships" on public.team_room_members for select
  using (public.is_team_room_member(room_id));
create policy "members read files" on public.team_room_files for select
  using (public.is_team_room_member(room_id));
create policy "members write files" on public.team_room_files for all
  using (public.is_team_room_member(room_id))
  with check (auth.uid() = updated_by and public.is_team_room_member(room_id));
