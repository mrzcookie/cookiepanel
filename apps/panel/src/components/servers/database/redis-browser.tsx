import { useQueryClient } from "@tanstack/react-query";
import {
	ChevronRight,
	Clock,
	KeyRound,
	Pencil,
	Plus,
	Search,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import type { ServerConnection } from "@/components/servers/database/explorer-shell";
import {
	Breadcrumb,
	ConfirmDrop,
	ConnectionHeader,
	IconAction,
	RowActions,
	Section,
} from "@/components/servers/database/explorer-shell";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
	hitRate,
	isCollection,
	REDIS_SET_TYPES,
	type RedisKeyDetail,
	type RedisKeySummary,
	type RedisSetRequest,
	type RedisSetType,
	ttlLabel,
} from "@/lib/domain/redis-browser";
import { formatBytes, formatCount } from "@/lib/format";
import {
	deleteRedisKey,
	fetchRedisKeys,
	flushRedisDb,
	invalidateRedis,
	renameRedisKey,
	setRedisKey,
	setRedisTtl,
	useRedisKey,
	useRedisOverview,
} from "@/lib/redis-browser-queries";

const DB_COUNT = 16;

function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

function sizeLabel(s: { type: string; length: number; sizeBytes: number }) {
	return isCollection(s.type)
		? `${formatCount(s.length)} ${s.length === 1 ? "item" : "items"}`
		: formatBytes(s.sizeBytes || s.length);
}

