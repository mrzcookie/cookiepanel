// Shared, client-safe input validation helpers.

// A pragmatic email shape (not RFC-exhaustive): a local part, an "@", and a
// dotted host, with no spaces. Good enough to gate a submit button; the real
// check is the provider delivering the mail.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isEmail(value: string): boolean {
	return EMAIL.test(value.trim());
}
