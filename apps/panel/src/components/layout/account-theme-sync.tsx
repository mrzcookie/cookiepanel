import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { THEME_OPTIONS } from "@/lib/theme";

/**
 * Applies the signed-in user's saved theme (`user.theme`) once per session load,
 * so the preference follows the account across devices. next-themes handles the
 * local/applied theme; this layers the account value on top when the session
 * arrives.
 *
 * One-shot: after the first apply we stop, so a manual toggle (which itself
 * persists to the account via the account page) is never fought. Renders nothing.
 */
export function AccountThemeSync() {
	const { setTheme } = useTheme();
	const { data: session } = authClient.useSession();
	const applied = useRef(false);
	const accountTheme = session?.user.theme;

	useEffect(() => {
		// Defense in depth: the server allowlists `theme`, but re-check before
		// applying so a stale/legacy value is never handed to next-themes.
		if (
			applied.current ||
			!accountTheme ||
			!(THEME_OPTIONS as readonly string[]).includes(accountTheme)
		) {
			return;
		}
		applied.current = true;
		setTheme(accountTheme);
	}, [accountTheme, setTheme]);

	return null;
}
