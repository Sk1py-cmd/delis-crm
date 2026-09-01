import { db } from "@/db";
import * as s from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { hashPassword, passwordValidationError } from "@/server/password";

let seeded: Promise<void> | null = null;

const DDL = `
create table if not exists categories (id serial primary key, name text not null, slug text not null, kind text not null default 'home', icon text not null default '🧴', created_at timestamp not null default now());
create table if not exists products (id serial primary key, name text not null, slug text not null, sku text not null, barcode text not null default '', category_id integer, description text not null default '', brand text not null default 'DELIS', country text not null default 'Uzbekistan', volume text not null default '1 L', weight numeric not null default 1, price numeric not null default 0, cost numeric not null default 0, vat integer not null default 12, discount integer not null default 0, stock integer not null default 0, low_stock integer not null default 20, image text not null default '', images jsonb not null default '[]'::jsonb, color text not null default '#8b5cf6', is_popular boolean not null default false, is_new boolean not null default false, is_featured boolean not null default false, status text not null default 'active', sold integer not null default 0, created_at timestamp not null default now());
create table if not exists customers (id serial primary key, first_name text not null, last_name text not null default '', username text not null default '', telegram_id text not null default '', phone text not null default '', email text not null default '', city text not null default 'Tashkent', region text not null default 'Toshkent', address text not null default '', language text not null default 'ru', source text not null default 'telegram', is_vip boolean not null default false, bonus integer not null default 0, tags jsonb not null default '[]'::jsonb, notes text not null default '', orders_count integer not null default 0, total_spent numeric not null default 0, last_active_at timestamp not null default now(), created_at timestamp not null default now());
create table if not exists orders (id serial primary key, number text not null, customer_id integer, agent_id integer, status text not null default 'new', channel text not null default 'miniapp', payment text not null default 'click', sync_key text, total numeric not null default 0, profit numeric not null default 0, comment text not null default '', timeline jsonb not null default '[]'::jsonb, created_at timestamp not null default now());
create table if not exists order_items (id serial primary key, order_id integer not null, product_id integer not null, name text not null, qty integer not null default 1, price numeric not null default 0);
create table if not exists agents (id serial primary key, name text not null, phone text not null default '', telegram text not null default '', email text not null default '', region text not null default 'Toshkent', route text not null default '', plan numeric not null default 0, fact numeric not null default 0, commission integer not null default 7, visits integer not null default 0, status text not null default 'active', avatar_color text not null default '#8b5cf6');
create table if not exists transactions (id serial primary key, kind text not null, category text not null default 'sales', account text not null default 'click', amount numeric not null default 0, reference_type text not null default '', reference_id integer, actor_user_id integer, actor_name text not null default '', note text not null default '', created_at timestamp not null default now());
create table if not exists messages (id serial primary key, customer_id integer not null, body text not null, from_admin boolean not null default false, kind text not null default 'text', read_at timestamp, created_at timestamp not null default now());
create table if not exists templates (id serial primary key, title text not null, body text not null);
create table if not exists stock_moves (id serial primary key, product_id integer not null, kind text not null, qty integer not null default 0, note text not null default '', created_at timestamp not null default now());
create table if not exists warehouses (id serial primary key, code text not null unique, name text not null, city text not null default '', address text not null default '', is_default boolean not null default false, status text not null default 'active', created_at timestamp not null default now(), updated_at timestamp not null default now());
create table if not exists warehouse_stocks (id serial primary key, warehouse_id integer not null, product_id integer not null, on_hand integer not null default 0, reserved integer not null default 0, updated_at timestamp not null default now());
create table if not exists inventory_migrations (key text primary key, applied_at timestamp not null default now());
create table if not exists stock_reservations (id serial primary key, order_id integer, warehouse_id integer not null, product_id integer not null, qty integer not null, status text not null default 'active', reason text not null default '', expires_at timestamp, released_at timestamp, created_by_user_id integer, created_by_name text not null default '', created_at timestamp not null default now());
create table if not exists inventory_counts (id serial primary key, warehouse_id integer not null, number text not null, title text not null default '', status text not null default 'draft', notes text not null default '', started_by_user_id integer, started_by_name text not null default '', posted_by_user_id integer, posted_by_name text not null default '', started_at timestamp, posted_at timestamp, created_at timestamp not null default now(), updated_at timestamp not null default now());
create table if not exists inventory_count_lines (id serial primary key, inventory_count_id integer not null, product_id integer not null, system_qty integer not null default 0, counted_qty integer, difference integer, note text not null default '', counted_by_user_id integer, counted_at timestamp, updated_at timestamp not null default now());
alter table stock_moves add column if not exists warehouse_id integer;
alter table stock_moves add column if not exists balance_after integer;
alter table stock_moves add column if not exists reference_type text not null default '';
alter table stock_moves add column if not exists reference_id integer;
alter table stock_moves add column if not exists actor_user_id integer;
alter table stock_moves add column if not exists actor_name text not null default '';
alter table transactions add column if not exists reference_type text not null default '';
alter table transactions add column if not exists reference_id integer;
alter table transactions add column if not exists actor_user_id integer;
alter table transactions add column if not exists actor_name text not null default '';
alter table transactions add column if not exists channel text not null default '';
create index if not exists transactions_channel_created_at_idx on transactions (channel, created_at desc);
create unique index if not exists transactions_order_income_unique on transactions (reference_type, reference_id, kind) where reference_type = 'order' and kind = 'income';
create unique index if not exists warehouses_one_default_unique on warehouses ((is_default)) where is_default;
create unique index if not exists warehouse_stocks_warehouse_product_unique on warehouse_stocks (warehouse_id, product_id);
create index if not exists warehouse_stocks_product_idx on warehouse_stocks (product_id);
create index if not exists stock_reservations_order_status_idx on stock_reservations (order_id, status);
create index if not exists stock_reservations_warehouse_product_status_idx on stock_reservations (warehouse_id, product_id, status);
create unique index if not exists inventory_counts_number_unique on inventory_counts (number);
create index if not exists inventory_counts_warehouse_status_idx on inventory_counts (warehouse_id, status);
create unique index if not exists inventory_count_lines_count_product_unique on inventory_count_lines (inventory_count_id, product_id);
create index if not exists stock_moves_warehouse_created_at_idx on stock_moves (warehouse_id, created_at desc);
create table if not exists users (id serial primary key, name text not null, email text not null default '', role text not null default 'manager', status text not null default 'active', last_ip text not null default '', device text not null default '', two_fa boolean not null default false, two_fa_secret_encrypted text not null default '', two_fa_enabled_at timestamp, owner_initialized_at timestamp, agent_id integer unique, login text not null default '', password_hash text not null default '', last_login_at timestamp not null default now());
create table if not exists activity (id serial primary key, actor_user_id integer, actor text not null, action text not null, entity text not null default '', entity_type text not null default '', entity_id integer, event_type text not null default 'business', severity text not null default 'info', ip text not null default '', metadata jsonb not null default '{}'::jsonb, created_at timestamp not null default now());
create table if not exists content_blocks (id serial primary key, surface text not null, "key" text not null, title text not null, body text not null default '', enabled boolean not null default true, updated_at timestamp not null default now());
create table if not exists sessions (id serial primary key, token text not null unique, user_id integer not null, device text not null default '', ip text not null default '', expires_at timestamp not null, created_at timestamp not null default now());
create table if not exists two_factor_challenges (id serial primary key, token_hash text not null unique, user_id integer not null, attempts integer not null default 0, expires_at timestamp not null, created_at timestamp not null default now());
create table if not exists two_factor_enrollments (id serial primary key, token_hash text not null unique, user_id integer not null, secret_encrypted text not null, attempts integer not null default 0, expires_at timestamp not null, created_at timestamp not null default now());
create table if not exists two_factor_backup_codes (id serial primary key, user_id integer not null, code_hash text not null, used_at timestamp, created_at timestamp not null default now());
alter table users add column if not exists password_hash text not null default '';
alter table users add column if not exists login text not null default '';
alter table users add column if not exists agent_id integer;
alter table users add column if not exists owner_initialized_at timestamp;
alter table users add column if not exists two_fa_secret_encrypted text not null default '';
alter table users add column if not exists two_fa_enabled_at timestamp;
alter table two_factor_enrollments add column if not exists attempts integer not null default 0;
alter table users alter column last_ip set default '';
alter table users alter column device set default '';
alter table activity add column if not exists actor_user_id integer;
alter table activity add column if not exists entity_type text not null default '';
alter table activity add column if not exists entity_id integer;
alter table activity add column if not exists event_type text not null default 'business';
alter table activity add column if not exists severity text not null default 'info';
alter table activity add column if not exists ip text not null default '';
alter table activity add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table sessions add column if not exists ip text not null default '';
alter table orders add column if not exists sync_key text;
create unique index if not exists orders_sync_key_unique on orders (sync_key) where sync_key is not null and sync_key <> '';
create index if not exists activity_created_at_idx on activity (created_at desc);
create index if not exists activity_actor_user_id_idx on activity (actor_user_id);
create index if not exists sessions_expires_at_idx on sessions (expires_at);
-- Keep the newest record before adding the singleton-flow guarantees to a pre-release database.
with ranked_two_factor_challenges as (
  select id, row_number() over (partition by user_id order by created_at desc, id desc) as position
  from two_factor_challenges
)
delete from two_factor_challenges where id in (select id from ranked_two_factor_challenges where position > 1);
with ranked_two_factor_enrollments as (
  select id, row_number() over (partition by user_id order by created_at desc, id desc) as position
  from two_factor_enrollments
)
delete from two_factor_enrollments where id in (select id from ranked_two_factor_enrollments where position > 1);
create unique index if not exists two_factor_challenges_user_id_unique on two_factor_challenges (user_id);
create index if not exists two_factor_challenges_expires_at_idx on two_factor_challenges (expires_at);
create unique index if not exists two_factor_enrollments_user_id_unique on two_factor_enrollments (user_id);
create index if not exists two_factor_enrollments_expires_at_idx on two_factor_enrollments (expires_at);
create index if not exists two_factor_backup_codes_user_id_idx on two_factor_backup_codes (user_id);
-- Old UI flags did not contain a real TOTP secret or enablement timestamp. Do not let a legacy flag lock anyone out.
update users set two_fa = false, two_fa_secret_encrypted = '', two_fa_enabled_at = null
where two_fa = true and two_fa_enabled_at is null and coalesce(two_fa_secret_encrypted, '') = '';
-- Legacy demo data had a non-login placeholder Owner. Keep the oldest existing owner
-- for one-time environment bootstrap and demote duplicates before enforcing singleton.
update users set role = 'admin' where role = 'owner' and login = '';
with ranked_owners as (
  select id, row_number() over (order by id) as position from users where role = 'owner'
)
update users set role = 'admin' where id in (select id from ranked_owners where position > 1);
-- Old versions could issue duplicate login values. Preserve rows under a unique legacy login
-- so the Owner can reset them instead of preventing the application from starting.
with ranked_logins as (
  select id, row_number() over (partition by lower(login) order by id) as position
  from users where login <> ''
)
update users set login = 'legacy-migrated-' || id::text
where id in (select id from ranked_logins where position > 1);
create unique index if not exists users_login_lower_unique on users (lower(login)) where login <> '';
create unique index if not exists users_agent_id_unique on users (agent_id) where agent_id is not null;
create unique index if not exists users_single_owner_unique on users ((role)) where role = 'owner';
create table if not exists sync_events (id serial primary key, source text not null default 'crm', target text not null default 'all', entity text not null, action text not null, status text not null default 'synced', payload jsonb not null default '{}'::jsonb, created_at timestamp not null default now());
create table if not exists broadcasts (id serial primary key, title text not null default '', body text not null default '', recipients integer not null default 0, channel text not null default 'telegram', status text not null default 'queued', scheduled_at timestamp, sent_at timestamp not null default now(), created_by text not null default '', created_at timestamp not null default now());
alter table broadcasts alter column status set default 'queued';
create table if not exists broadcast_recipients (id serial primary key, broadcast_id integer not null, customer_id integer not null, channel text not null default 'telegram', status text not null default 'queued', created_at timestamp not null default now());
create unique index if not exists broadcast_recipients_broadcast_customer_unique on broadcast_recipients (broadcast_id, customer_id);
create index if not exists broadcast_recipients_customer_created_at_idx on broadcast_recipients (customer_id, created_at desc);
create table if not exists campaigns (id serial primary key, title text not null default '', body text not null, channel text not null default 'telegram', attachments jsonb not null default '[]'::jsonb, segment jsonb not null default '{}'::jsonb, recipients integer not null default 0, delivered integer not null default 0, status text not null default 'sent', scheduled_at timestamp, created_at timestamp not null default now());
create table if not exists promocodes (id serial primary key, code text not null unique, discount_type text not null default 'percent', discount_value numeric not null default 15, min_order_amount numeric not null default 100000, max_uses integer not null default 100, used_count integer not null default 0, status text not null default 'active', valid_until timestamp, created_at timestamp not null default now());
create table if not exists marketing_triggers (id serial primary key, title text not null, event_key text not null, action_type text not null default 'discount_message', message_body text not null, discount_bonus integer not null default 0, is_active boolean not null default true, triggered_count integer not null default 0, created_at timestamp not null default now());
alter table customers add column if not exists marketing_consent boolean not null default false;
alter table customers add column if not exists marketing_consent_at timestamp;
create table if not exists automation_runs (id serial primary key, trigger_id integer not null, customer_id integer not null, event_key text not null, action_type text not null default 'discount_message', status text not null default 'queued', created_at timestamp not null default now());
alter table automation_runs alter column status set default 'queued';
create unique index if not exists automation_runs_trigger_customer_event_unique on automation_runs (trigger_id, customer_id, event_key);
create index if not exists automation_runs_customer_created_at_idx on automation_runs (customer_id, created_at desc);
create table if not exists suppliers (id serial primary key, name text not null, contact_person text not null default '', phone text not null default '', email text not null default '', country text not null default 'Uzbekistan', city text not null default 'Tashkent', address text not null default '', inn text not null default '', category text not null default 'chemicals', rating integer not null default 5, lead_time_days integer not null default 7, total_purchased numeric not null default 0, status text not null default 'active', notes text not null default '', created_at timestamp not null default now());
create table if not exists purchase_orders (id serial primary key, number text not null, supplier_id integer not null, warehouse_id integer, status text not null default 'draft', total numeric not null default 0, paid numeric not null default 0, expected_at timestamp, received_at timestamp, notes text not null default '', created_by text not null default '', created_at timestamp not null default now());
alter table purchase_orders add column if not exists warehouse_id integer;
create index if not exists purchase_orders_warehouse_status_idx on purchase_orders (warehouse_id, status);
create table if not exists purchase_items (id serial primary key, purchase_order_id integer not null, product_id integer not null, name text not null, qty integer not null default 1, price numeric not null default 0);
create table if not exists returns (id serial primary key, order_id integer not null, customer_id integer, reason text not null default 'defect', status text not null default 'pending', refund_amount numeric not null default 0, restock_items boolean not null default false, notes text not null default '', created_by text not null default '', created_at timestamp not null default now());
create table if not exists couriers (id serial primary key, name text not null, phone text not null default '', vehicle text not null default 'car', zone text not null default 'Tashkent', status text not null default 'available', active_deliveries integer not null default 0, completed_today integer not null default 0, rating integer not null default 5, avatar_color text not null default '#3b82f6', created_at timestamp not null default now());
create table if not exists deliveries (id serial primary key, order_id integer not null, courier_id integer, status text not null default 'pending', address text not null default '', city text not null default 'Tashkent', scheduled_at timestamp, delivered_at timestamp, notes text not null default '', created_at timestamp not null default now());
create table if not exists agent_routes (id serial primary key, agent_id integer not null, route_date text not null, title text not null default '', notes text not null default '', status text not null default 'planned', assigned_by_user_id integer, assigned_by_name text not null default '', updated_at timestamp not null default now(), created_at timestamp not null default now());
create table if not exists agent_route_stops (id serial primary key, route_id integer not null, sequence integer not null default 1, store_name text not null, store_address text not null default '', planned_latitude numeric, planned_longitude numeric, status text not null default 'planned', visit_id integer, notes text not null default '', completed_at timestamp, updated_at timestamp not null default now(), created_at timestamp not null default now());
create table if not exists agent_visits (id serial primary key, agent_id integer not null, route_id integer, route_stop_id integer, store_name text not null, store_address text not null default '', gps_coords text not null default '', latitude numeric, longitude numeric, accuracy_meters numeric, location_captured_at timestamp, status text not null default 'order_placed', order_total numeric not null default 0, notes text not null default '', photos jsonb not null default '[]'::jsonb, source text not null default 'online', sync_key text, recorded_by_user_id integer, recorded_by_name text not null default '', visited_at timestamp not null default now(), created_at timestamp not null default now());
alter table agent_visits alter column gps_coords set default '';
alter table agent_visits add column if not exists route_id integer;
alter table agent_visits add column if not exists route_stop_id integer;
alter table agent_visits add column if not exists latitude numeric;
alter table agent_visits add column if not exists longitude numeric;
alter table agent_visits add column if not exists accuracy_meters numeric;
alter table agent_visits add column if not exists location_captured_at timestamp;
alter table agent_visits add column if not exists source text not null default 'online';
alter table agent_visits add column if not exists sync_key text;
alter table agent_visits add column if not exists recorded_by_user_id integer;
alter table agent_visits add column if not exists recorded_by_name text not null default '';
alter table agent_visits add column if not exists created_at timestamp not null default now();
create unique index if not exists agent_routes_agent_date_unique on agent_routes (agent_id, route_date);
create index if not exists agent_route_stops_route_sequence_idx on agent_route_stops (route_id, sequence);
create index if not exists agent_route_stops_status_idx on agent_route_stops (status);
create unique index if not exists agent_visits_sync_key_unique on agent_visits (sync_key) where sync_key is not null and sync_key <> '';
create index if not exists agent_visits_agent_visited_at_idx on agent_visits (agent_id, visited_at desc);
create index if not exists agent_visits_route_stop_id_idx on agent_visits (route_stop_id);
create table if not exists tasks (id serial primary key, title text not null, description text not null default '', assignee text not null default '', assignee_user_id integer, priority text not null default 'mid', status text not null default 'todo', link_type text not null default '', link_label text not null default '', due_at timestamp, completed_at timestamp, created_by text not null default '', created_by_user_id integer, updated_at timestamp not null default now(), created_at timestamp not null default now());
create table if not exists employee_profiles (id serial primary key, user_id integer not null, position text not null default '', department text not null default '', phone text not null default '', hire_date timestamp, notes text not null default '', avatar_color text not null default '#64748b', updated_at timestamp not null default now(), created_at timestamp not null default now());
create table if not exists employee_kpis (id serial primary key, user_id integer not null, period text not null, metric text not null, label text not null default '', target numeric not null default 0, actual numeric not null default 0, unit text not null default '', note text not null default '', updated_by_user_id integer, updated_at timestamp not null default now(), created_at timestamp not null default now());
create table if not exists approvals (id serial primary key, title text not null, description text not null default '', type text not null default 'other', priority text not null default 'normal', status text not null default 'pending', requester_user_id integer, requester_name text not null default '', reviewer_user_id integer, reviewer_name text not null default '', related_task_id integer, amount numeric not null default 0, decision_note text not null default '', due_at timestamp, reviewed_at timestamp, updated_at timestamp not null default now(), created_at timestamp not null default now());
alter table tasks add column if not exists assignee_user_id integer;
alter table tasks add column if not exists completed_at timestamp;
alter table tasks add column if not exists created_by_user_id integer;
alter table tasks add column if not exists updated_at timestamp not null default now();
alter table approvals add column if not exists priority text not null default 'normal';
-- Convert legacy name-only task links where the matching account is unambiguous.
update tasks set assignee_user_id = users.id
from users
where tasks.assignee_user_id is null and lower(trim(tasks.assignee)) = lower(trim(users.name));
update tasks set created_by_user_id = users.id
from users
where tasks.created_by_user_id is null and lower(trim(tasks.created_by)) = lower(trim(users.name));
update tasks set completed_at = coalesce(completed_at, updated_at, created_at)
where status = 'done' and completed_at is null;
create unique index if not exists employee_profiles_user_id_unique on employee_profiles (user_id);
create unique index if not exists employee_kpis_user_period_metric_unique on employee_kpis (user_id, period, metric);
create index if not exists employee_kpis_period_idx on employee_kpis (period);
create index if not exists approvals_status_created_at_idx on approvals (status, created_at desc);
create index if not exists approvals_requester_user_id_idx on approvals (requester_user_id);
create index if not exists approvals_related_task_id_idx on approvals (related_task_id);
create index if not exists tasks_assignee_user_id_idx on tasks (assignee_user_id);
create index if not exists tasks_created_by_user_id_idx on tasks (created_by_user_id);
create index if not exists tasks_status_updated_at_idx on tasks (status, updated_at desc);
create table if not exists agent_messages (id serial primary key, agent_id integer not null, body text not null, from_admin boolean not null default false, read_at timestamp, created_at timestamp not null default now());
create table if not exists integrations (id serial primary key, key text not null unique, title text not null, enabled boolean not null default false, credentials jsonb not null default '{}'::jsonb, status text not null default 'not_configured', last_check_at timestamp, updated_at timestamp not null default now());
create table if not exists knowledge_base (id serial primary key, title text not null, category text not null default 'general', content text not null default '', icon text not null default '📄', views integer not null default 0, is_pinned boolean not null default false, created_by text not null default '', updated_at timestamp not null default now(), created_at timestamp not null default now());
`;

