# DELIS CRM

Enterprise CRM for DELIS, built with Next.js, PostgreSQL and Drizzle ORM.

## First launch

1. Copy the example configuration:

   ```bash
   cp .env.example .env
   ```

2. Set a real PostgreSQL `DATABASE_URL` and **replace** `OWNER_LOGIN` and `OWNER_PASSWORD`.
   - Owner login: 3–24 lowercase Latin letters, digits, `.`, `_`, or `-`.
   - Owner password: 10–128 characters.
   - Do not commit `.env`.
3. Install and run:

   ```bash
   npm ci
   npm run dev
   ```

On first startup against an empty database, the CRM creates exactly one `owner` account from `OWNER_LOGIN` and `OWNER_PASSWORD`. It does **not** overwrite an Owner credential after that bootstrap is recorded. When upgrading a legacy database from the old demo bootstrap, the first startup migrates the retained Owner once to the environment-provided credential; set the variables before deploying.

Demo operational data is disabled by default. Set `SEED_DEMO_DATA=true` only for a local demo database.

## Access model

- Login is by login and password. There is no public registration endpoint or UI.
- Only the Owner can create employee accounts, assign or change employee roles, block/unblock or delete employee accounts, and issue/reset passwords.
- Admin can perform delegated business operations, but cannot create accounts or manage passwords.
- Employees cannot change their own passwords; they request a reset from the Owner.
- Agent accounts must be explicitly linked by the Owner to one Agent profile. The agent portal never falls back to another agent's data.
- Role checks run on server-rendered CRM pages and API mutation/read routes. Hiding a navigation item is not considered authorization.

The supported roles are `owner`, `admin`, `manager`, `warehouse`, `agent`, `support`, `moderator`, and `operator`. The centralized policy is in `src/shared/config/access.ts`.

## Security notes

- Passwords use salted Node.js `scrypt` hashes and constant-time verification.
- Login attempts are limited to five failed attempts per IP/login pair in a 15-minute window. The current limiter is process-local; deploy a shared Redis/database limiter when horizontally scaling.
- Cookie-authenticated write endpoints enforce same-origin requests.
- Production must run behind HTTPS so secure session cookies are enabled.

## Quality checks

```bash
npm run typecheck
npm run lint
npm run build
```

A reachable PostgreSQL instance and valid `DATABASE_URL` are needed to exercise login, seed, and business workflows end to end.
