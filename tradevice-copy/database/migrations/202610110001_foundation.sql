-- Tradevice Copy only: apply to a NEW dedicated Supabase project, never the existing Tradevice/Pentagon DB.
-- Unapplied foundation; run ONLY in a new dedicated Supabase project.
-- PostgreSQL gen_random_uuid() is built in; no extension installation necessary.

create table public.copy_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
create table public.copy_brokers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  enabled boolean not null default false check (enabled = false)
);
create table public.copy_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker_id uuid not null references public.copy_brokers(id),
  external_account_id text not null,
  environment text not null default 'paper' check (environment = 'paper'),
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
  is_enabled boolean not null default false check (is_enabled = false)
);
create table public.copy_signals (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.copy_strategies(id),
  event_key text not null unique,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  environment text not null default 'paper' check(environment = 'paper'),
  created_at timestamptz not null default now()
);
create table public.copy_orders (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null references public.copy_signals(id),
  account_id uuid not null references public.copy_accounts(id),
  status text not null default 'queued' check(status in ('queued','accepted_simulated','rejected','cancelled','expired','unknown')),
  environment text not null default 'paper' check(environment = 'paper'),
  paper_order_id text,
  unique(signal_id,account_id)
);
create table public.copy_funding_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.copy_accounts(id),
  kind text not null check(kind in ('deposit','withdrawal')),
  amount numeric(20,2) not null check(amount > 0 and amount < 1000000000000),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'requested' check(status in ('requested','cancelled','rejected','simulated')),
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

revoke all on public.copy_profiles from public, anon, authenticated;
create policy permanent_member_only on public.copy_profiles as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on public.copy_brokers from public, anon, authenticated;
create policy permanent_member_only on public.copy_brokers as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on public.copy_accounts from public, anon, authenticated;
create policy permanent_member_only on public.copy_accounts as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on public.copy_strategies from public, anon, authenticated;
create policy permanent_member_only on public.copy_strategies as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on public.copy_subscriptions from public, anon, authenticated;
create policy permanent_member_only on public.copy_subscriptions as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on public.copy_risk_profiles from public, anon, authenticated;
create policy permanent_member_only on public.copy_risk_profiles as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on public.copy_signals from public, anon, authenticated;
create policy permanent_member_only on public.copy_signals as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on public.copy_orders from public, anon, authenticated;
create policy permanent_member_only on public.copy_orders as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on public.copy_funding_events from public, anon, authenticated;
create policy permanent_member_only on public.copy_funding_events as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on public.copy_referrals from public, anon, authenticated;
create policy permanent_member_only on public.copy_referrals as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on public.copy_audit_events from public, anon, authenticated;
create policy permanent_member_only on public.copy_audit_events as restrictive for select to authenticated using ((select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'true')='false');
revoke all on sequence public.copy_audit_events_id_seq from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.copy_profiles,public.copy_brokers,public.copy_accounts,public.copy_strategies,public.copy_subscriptions,public.copy_risk_profiles,public.copy_orders,public.copy_funding_events,public.copy_referrals to authenticated;
create policy read_paper_broker_catalog on public.copy_brokers for select to authenticated using (enabled=false);
create policy read_research_strategy_catalog on public.copy_strategies for select to authenticated using (enabled=false);
create index copy_accounts_owner_idx on public.copy_accounts(user_id,id);
create index copy_orders_account_idx on public.copy_orders(account_id,id);
create index copy_funding_account_idx on public.copy_funding_events(account_id,created_at);
create index copy_referrals_owner_idx on public.copy_referrals(referrer_user_id,id);
insert into public.copy_brokers(name) values ('Paper simulator (not a broker)');
insert into public.copy_strategies(code) values ('TRADEVICE_SHADOW_XAUUSD');
