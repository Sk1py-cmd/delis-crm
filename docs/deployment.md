# Staging and production deployment

The repository includes a production container image, a private PostgreSQL service, and a Caddy TLS reverse proxy. The same `compose.production.yml` is used for staging and production; isolation comes from a separate host (or separate Docker context), DNS name, environment file, and volumes for each environment.

## Prerequisites

- A Linux host with current Docker Engine and Docker Compose v2.
- A DNS `A`/`AAAA` record for the environment domain pointing to the host.
- Inbound TCP ports **80** and **443**, plus UDP port **443**, open to the host. PostgreSQL is deliberately not published outside Docker.
- A separate hostname and database volume for staging. Do not run staging against production data.

Caddy obtains and renews TLS certificates automatically once DNS and firewall rules are correct. The application receives `X-Forwarded-Host` and `X-Forwarded-Proto` from Caddy, which preserves the server-side same-origin write protection.

## Create the environment file on the host

Do this on the deployment host, never in the repository:

```bash
cp deploy/production.env.example .env.production
chmod 600 .env.production
```

Fill every blank value. Generate `POSTGRES_PASSWORD` with URL-safe characters because Compose places it in the internal PostgreSQL URL:

```bash
openssl rand -base64 36 | tr '+/' '-_' | tr -d '='
```

Generate the Owner password independently, using the organisation's password manager. Generate and retain `TWO_FACTOR_ENCRYPTION_KEY` exactly once:

```bash
openssl rand -base64 32
```

The encryption key is required before Owner TOTP can be enabled. Losing or changing it makes existing encrypted TOTP material unusable. Neither this key, the database password, nor the Owner password belongs in Git, CI logs, screenshots, or tickets.

`OWNER_LOGIN` and `OWNER_PASSWORD` bootstrap exactly one Owner only when the database has no initialized Owner. Changing them later does not reset that account.

## Deploy

From a checked-out release on the target host:

```bash
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml up -d --build
curl --fail --silent --show-error "https://$(grep '^DOMAIN=' .env.production | cut -d= -f2)/api/health"
```

The health endpoint is a readiness check: it returns success only after the database connection and the idempotent schema bootstrap are ready. It does not reveal database, account, or configuration details.

The production image is built as a non-root Node process. The database resides only on the `internal` Docker network; Caddy is the only public service and terminates TLS. The proxy headers also keep session cookies marked `Secure` in production.

## Staging

For staging, repeat the deployment on a separate host or Docker context with:

- a distinct `DOMAIN` such as `staging-crm.example.uz`;
- a separate `.env.production` file and separately generated secrets;
- a fresh `postgres_data` volume; and
- `SEED_DEMO_DATA=false` (the compose file sets this explicitly).

Run the CI checks before promotion, then deploy to staging, verify login, Owner TOTP, a staff session revocation, a non-consented broadcast rejection, and `/api/health`. Promote the exact reviewed commit or image to production only after staging verification.

## Backups and recovery

Take a backup before each deployment and test restores in staging. The following writes a PostgreSQL custom-format dump to the host; protect the backup as confidential customer data.

```bash
mkdir -p backups
docker compose --env-file .env.production -f compose.production.yml exec -T db \
  pg_dump -U delis -d delis_crm --format=custom > "backups/delis-$(date +%F-%H%M).dump"
```

To restore, first stop the application, restore into the intended **staging** database, then start it and check readiness:

```bash
docker compose --env-file .env.production -f compose.production.yml stop app
cat backups/delis-YYYY-MM-DD-HHMM.dump | docker compose --env-file .env.production -f compose.production.yml exec -T db \
  pg_restore -U delis -d delis_crm --clean --if-exists
docker compose --env-file .env.production -f compose.production.yml up -d app
```

Automate encrypted off-host backups and define a retention policy appropriate for customer and financial records. A Docker volume alone is not a backup.

## Upgrade and rollback

1. Back up the database.
2. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` in CI.
3. Deploy the reviewed revision to staging and perform the checks above.
4. On production, run `docker compose --env-file .env.production -f compose.production.yml up -d --build`.
5. Confirm `/api/health`, recent logs, and an authenticated Owner workflow.

Schema initialization is additive and idempotent, but rollback can still be unsafe after a data-shape change. Keep the preceding image or Git revision and the pre-deploy backup; do not roll back the application without evaluating the database state first.
