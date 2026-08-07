create table if not exists public.product_graphs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  yaml_content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_graphs_user_updated_idx
  on public.product_graphs (user_id, updated_at desc);

alter table public.product_graphs enable row level security;

drop policy if exists "Users can view their own product graphs" on public.product_graphs;
create policy "Users can view their own product graphs"
  on public.product_graphs for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own product graphs" on public.product_graphs;
create policy "Users can create their own product graphs"
  on public.product_graphs for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own product graphs" on public.product_graphs;
create policy "Users can update their own product graphs"
  on public.product_graphs for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own product graphs" on public.product_graphs;
create policy "Users can delete their own product graphs"
  on public.product_graphs for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_product_graph_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_product_graph_updated_at on public.product_graphs;
create trigger set_product_graph_updated_at
  before update on public.product_graphs
  for each row execute function public.set_product_graph_updated_at();

grant select, insert, update, delete on public.product_graphs to authenticated;
revoke all on public.product_graphs from anon;
