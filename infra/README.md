# infra — local dev infrastructure

`compose.yaml` runs the backing services the panel needs in development:

- **Postgres** (`localhost:5432`, db `raptor`, `postgres`/`postgres`) — the
  panel's database (Drizzle).
- **Redis** (`localhost:6379`) — Better Auth secondary storage (sessions +
  rate-limit counters).

Defaults match `apps/panel/.env.example`.

## Usage

```bash
pnpm dev:up      # start Postgres + Redis, wait for healthy (compose up -d --wait)
pnpm dev:down    # stop them
```

Then in `apps/panel`: copy `.env.example` → `.env`, fill the secrets, and run
`pnpm --filter @raptor/panel db:migrate` to apply migrations.
