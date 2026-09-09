create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  url text not null,
  domain text,
  platform text,
  latest_score int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, url)
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  scan_id text,
  score int not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.buyer_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  query text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  type text not null default 'general',
  rating int check (rating between 1 and 5),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text,
  provider_subscription_id text,
  plan text not null default 'free',
  status text not null default 'inactive',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.scans enable row level security;
alter table public.buyer_tests enable row level security;
alter table public.feedback enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "profiles own row" on public.profiles;
create policy "profiles own row" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "stores own rows" on public.stores;
create policy "stores own rows" on public.stores for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "scans own rows" on public.scans;
create policy "scans own rows" on public.scans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "buyer tests own rows" on public.buyer_tests;
create policy "buyer tests own rows" on public.buyer_tests for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "feedback insert own or anon" on public.feedback;
create policy "feedback insert own or anon" on public.feedback for insert with check (user_id is null or auth.uid() = user_id);
drop policy if exists "feedback read own" on public.feedback;
create policy "feedback read own" on public.feedback for select using (auth.uid() = user_id);

drop policy if exists "subscriptions own row" on public.subscriptions;
create policy "subscriptions own row" on public.subscriptions for select using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,email) values(new.id,new.email)
  on conflict(id) do update set email=excluded.email, updated_at=now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create index if not exists stores_user_id_idx on public.stores(user_id);
create index if not exists scans_user_id_created_at_idx on public.scans(user_id, created_at desc);
create index if not exists scans_store_id_created_at_idx on public.scans(store_id, created_at desc);
create index if not exists buyer_tests_store_id_created_at_idx on public.buyer_tests(store_id, created_at desc);
create index if not exists feedback_created_at_idx on public.feedback(created_at desc);
