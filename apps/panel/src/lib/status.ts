// One source of truth for status presentation. Color is the *only* place color
// enters this otherwise-neutral UI, and it's confined to these four tones, shown
// as a `[ LABEL ]` bracket chip (StatusIndicator), never a loud filled badge.
// Pages map their domain status through these helpers so a state reads
// identically everywhere.

export type StatusTone = "online" | "pending" | "error" | "muted";

export type StatusMeta = { label: string; tone: StatusTone };

const TONE_LABEL: Record<StatusTone, string> = {
	online: "text-ok",
	pending: "text-warn",
	error: "text-destructive",
	muted: "text-muted-foreground",
};

export const statusLabelClass = (tone: StatusTone) => TONE_LABEL[tone];

const FALLBACK: StatusMeta = { label: "Unknown", tone: "muted" };

const NODE_STATUS: Record<string, StatusMeta> = {
	online: { label: "Online", tone: "online" },
	pending: { label: "Pending", tone: "pending" },
	unhealthy: { label: "Unhealthy", tone: "error" },
	offline: { label: "Offline", tone: "muted" },
};

const SERVER_STATUS: Record<string, StatusMeta> = {
	running: { label: "Running", tone: "online" },
	starting: { label: "Starting", tone: "pending" },
	installing: { label: "Installing", tone: "pending" },
	stopped: { label: "Stopped", tone: "muted" },
	failed: { label: "Failed", tone: "error" },
};

const TEMPLATE_STATUS: Record<string, StatusMeta> = {
	published: { label: "Published", tone: "online" },
	draft: { label: "Draft", tone: "pending" },
	archived: { label: "Archived", tone: "muted" },
};

// The org's billing lifecycle. "Trial" is the free-first-node grant; a paid plan
// can still be in trial. "Past due" is the dunning grace window; "Canceled" means
// the plan is set to end (access holds until the period closes).
const BILLING_STATUS: Record<string, StatusMeta> = {
	none: { label: "No plan", tone: "muted" },
	trialing: { label: "Trial", tone: "pending" },
	active: { label: "Active", tone: "online" },
	past_due: { label: "Past due", tone: "error" },
	canceled: { label: "Canceled", tone: "muted" },
};

const INVOICE_STATUS: Record<string, StatusMeta> = {
	paid: { label: "Paid", tone: "online" },
	open: { label: "Open", tone: "pending" },
	void: { label: "Void", tone: "muted" },
};

export const nodeStatus = (status: string): StatusMeta =>
	NODE_STATUS[status] ?? FALLBACK;
export const serverStatus = (status: string): StatusMeta =>
	SERVER_STATUS[status] ?? FALLBACK;
export const templateStatus = (status: string): StatusMeta =>
	TEMPLATE_STATUS[status] ?? FALLBACK;
export const billingStatus = (status: string): StatusMeta =>
	BILLING_STATUS[status] ?? FALLBACK;
export const invoiceStatus = (status: string): StatusMeta =>
	INVOICE_STATUS[status] ?? FALLBACK;
