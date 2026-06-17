// Client-safe theme constants — the fixed set of theme choices. Shared by the
// theme switcher (what it offers), the account-theme sync (what it will apply),
// and the server-side validator on the `theme` user field (what it will store),
// so all three agree and an arbitrary value can never be persisted or applied.

export const THEME_OPTIONS = ["light", "dark", "system"] as const;
