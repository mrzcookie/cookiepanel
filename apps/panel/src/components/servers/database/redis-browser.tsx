import { ChevronRight, KeyRound, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
	REDIS_TYPES,
	type RedisData,
	type RedisKey,
	type RedisType,
	ttlLabel,
} from "@/lib/domain/redis-browser";
import type { ServerRow } from "@/lib/domain/servers";
import { formatBytes, formatCount } from "@/lib/format";
import {
	createKey,
	deleteKey,
	useRedisData,
} from "@/lib/stores/redis-browser-store";

function sizeLabel(entry: RedisKey): string {
	return isCollection(entry.type)
		? `${formatCount(entry.length)} items`
		: formatBytes(entry.length);
}

// The Redis Key Browser: keyspace stats, a filterable key list, and a per-key
// detail with type / TTL / value. Create and delete keys against the stub store.
export function RedisBrowser({ server }: { server: ServerRow }) {
	const data = useRedisData(server.id);
	const [filter, setFilter] = useState("");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	const selected = selectedKey
		? data.keys.find((entry) => entry.key === selectedKey)
		: undefined;

	return (
		<div className="space-y-4">
			<ConnectionHeader label="Browser" server={server} />
			<RedisStats data={data} />
			{selected ? (
				<KeyDetail
					entry={selected}
					onBack={() => setSelectedKey(null)}
					serverId={server.id}
				/>
			) : (
				<KeyList
					data={data}
					filter={filter}
					onFilter={setFilter}
					onOpen={setSelectedKey}
					serverId={server.id}
				/>
			)}
		</div>
	);
}

