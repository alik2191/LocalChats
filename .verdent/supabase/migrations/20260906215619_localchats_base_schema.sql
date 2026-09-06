-- Базовая схема LocalChats (фаза 1-2 + 3). Идемпотентна: можно применять повторно.
-- Модель: рабочие каналы компании + личные номера сотрудников. Inbound-only.

-- ============ Сотрудники ============
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'manager' check (role in ('admin','manager')),
  created_at timestamptz not null default now()
);

-- ============ Каналы (рабочие + личные) ============
create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('wa','tg','viber')),
  owner text not null default 'company' check (owner in ('company','personal')),
  owner_id uuid references profiles(id) on delete cascade,
  display_name text not null,
  external_ref text not null,
  instance text unique,
  status text not null default 'offline' check (status in ('online','offline','pairing')),
  health_last_ok timestamptz,
  created_at timestamptz not null default now(),
  unique (owner, owner_id, external_ref)
);

create table if not exists channel_sessions (
  channel_id uuid primary key references channels(id) on delete cascade,
  encrypted_creds bytea not null,
  updated_at timestamptz not null default now()
);

-- ============ Клик и атрибуция ============
create table if not exists clicks (
  click_id text primary key,
  channel_kind text not null,
  utm_source text, utm_medium text, utm_campaign text,
  gclid text,
  ip_hash text,
  ua_hash text,
  created_at timestamptz not null default now()
);
create index if not exists clicks_fallback on clicks (ip_hash, ua_hash, created_at desc);

-- ============ Диалоги ============
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  external_chat_id text not null,
  contact_name text,
  phone text,
  click_id text references clicks(click_id),
  attribution text check (attribution in ('exact','fallback','direct')),
  utm_source text, utm_medium text, utm_campaign text, gclid text,
  unread_count int not null default 0,
  assigned_to uuid references profiles(id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (channel_id, external_chat_id)
);

-- ============ Сообщения ============
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out','sys')),
  body text not null,
  external_id text unique,
  status text not null default 'sent' check (status in ('sent','delivered','read','failed')),
  created_at timestamptz not null default now()
);
create index if not exists messages_thread on messages (conversation_id, created_at);
create index if not exists messages_created_at on messages (created_at desc);

-- ============ Очередь задач ============
create table if not exists job_queue (
  id bigint generated always as identity primary key,
  job_type text not null,
  payload jsonb not null,
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  done_at timestamptz,
  error text
);

-- ============ Лиды ============
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  zoho_lead_id text,
  full_name text, phone text,
  utm_source text, utm_medium text, utm_campaign text, gclid text,
  attribution text,
  status text not null default 'Новий',
  sync_status text not null default 'pending' check (sync_status in ('pending','synced','error')),
  created_at timestamptz not null default now()
);

-- ============ QR-пейринг ============
create table if not exists pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  channel_kind text not null check (channel_kind in ('wa','tg')),
  owner_id uuid references profiles(id),
  qr_data text,
  status text not null default 'waiting' check (status in ('waiting','scanned','syncing','connected','expired')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ============ Состояние консоли (jsonb, строка на пользователя) ============
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

-- ============ Fallback-матчинг ============
create or replace function match_fallback(p_channel_kind text, p_ip_hash text, p_ua_hash text)
returns text language sql as $$
  select click_id from clicks
  where ip_hash = p_ip_hash and ua_hash = p_ua_hash
    and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1
$$;

-- ============ RLS ============
alter table conversations enable row level security;
alter table messages enable row level security;
alter table channels enable row level security;

drop policy if exists "channels visible" on channels;
create policy "channels visible"
  on channels for select to authenticated
  using (owner = 'company' or owner_id = auth.uid());

drop policy if exists "personal channels owned" on channels;
create policy "personal channels owned"
  on channels for insert to authenticated
  with check (owner = 'company' or (owner = 'personal' and owner_id = auth.uid()));

drop policy if exists "channels owned update" on channels;
create policy "channels owned update"
  on channels for update to authenticated
  using (owner = 'company' or owner_id = auth.uid())
  with check (owner = 'company' or owner_id = auth.uid());

drop policy if exists "channels owned delete" on channels;
create policy "channels owned delete"
  on channels for delete to authenticated
  using (owner = 'company' or owner_id = auth.uid());

drop policy if exists "company conversations all / personal owned" on conversations;
create policy "company conversations all / personal owned"
  on conversations for select to authenticated
  using (
    exists (
      select 1 from channels ch
      where ch.id = conversations.channel_id
        and (ch.owner = 'company' or ch.owner_id = auth.uid())
    )
  );

drop policy if exists "managers read msgs" on messages;
create policy "managers read msgs"
  on messages for select to authenticated
  using (
    exists (
      select 1 from conversations cv
      join channels ch on ch.id = cv.channel_id
      where cv.id = messages.conversation_id
        and (ch.owner = 'company' or ch.owner_id = auth.uid())
    )
  );

-- ============ Ingest-приём сообщений (фаза 3) ============
create or replace function upsert_incoming_message(
  p_instance text,
  p_external_chat_id text,
  p_contact_name text,
  p_external_id text,
  p_direction text,
  p_body text,
  p_ts timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel uuid;
  v_conv uuid;
begin
  if p_direction not in ('in','out') then
    return null;
  end if;
  select id into v_channel from channels where instance = p_instance;
  if v_channel is null then
    return null;
  end if;

  insert into conversations (channel_id, external_chat_id, contact_name, phone, last_message_at)
  values (v_channel, p_external_chat_id, p_contact_name, p_external_chat_id, p_ts)
  on conflict (channel_id, external_chat_id) do update
    set last_message_at = excluded.last_message_at,
        contact_name = coalesce(conversations.contact_name, excluded.contact_name)
  returning id into v_conv;

  insert into messages (conversation_id, direction, body, external_id, status, created_at)
  values (v_conv, p_direction, p_body, p_external_id, 'sent', p_ts)
  on conflict (external_id) do nothing;

  return v_conv;
end;
$$;

revoke execute on function upsert_incoming_message from public, anon;
grant execute on function upsert_incoming_message to authenticated, service_role;

-- Исходящие из консоли пишет авторизованный пользователь (reply-only);
-- входящие — только service role (ingest-воркер).
drop policy if exists "out messages insertable" on messages;
create policy "out messages insertable"
  on messages for insert to authenticated
  with check (direction = 'out');

-- ============ Профиль создаётся триггером при регистрации ============
create or replace function handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============ Realtime ============
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table pairing_sessions;