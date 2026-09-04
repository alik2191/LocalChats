-- ============================================================
-- «Меридіан» Sales Console — схема етапу 2 (Supabase / Postgres)
-- Модель: робочі канали компанії + особисті номери співробітників.
-- Режим: inbound-only (відповіді клієнтам), розсилок немає за побудовою.
-- Застосовувати через mcp_verdent_supabase_migration, коли ввімкнено біндінг.
-- ============================================================

-- ============ Співробітники ============
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'manager' check (role in ('admin','manager')),
  created_at timestamptz not null default now()
);

-- ============ Канали (робочі + особисті) ============
create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('wa','tg','viber')),
  owner text not null default 'company' check (owner in ('company','personal')),
  owner_id uuid references profiles(id) on delete cascade, -- null для робочих
  display_name text not null,
  external_ref text not null,             -- phone_e164 / @username
  status text not null default 'offline' check (status in ('online','offline','pairing')),
  health_last_ok timestamptz,
  created_at timestamptz not null default now(),
  unique (owner, owner_id, external_ref)
);

-- Сесії воркера (Baileys creds / gramjs StringSession) — шифрувати AES-GCM, ключ в env
create table if not exists channel_sessions (
  channel_id uuid primary key references channels(id) on delete cascade,
  encrypted_creds bytea not null,
  updated_at timestamptz not null default now()
);

-- ============ Клік і атрибуція ============
create table if not exists clicks (
  click_id text primary key,              -- Crockford base32, 8 символів
  channel_kind text not null,
  utm_source text, utm_medium text, utm_campaign text,
  gclid text,
  ip_hash text,
  ua_hash text,
  created_at timestamptz not null default now()
);
create index if not exists clicks_fallback on clicks (ip_hash, ua_hash, created_at desc);

-- ============ Діалоги ============
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  external_chat_id text not null,
  contact_name text,
  phone text,
  -- атрибуція (лише робочі канали)
  click_id text references clicks(click_id),
  attribution text check (attribution in ('exact','fallback','direct')),
  utm_source text, utm_medium text, utm_campaign text, gclid text,
  unread_count int not null default 0,
  assigned_to uuid references profiles(id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (channel_id, external_chat_id)
);

-- ============ Повідомлення ============
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out','sys')),
  body text not null,
  external_id text unique,                -- ідемпотентність вебхуків
  status text not null default 'sent' check (status in ('sent','delivered','read','failed')),
  created_at timestamptz not null default now()
);
create index if not exists messages_thread on messages (conversation_id, created_at);

-- ============ Черга вихідних (reply-only) і задач ============
create table if not exists job_queue (
  id bigint generated always as identity primary key,
  job_type text not null,                 -- 'send_reply' | 'zoho_upsert' | 'gclid_upload'
  payload jsonb not null,
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  done_at timestamptz,
  error text
);

-- ============ Ліди (локальне дзеркало до синку в Zoho) ============
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

-- ============ QR-пейринг (воркер) ============
create table if not exists pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  channel_kind text not null check (channel_kind in ('wa','tg')),
  owner_id uuid references profiles(id),  -- хто підключає особистий номер
  qr_data text,
  status text not null default 'waiting' check (status in ('waiting','scanned','syncing','connected','expired')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ============ Realtime ============
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table pairing_sessions;

-- ============ Стан консолі (шар даних, адаптер supabase) ============
-- Повний стан UI-стору як jsonb, рядок на користувача.
create table if not exists app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

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
-- Робочі діалоги бачать усі менеджери; особисті — лише власник номера.
alter table conversations enable row level security;
alter table messages enable row level security;
alter table channels enable row level security;

create policy "channels visible"
  on channels for select to authenticated
  using (owner = 'company' or owner_id = auth.uid());

create policy "personal channels owned"
  on channels for insert to authenticated
  with check (owner = 'company' or (owner = 'personal' and owner_id = auth.uid()));

create policy "company conversations all / personal owned"
  on conversations for select to authenticated
  using (
    exists (
      select 1 from channels ch
      where ch.id = conversations.channel_id
        and (ch.owner = 'company' or ch.owner_id = auth.uid())
    )
  );

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

-- Записують повідомлення лише серверні компоненти (service_role) —
-- публічних insert-політик немає. click/leads/job_queue — лише service_role.

-- ============ Профіль створюється тригером при реєстрації ============
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