function RedisStats({ data }: { data: RedisData }) {
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
			<StatTile
				label="Memory"
				suffix={`/ ${formatBytes(data.maxMemoryBytes)}`}
				value={formatBytes(data.usedMemoryBytes)}
			/>
			<StatTile label="Keys" value={formatCount(data.keys.length)} />
			<StatTile label="Hit rate" value={hitRate(data)} />
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
	data,
	filter,
	onFilter,
	onOpen,
	serverId,
}: {
	data: RedisData;
	filter: string;
	onFilter: (value: string) => void;
	onOpen: (key: string) => void;
	serverId: string;
}) {
	const [createOpen, setCreateOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);

	const needle = filter.trim().toLowerCase();
	const keys = needle
		? data.keys.filter((entry) => entry.key.toLowerCase().includes(needle))
		: data.keys;

	return (
		<div className="space-y-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				<div className="relative sm:max-w-xs sm:flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						aria-label="Filter keys"
						className="pl-8 font-mono text-xs"
						onChange={(event) => onFilter(event.target.value)}
						placeholder="Filter keys, e.g. session:"
						value={filter}
					/>
				</div>
				<Button
					className="sm:ml-auto"
					onClick={() => setCreateOpen(true)}
					size="sm"
				>
					<Plus />
					New key
				</Button>
			</div>

			<div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
				{keys.length === 0 ? (
					<div className="p-4">
						<EmptyState
							description={
								needle
									? "No keys match that filter."
									: "Set a key to start storing data."
							}
							icon={KeyRound}
							title={needle ? "No matching keys" : "No keys yet"}
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

			<NewKeyDialog
				existing={data.keys.map((entry) => entry.key)}
				onOpenChange={setCreateOpen}
				open={createOpen}
				serverId={serverId}
			/>
			<ConfirmDrop
				confirmLabel="Delete key"
				description={`Delete the key “${drop}”. This can't be undone.`}
				onConfirm={() => {
					if (drop) {
						deleteKey(serverId, drop);
						toast.success(`Deleted “${drop}”.`);
					}
				}}
				onOpenChange={(next) => setDrop(next ? drop : null)}
				open={drop !== null}
				title="Delete this key?"
			/>
		</div>
	);
}

function KeyDetail({
	entry,
	onBack,
	serverId,
}: {
	entry: RedisKey;
	onBack: () => void;
	serverId: string;
}) {
	const [drop, setDrop] = useState(false);
	return (
		<Section
			action={
				<Button onClick={() => setDrop(true)} size="sm" variant="destructive">
					<Trash2 />
					Delete
				</Button>
			}
			subtitle={<span className="font-mono">{entry.type}</span>}
			title={
				<Breadcrumb
					current={entry.key}
					trail={[{ label: "Keys", onClick: onBack }]}
				/>
			}
		>
			<div className="space-y-4 p-4">
				<DetailList>
					<DetailRow label="Type" value={entry.type} />
					<DetailRow label="TTL" value={ttlLabel(entry.ttlSeconds)} />
					<DetailRow label="Size" value={sizeLabel(entry)} />
				</DetailList>
				<div className="space-y-2">
					<p className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
						{"// value"}
					</p>
					<div className="terminal whitespace-pre-wrap break-all rounded-lg p-4 font-mono text-sm">
						{entry.preview}
					</div>
				</div>
			</div>
			<ConfirmDrop
				confirmLabel="Delete key"
				description={`Delete the key “${entry.key}”. This can't be undone.`}
				onConfirm={() => {
					deleteKey(serverId, entry.key);
					toast.success(`Deleted “${entry.key}”.`);
					onBack();
				}}
				onOpenChange={setDrop}
				open={drop}
				title="Delete this key?"
			/>
		</Section>
	);
}

function NewKeyDialog({
	existing,
	onOpenChange,
	open,
	serverId,
}: {
	existing: string[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const [key, setKey] = useState("");
	const [type, setType] = useState<RedisType>("string");
	const [ttl, setTtl] = useState("");
	const [value, setValue] = useState("");

	const trimmed = key.trim();
	const duplicate = existing.includes(trimmed);
	const valid = trimmed !== "" && !duplicate;

	function reset() {
		setKey("");
		setType("string");
		setTtl("");
		setValue("");
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					reset();
				}
			}}
			open={open}
		>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (!valid) {
							return;
						}
						const ttlNumber = Number(ttl);
						createKey(serverId, {
							key: trimmed,
							type,
							ttlSeconds:
								ttl.trim() !== "" && Number.isFinite(ttlNumber) && ttlNumber > 0
									? Math.floor(ttlNumber)
									: null,
							length: type === "string" ? value.length : 0,
							preview: value.trim() === "" ? "(empty)" : value,
						});
						toast.success(`Set key “${trimmed}”.`);
						onOpenChange(false);
						reset();
					}}
				>
					<DialogHeader>
						<DialogTitle>New key</DialogTitle>
						<DialogDescription>
							Set a key and its value. Leave the TTL blank for no expiry.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="key-name">Key</Label>
							<Input
								aria-invalid={Boolean(trimmed) && !valid}
								className="font-mono text-sm"
								id="key-name"
								onChange={(event) => setKey(event.target.value)}
								placeholder="cache:user:18342"
								value={key}
							/>
							{duplicate ? (
								<p className="text-destructive text-xs">
									That key already exists.
								</p>
							) : null}
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label htmlFor="key-type">Type</Label>
								<Select
									onValueChange={(next) => setType(next as RedisType)}
									value={type}
								>
									<SelectTrigger className="w-full" id="key-type">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{REDIS_TYPES.map((option) => (
											<SelectItem key={option} value={option}>
												{option}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="key-ttl">TTL (seconds)</Label>
								<Input
									className="tabular-nums"
									id="key-ttl"
									inputMode="numeric"
									min={1}
									onChange={(event) => setTtl(event.target.value)}
									placeholder="No expiry"
									type="number"
									value={ttl}
								/>
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="key-value">Value</Label>
							<Textarea
								className="font-mono text-xs"
								id="key-value"
								onChange={(event) => setValue(event.target.value)}
								placeholder="A string, or a JSON document"
								value={value}
							/>
						</div>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={!valid} type="submit">
							Set key
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
