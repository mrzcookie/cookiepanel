import { authClient } from "@/lib/auth-client";
import { slugify } from "@/lib/slug";

/**
 * Create an organization, deriving a slug from the name. Slugs are unique
 * org-wide, so on a collision retry once with a short random suffix rather than
 * failing the user. `create` makes the new org the active one (Better Auth's
 * default). Returns the Better Auth `{ data, error }` result.
 */
export function createOrganization(name: string) {
	const base = slugify(name) || "org";
	return authClient.organization.create({ name, slug: base }).then((first) => {
		if (first.error?.code !== "ORGANIZATION_SLUG_ALREADY_TAKEN") {
			return first;
		}
		const suffix = crypto.randomUUID().slice(0, 6);
		return authClient.organization.create({ name, slug: `${base}-${suffix}` });
	});
}

/**
 * Resolve where to send the user after they leave or delete the active org
 * (Better Auth clears the active org in both cases). If they still belong to
 * another org, make it active and return "/"; otherwise return "/onboarding" to
 * create a fresh one. The caller handles the cache reset + navigation.
 */
export async function nextOrgDestination(): Promise<"/" | "/onboarding"> {
	const { data } = await authClient.organization.list();
	const next = data?.[0];
	if (!next) {
		return "/onboarding";
	}
	await authClient.organization.setActive({ organizationId: next.id });
	return "/";
}