async function createTables() {
  await db.execute(sql.raw(DDL));
}

/**
 * Migrate the legacy aggregate `products.stock` into the default physical
 * warehouse exactly once per product. Later inventory operations own this table.
 */
export async function bootstrapWarehouseStocks() {
  await db.execute(sql.raw(`
    insert into warehouses (code, name, city, is_default, status)
    values ('MAIN', 'Основной склад', 'Tashkent', true, 'active')
    on conflict (code) do nothing;

    insert into warehouse_stocks (warehouse_id, product_id, on_hand, reserved)
    select warehouse.id, product.id, product.stock, 0
    from warehouses warehouse
    cross join products product
    where warehouse.is_default = true
      and warehouse.status = 'active'
    on conflict (warehouse_id, product_id) do nothing;

    -- One compatibility cutover absorbs legacy aggregate writes made after the
    -- physical table first existed but before all writer paths were migrated.
    with marker as (
      insert into inventory_migrations (key) values ('warehouse_stock_cutover_v1')
      on conflict (key) do nothing
      returning key
    ), main as (
      select id from warehouses where is_default = true and status = 'active' limit 1
    ), availability as (
      select product_id, sum(on_hand - reserved) as available
      from warehouse_stocks
      group by product_id
    ), deltas as (
      select product.id as product_id, product.stock - coalesce(availability.available, 0) as delta
      from products product
      left join availability on availability.product_id = product.id
    )
    update warehouse_stocks balance
    set on_hand = balance.on_hand + deltas.delta, updated_at = now()
    from marker, main, deltas
    where balance.warehouse_id = main.id
      and balance.product_id = deltas.product_id
      and deltas.delta <> 0
      and balance.on_hand + deltas.delta >= balance.reserved;
  `));
}

