import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Maximize2, Minimize2, SendHorizontal } from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ServerState } from "@/lib/domain/servers";
import { cn } from "@/lib/utils";
import type { ConsoleLine, ConsoleStatus } from "./use-server-console";
import "@xterm/xterm/css/xterm.css";

// The live server console. xterm.js renders the container's real stdout/stderr,
// streamed from the daemon over a WebSocket (see `useServerConsole`). Input is a
// separate command bar — the terminal itself is read-only (`disableStdin`) — so
// it stays accessible. Client-only (lazy + ClientOnly): xterm touches the DOM at
// import.

// "The Console" terminal palette: deep cool-ink surface, azure cursor + brand,
// ANSI colors mapped to the app's semantic tones. xterm needs concrete color
// strings, so these are the sRGB renderings of the OKLCH tokens.
const THEME = {
	background: "#0a0c11",
	foreground: "#dfe3ea",
	cursor: "#5aa6f0",
	cursorAccent: "#0a0c11",
	selectionBackground: "#21456e",
	black: "#1a1e26",
	red: "#ef5350",
	green: "#57d98f",
	yellow: "#f0c050",
	blue: "#5aa6f0",
	magenta: "#a98cf2",
	cyan: "#5cc8ec",
	white: "#dfe3ea",
	brightBlack: "#4a525f",
	brightRed: "#ff7a72",
	brightGreen: "#7ee6a8",
	brightYellow: "#ffd166",
	brightBlue: "#82bdf8",
	brightMagenta: "#c4a8f8",
	brightCyan: "#82d8f2",
	brightWhite: "#f5f7fa",
} as const;

const RED = "\x1b[31m";
const RESET = "\x1b[0m";

export type ServerConsoleProps = {
	lines: ConsoleLine[];
	status: ConsoleStatus;
	/** Bumped on each (re)connect, so we clear scrollback before the replay tail. */
	generation: number;
	state: ServerState;
	canSend: boolean;
	onSend: (command: string) => void;
};

// What to show over an empty terminal — the server's lifecycle first, then the
// connection state once it's running.
function consoleHint(state: ServerState, status: ConsoleStatus): string | null {
	if (state === "installing") {
		return "Setting up your server in an isolated sandbox…";
	}
	if (state === "failed") {
		return "The server failed to start. See Settings for the last error.";
	}
	if (state === "starting") {
		return "Booting up…";
	}
	if (state !== "running") {
		return "Server is stopped. Press Start to boot it up.";
	}
	if (status === "connecting" || status === "idle") {
		return "Connecting to the console…";
	}
	if (status === "error") {
		return "Couldn't reach the console. The node may not have a trusted certificate yet.";
	}
	if (status === "closed") {
		return "Reconnecting…";
	}
	return null;
}

export default function ServerConsole({
	lines,
	status,
	generation,
	state,
	canSend,
	onSend,
}: ServerConsoleProps) {
	const mountRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const lastIdRef = useRef(-1);
	const genRef = useRef(generation);

	const [command, setCommand] = useState("");
	const [history, setHistory] = useState<string[]>([]);
	const [histIdx, setHistIdx] = useState<number | null>(null);
	const [fullscreen, setFullscreen] = useState(false);

	// Esc leaves fullscreen, and refit when the panel resizes between modes.
	useEffect(() => {
		fitRef.current?.fit();
		if (!fullscreen) {
			return;
		}
		const onKey = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				setFullscreen(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [fullscreen]);

	// Create the terminal once, and keep it fitted to its container.
	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) {
			return;
		}
		const term = new Terminal({
			convertEol: true,
			cursorBlink: false,
			disableStdin: true,
			fontFamily:
				'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
			fontSize: 12,
			lineHeight: 1.4,
			scrollback: 2000,
			theme: THEME,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(mount);
		fit.fit();
		termRef.current = term;
		fitRef.current = fit;

		const observer = new ResizeObserver(() => {
			try {
				fit.fit();
			} catch {
				// Can measure 0×0 mid-layout; ignore and refit later.
			}
		});
		observer.observe(mount);

		return () => {
			observer.disconnect();
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, []);

	// Stream new lines into the terminal. On reconnect (generation change) clear
	// the scrollback first, since the daemon replays the recent-history tail.
	useEffect(() => {
		const term = termRef.current;
		if (!term) {
			return;
		}
		if (genRef.current !== generation) {
			genRef.current = generation;
			term.write("\x1b[2J\x1b[H");
			lastIdRef.current = -1;
		}
		for (const ln of lines) {
			if (ln.id > lastIdRef.current) {
				term.writeln(
					ln.stream === "stderr" ? `${RED}${ln.data}${RESET}` : ln.data
				);
				lastIdRef.current = ln.id;
			}
		}
	}, [lines, generation]);

	function submit(event: FormEvent) {
		event.preventDefault();
		const cmd = command.trim();
		if (!cmd || !canSend) {
			return;
		}
		onSend(cmd);
		setHistory((h) => [...h.filter((c) => c !== cmd), cmd].slice(-100));
		setHistIdx(null);
		setCommand("");
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowUp") {
			if (history.length === 0) {
				return;
			}
			event.preventDefault();
			const idx =
				histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
			setHistIdx(idx);
			setCommand(history[idx] ?? "");
		} else if (event.key === "ArrowDown") {
			if (histIdx === null) {
				return;
			}
			event.preventDefault();
			const idx = histIdx + 1;
			if (idx >= history.length) {
				setHistIdx(null);
				setCommand("");
			} else {
				setHistIdx(idx);
				setCommand(history[idx] ?? "");
			}
		}
	}

	const hint = lines.length === 0 ? consoleHint(state, status) : null;

	return (
		<div
			className={cn(
				"flex flex-col gap-3",
				fullscreen && "fixed inset-0 z-50 bg-background p-4"
			)}
		>
			<div className={cn("relative", fullscreen && "min-h-0 flex-1")}>
				<div
					className={cn(
						"overflow-hidden rounded-lg bg-terminal p-3",
						fullscreen ? "h-full" : "h-96"
					)}
					ref={mountRef}
				/>
				{hint ? (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-muted-foreground text-sm">
						{hint}
					</div>
				) : null}
				<Button
					aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen console"}
					className="absolute top-2 right-2 size-7 text-muted-foreground hover:text-foreground"
					onClick={() => setFullscreen((value) => !value)}
					size="icon"
					type="button"
					variant="ghost"
				>
					{fullscreen ? <Minimize2 /> : <Maximize2 />}
				</Button>
			</div>
			<form className="flex items-center gap-2" onSubmit={submit}>
				<span className="font-mono text-muted-foreground text-sm">$</span>
				<Input
					aria-label="Console command"
					className="h-9 flex-1 font-mono"
					disabled={!canSend}
					onChange={(event) => setCommand(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={
						canSend
							? "Type a command, then press Enter (↑/↓ for history)"
							: "Start the server to send commands"
					}
					value={command}
				/>
				<Button disabled={!(canSend && command.trim())} size="sm" type="submit">
					<SendHorizontal />
					Send
				</Button>
			</form>
		</div>
	);
}
