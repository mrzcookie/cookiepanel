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

export const nodeStatus = (status: string): StatusMeta =>
	NODE_STATUS[status] ?? FALLBACK;
export const serverStatus = (status: string): StatusMeta =>
	SERVER_STATUS[status] ?? FALLBACK;
export const templateStatus = (status: string): StatusMeta =>
	TEMPLATE_STATUS[status] ?? FALLBACK;