function formatUptime(seconds: number): string {
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const d = Math.floor(seconds / 86_400);
	const h = Math.floor((seconds % 86_400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) {
		return `${d}d ${h}h`;
	}
	if (h > 0) {
		return `${h}h ${m}m`;
	}
	return `${m}m`;
}

// The Redis Browser: a live keyspace explorer + manager. DB selector, INFO-derived
// overview, server-side pattern scan with paging, type-aware key inspection, and
// create / edit-ttl / rename / delete / flush — all against the real instance.
export function RedisBrowser({
	eggName,
	nodeAddress,
	port,
	serverId,
	state,
}: { serverId: string } & ServerConnection) {
	const [db, setDb] = useState(0);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	// Switching DB drops the open key.
	function changeDb(next: number) {
		setDb(next);
		setSelectedKey(null);
	}

	return (
		<div className="space-y-4">
			<ConnectionHeader
				eggName={eggName}
				label="Browser"
				nodeAddress={nodeAddress}
				port={port}
				state={state}
			/>
			<Overview db={db} onChangeDb={changeDb} serverId={serverId} />
			{selectedKey ? (
				<KeyDetail
					db={db}
					keyName={selectedKey}
					onBack={() => setSelectedKey(null)}
					serverId={serverId}
				/>
			) : (
				<KeyList db={db} onOpen={setSelectedKey} serverId={serverId} />
			)}
		</div>
	);
}

function Overview({
	db,
	onChangeDb,
	serverId,
}: {
	db: number;
	onChangeDb: (db: number) => void;
	serverId: string;
}) {
	const read = useRedisOverview(serverId, db);
	const dbId = useId();
	const ov = read?.ok ? read.data : null;
	const keysHere = ov?.databases.find((d) => d.db === db)?.keys ?? 0;

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-3">
				<div className="flex items-center gap-2">
					<Label className="text-muted-foreground text-xs" htmlFor={dbId}>
						Database
					</Label>
					<Select
						onValueChange={(v) => onChangeDb(Number(v))}
						value={String(db)}
					>
						<SelectTrigger className="h-8 w-20" id={dbId}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Array.from({ length: DB_COUNT }, (_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: a fixed 0–15 enumeration; the index is the stable identity
								<SelectItem key={i} value={String(i)}>
									db{i}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				{ov ? (
					<span className="font-mono text-muted-foreground text-xs">
						redis {ov.version} · {ov.mode} · up {formatUptime(ov.uptimeSeconds)}
					</span>
				) : null}
			</div>

			{read && !read.ok ? (
				<div className="rounded-lg border border-warn/40 bg-warn-wash/40 px-3 py-2.5 text-muted-foreground text-sm">
					Couldn't reach Redis: {read.error}
				</div>
			) : (
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					<StatTile
						label="Memory"
						suffix={ov ? `/ ${formatBytes(ov.maxMemoryBytes || 0)}` : undefined}
						value={ov ? formatBytes(ov.usedMemoryBytes) : "—"}
					/>
					<StatTile label="Keys" value={ov ? formatCount(keysHere) : "—"} />
					<StatTile
						label="Hit rate"
						value={ov ? hitRate(ov.keyspaceHits, ov.keyspaceMisses) : "—"}
					/>
					<StatTile
						label="Clients"
						value={ov ? formatCount(ov.connectedClients) : "—"}
					/>
				</div>
			)}
		</div>
	);
}

function StatTile({
	label,
	suffix,
	value,
}: {
	label: string;
	suffix?: string;
	value: string;
}) {
	return (
		<div className="rounded-lg px-4 py-3 ring-1 ring-foreground/10">
			<div className="text-muted-foreground text-xs">{label}</div>
			<div className="font-mono text-lg tabular-nums">
				{value}
				{suffix ? (
					<span className="text-muted-foreground text-sm"> {suffix}</span>
				) : null}
			</div>
		</div>
	);
}

function KeyList({
	db,
	onOpen,
	serverId,
}: {
	db: number;
	onOpen: (key: string) => void;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const [pattern, setPattern] = useState("*");
	const [keys, setKeys] = useState<RedisKeySummary[]>([]);
	const [cursor, setCursor] = useState("0");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [flushOpen, setFlushOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);

	// Load the first page for a (db, pattern) — replaces the list. Debounced so
	// typing a pattern doesn't fire a scan per keystroke.
	const load = useCallback(
		async (pat: string) => {
			setLoading(true);
			setError(null);
			const read = await fetchRedisKeys(serverId, db, pat || "*", "0");
			if (read.ok) {
				setKeys(read.data.keys);
				setCursor(read.data.cursor);
			} else {
				setError(read.error);
				setKeys([]);
				setCursor("0");
			}
			setLoading(false);
		},
		[serverId, db]
	);

	useEffect(() => {
		const t = setTimeout(() => load(pattern), 300);
		return () => clearTimeout(t);
	}, [pattern, load]);

	async function loadMore() {
		const read = await fetchRedisKeys(serverId, db, pattern || "*", cursor);
		if (read.ok) {
			setKeys((prev) => [...prev, ...read.data.keys]);
			setCursor(read.data.cursor);
		} else {
			toast.error(read.error);
		}
	}

	async function remove(key: string) {
		try {
			await deleteRedisKey(serverId, db, key);
			await invalidateRedis(queryClient, serverId);
			toast.success(`Deleted “${key}”.`);
			load(pattern);
		} catch (e) {
			toast.error(errorMessage(e, "Couldn't delete the key."));
		}
	}

	const hasMore = cursor !== "0";

	return (
		<div className="space-y-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				<div className="relative sm:max-w-xs sm:flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						aria-label="Match pattern"
						className="pl-8 font-mono text-xs"
						onChange={(e) => setPattern(e.target.value)}
						placeholder="Match pattern, e.g. session:*"
						value={pattern}
					/>
				</div>
				<div className="flex gap-2 sm:ml-auto">
					<Button
						className="text-muted-foreground hover:text-destructive"
						onClick={() => setFlushOpen(true)}
						size="sm"
						variant="outline"
					>
						<Trash2 />
						Flush
					</Button>
					<Button onClick={() => setCreateOpen(true)} size="sm">
						<Plus />
						New key
					</Button>
				</div>
			</div>

			<div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
				{error ? (
					<div className="p-4">
						<EmptyState
							description={error}
							icon={KeyRound}
							title="Couldn't reach Redis"
						/>
					</div>
				) : loading && keys.length === 0 ? (
					<div className="p-8 text-center text-muted-foreground text-sm">
						Scanning…
					</div>
				) : keys.length === 0 ? (
					<div className="p-4">
						<EmptyState
							description={
								pattern && pattern !== "*"
									? "No keys match that pattern."
									: "Set a key to start storing data."
							}
							icon={KeyRound}
							title="No keys"
						/>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Key</TableHead>
								<TableHead>Type</TableHead>
								<TableHead className="text-right">TTL</TableHead>
								<TableHead className="text-right">Size</TableHead>
								<TableHead className="w-px text-right">Manage</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{keys.map((entry) => (
								<TableRow key={entry.key}>
									<TableCell>
										<button
											className="flex items-center gap-2 font-mono text-sm hover:text-primary"
											onClick={() => onOpen(entry.key)}
											type="button"
										>
											<KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
											{entry.key}
										</button>
									</TableCell>
									<TableCell>
										<Badge variant="secondary">{entry.type}</Badge>
									</TableCell>
									<TableCell className="text-right font-mono text-muted-foreground text-xs tabular-nums">
										{ttlLabel(entry.ttlSeconds)}
									</TableCell>
									<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
										{sizeLabel(entry)}
									</TableCell>
									<TableCell className="text-right">
										<RowActions>
											<IconAction
												icon={ChevronRight}
												label={`Open ${entry.key}`}
												onClick={() => onOpen(entry.key)}
											/>
											<IconAction
												danger
												icon={Trash2}
												label={`Delete ${entry.key}`}
												onClick={() => setDrop(entry.key)}
											/>
										</RowActions>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</div>

			{hasMore ? (
				<div className="flex justify-center">
					<Button onClick={loadMore} size="sm" variant="outline">
						Load more
					</Button>
				</div>
			) : null}

			<KeyEditorDialog
				db={db}
				onOpenChange={setCreateOpen}
				onSaved={() => load(pattern)}
				open={createOpen}
				serverId={serverId}
			/>
			<ConfirmDrop
				confirmLabel="Delete key"
				description={`Delete the key “${drop}”. This can't be undone.`}
				onConfirm={() => {
					if (drop) {
						remove(drop);
					}
				}}
				onOpenChange={(next) => setDrop(next ? drop : null)}
				open={drop !== null}
				title="Delete this key?"
			/>
			<ConfirmDrop
				confirmLabel="Flush database"
				description={`Permanently delete every key in db${db}. This can't be undone.`}
				onConfirm={async () => {
					try {
						await flushRedisDb(serverId, db);
						await invalidateRedis(queryClient, serverId);
						toast.success(`Flushed db${db}.`);
						load(pattern);
					} catch (e) {
						toast.error(errorMessage(e, "Couldn't flush the database."));
					}
				}}
				onOpenChange={setFlushOpen}
				open={flushOpen}
				title={`Flush db${db}?`}
			/>
		</div>
	);
}

function KeyDetail({
	db,
	keyName,
	onBack,
	serverId,
}: {
	db: number;
	keyName: string;
	onBack: () => void;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const read = useRedisKey(serverId, db, keyName);
	const [drop, setDrop] = useState(false);
	const [ttlOpen, setTtlOpen] = useState(false);
	const [renameOpen, setRenameOpen] = useState(false);

	const detail = read?.ok ? read.data : null;

	async function remove() {
		try {
			await deleteRedisKey(serverId, db, keyName);
			await invalidateRedis(queryClient, serverId);
			toast.success(`Deleted “${keyName}”.`);
			onBack();
		} catch (e) {
			toast.error(errorMessage(e, "Couldn't delete the key."));
		}
	}

	return (
		<Section
			action={
				<div className="flex gap-2">
					<Button
						onClick={() => setRenameOpen(true)}
						size="sm"
						variant="outline"
					>
						<Pencil />
						Rename
					</Button>
					<Button onClick={() => setTtlOpen(true)} size="sm" variant="outline">
						<Clock />
						TTL
					</Button>
					<Button onClick={() => setDrop(true)} size="sm" variant="destructive">
						<Trash2 />
						Delete
					</Button>
				</div>
			}
			subtitle={
				detail ? <span className="font-mono">{detail.type}</span> : null
			}
			title={
				<Breadcrumb
					current={keyName}
					trail={[{ label: "Keys", onClick: onBack }]}
				/>
			}
		>
			<div className="space-y-4 p-4">
				{read && !read.ok ? (
					<p className="text-muted-foreground text-sm">
						Couldn't reach Redis: {read.error}
					</p>
				) : detail ? (
					<>
						<DetailList>
							<DetailRow label="Type" value={detail.type} />
							<DetailRow label="TTL" value={ttlLabel(detail.ttlSeconds)} />
							<DetailRow
								label="Size"
								value={formatBytes(detail.sizeBytes || 0)}
							/>
						</DetailList>
						<div className="space-y-2">
							<p className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
								{"// value"}
							</p>
							{detail.truncated ? (
								<p className="rounded-lg border border-warn/40 bg-warn-wash/40 px-3 py-2 text-muted-foreground text-xs">
									Large value — showing a capped preview of{" "}
									{formatCount(detail.length)}{" "}
									{isCollection(detail.type) ? "elements" : "bytes"}.
								</p>
							) : null}
							<ValueView detail={detail} />
						</div>
					</>
				) : (
					<p className="text-muted-foreground text-sm">Loading…</p>
				)}
			</div>

			<ConfirmDrop
				confirmLabel="Delete key"
				description={`Delete the key “${keyName}”. This can't be undone.`}
				onConfirm={remove}
				onOpenChange={setDrop}
				open={drop}
				title="Delete this key?"
			/>
			<TtlDialog
				current={detail?.ttlSeconds ?? -1}
				db={db}
				keyName={keyName}
				onOpenChange={setTtlOpen}
				open={ttlOpen}
				serverId={serverId}
			/>
			<RenameDialog
				db={db}
				keyName={keyName}
				onOpenChange={setRenameOpen}
				onRenamed={onBack}
				open={renameOpen}
				serverId={serverId}
			/>
		</Section>
	);
}

function ValueView({ detail }: { detail: RedisKeyDetail }) {
	const mono =
		"terminal whitespace-pre-wrap break-all rounded-lg p-4 font-mono text-sm";
	switch (detail.type) {
		case "string":
			return <div className={mono}>{detail.string || "(empty)"}</div>;
		case "hash":
			return (
				<PairTable
					left="Field"
					right="Value"
					rows={(detail.fields ?? []).map((f) => [f.field, f.value])}
				/>
			);
		case "zset":
			return (
				<PairTable
					left="Member"
					right="Score"
					rows={(detail.members ?? []).map((m) => [m.member, String(m.score)])}
				/>
			);
		case "list":
		case "set":
			return (
				<div className={mono}>
					{(detail.items ?? []).map((it, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: items can repeat (a list), index is the stable identity
						<div key={i}>{it}</div>
					))}
					{(detail.items ?? []).length === 0 ? "(empty)" : null}
				</div>
			);
		case "stream":
			return (
				<div className="space-y-2">
					{(detail.entries ?? []).map((e) => (
						<div className={mono} key={e.id}>
							<div className="text-muted-foreground text-xs">{e.id}</div>
							{e.fields.map((f) => (
								<div key={f.field}>
									{f.field}: {f.value}
								</div>
							))}
						</div>
					))}
				</div>
			);
		default:
			return <div className={mono}>(unsupported type)</div>;
	}
}

function PairTable({
	left,
	right,
	rows,
}: {
	left: string;
	right: string;
	rows: [string, string][];
}) {
	if (rows.length === 0) {
		return <div className="text-muted-foreground text-sm">(empty)</div>;
	}
	return (
		<div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>{left}</TableHead>
						<TableHead>{right}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map(([k, v]) => (
						<TableRow key={k}>
							<TableCell className="font-mono text-xs">{k}</TableCell>
							<TableCell className="break-all font-mono text-xs">{v}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function TtlDialog({
	current,
	db,
	keyName,
	onOpenChange,
	open,
	serverId,
}: {
	current: number;
	db: number;
	keyName: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const [ttl, setTtl] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setTtl(current >= 0 ? String(current) : "");
		}
	}, [open, current]);

	async function save() {
		setBusy(true);
		try {
			const n = ttl.trim() === "" ? -1 : Math.floor(Number(ttl));
			await setRedisTtl(serverId, db, keyName, Number.isFinite(n) ? n : -1);
			await invalidateRedis(queryClient, serverId);
			toast.success(ttl.trim() === "" ? "Expiry removed." : "TTL updated.");
			onOpenChange(false);
		} catch (e) {
			toast.error(errorMessage(e, "Couldn't set the TTL."));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Set TTL</DialogTitle>
					<DialogDescription>
						Seconds until “{keyName}” expires. Leave blank for no expiry.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-2 py-2">
					<Label htmlFor="ttl-input">TTL (seconds)</Label>
					<Input
						className="tabular-nums"
						id="ttl-input"
						inputMode="numeric"
						min={1}
						onChange={(e) => setTtl(e.target.value)}
						placeholder="No expiry"
						type="number"
						value={ttl}
					/>
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
					<Button disabled={busy} onClick={save}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function RenameDialog({
	db,
	keyName,
	onOpenChange,
	onRenamed,
	open,
	serverId,
}: {
	db: number;
	keyName: string;
	onOpenChange: (open: boolean) => void;
	onRenamed: () => void;
	open: boolean;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const [next, setNext] = useState(keyName);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setNext(keyName);
		}
	}, [open, keyName]);

	async function save() {
		setBusy(true);
		try {
			await renameRedisKey(serverId, db, keyName, next.trim());
			await invalidateRedis(queryClient, serverId);
			toast.success(`Renamed to “${next.trim()}”.`);
			onOpenChange(false);
			onRenamed();
		} catch (e) {
			toast.error(errorMessage(e, "Couldn't rename the key."));
		} finally {
			setBusy(false);
		}
	}

	const valid = next.trim() !== "" && next.trim() !== keyName;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rename key</DialogTitle>
					<DialogDescription>
						Move “{keyName}” to a new name. Fails if the target already exists.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-2 py-2">
					<Label htmlFor="rename-input">New key</Label>
					<Input
						className="font-mono text-sm"
						id="rename-input"
						onChange={(e) => setNext(e.target.value)}
						value={next}
					/>
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
					<Button disabled={busy || !valid} onClick={save}>
						Rename
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// KeyEditorDialog creates (or replaces) a key with a type-specific value editor.
function KeyEditorDialog({
	db,
	onOpenChange,
	onSaved,
	open,
	serverId,
}: {
	db: number;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void;
	open: boolean;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const [key, setKey] = useState("");
	const [type, setType] = useState<RedisSetType>("string");
	const [ttl, setTtl] = useState("");
	const [str, setStr] = useState("");
	const [lines, setLines] = useState(""); // list/set: one item per line
	const [pairs, setPairs] = useState<[string, string][]>([["", ""]]); // hash/zset
	const [busy, setBusy] = useState(false);

	function reset() {
		setKey("");
		setType("string");
		setTtl("");
		setStr("");
		setLines("");
		setPairs([["", ""]]);
	}

	function buildSet(): RedisSetRequest | null {
		const trimmed = key.trim();
		if (!trimmed) {
			return null;
		}
		const ttlSeconds = ttl.trim() === "" ? -1 : Math.floor(Number(ttl));
		const base = { key: trimmed, ttlSeconds, type };
		switch (type) {
			case "string":
				return { ...base, string: str };
			case "list":
			case "set": {
				const items = lines.split("\n").filter((l) => l.length > 0);
				return items.length ? { ...base, items } : null;
			}
			case "hash": {
				const fields = pairs
					.filter(([f]) => f.trim() !== "")
					.map(([field, value]) => ({ field, value }));
				return fields.length ? { ...base, fields } : null;
			}
			case "zset": {
				const members = pairs
					.filter(([m]) => m.trim() !== "")
					.map(([member, score]) => ({ member, score: Number(score) || 0 }));
				return members.length ? { ...base, members } : null;
			}
			default:
				return null;
		}
	}

	async function submit() {
		const payload = buildSet();
		if (!payload) {
			toast.error("Fill in the key and a value.");
			return;
		}
		setBusy(true);
		try {
			await setRedisKey(serverId, db, payload);
			await invalidateRedis(queryClient, serverId);
			toast.success(`Set key “${payload.key}”.`);
			onOpenChange(false);
			reset();
			onSaved();
		} catch (e) {
			toast.error(errorMessage(e, "Couldn't set the key."));
		} finally {
			setBusy(false);
		}
	}

	const usesPairs = type === "hash" || type === "zset";

	return (
		<Dialog
			onOpenChange={(o) => {
				onOpenChange(o);
				if (!o) {
					reset();
				}
			}}
			open={open}
		>
			<DialogContent className="max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>New key</DialogTitle>
					<DialogDescription>
						Set a key and its value. Replaces any existing key with the same
						name.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-2">
					<div className="grid gap-2">
						<Label htmlFor="ed-key">Key</Label>
						<Input
							className="font-mono text-sm"
							id="ed-key"
							onChange={(e) => setKey(e.target.value)}
							placeholder="cache:user:18342"
							value={key}
						/>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-2">
							<Label htmlFor="ed-type">Type</Label>
							<Select
								onValueChange={(v) => setType(v as RedisSetType)}
								value={type}
							>
								<SelectTrigger className="w-full" id="ed-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{REDIS_SET_TYPES.map((t) => (
										<SelectItem key={t} value={t}>
											{t}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="ed-ttl">TTL (seconds)</Label>
							<Input
								className="tabular-nums"
								id="ed-ttl"
								inputMode="numeric"
								min={1}
								onChange={(e) => setTtl(e.target.value)}
								placeholder="No expiry"
								type="number"
								value={ttl}
							/>
						</div>
					</div>

					{type === "string" ? (
						<div className="grid gap-2">
							<Label htmlFor="ed-str">Value</Label>
							<Textarea
								className="font-mono text-xs"
								id="ed-str"
								onChange={(e) => setStr(e.target.value)}
								placeholder="A string, or a JSON document"
								value={str}
							/>
						</div>
					) : null}

					{type === "list" || type === "set" ? (
						<div className="grid gap-2">
							<Label htmlFor="ed-lines">
								{type === "set" ? "Members" : "Items"} (one per line)
							</Label>
							<Textarea
								className="font-mono text-xs"
								id="ed-lines"
								onChange={(e) => setLines(e.target.value)}
								placeholder={"first\nsecond\nthird"}
								value={lines}
							/>
						</div>
					) : null}

					{usesPairs ? (
						<PairEditor
							leftPlaceholder={type === "hash" ? "field" : "member"}
							onChange={setPairs}
							pairs={pairs}
							rightNumeric={type === "zset"}
							rightPlaceholder={type === "hash" ? "value" : "score"}
						/>
					) : null}
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
					<Button disabled={busy} onClick={submit}>
						Set key
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function PairEditor({
	leftPlaceholder,
	onChange,
	pairs,
	rightNumeric,
	rightPlaceholder,
}: {
	leftPlaceholder: string;
	onChange: (pairs: [string, string][]) => void;
	pairs: [string, string][];
	rightNumeric?: boolean;
	rightPlaceholder: string;
}) {
	function update(i: number, side: 0 | 1, value: string) {
		onChange(
			pairs.map((p, idx) =>
				idx === i ? (side === 0 ? [value, p[1]] : [p[0], value]) : p
			)
		);
	}
	return (
		<div className="grid gap-2">
			{pairs.map((p, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder-free
				<div className="flex items-center gap-2" key={i}>
					<Input
						className="font-mono text-xs"
						onChange={(e) => update(i, 0, e.target.value)}
						placeholder={leftPlaceholder}
						value={p[0]}
					/>
					<Input
						className="font-mono text-xs"
						inputMode={rightNumeric ? "decimal" : undefined}
						onChange={(e) => update(i, 1, e.target.value)}
						placeholder={rightPlaceholder}
						type={rightNumeric ? "number" : "text"}
						value={p[1]}
					/>
					<IconAction
						danger
						icon={Trash2}
						label="Remove row"
						onClick={() => onChange(pairs.filter((_, idx) => idx !== i))}
					/>
				</div>
			))}
			<Button
				className="justify-self-start"
				onClick={() => onChange([...pairs, ["", ""]])}
				size="sm"
				type="button"
				variant="ghost"
			>
				<Plus />
				Add row
			</Button>
		</div>
	);
}