const OWNER_LOGIN_PATTERN = /^[a-z0-9._-]{3,24}$/;

type OwnerBootstrap = { login: string; password: string; name: string; email: string };

function ownerBootstrapFromEnv(): OwnerBootstrap {
  const login = (process.env.OWNER_LOGIN ?? "").trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD ?? "";
  const name = (process.env.OWNER_NAME ?? "Owner").trim() || "Owner";
  const email = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  const passwordError = passwordValidationError(password);

  if (!OWNER_LOGIN_PATTERN.test(login) || passwordError) {
    throw new Error(
      "Первый Owner не настроен. Укажите OWNER_LOGIN (3–24 символа) и OWNER_PASSWORD (минимум 10 символов) в переменных окружения.",
    );
  }
  return { login, password, name, email };
}

/**
 * Creates the singleton Owner from environment variables. Legacy data without
 * owner_initialized_at is migrated once to the environment-provided credential,
 * so an old shipped demo password cannot remain an Owner password.
 */
async function ensureOwner() {
  const [existingOwner] = await db
    .select({ id: s.users.id, ownerInitializedAt: s.users.ownerInitializedAt })
    .from(s.users)
    .where(eq(s.users.role, "owner"))
    .limit(1);
  if (existingOwner?.ownerInitializedAt) return;

  const config = ownerBootstrapFromEnv();
  const loginInUse = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(sql`lower(${s.users.login}) = ${config.login}`)
    .limit(2);
  if (loginInUse.some((user) => user.id !== existingOwner?.id)) {
    throw new Error("OWNER_LOGIN уже занят существующим пользователем.");
  }

  const ownerValues = {
    name: config.name,
    login: config.login,
    email: config.email,
    role: "owner" as const,
    passwordHash: hashPassword(config.password),
    twoFa: false,
    status: "active",
    ownerInitializedAt: new Date(),
  };

  if (existingOwner) {
    await db.update(s.users).set(ownerValues).where(eq(s.users.id, existingOwner.id));
    return;
  }
  await db.insert(s.users).values(ownerValues);
}

