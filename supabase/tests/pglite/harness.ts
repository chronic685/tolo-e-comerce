// Runs real migration SQL against an in-process Postgres (PGlite), so RLS
// policies, triggers and SQL functions can be tested without any database
// server -- never the live project, and no Docker/local Supabase needed.
//
// PGlite is plain Postgres, not Supabase, so the few Supabase pieces the
// migrations under test rely on are stubbed below: the anon/authenticated/
// service_role roles and their default grants, auth.users + auth.uid(), and
// the subset of the public schema those migrations reference. Each stub
// mirrors the real definition it stands in for (named in its comment);
// anything not listed here isn't modelled.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite, type Transaction } from "@electric-sql/pglite";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../migrations");

const SUPABASE_STUBS = /* sql */ `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- Supabase's own default privileges on public: every role can reach every
-- table and function unless a migration revokes it (which is why
-- migrations revoke from anon/authenticated explicitly, not just public).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- auth --------------------------------------------------------------------
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text unique,               -- stored without the leading "+", like GoTrue
  phone_confirmed_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- public prerequisites ----------------------------------------------------
create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- profiles: columns from 0001/0024/0028/0049/0050.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  phone_verified boolean not null default false,
  role text not null default 'customer',
  admin_tier text check (admin_tier in ('admin', 'super_admin')),
  account_status text not null default 'active',
  permissions jsonb not null default '[]'::jsonb
);

-- is_tolo_admin(): exactly migration 0050's definition.
create function is_tolo_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and account_status = 'active' and admin_tier is not null
  );
$$;

-- profiles RLS: the real profiles_update_own (0014, as amended by 0052) --
-- an active account may update ANY column of its own row, phone and
-- phone_verified included. That is exactly why nothing may trust them.
alter table profiles enable row level security;
create policy profiles_select_own on profiles for select using (id = auth.uid() or is_tolo_admin());
create policy profiles_update_own on profiles
  for update using (((id = auth.uid()) and account_status = 'active') or is_tolo_admin());
`;

export interface TestUser {
  id: string;
}

export interface Harness {
  db: PGlite;
  /** Runs `fn` as a signed-in user (role authenticated, auth.uid() = userId),
   * in a transaction that rolls back if `fn` throws. */
  asUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T>;
  /** Runs `fn` as the anon role (no session). */
  asAnon<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  /** Runs `fn` as service_role (what Edge Functions use; bypasses RLS). */
  asService<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  /** An auth user + profiles row, as Supabase Auth + handle_new_user() would
   * create them. `profilePhone` is the self-editable profiles.phone only --
   * it links nothing. */
  createAuthUser(opts?: { profilePhone?: string | null; adminTier?: "admin" | "super_admin"; role?: string }): Promise<TestUser>;
}

let phoneCounter = 0;
/** A fresh, valid +2519XXXXXXXX number per call. */
export function nextPhone(): string {
  phoneCounter += 1;
  return `+2519${String(10_000_000 + phoneCounter).slice(-8)}`;
}

export async function createHarness(migrations: string[]): Promise<Harness> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const file of migrations) {
    await db.exec(readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"));
  }

  async function asRole<T>(role: string, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
      return fn(tx);
    });
  }

  return {
    db,
    asUser: (userId, fn) => asRole("authenticated", userId, fn),
    asAnon: (fn) => asRole("anon", null, fn),
    asService: (fn) => asRole("service_role", null, fn),

    async createAuthUser({ profilePhone = null, adminTier, role = "customer" } = {}) {
      const id = randomUUID();
      await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
      await db.query("insert into profiles (id, phone, role, admin_tier) values ($1, $2, $3, $4)", [id, profilePhone, role, adminTier ?? null]);
      return { id };
    },
  };
}
