-- Повний стан UI-стору консолі як jsonb, рядок на користувача.
create table if not exists app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

drop policy if exists "app_state owned" on app_state;
create policy "app_state owned"
  on app_state for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());