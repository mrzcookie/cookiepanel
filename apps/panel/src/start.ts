import { createStart } from "@tanstack/react-start";

/**
 * The TanStack Start instance. This export is required — the generated route
 * tree imports `startInstance` for its config typing — so it stays even with no
 * options set.
 *
 * The Better Auth HTTP handler is mounted as a server route at
 * `routes/api/auth/$.ts` (Better Auth's documented TanStack Start integration),
 * so no global request middleware is needed here. Add `requestMiddleware` here if
 * a future cross-cutting concern needs to wrap every request.
 */
export const startInstance = createStart(() => ({}));
