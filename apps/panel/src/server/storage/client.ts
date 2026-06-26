import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@/server/env";

/**
 * Shared S3-compatible object-storage client (server-only). Backs egg
 * icons + uploads; works with Cloudflare R2 / AWS S3 / MinIO. Storage is
 * OPTIONAL — when the S3_* env group is absent the panel runs without it, so
 * callers must gate on `isStorageConfigured()` before reaching for the client.
 * Cached on globalThis in dev so HMR re-evaluating this module doesn't build a
 * fresh client each reload.
 */
const globalForS3 = globalThis as unknown as {
	__raptorS3?: S3Client;
};

/**
 * True only when the full credential set is present: a bucket, an access-key
 * pair, and the public base URL we serve objects from. The endpoint/region are
 * optional (AWS infers them), so they don't gate configuration.
 */
export function isStorageConfigured(): boolean {
	return Boolean(
		env.S3_BUCKET &&
			env.S3_ACCESS_KEY_ID &&
			env.S3_SECRET_ACCESS_KEY &&
			env.S3_PUBLIC_URL
	);
}

const notConfigured = () => new Error("Object storage is not configured");

/** Bucket + public base URL (trailing slash stripped). Throws when unconfigured. */
export function getStorageConfig(): { bucket: string; publicUrl: string } {
	if (!isStorageConfigured()) {
		throw notConfigured();
	}
	// isStorageConfigured asserts these are present, but narrow explicitly so
	// strict TS (noUncheckedIndexedAccess + no non-null assertions) stays happy.
	const bucket = env.S3_BUCKET;
	const publicUrl = env.S3_PUBLIC_URL;
	if (!bucket || !publicUrl) {
		throw notConfigured();
	}
	return { bucket, publicUrl: publicUrl.replace(/\/+$/, "") };
}

function createS3Client(): S3Client {
	const accessKeyId = env.S3_ACCESS_KEY_ID;
	const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
	if (!accessKeyId || !secretAccessKey) {
		throw notConfigured();
	}
	return new S3Client({
		region: env.S3_REGION ?? "us-east-1",
		// Pass through: undefined targets real AWS, a value targets R2/MinIO/etc.
		endpoint: env.S3_ENDPOINT,
		// Custom endpoints (MinIO/R2) require path-style; AWS uses virtual-hosted.
		forcePathStyle: Boolean(env.S3_ENDPOINT),
		credentials: { accessKeyId, secretAccessKey },
	});
}

/** The cached S3 client, built lazily on first use. Throws when unconfigured. */
export function getS3Client(): S3Client {
	if (!isStorageConfigured()) {
		throw notConfigured();
	}
	const client = globalForS3.__raptorS3 ?? createS3Client();
	if (env.NODE_ENV !== "production") {
		globalForS3.__raptorS3 = client;
	}
	return client;
}