const shouldSeedDemoData = process.env.SEED_DEMO_DATA === "true";

const CATEGORIES = [
  { name: "Home Care", slug: "home-care", kind: "home", icon: "🏠" },
  { name: "Auto Care", slug: "auto-care", kind: "auto", icon: "🚗" },
  { name: "Kitchen", slug: "kitchen", kind: "home", icon: "🍽️" },
  { name: "Bathroom", slug: "bathroom", kind: "home", icon: "🛁" },
  { name: "Laundry", slug: "laundry", kind: "home", icon: "🧺" },
];

const PRODUCTS: [string, number, string, number, number, string][] = [
  ["DELIS Car Shampoo Active Foam", 2, "🚗", 42000, 24000, "5 L"],
  ["DELIS Wax Protect Ceramic", 2, "✨", 89000, 51000, "500 ml"],
  ["DELIS Glass Cleaner Crystal", 2, "🪟", 21000, 11000, "750 ml"],
  ["DELIS Engine Cleaner Pro", 2, "⚙️", 64000, 37000, "1 L"],
  ["DELIS Universal Cleaner Fresh", 1, "🧴", 27000, 14000, "1 L"],
  ["DELIS Floor Cleaner Lavender", 1, "🧹", 31000, 16500, "2 L"],
  ["DELIS Dishwashing Gel Lemon", 3, "🍋", 18000, 8900, "1 L"],
  ["DELIS Dishwashing Gel Aloe", 3, "🌿", 19500, 9400, "1 L"],
  ["DELIS Laundry Gel Color", 5, "🧺", 74000, 44000, "3 L"],
  ["DELIS Laundry Gel White", 5, "🤍", 76000, 45000, "3 L"],
  ["DELIS Fabric Softener Silk", 5, "🌸", 39000, 21000, "2 L"],
  ["DELIS Bathroom Anti-Calc", 4, "🛁", 29000, 15000, "750 ml"],
  ["DELIS Toilet Gel Ocean", 4, "🌊", 17000, 8000, "750 ml"],
  ["DELIS Kitchen Degreaser Max", 3, "🔥", 33000, 17500, "1 L"],
  ["DELIS Tire Shine Black", 2, "🛞", 47000, 25000, "600 ml"],
  ["DELIS Interior Detailer Silk", 2, "🪑", 55000, 29000, "500 ml"],
];

const NAMES: [string, string, string][] = [
  ["Азиз", "Каримов", "azizkarimov"],
  ["Дилноза", "Рахимова", "dilnoza_r"],
  ["Тимур", "Сафаров", "timursaf"],
  ["Малика", "Юсупова", "malika_y"],
  ["Бекзод", "Тураев", "bekzod_t"],
  ["Нилуфар", "Хасанова", "nilufar_h"],
  ["Жасур", "Ортиков", "jasur_o"],
  ["Камила", "Абдуллаева", "kamila_a"],
  ["Рустам", "Эргашев", "rustam_e"],
  ["Севара", "Мирзаева", "sevara_m"],
  ["Отабек", "Нурматов", "otabek_n"],
  ["Гулнора", "Саидова", "gulnora_s"],
];

const CITIES = ["Tashkent", "Samarkand", "Bukhara", "Andijan", "Fergana", "Namangan"];
const SOURCES = ["telegram", "miniapp", "website", "instagram", "agent", "facebook"];
const STATUSES = ["new", "confirmed", "processing", "paid", "packed", "courier", "shipped", "delivered", "cancelled", "returned"];

function rnd(n: number) {
  return Math.floor(Math.random() * n);
}

