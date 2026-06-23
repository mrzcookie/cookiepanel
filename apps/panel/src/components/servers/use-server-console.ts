import { useCallback, useEffect, useRef, useState } from "react";
import { mintServerToken, sendServerCommand } from "@/lib/server-queries";

// Client-only hook driving the live server console: mint a short-lived JWT, open
// the WebSocket straight to the daemon, and demux its typed frames into a capped
// log buffer + the latest stats sample. The token expires in ~60s, so the socket
// reconnects (re-minting) on close. The WebSocket is only touched inside the
// effect, so this is SSR-safe.
//
// NOTE: the browser connects directly to the daemon's TLS endpoint, so the live
// console requires a browser-trusted cert (a managed/ACME node). For a self-
// signed node it stays in the "connecting/closed" state unless the operator has
// trusted the cert. See architecture.md.

export type ConsoleStatus = "idle" | "connecting" | "open" | "closed" | "error";

export type ConsoleStats = {
	cpuPct: number;
	memBytes: number;
	memLimit: number;
};

export type ConsoleLine = {
	id: number;
	stream: "stdout" | "stderr";
	data: string;
};

type Frame = {
	kind?: string;
	stream?: "stdout" | "stderr";
	data?: string;
	cpuPct?: number;
	memBytes?: number;
	memLimit?: number;
	message?: string;
};

const MAX_LINES = 2000;

export function useServerConsole(serverId: string, enabled: boolean) {
	const [lines, setLines] = useState<ConsoleLine[]>([]);
	const [stats, setStats] = useState<ConsoleStats | null>(null);
	const [status, setStatus] = useState<ConsoleStatus>("idle");
	// Bumped on each (re)connect so the terminal can clear its scrollback before
	// the daemon replays the recent-history tail.
	const [generation, setGeneration] = useState(0);

	const wsRef = useRef<WebSocket | null>(null);
	const lineIdRef = useRef(0);
	const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const closedRef = useRef(false);

	const pushLine = useCallback((stream: "stdout" | "stderr", data: string) => {
		setLines((prev) => {
			const next = [...prev, { id: lineIdRef.current++, stream, data }];
			return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
		});
	}, []);

	useEffect(() => {
		if (!enabled) {
			setStatus("idle");
			return;
		}
		closedRef.current = false;

		const connect = async () => {
			if (closedRef.current) {
				return;
			}
			setStatus("connecting");
			let url: string;
			try {
				url = (await mintServerToken(serverId)).url;
			} catch {
				setStatus("error");
				return;
			}
			if (closedRef.current) {
				return;
			}
			setLines([]);
			setGeneration((g) => g + 1);

			const ws = new WebSocket(url);
			wsRef.current = ws;
			ws.onopen = () => setStatus("open");
			ws.onmessage = (event) => {
				let frame: Frame;
				try {
					frame = JSON.parse(event.data);
				} catch {
					return;
				}
				if (frame.kind === "log") {
					pushLine(frame.stream ?? "stdout", frame.data ?? "");
				} else if (frame.kind === "stats") {
					setStats({
						cpuPct: frame.cpuPct ?? 0,
						memBytes: frame.memBytes ?? 0,
						memLimit: frame.memLimit ?? 0,
					});
				} else if (frame.kind === "error" && frame.message) {
					pushLine("stderr", frame.message);
				}
			};
			ws.onclose = () => {
				wsRef.current = null;
				if (closedRef.current) {
					return;
				}
				setStatus("closed");
				// Token expired or the box dropped — reconnect after a beat.
				reconnectRef.current = setTimeout(() => void connect(), 1000);
			};
		};

		void connect();

		return () => {
			closedRef.current = true;
			if (reconnectRef.current) {
				clearTimeout(reconnectRef.current);
			}
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [serverId, enabled, pushLine]);

	const sendCommand = useCallback(
		async (command: string) => {
			// The daemon doesn't echo stdin, so echo locally.
			pushLine("stdout", `> ${command}`);
			try {
				await sendServerCommand(serverId, command);
			} catch {
				pushLine("stderr", "Failed to send command.");
			}
		},
		[serverId, pushLine]
	);

	return { lines, stats, status, generation, sendCommand };
}
