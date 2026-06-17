/**
 * Shared, server-only validation for image uploads (user avatars, org logos).
 * Untrusted multipart input is re-checked here authoritatively — `accept` and any
 * client-side cap are only hints. Two stages, matching the server-fn split:
 *
 * - `validateImageUpload` runs synchronously in a server fn's `.validator` (type,
 *   presence, size).
 * - `sniffImage` runs in the handler and verifies the file's magic bytes match
 *   the claimed MIME type, so a client can't smuggle arbitrary content past the
 *   `type` check alone. It returns the raw bytes + a safe file extension.
 *
 * Must stay in step with `image-upload-field.tsx` (PNG / JPG / WebP, 2 MB, no SVG).
 */

/** Allowed image MIME types → file extension. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
};

/** 2 MB — matches the client cap in `image-upload-field.tsx`. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Verify the file's magic bytes match the claimed MIME type.
 * - PNG: `89 50 4E 47 0D 0A 1A 0A`
 * - JPEG: `FF D8 FF`
 * - WebP: bytes 0..3 are ASCII "RIFF" and bytes 8..11 are ASCII "WEBP"
 */
function sniffMatchesMime(bytes: Uint8Array, mime: string): boolean {
	switch (mime) {
		case "image/png":
			return (
				bytes.length >= 8 &&
				bytes[0] === 0x89 &&
				bytes[1] === 0x50 &&
				bytes[2] === 0x4e &&
				bytes[3] === 0x47 &&
				bytes[4] === 0x0d &&
				bytes[5] === 0x0a &&
				bytes[6] === 0x1a &&
				bytes[7] === 0x0a
			);
		case "image/jpeg":
			return (
				bytes.length >= 3 &&
				bytes[0] === 0xff &&
				bytes[1] === 0xd8 &&
				bytes[2] === 0xff
			);
		case "image/webp":
			return (
				bytes.length >= 12 &&
				// "RIFF"
				bytes[0] === 0x52 &&
				bytes[1] === 0x49 &&
				bytes[2] === 0x46 &&
				bytes[3] === 0x46 &&
				// "WEBP"
				bytes[8] === 0x57 &&
				bytes[9] === 0x45 &&
				bytes[10] === 0x42 &&
				bytes[11] === 0x50
			);
		default:
			return false;
	}
}

/**
 * Validate a multipart upload before it reaches the handler — for a server fn's
 * `.validator`. Synchronous (no file read); the magic-byte check is `sniffImage`.
 */
export function validateImageUpload(input: unknown): { file: File } {
	if (!(input instanceof FormData)) {
		throw new Error("Expected a multipart form upload");
	}
	const file = input.get("file");
	if (!(file instanceof File)) {
		throw new Error("No file provided");
	}
	if (!(file.type in ALLOWED_IMAGE_TYPES)) {
		throw new Error("Use a PNG, JPG, or WebP image");
	}
	if (file.size <= 0) {
		throw new Error("That file is empty");
	}
	if (file.size > MAX_IMAGE_BYTES) {
		throw new Error("That image is over 2 MB");
	}
	return { file };
}

/**
 * Read the file's bytes and confirm they actually look like the claimed image
 * type, returning the bytes + a safe extension. Throws on any mismatch. Call
 * after `validateImageUpload` has narrowed the MIME type.
 */
export async function sniffImage(
	file: File
): Promise<{ bytes: Uint8Array; ext: string }> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const ext = ALLOWED_IMAGE_TYPES[file.type];
	if (!ext || !sniffMatchesMime(bytes, file.type)) {
		throw new Error("That file doesn't look like a PNG, JPG, or WebP image");
	}
	return { bytes, ext };
}
