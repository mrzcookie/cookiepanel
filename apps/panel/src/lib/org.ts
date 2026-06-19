import { authClient } from "@/lib/auth-client";
import { slugify } from "@/lib/slug";

/**
 * Create an organization, deriving a slug from the name. Slugs are unique
 * org-wide, so on a collision retry once with a short random suffix rather than
 * failing the user. Returns the Better Auth `{ data, error }` result.
 *
 * Creating an org does NOT make it the session's active org, so on success we
 * set it active explicitly — otherwise a brand-new user (no prior active org)
 * would create the org but stay `activeOrganizationId: null` and get bounced
 * straight back to onboarding. setActive also refreshes the session cookie
 * cache so the next guard read sees the new active org.
 */
export async function createOrganization(name: string) {
	const base = slugify(name) || "org";
	const first = await authClient.organization.create({ name, slug: base });
	const result =
		first.error?.code === "ORGANIZATION_SLUG_ALREADY_TAKEN"
			? await authClient.organization.create({
					name,
					slug: `${base}-${crypto.randomUUID().slice(0, 6)}`,
				})
			: first;
	if (result.data) {
		await authClient.organization.setActive({
			organizationId: result.data.id,
		});
	}
	return result;
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
