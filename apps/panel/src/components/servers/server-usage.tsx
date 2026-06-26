import { type ReactNode, useEffect, useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, YAxis } from "recharts";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import type { ServerRow } from "@/lib/domain/servers";
import { formatBytes, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConsoleStats } from "./use-server-console";

// The live-usage strip on a server's console tab — a telemetry bar of area
// graphs (CPU / memory / disk / network) that tick in time with the streamed
// console above them.
//
// CPU and memory are real: useLiveUsage accumulates the daemon's stats-WS frames
// into rolling series. Disk + network aren't in the stats frame yet, so those two
// panels read "No live data" until those subsystems land.

// ~80s of history at the console's heartbeat cadence — long enough to read a
// trend, short enough to feel immediate.
const WINDOW = 40;
const STRESS_THRESHOLD = 90;

const MB = 1024 * 1024;
// The fixed ceiling the network graph scales to.
const NET_MAX = 3 * MB;

const HUE = {
	cpu: "var(--color-chart-1)",
	mem: "var(--color-chart-2)",
	disk: "var(--color-chart-3)",
	down: "var(--color-chart-4)",
	up: "var(--color-chart-1)",
} as const;

type Series = number[];

function clamp(value: number, lo: number, hi: number) {
	return Math.min(hi, Math.max(lo, value));
}

// Bytes/sec → a compact "1.5 MB/s" / "410 KB/s" reading. Rolls over to MB just
// under 1024 KB so the KB reading never shows four digits.
function formatRate(bytesPerSec: number) {
	if (bytesPerSec >= 1000 * 1024) {
		return `${(bytesPerSec / MB).toFixed(1)} MB/s`;
	}
	if (bytesPerSec >= 1024) {
		return `${Math.round(bytesPerSec / 1024)} KB/s`;
	}
	return `${Math.round(bytesPerSec)} B/s`;
}

type Buffers = {
	cpu: Series;
	mem: Series;
	disk: Series;
	down: Series;
	up: Series;
};

// Accumulate the live CPU% + memory% samples from the daemon's stats frames into
// rolling series. Disk + network aren't in the stats frame yet, so they read "No
// live data" until those subsystems land.
function useLiveUsage(server: ServerRow, live: ConsoleStats | null): Buffers {
	const running = server.state === "running";
	const [series, setSeries] = useState<{ cpu: Series; mem: Series }>({
		cpu: [],
		mem: [],
	});

	useEffect(() => {
		if (!(running && live)) {
			setSeries({ cpu: [], mem: [] });
			return;
		}
		const cpu = clamp(live.cpuPct, 0, 100);
		const mem =
			live.memLimit > 0
				? clamp((live.memBytes / live.memLimit) * 100, 0, 100)
				: 0;
		setSeries((prev) => ({
			cpu: [...prev.cpu, cpu].slice(-WINDOW),
			mem: [...prev.mem, mem].slice(-WINDOW),
		}));
	}, [running, live]);

	return { cpu: series.cpu, mem: series.mem, disk: [], down: [], up: [] };
}

export function ServerUsageCard({
	live,
	server,
}: {
	live: ConsoleStats | null;
	server: ServerRow;
}) {
	const { cpu, mem, disk, down, up } = useLiveUsage(server, live);
	const running = server.state === "running";

	const cpuNow = cpu.at(-1) ?? null;
	const memNow = mem.at(-1) ?? null;
	const diskNow = disk.at(-1) ?? null;
	const downNow = down.at(-1) ?? null;
	const upNow = up.at(-1) ?? null;

	const memBytes =
		memNow === null ? null : (memNow / 100) * server.memLimitBytes;
	const diskBytes =
		diskNow === null ? null : (diskNow / 100) * server.diskLimitBytes;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Live usage</CardTitle>
				{running ? (
					<CardAction>
						<LivePill />
					</CardAction>
				) : null}
			</CardHeader>
			<CardContent className="grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-4 lg:gap-x-0 lg:divide-x lg:divide-border">
				<PercentPanel
					className="lg:pr-6"
					detail={pluralize(server.cpuLimitCores, "core")}
					hue={HUE.cpu}
					label="CPU"
					now={cpuNow}
					readout={cpuNow === null ? null : `${Math.round(cpuNow)}%`}
					series={cpu}
				/>
				<PercentPanel
					className="lg:px-6"
					detail={formatBytes(server.memLimitBytes)}
					hue={HUE.mem}
					label="Memory"
					now={memNow}
					readout={memBytes === null ? null : formatBytes(memBytes)}
					series={mem}
				/>
				<PercentPanel
					className="lg:px-6"
					detail={formatBytes(server.diskLimitBytes)}
					hue={HUE.disk}
					label="Disk"
					now={diskNow}
					readout={diskBytes === null ? null : formatBytes(diskBytes)}
					series={disk}
				/>
				<UsageGraph
					className="lg:pl-6"
					detail={
						upNow === null ? (
							"—"
						) : (
							<>
								<span style={{ color: HUE.up }}>↑</span> {formatRate(upNow)}
							</>
						)
					}
					domainMax={NET_MAX}
					empty={downNow === null}
					headline={
						downNow === null ? (
							"—"
						) : (
							<>
								<span style={{ color: HUE.down }}>↓</span> {formatRate(downNow)}
							</>
						)
					}
					label="Network"
					lines={[
						{ key: "down", color: HUE.down, series: down, fill: true },
						{ key: "up", color: HUE.up, series: up, fill: false },
					]}
				/>
			</CardContent>
		</Card>
	);
}

