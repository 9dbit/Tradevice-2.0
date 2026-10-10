-- Tradevice Copy only: apply to a NEW dedicated Supabase project, never the existing Tradevice/Pentagon DB.
create extension if not exists pgcrypto;
create table public.copy_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
create table public.copy_brokers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  enabled boolean not null default false
);
create table public.copy_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_id uuid not null references public.copy_brokers(id),
  external_account_id text not null,
  created_at timestamptz not null default now(),
  unique(broker_id, external_account_id)
);
create table public.copy_strategies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  symbol text not null default 'XAUUSD',
  enabled boolean not null default false
);
create table public.copy_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.copy_accounts(id),
  strategy_id uuid not null references public.copy_strategies(id),
  status text not null default 'pending'
    check(status in ('pending','paused','stopped')),
  unique(account_id,strategy_id)
);
create table public.copy_risk_profiles (
  account_id uuid primary key references public.copy_accounts(id),
  risk_per_trade_pct numeric(5,3) not null default 0.250
    check(risk_per_trade_pct > 0 and risk_per_trade_pct <= 1),
  daily_loss_limit_pct numeric(5,2) not null default 2
    check(daily_loss_limit_pct > 0 and daily_loss_limit_pct <= 5),
  is_enabled boolean not null default false
);
create table public.copy_signals (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.copy_strategies(id),
  event_key text not null unique,
  payload jsonb not null,
  environment text not null default 'paper' check(environment = 'paper'),
  created_at timestamptz not null default now()
);
create table public.copy_orders (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.copy_signals(id),
  account_id uuid not null references public.copy_accounts(id),
  status text not null default 'queued',
  paper_order_id text,
  unique(signal_id,account_id)
);
create table public.copy_funding_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.copy_accounts(id),
  kind text not null check(kind in ('deposit','withdrawal')),
  amount numeric(20,2) not null check(amount > 0),
  status text not null default 'requested',
  broker_reference text,
  created_at timestamptz not null default now()
);
create table public.copy_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id),
  referred_user_id uuid not null unique references auth.users(id),
  broker_attribution text,
  created_at timestamptz not null default now(),
  check(referrer_user_id <> referred_user_id)
);
create table public.copy_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.copy_profiles enable row level security;
alter table public.copy_brokers enable row level security;
alter table public.copy_accounts enable row level security;
alter table public.copy_strategies enable row level security;
alter table public.copy_subscriptions enable row level security;
alter table public.copy_risk_profiles enable row level security;
alter table public.copy_signals enable row level security;
alter table public.copy_orders enable row level security;
alter table public.copy_funding_events enable row level security;
alter table public.copy_referrals enable row level security;
alter table public.copy_audit_events enable row level security;
create policy "own profile read" on public.copy_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own account read" on public.copy_accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own subscription read" on public.copy_subscriptions for select to authenticated
  using (exists(select 1 from public.copy_accounts a where a.id=account_id and a.user_id=(select auth.uid())));
create policy "own risk read" on public.copy_risk_profiles for select to authenticated
  using (exists(select 1 from public.copy_accounts a where a.id=account_id and a.user_id=(select auth.uid())));
create policy "own orders read" on public.copy_orders for select to authenticated
  using (exists(select 1 from public.copy_accounts a where a.id=account_id and a.user_id=(select auth.uid())));
create policy "own funding read" on public.copy_funding_events for select to authenticated
  using (exists(select 1 from public.copy_accounts a where a.id=account_id and a.user_id=(select auth.uid())));
create policy "own referral read" on public.copy_referrals for select to authenticated
  using (referrer_user_id=(select auth.uid()) or referred_user_id=(select auth.uid()));
-- Deliberately no INSERT/UPDATE/DELETE policies for member clients.
-- Trade and funding mutations must flow through audited server services.