async function run() {
  await createTables();
  await ensureOwner();
  if (!shouldSeedDemoData) {
    await bootstrapWarehouseStocks();
    return;
  }

  const existing = await db.execute<{ count: string }>(sql`select count(*)::text as count from products`);
  if (Number(existing.rows[0]?.count ?? "0") > 0) {
    await bootstrapWarehouseStocks();
    return;
  }

  const cats = await db.insert(s.categories).values(CATEGORIES).returning();

  const PROD_IMAGES = [
  "https://picsum.photos/id/1011/800/600",
  "https://picsum.photos/id/160/800/600",
  "https://picsum.photos/id/201/800/600",
  "https://picsum.photos/id/251/800/600",
  "https://picsum.photos/id/29/800/600",
  "https://picsum.photos/id/30/800/600",
  "https://picsum.photos/id/48/800/600",
  "https://picsum.photos/id/60/800/600",
];

const prodRows = PRODUCTS.map(([name, catIdx, icon, price, cost, volume], i) => ({
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    sku: `DLS-${1000 + i}`,
    barcode: `48600${100000 + i}`,
    categoryId: cats[catIdx - 1]?.id ?? cats[0].id,
    description: `Профессиональное средство ${name} от DELIS. Концентрированная формула, безопасно для поверхностей, экономичный расход.`,
    volume,
    price: String(price),
    cost: String(cost),
    stock: 12 + rnd(400),
    image: PROD_IMAGES[i % PROD_IMAGES.length],
    images: [
      PROD_IMAGES[i % PROD_IMAGES.length],
      PROD_IMAGES[(i + 1) % PROD_IMAGES.length],
      PROD_IMAGES[(i + 2) % PROD_IMAGES.length],
    ],
    isPopular: i % 3 === 0,
    isNew: i % 5 === 0,
    isFeatured: i % 4 === 0,
    sold: 40 + rnd(900),
  }));
  const prods = await db.insert(s.products).values(prodRows).returning();
  const now = Date.now();

  const custRows = NAMES.map(([f, l, u], i) => ({
    firstName: f,
    lastName: l,
    username: u,
    telegramId: String(500000000 + i * 13337),
    phone: `+9989${rnd(9)}${1000000 + rnd(8999999)}`,
    email: `${u}@mail.uz`,
    city: CITIES[i % CITIES.length],
    source: SOURCES[i % SOURCES.length],
    isVip: i % 4 === 0,
    bonus: rnd(120) * 1000,
    marketingConsent: i % 5 !== 0,
    marketingConsentAt: i % 5 !== 0 ? new Date(now - (i + 1) * 86400000) : null,
    tags: i % 4 === 0 ? ["VIP", "Опт"] : ["Розница"],
    address: `ул. Амира Темура, ${10 + i}`,
  }));
  const custs = await db.insert(s.customers).values(custRows).returning();

  const agentRows = [
    ["Шохрух Абдуллаев", "Toshkent", "Чиланзар — Юнусабад", 120_000_000, "#8b5cf6"],
    ["Диёр Комилов", "Samarqand", "Центр — Ургут", 80_000_000, "#3b82f6"],
    ["Азамат Юлдашев", "Farg'ona", "Фергана — Маргилан", 65_000_000, "#22c55e"],
    ["Мадина Хамидова", "Buxoro", "Бухара — Гиждуван", 54_000_000, "#f97316"],
    ["Санжар Ниязов", "Andijon", "Андижан — Асака", 47_000_000, "#ec4899"],
  ].map(([name, region, route, plan, color], i) => ({
    name: String(name),
    region: String(region),
    route: String(route),
    plan: String(plan),
    fact: String(Math.round(Number(plan) * (0.55 + Math.random() * 0.7))),
    phone: `+9989${rnd(9)}${1000000 + rnd(8999999)}`,
    telegram: `@delis_agent_${i + 1}`,
    email: `agent${i + 1}@delis.uz`,
    visits: 20 + rnd(120),
    commission: 5 + rnd(6),
    avatarColor: String(color),
  }));
  const ags = await db.insert(s.agents).values(agentRows).returning();

  await db.insert(s.agentVisits).values([
    {
      agentId: ags[0].id,
      storeName: "Автомойка LUX Чиланзар",
      storeAddress: "г. Ташкент, ул. Бунёдкор, 24",
      gpsCoords: "41.2858, 69.2035",
      status: "order_placed",
      orderTotal: "450000",
      notes: "Выкладка на стенде проверена, заказана пена и керамический воск",
      photos: ["https://picsum.photos/id/1011/800/600"],
      visitedAt: new Date(now - 2 * 3600_000),
    },
    {
      agentId: ags[0].id,
      storeName: "Детейлинг центр Prestige",
      storeAddress: "г. Ташкент, ул. Нукусская, 88",
      gpsCoords: "41.3111, 69.2797",
      status: "order_placed",
      orderTotal: "1200000",
      notes: "Крупный клиент. Презентовали новую линейку для очистки кузова",
      photos: ["https://picsum.photos/id/160/800/600", "https://picsum.photos/id/201/800/600"],
      visitedAt: new Date(now - 6 * 3600_000),
    },
    {
      agentId: ags[0].id,
      storeName: "Магазин Хозтовары Юнусабад",
      storeAddress: "г. Ташкент, кв. 4, дом 12",
      gpsCoords: "41.3667, 69.2833",
      status: "order_placed",
      orderTotal: "340000",
      notes: "Заказали гель для посуды и универсальные чистящие средства",
      photos: ["https://picsum.photos/id/251/800/600"],
      visitedAt: new Date(now - 24 * 3600_000),
    },
    {
      agentId: ags[1].id,
      storeName: "Автосервис PRO Самарканд",
      storeAddress: "г. Самарканд, ул. Гагарина, 41",
      gpsCoords: "39.6542, 66.9597",
      status: "order_placed",
      orderTotal: "780000",
      notes: "Доставлен каталог и прайс-лист, отличная проходимость",
      photos: ["https://picsum.photos/id/48/800/600"],
      visitedAt: new Date(now - 12 * 3600_000),
    },
    {
      agentId: ags[3].id,
      storeName: "Мойка 24/7 Бухара",
      storeAddress: "г. Бухара, ул. Навои, 15",
      gpsCoords: "39.7681, 64.4556",
      status: "completed",
      orderTotal: "0",
      notes: "Остатки шампуня ещё есть, следующий заказ планируют через неделю",
      photos: ["https://picsum.photos/id/60/800/600"],
      visitedAt: new Date(now - 4 * 3600_000),
    },
  ]);
  for (let i = 0; i < 68; i++) {
    const cust = custs[rnd(custs.length)];
    const agent = ags[rnd(ags.length)];
    const created = new Date(now - rnd(30) * 86400000 - rnd(86400000));
    const status = i < 8 ? STATUSES[i % 4] : STATUSES[rnd(STATUSES.length)];
    const items = Array.from({ length: 1 + rnd(3) }, () => {
      const p = prods[rnd(prods.length)];
      return { product: p, qty: 1 + rnd(6) };
    });
    const total = items.reduce((a, it) => a + Number(it.product.price) * it.qty, 0);
    const cost = items.reduce((a, it) => a + Number(it.product.cost) * it.qty, 0);
    const [order] = await db
      .insert(s.orders)
      .values({
        number: `DLS-${24000 + i}`,
        customerId: cust.id,
        agentId: agent.id,
        status,
        channel: SOURCES[rnd(SOURCES.length)],
        payment: ["click", "payme", "uzum", "cash", "bank"][rnd(5)],
        total: String(total),
        profit: String(total - cost),
        createdAt: created,
        timeline: [{ status: "new", at: created.toISOString(), by: "Telegram Bot" }],
      })
      .returning();
    await db.insert(s.orderItems).values(
      items.map((it) => ({
        orderId: order.id,
        productId: it.product.id,
        name: it.product.name,
        qty: it.qty,
        price: it.product.price,
      })),
    );
    if (status !== "cancelled") {
      await db.insert(s.transactions).values({
        kind: "income",
        category: "sales",
        account: order.payment,
        amount: String(total),
        channel: order.channel,
        note: `Оплата заказа ${order.number}`,
        createdAt: created,
      });
    }
  }

  await db.execute(sql`
    update customers c set orders_count = x.cnt, total_spent = x.sum
    from (select customer_id, count(*) as cnt, sum(total) as sum from orders group by customer_id) x
    where x.customer_id = c.id`);

  const expenses = [
    ["logistics", "Доставка и логистика", 28_000_000],
    ["marketing", "Реклама Instagram / Telegram Ads", 41_000_000],
    ["salary", "Зарплата команды", 96_000_000],
    ["production", "Сырьё и тара", 132_000_000],
    ["rent", "Аренда склада", 22_000_000],
  ];
  await db.insert(s.transactions).values(
    expenses.flatMap(([category, note, amount]) =>
      Array.from({ length: 3 }, (_, k) => ({
        kind: "expense",
        category: String(category),
        account: "bank",
        amount: String(Math.round(Number(amount) / 3)),
        note: String(note),
        createdAt: new Date(now - k * 9 * 86400000),
      })),
    ),
  );

  const chats = [
    [0, "Здравствуйте! Есть ли в наличии автошампунь 5 литров?", false],
    [0, "Здравствуйте! Да, DELIS Car Shampoo Active Foam 5 L в наличии — 42 000 сум.", true],
    [0, "Отлично, оформите 3 штуки на Чиланзар.", false],
    [1, "Когда придёт мой заказ DLS-24012?", false],
    [1, "Заказ передан курьеру, доставка сегодня до 18:00 🚚", true],
    [2, "Можно оптовый прайс?", false],
    [3, "Спасибо, гель для посуды супер 👍", false],
    [4, "Есть скидка при заказе от 20 шт?", false],
    [4, "Да, от 20 штук действует скидка 12% и бесплатная доставка.", true],
    [5, "Отправьте счёт на оплату, пожалуйста.", false],
  ];
  await db.insert(s.messages).values(
    chats.map(([ci, body, admin], i) => ({
      customerId: custs[Number(ci)].id,
      body: String(body),
      fromAdmin: Boolean(admin),
      createdAt: new Date(now - (chats.length - i) * 900000),
    })),
  );

  await db.insert(s.templates).values([
    { title: "Заказ принят", body: "Ваш заказ принят ✅ Мы свяжемся с вами для подтверждения." },
    { title: "Заказ собирается", body: "Ваш заказ собирается на складе DELIS 📦" },
    { title: "Передан курьеру", body: "Заказ передан курьеру 🚚 Ожидайте доставку сегодня." },
    { title: "Доставлен", body: "Заказ доставлен 🎉 Спасибо, что выбираете DELIS!" },
    { title: "Персональная скидка", body: "Дарим вам персональную скидку 15% на следующий заказ 💜" },
    { title: "Новый товар", body: "Новинка DELIS уже в каталоге — попробуйте первыми ✨" },
  ]);

  await db.insert(s.stockMoves).values(
    Array.from({ length: 18 }, (_, i) => ({
      productId: prods[rnd(prods.length)].id,
      kind: ["in", "out", "transfer", "writeoff"][rnd(4)],
      qty: 5 + rnd(200),
      note: ["Поставка от производителя", "Отгрузка заказа", "Перемещение на склад №2", "Списание брака"][rnd(4)],
      createdAt: new Date(now - rnd(20) * 86400000),
    })),
  );

  await db.insert(s.activity).values([
    { actor: "Азиза Мансурова", action: "изменила цену товара", entity: "DELIS Wax Protect Ceramic" },
    { actor: "Улугбек Сотволдиев", action: "принял поставку 400 шт", entity: "Склад №1" },
    { actor: "Фаррух Юсупов", action: "подтвердил заказ", entity: "DLS-24031" },
    { actor: "Telegram Bot", action: "новый клиент из Mini App", entity: "@sevara_m" },
    { actor: "Нигора Расулова", action: "ответила в чате", entity: "@dilnoza_r" },
  ]);

  await db.insert(s.broadcasts).values([
    { title: "Скидка 20% на авто-химию", body: "💜 DELIS: новая акция — скидка 20% на всю авто-химию до конца недели. Промокод DELIS20", recipients: 11, channel: "telegram", status: "sent", createdBy: "Отабек Delis", sentAt: new Date(now - 2 * 86400000) },
    { title: "Новинка: Laundry Gel", body: "Встречайте новый гель для стирки DELIS Color — бережная забота о ярких тканях 🌸", recipients: 12, channel: "telegram", status: "sent", createdBy: "Азиза Мансурова", sentAt: new Date(now - 5 * 86400000) },
    { title: "VIP-программа", body: "Дорогие VIP-клиенты! Для вас открыта персональная скидка 15% на весь ассортимент ⭐", recipients: 3, channel: "telegram", status: "sent", createdBy: "Отабек Delis", sentAt: new Date(now - 8 * 86400000) },
  ]);

  await db.insert(s.syncEvents).values([
    { source: "telegram_bot", target: "crm", entity: "customer", action: "customer_registered", status: "synced", payload: { username: "sevara_m", channel: "miniapp" } },
    { source: "crm", target: "warehouse", entity: "order", action: "stock_reserved", status: "synced", payload: { order: "DLS-24031" } },
    { source: "crm", target: "site", entity: "product", action: "price_updated", status: "synced", payload: { sku: "DLS-1001" } },
    { source: "crm", target: "telegram_mini_app", entity: "banner", action: "banner_published", status: "synced", payload: { surface: "home" } },
    { source: "crm", target: "finance", entity: "payment", action: "payment_confirmed", status: "synced", payload: { provider: "uzum" } },
  ]);

  await db.insert(s.contentBlocks).values([
    { surface: "site", key: "home", title: "Главная страница", body: "DELIS — профессиональная химия для дома и авто" },
    { surface: "site", key: "catalog", title: "Каталог", body: "16 товаров, 5 категорий" },
    { surface: "site", key: "faq", title: "FAQ", body: "12 вопросов" },
    { surface: "site", key: "blog", title: "Блог", body: "8 статей" },
    { surface: "miniapp", key: "banners", title: "Баннеры Mini App", body: "3 активных баннера" },
    { surface: "miniapp", key: "splash", title: "Splash Screen", body: "Логотип DELIS + градиент" },
    { surface: "miniapp", key: "bottomnav", title: "Bottom Navigation", body: "Каталог · Корзина · Заказы · Профиль" },
    { surface: "instagram", key: "plan", title: "Контент-план", body: "14 публикаций на месяц" },
    { surface: "instagram", key: "banners", title: "Баннеры и шаблоны", body: "6 шаблонов сторис" },
  ]);

  await db.insert(s.integrations).values([
    { key: "telegram_bot", title: "Telegram Bot", enabled: false, status: "not_configured", credentials: {} },
    { key: "click", title: "Click (платежи)", enabled: false, status: "not_configured", credentials: {} },
    { key: "payme", title: "Payme (платежи)", enabled: false, status: "not_configured", credentials: {} },
    { key: "uzum", title: "Uzum Bank (платежи)", enabled: false, status: "not_configured", credentials: {} },
    { key: "smtp", title: "Email / SMTP", enabled: false, status: "not_configured", credentials: {} },
    { key: "sms", title: "SMS-шлюз (Eskiz.uz)", enabled: false, status: "not_configured", credentials: {} },
  ]);

  await db.insert(s.knowledgeBase).values([
    { title: "Как оформить заказ клиента", category: "sales", icon: "🧾", isPinned: true, views: 142, createdBy: "Отабек Delis", content: "1. Откройте раздел «Заказы» → «Новый заказ».\n2. Выберите клиента из базы или создайте нового.\n3. Добавьте товары из каталога, укажите количество.\n4. Проверьте сумму и способ оплаты.\n5. Нажмите «Создать заказ» — остатки склада уменьшатся автоматически.\n6. Распечатайте счёт или чек через кнопки в карточке заказа." },
    { title: "Приём товара на склад", category: "warehouse", icon: "📦", isPinned: true, views: 98, createdBy: "Отабек Delis", content: "1. Раздел «Поставщики» → вкладка «Закупки».\n2. Найдите нужную закупку со статусом «В пути» или «Подтверждена».\n3. Пересчитайте фактическое количество товара.\n4. Нажмите «Принять» — остатки увеличатся, расход уйдёт в финансы.\n5. Если есть расхождения — проведите инвентаризацию в разделе «Склад»." },
    { title: "Работа с возвратами", category: "sales", icon: "🔄", views: 64, createdBy: "Азиза Мансурова", content: "1. Раздел «Возвраты» → «Оформить возврат».\n2. Выберите заказ и укажите причину (брак, не тот товар, повреждение).\n3. Добавьте комментарий клиента.\n4. Далее два варианта:\n   • «+ склад» — деньги возвращаются, товар принимается обратно\n   • «Возврат ₽» — только деньги (товар бракованный)\n5. Расход автоматически проводится в финансах." },
    { title: "Регламент работы торгового агента", category: "agents", icon: "🧑‍💼", isPinned: true, views: 187, createdBy: "Отабек Delis", content: "ЕЖЕДНЕВНО:\n• Минимум 8 визитов торговых точек\n• Фотоотчёт с каждой точки (выкладка товара)\n• GPS-чекин при входе на точку\n\nПРИ ВИЗИТЕ:\n1. Проверить наличие продукции DELIS на полке\n2. Проверить сроки годности\n3. Поправить выкладку, разместить POS-материалы\n4. Уточнить остатки, предложить дозаказ\n5. Сфотографировать полку ПОСЛЕ выкладки\n6. Зафиксировать визит в CRM\n\nОТЧЁТНОСТЬ: до 19:00 все визиты должны быть в системе." },
    { title: "Скрипт продаж для новых клиентов", category: "sales", icon: "💬", views: 156, createdBy: "Азиза Мансурова", content: "ПРИВЕТСТВИЕ:\n«Здравствуйте! DELIS — производитель профессиональной химии для дома и авто. Работаем с 2019 года, поставляем более 200 точкам по Узбекистану.»\n\nВЫЯВЛЕНИЕ ПОТРЕБНОСТИ:\n• Какую химию используете сейчас?\n• Что не устраивает в текущем поставщике?\n• Какой объём закупаете в месяц?\n\nПРЕЗЕНТАЦИЯ:\n• Своё производство → цена ниже импорта на 30%\n• Доставка за 24 часа по Ташкенту\n• Отсрочка платежа для постоянных клиентов\n• Бесплатные образцы на пробу\n\nЗАКРЫТИЕ:\n«Давайте начнём с пробной партии — привезу завтра, оплата после реализации.»" },
    { title: "Настройка Telegram Bot", category: "tech", icon: "🤖", views: 43, createdBy: "Отабек Delis", content: "1. Откройте @BotFather в Telegram\n2. Отправьте команду /newbot\n3. Придумайте имя бота (например: DELIS Uzbekistan)\n4. Придумайте username (должен заканчиваться на _bot)\n5. Скопируйте полученный токен\n6. В CRM: Настройки → Интеграции → Telegram Bot\n7. Вставьте токен и нажмите «Проверить соединение»\n8. После успешной проверки включите переключатель" },
    { title: "Что делать при низком остатке", category: "warehouse", icon: "⚠️", views: 71, createdBy: "Улугбек Сотволдиев", content: "СИГНАЛ: товар подсвечен красным в разделе «Склад».\n\nДЕЙСТВИЯ:\n1. Раздел «Поставщики» → красная плашка сверху\n2. Нажмите «Заказать одним кликом» — система сама рассчитает количество\n3. Или создайте закупку вручную: выберите поставщика → добавьте позиции\n4. Проверьте срок поставки (у импорта из Китая — 35 дней!)\n5. Поставьте задачу на контроль в разделе «Задачи»\n\nПРАВИЛО: заказывать при остатке ниже 3-недельного запаса." },
    { title: "Права доступа сотрудников (RBAC)", category: "tech", icon: "🔐", views: 38, createdBy: "Отабек Delis", content: "РОЛИ В СИСТЕМЕ:\n\n• Owner — полный доступ, создание аккаунтов\n• Admin — операционное управление без аккаунтов и паролей\n• Manager — заказы, клиенты, товары, чат\n• Warehouse — склад, приход/расход, инвентаризация\n• Agent — свои визиты, заказы точек\n• Support — чат и клиенты\n• Moderator — контент сайта и Mini App\n• Operator — приём заказов\n\nСОЗДАНИЕ АККАУНТА:\nПользователи → «Создать аккаунт» → имя, @логин, роль, пароль.\nЛогин и пароль сотруднику выдаёт или сбрасывает только Owner." },
  ]);

  await db.insert(s.tasks).values([
    { title: "Обзвонить VIP-клиентов с акцией", description: "Предложить персональную скидку 25% по промокоду VIP2026", assignee: "Азиза Мансурова", priority: "high", status: "in_progress", linkType: "customer", linkLabel: "12 VIP-клиентов", dueAt: new Date(now + 86400000), createdBy: "Отабек Delis" },
    { title: "Проверить приход партии PO-1203", description: "Сверить накладную с фактическим количеством", assignee: "Улугбек Сотволдиев", priority: "high", status: "todo", linkType: "supplier", linkLabel: "Guangzhou ChemImport", dueAt: new Date(now + 2 * 86400000), createdBy: "Отабек Delis" },
    { title: "Подготовить отчёт по продажам за месяц", description: "Выгрузить Excel и отправить учредителям", assignee: "Отабек Delis", priority: "mid", status: "todo", linkType: "", linkLabel: "", dueAt: new Date(now + 3 * 86400000), createdBy: "Отабек Delis" },
    { title: "Обработать возврат по заказу DLS-24031", description: "Клиент жалуется на повреждённую упаковку", assignee: "Нигора Расулова", priority: "high", status: "todo", linkType: "order", linkLabel: "DLS-24031", dueAt: new Date(now + 86400000 / 2), createdBy: "Азиза Мансурова" },
    { title: "Согласовать маршрут агента в Самарканде", description: "Добавить 3 новые точки к маршруту", assignee: "Диёр Комилов", priority: "low", status: "in_progress", linkType: "agent", linkLabel: "Диёр Комилов", dueAt: new Date(now + 5 * 86400000), createdBy: "Отабек Delis" },
    { title: "Обновить баннеры в Mini App", description: "Загрузить новые акционные баннеры на главную", assignee: "Азиза Мансурова", priority: "mid", status: "done", linkType: "", linkLabel: "", dueAt: new Date(now - 86400000), createdBy: "Отабек Delis" },
    { title: "Пополнить склад: Glass Cleaner", description: "Остаток ниже минимума, заказать у поставщика", assignee: "Улугбек Сотволдиев", priority: "high", status: "done", linkType: "supplier", linkLabel: "Chemical Trade Group", dueAt: new Date(now - 2 * 86400000), createdBy: "Отабек Delis" },
  ]);

  await db.insert(s.promocodes).values([
    { code: "DELIS20", discountType: "percent", discountValue: "20", minOrderAmount: "150000", maxUses: 500, usedCount: 142, status: "active", validUntil: new Date(now + 14 * 86400000) },
    { code: "VIP2026", discountType: "percent", discountValue: "25", minOrderAmount: "300000", maxUses: 100, usedCount: 38, status: "active", validUntil: new Date(now + 30 * 86400000) },
    { code: "AUTO15", discountType: "fixed", discountValue: "50000", minOrderAmount: "250000", maxUses: 200, usedCount: 89, status: "active", validUntil: new Date(now + 10 * 86400000) },
    { code: "WELCOME10", discountType: "percent", discountValue: "10", minOrderAmount: "50000", maxUses: 1000, usedCount: 412, status: "active", validUntil: new Date(now + 60 * 86400000) },
  ]);

  const supplierRows = await db.insert(s.suppliers).values([
    { name: "Chemical Trade Group", contactPerson: "Алишер Рахимов", phone: "+998 71 234-56-78", email: "sales@chemtrade.uz", city: "Tashkent", address: "ул. Промышленная, 42", inn: "301889224", category: "raw_materials", rating: 5, leadTimeDays: 5, totalPurchased: "284000000", notes: "Основной поставщик сырья. Отсрочка платежа 14 дней." },
    { name: "PackPro Uzbekistan", contactPerson: "Дилшод Каримов", phone: "+998 90 111-22-33", email: "info@packpro.uz", city: "Tashkent", address: "Сергелийский р-н, склад 7", inn: "302445610", category: "packaging", rating: 4, leadTimeDays: 10, totalPurchased: "96500000", notes: "Флаконы, канистры, крышки, этикетки." },
    { name: "Guangzhou ChemImport", contactPerson: "Li Wei", phone: "+86 20 8888 1234", email: "export@gzchem.cn", country: "China", city: "Guangzhou", address: "Baiyun District, Blk 12", inn: "CN-91440101", category: "raw_materials", rating: 4, leadTimeDays: 35, totalPurchased: "412000000", notes: "Импорт ПАВ и концентратов. Морская доставка 30-40 дней." },
    { name: "Tashkent Label Print", contactPerson: "Нодира Юсупова", phone: "+998 93 456-78-90", email: "order@tlp.uz", city: "Tashkent", address: "ул. Навои, 15", inn: "303112998", category: "packaging", rating: 5, leadTimeDays: 4, totalPurchased: "38200000", notes: "Печать этикеток и упаковки, срочные заказы." },
    { name: "AutoChem Supply", contactPerson: "Бахтиёр Умаров", phone: "+998 95 777-88-99", email: "b.umarov@autochem.uz", city: "Samarkand", address: "Промзона, участок 3", inn: "304556123", category: "chemicals", rating: 3, leadTimeDays: 14, totalPurchased: "67400000", notes: "Автохимия, воски. Иногда задерживает поставки." },
  ]).returning();

  const poRows: { number: string; supplierId: number; status: string; total: string; paid: string; expectedAt: Date | null; receivedAt: Date | null; notes: string; createdBy: string; createdAt: Date }[] = [];
  const poStatuses = ["received", "shipped", "confirmed", "sent", "draft", "received"];
  for (let i = 0; i < 6; i++) {
    const sup = supplierRows[i % supplierRows.length];
    const st = poStatuses[i];
    const created = new Date(now - (i * 6 + 2) * 86400000);
    const total = 12_000_000 + rnd(60) * 1_000_000;
    poRows.push({
      number: `PO-${1200 + i}`,
      supplierId: sup.id,
      status: st,
      total: String(total),
      paid: st === "received" ? String(total) : st === "shipped" ? String(Math.round(total / 2)) : "0",
      expectedAt: new Date(created.getTime() + sup.leadTimeDays * 86400000),
      receivedAt: st === "received" ? new Date(created.getTime() + sup.leadTimeDays * 86400000) : null,
      notes: ["Плановая закупка сырья", "Пополнение тары", "Импортная партия концентратов", "Этикетки на новую линейку", "Автохимия к сезону", "Регулярная поставка"][i],
      createdBy: "Отабек Delis",
      createdAt: created,
    });
  }
  const insertedPOs = await db.insert(s.purchaseOrders).values(poRows).returning();

  for (const po of insertedPOs) {
    const itemsCount = 2 + rnd(3);
    const items = Array.from({ length: itemsCount }, () => {
      const p = prods[rnd(prods.length)];
      const qty = 50 + rnd(400);
      return { purchaseOrderId: po.id, productId: p.id, name: p.name, qty, price: p.cost };
    });
    await db.insert(s.purchaseItems).values(items);
  }

  await db.insert(s.marketingTriggers).values([
    { title: "Брошенная корзина (через 2 часа)", eventKey: "abandoned_cart", actionType: "discount_message", messageBody: "💜 Вы забыли товары в корзине DELIS! Дарим скидку 10% по коду WELCOME10 при оформлении сегодня.", discountBonus: 10, isActive: true, triggeredCount: 184 },
    { title: "Спящий клиент (30 дней без покупок)", eventKey: "sleeping_customer", actionType: "discount_message", messageBody: "✨ Скучаем по вам! Специальный промокод DELIS20 на скидку 20% на всю автохимию.", discountBonus: 20, isActive: true, triggeredCount: 96 },
    { title: "Достижение статуса VIP", eventKey: "vip_threshold", actionType: "bonus_points", messageBody: "🎉 Поздравляем! Вы стали VIP-клиентом DELIS. Вам начислено 50 000 бонусных баллов и постоянная скидка 15%.", discountBonus: 50000, isActive: true, triggeredCount: 24 },
    { title: "День рождения клиента", eventKey: "birthday", actionType: "discount_message", messageBody: "🎂 С Днём рождения от команды DELIS! Дарим вам персональный подарок к заказу и бесплатную доставку.", discountBonus: 15, isActive: true, triggeredCount: 41 },
  ]);
  await bootstrapWarehouseStocks();
}

export function ensureSeed() {
  if (!seeded) {
    seeded = run().catch((e) => {
      seeded = null;
      throw e;
    });
  }
  return seeded;
}