// A percent-scaled metric (CPU / memory / disk): a single area graph, with the
// reading shown in its natural unit and the bar turning red near its ceiling.
function PercentPanel({
	className,
	detail,
	hue,
	label,
	now,
	readout,
	series,
}: {
	className?: string;
	detail: ReactNode;
	hue: string;
	label: string;
	now: number | null;
	readout: string | null;
	series: Series;
}) {
	const stressed = (now ?? 0) >= STRESS_THRESHOLD;
	const color = stressed ? "var(--destructive)" : hue;

	return (
		<UsageGraph
			className={className}
			detail={detail}
			domainMax={100}
			empty={readout === null}
			headline={readout ?? "—"}
			headlineClassName={stressed ? "text-destructive" : undefined}
			label={label}
			lines={[{ key: "v", color, series, fill: true }]}
		/>
	);
}

// A small "this is updating" cue that echoes the streamed console beside it.
function LivePill() {
	return (
		<span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
			<span className="relative flex size-1.5">
				<span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-75 motion-reduce:hidden" />
				<span className="relative inline-flex size-1.5 rounded-full bg-brand" />
			</span>
			Live
		</span>
	);
}

type Line = { key: string; color: string; series: Series; fill: boolean };

function UsageGraph({
	className,
	detail,
	domainMax,
	empty,
	headline,
	headlineClassName,
	label,
	lines,
}: {
	className?: string;
	detail: ReactNode;
	domainMax: number;
	empty: boolean;
	headline: ReactNode;
	headlineClassName?: string;
	label: string;
	lines: Line[];
}) {
	return (
		<div className={cn("grid gap-2.5", className)}>
			<div className="flex items-baseline justify-between gap-3">
				<span className="font-medium text-muted-foreground text-xs">
					{label}
				</span>
				<span className="font-mono text-muted-foreground text-xs tabular-nums">
					{detail}
				</span>
			</div>
			<span
				className={cn(
					"font-mono font-semibold text-2xl text-foreground tabular-nums leading-none",
					empty && "text-muted-foreground",
					headlineClassName
				)}
			>
				{headline}
			</span>
			{empty ? (
				<div className="flex h-24 items-center justify-center rounded-md bg-muted/30 text-muted-foreground text-xs">
					No live data
				</div>
			) : (
				<UsageSpark domainMax={domainMax} label={label} lines={lines} />
			)}
		</div>
	);
}

function UsageSpark({
	domainMax,
	label,
	lines,
}: {
	domainMax: number;
	label: string;
	lines: Line[];
}) {
	const baseId = useId();
	const length = Math.max(...lines.map((line) => line.series.length), 0);
	const data = Array.from({ length }, (_, i) => {
		const row: Record<string, number> = { i };
		for (const line of lines) {
			const value = line.series[i];
			if (value !== undefined) {
				row[line.key] = value;
			}
		}
		return row;
	});
	const lastIndex = length - 1;
	const config = Object.fromEntries(
		lines.map((line) => [line.key, { label, color: line.color }])
	) satisfies ChartConfig;

	return (
		<ChartContainer className="aspect-auto h-24 w-full" config={config}>
			<AreaChart data={data} margin={{ bottom: 2, left: 0, right: 4, top: 4 }}>
				<defs>
					{lines.map((line) => (
						<linearGradient
							id={`${baseId}-${line.key}`}
							key={line.key}
							x1="0"
							x2="0"
							y1="0"
							y2="1"
						>
							<stop offset="0%" stopColor={line.color} stopOpacity={0.3} />
							<stop offset="100%" stopColor={line.color} stopOpacity={0.02} />
						</linearGradient>
					))}
				</defs>
				<CartesianGrid
					horizontal
					strokeDasharray="2 4"
					strokeOpacity={0.4}
					vertical={false}
				/>
				<YAxis domain={[0, domainMax]} hide />
				{lines.map((line) => (
					<Area
						dataKey={line.key}
						dot={(props: { cx?: number; cy?: number; index?: number }) =>
							leadingDot(props, lastIndex, line.color)
						}
						fill={line.fill ? `url(#${baseId}-${line.key})` : "transparent"}
						isAnimationActive={false}
						key={line.key}
						stroke={line.color}
						strokeWidth={2}
						type="monotone"
					/>
				))}
			</AreaChart>
		</ChartContainer>
	);
}

// A single glowing marker at the live (right) edge of a line — the "now" point
// of the readout. Every other point renders no dot.
function leadingDot(
	props: { cx?: number; cy?: number; index?: number },
	lastIndex: number,
	color: string
): ReactNode {
	const { cx, cy, index } = props;
	if (index !== lastIndex || cx == null || cy == null) {
		return <g key={`empty-${index}`} />;
	}
	return (
		<g key="live-dot">
			<circle cx={cx} cy={cy} fill={color} fillOpacity={0.18} r={5} />
			<circle cx={cx} cy={cy} fill={color} r={2.5} />
		</g>
	);
}
