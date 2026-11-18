-- Sorteios Brasil — schema inicial
-- Rode este arquivo inteiro no Supabase: Dashboard > SQL Editor > New query > Run.
--
-- Modelo: cada coleção do antigo server/data/db.json vira uma tabela.
-- O registro completo fica em `data` (jsonb), exatamente no formato de server/types.ts.
-- Colunas geradas (raffle_id, status, ...) existem só para facilitar filtros/consultas no painel.
--
-- Segurança: só o backend (chave secreta / service_role) acessa estas tabelas.
-- RLS ligado e SEM policies => a chave publishable/anon não lê nem grava nada.

create table if not exists public.raffles (
  id          text primary key,
  seq         bigint generated always as identity,
  data        jsonb not null,
  slug        text generated always as (data->>'slug') stored,
  status      text generated always as (data->>'status') stored,
  updated_at  timestamptz not null default now()
);
create unique index if not exists raffles_slug_idx on public.raffles (slug);

create table if not exists public.reservations (
  id          text primary key,
  seq         bigint generated always as identity,
  data        jsonb not null,
  raffle_id   text generated always as (data->>'raffleId') stored,
  owner_id    text generated always as (data->>'ownerId') stored,
  status      text generated always as (data->>'status') stored,
  payment_id  text generated always as (data->>'paymentId') stored,
  updated_at  timestamptz not null default now()
);
create index if not exists reservations_raffle_idx on public.reservations (raffle_id);
create index if not exists reservations_owner_idx on public.reservations (owner_id);
create index if not exists reservations_payment_idx on public.reservations (payment_id);

create table if not exists public.referral_codes (
  id          text primary key,
  seq         bigint generated always as identity,
  data        jsonb not null,
  code        text generated always as (upper(data->>'code')) stored,
  updated_at  timestamptz not null default now()
);
create index if not exists referral_codes_code_idx on public.referral_codes (code);

create table if not exists public.referral_alerts (
  id          text primary key,
  seq         bigint generated always as identity,
  data        jsonb not null,
  raffle_id   text generated always as (data->>'raffleId') stored,
  updated_at  timestamptz not null default now()
);

create table if not exists public.referral_payouts (
  id          text primary key,
  seq         bigint generated always as identity,
  data        jsonb not null,
  referral_id text generated always as (data->>'referralId') stored,
  updated_at  timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id          text primary key,
  seq         bigint generated always as identity,
  data        jsonb not null,
  action      text generated always as (data->>'action') stored,
  updated_at  timestamptz not null default now()
);

-- RLS + permissões: nada para anon/authenticated, tudo para service_role (backend).
do $$
declare t text;
begin
  foreach t in array array['raffles','reservations','referral_codes','referral_alerts','referral_payouts','audit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
