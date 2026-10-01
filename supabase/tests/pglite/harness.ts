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

-- storage -----------------------------------------------------------------
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid default auth.uid(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
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

-- categories: 0003.
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true
);

-- merchants: 0002 (columns approve_merchant_application() writes).
create type merchant_status as enum ('registered', 'pending_verification', 'under_review', 'approved', 'active', 'suspended', 'rejected', 'closed');
create table merchants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  business_name text not null,
  business_category text,
  phone text,
  location text,
  status merchant_status not null default 'registered',
  approved_at timestamptz,
  approved_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table merchants enable row level security;

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
  /** The Tolo phone linked to this account (tolo_phone_links), if any. */
  phone: string | null;
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
  /** An account linked to a fresh Tolo phone through link_tolo_phone()
   * (migration 0072), exactly as tolo-app-login's first login leaves it.
   * `linked: false` gives an account whose profile phone is set but that
   * has no Tolo link -- i.e. an unverified, self-entered phone. */
  createUser(opts?: { phone?: string; linked?: boolean; adminTier?: "admin" | "super_admin"; role?: string }): Promise<TestUser>;
  createCategory(opts?: { isActive?: boolean }): Promise<string>;
  /** Fixture: puts a license object in `userId`'s folder of the licenses
   * bucket as service_role. Storage-policy behavior itself is tested
   * explicitly, as the user, in merchant_application_licenses.test.ts. */
  uploadLicense(userId: string, name?: string): Promise<string>;
}

let phoneCounter = 0;
/** A fresh, valid +2519XXXXXXXX number per call. */
export function nextPhone(): string {
  phoneCounter += 1;
  return `+2519${String(10_000_000 + phoneCounter).slice(-8)}`;
}

export interface HarnessOptions {
  /** SQL run after the Supabase stubs and before the migrations, for a test
   * that needs a table/function its migration references but the shared
   * stubs above don't model (kept in the test, not here, so the stubs only
   * ever grow for things many tests need). */
  prelude?: string;
}

export async function createHarness(migrations: string[], options: HarnessOptions = {}): Promise<Harness> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  if (options.prelude) await db.exec(options.prelude);
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

  const harness: Harness = {
    db,
    asUser: (userId, fn) => asRole("authenticated", userId, fn),
    asAnon: (fn) => asRole("anon", null, fn),
    asService: (fn) => asRole("service_role", null, fn),

    async createAuthUser({ profilePhone = null, adminTier, role = "customer" } = {}) {
      const id = randomUUID();
      await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@test.local`]);
      await db.query("insert into profiles (id, phone, role, admin_tier) values ($1, $2, $3, $4)", [id, profilePhone, role, adminTier ?? null]);
      return { id, phone: null };
    },

    async createUser({ phone = nextPhone(), linked = true, adminTier, role = "customer" } = {}) {
      const user = await harness.createAuthUser({ profilePhone: phone, adminTier, role });
      if (!linked) return { id: user.id, phone: null };
      await asRole("service_role", null, (tx) => tx.query("select link_tolo_phone($1, $2)", [user.id, phone]));
      return { id: user.id, phone };
    },

    async createCategory({ isActive = true } = {}) {
      const id = randomUUID();
      await db.query("insert into categories (id, name, slug, is_active) values ($1, $2, $3, $4)", [id, `Category ${id.slice(0, 8)}`, id, isActive]);
      return id;
    },

    async uploadLicense(userId, name = `${randomUUID()}.jpg`) {
      const path = `${userId}/${name}`;
      await db.query(
        "insert into storage.buckets (id, name) values ('merchant-application-licenses', 'merchant-application-licenses') on conflict do nothing",
      );
      await db.query("insert into storage.objects (bucket_id, name, owner) values ('merchant-application-licenses', $1, $2)", [path, userId]);
      return path;
    },
  };
  return harness;
}
