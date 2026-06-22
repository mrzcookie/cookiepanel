import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Server-only environment, validated eagerly at import.
 *
 * Lives under `src/server` because it reads secrets (DB URL, auth + encryption
 * keys, provider credentials) and must never reach the client bundle. The data
 * layer imports `env` from here; client code never may. Importing this module
 * runs validation, so the process refuses to boot with a missing/invalid
 * required var.
 *
 * Required vars are the ones the panel can't run without (DB, Redis, auth). The
 * optional groups (OAuth, email, billing, storage) belong to features that read
 * their own group when they land; absent is fine. Social sign-in buttons, for
 * instance, show only when a provider's pair is present.
 */
export const env = createEnv({
	server: {
		// --- Core (required) ---
		// Postgres connection string for Drizzle.
		DATABASE_URL: z.url(),
		// Redis connection string — Better Auth secondary storage (sessions +
		// rate limiting) and shared server-side caching. See src/server/redis.ts.
		REDIS_URL: z.url(),
		// Better Auth signing secret. Generate: `openssl rand -base64 32`.
		AUTH_SECRET: z.string().min(32),
		// Public base URL the app is served from (auth callbacks, magic links).
		AUTH_URL: z.url(),
		// AES-256-GCM key for sealing per-server secrets + node keys at rest:
		// exactly 32 bytes, hex-encoded. Generate: `openssl rand -hex 32`.
		ENCRYPTION_KEY: z
			.string()
			.regex(
				/^[0-9a-f]{64}$/i,
				"ENCRYPTION_KEY must be 64 hex chars (32 bytes) — generate with `openssl rand -hex 32`"
			),

		// --- Auth extras (optional) ---
		// Extra CSRF-trusted origins (comma-separated); baseURL is always trusted.
		AUTH_TRUSTED_ORIGINS: z.string().optional(),
		// User ids to bootstrap as platform admins (comma-separated), independent
		// of their stored role — for seeding the first admin.
		AUTH_ADMIN_USER_IDS: z.string().optional(),

		// --- OAuth social providers (optional; a button shows only when set) ---
		GITHUB_CLIENT_ID: z.string().optional(),
		GITHUB_CLIENT_SECRET: z.string().optional(),
		GOOGLE_CLIENT_ID: z.string().optional(),
		GOOGLE_CLIENT_SECRET: z.string().optional(),

		// --- Email — magic links + org invitations via Resend (optional) ---
		RESEND_API_KEY: z.string().optional(),
		// From address; "Name <addr@host>" is allowed, so not strictly an email.
		EMAIL_FROM: z.string().optional(),

		// --- Billing — Polar (optional; the per-node subscription) ---
		POLAR_ACCESS_TOKEN: z.string().optional(),
		POLAR_WEBHOOK_SECRET: z.string().optional(),
		POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
		POLAR_NODE_PRODUCT_ID: z.string().optional(),

		// --- Managed-node DNS — Cloudflare (optional; the CookiePanel-subdomain path) ---
		// When both are set, the panel auto-manages each managed node's subdomain
		// A record (created at enrollment, when the node's public IP is first
		// observed; removed when the node is). Absent = auto-DNS is a no-op and the
		// operator points DNS themselves. The subdomain's base domain is separate,
		// non-secret public config — see VITE_NODES_DOMAIN / src/lib/node-domain.ts.
		// The token needs Zone:DNS:Edit on the zone below.
		CLOUDFLARE_API_TOKEN: z.string().optional(),
		// The Cloudflare zone id that owns the nodes' base domain.
		CLOUDFLARE_ZONE_ID: z.string().optional(),

		// --- Object storage — S3-compatible (optional; template icons + uploads) ---
		// Works with Cloudflare R2 / AWS S3 / MinIO. Omit S3_ENDPOINT for AWS S3.
		S3_ENDPOINT: z.url().optional(),
		S3_REGION: z.string().optional(),
		S3_BUCKET: z.string().optional(),
		S3_ACCESS_KEY_ID: z.string().optional(),
		S3_SECRET_ACCESS_KEY: z.string().optional(),
		// Public base URL the icons/uploads are served from (CDN or bucket URL).
		S3_PUBLIC_URL: z.url().optional(),
	},
	shared: {
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
	},
	// Nitro/Node exposes server env on process.env at runtime.
	runtimeEnv: process.env,
	// Treat "" as unset so blank .env lines fall back to optional/default.
	emptyStringAsUndefined: true,
	// Escape hatch for build/CI steps that shouldn't need real secrets.
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
