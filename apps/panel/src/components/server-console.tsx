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
import type { ServerState } from "@/lib/stubs";
import { cn } from "@/lib/utils";
import "@xterm/xterm/css/xterm.css";

// The live server console. xterm.js renders the streamed stdout/stderr (the
// daemon will pipe the container's real output here over a WebSocket); for now
// it replays believable, state-driven log lines. Input is a separate command bar
// — the terminal itself is read-only (`disableStdin`) — so it stays accessible
// and the command flow matches the rest of the panel. This module is loaded only
// on the client (lazy + ClientOnly), since xterm touches the DOM at import.

// "The Console" terminal palette: deep cool-ink surface, azure cursor + brand,
// and ANSI colors mapped to the app's semantic tones (green = ok, amber = warn,
// red = destructive, blue = azure). Dark in both app themes (terminals are dark
// by convention). `background` mirrors the `--color-terminal` token; xterm needs
// concrete color strings, so these are the sRGB renderings of the OKLCH tokens.
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

const DIM = "\x1b[90m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

function stamp() {
	return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function line(level: "INFO" | "WARN" | "ERROR", message: string) {
	const color = level === "WARN" ? YELLOW : level === "ERROR" ? RED : GREEN;
	return `${DIM}[${stamp()}]${RESET} ${color}${level}${RESET} ${message}`;
}

// Scripted "live" output. Cycled deterministically (no RNG) so the console reads
// like a real running server without ever depending on wall-clock randomness.
function bootSequence(templateName: string) {
	return [
		line("INFO", `Starting ${templateName} server`),
		line("INFO", "Loading configuration and world data"),
		line("INFO", "Preparing spawn area: 0%"),
		line("INFO", "Preparing spawn area: 84%"),
		line("INFO", "Done. Players can connect now"),
	];
}

const HEARTBEAT = [
	line.bind(null, "INFO", "Saving world…"),
	line.bind(null, "INFO", "Saved the game"),
	line.bind(null, "INFO", "Steve joined the game"),
	line.bind(
		null,
		"WARN",
		"Can't keep up! Is the server overloaded? Running 2140ms behind"
	),
	line.bind(null, "INFO", "<Alex> anyone seen my diamonds"),
	line.bind(null, "INFO", "Steve left the game"),
	line.bind(null, "INFO", "Autosave complete (took 412ms)"),
];

export type ServerConsoleProps = {
	state: ServerState;
	templateName: string;
	canSend: boolean;
	/** Where a real impl forwards the command to the daemon. The terminal already
	 * echoes it locally, so the stub can leave this unset. */
	onSend?: (command: string) => void;
};

export default function ServerConsole({
	state,
	templateName,
	canSend,
	onSend,
}: ServerConsoleProps) {
	const mountRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);

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
				// The element can be measured as 0×0 mid-layout; ignore and refit later.
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

	// Drive the content from the server's state: boot + stream while running,
	// a static message otherwise.
	useEffect(() => {
		const term = termRef.current;
		if (!term) {
			return;
		}
		term.write("\x1b[2J\x1b[H");

		if (state === "running") {
			for (const ln of bootSequence(templateName)) {
				term.writeln(ln);
			}
			let i = 0;
			const interval = setInterval(() => {
				term.writeln(HEARTBEAT[i % HEARTBEAT.length]());
				i += 1;
			}, 2200);
			return () => clearInterval(interval);
		}

		if (state === "starting") {
			term.writeln(`${DIM}Booting up…${RESET}`);
		} else if (state === "installing") {
			term.writeln(
				`${DIM}Setting up your server in an isolated sandbox…${RESET}`
			);
			term.writeln(`${DIM}This can take a few minutes the first time.${RESET}`);
		} else if (state === "failed") {
			term.writeln(
				`${RED}The server failed to start. See Settings for the last error,${RESET}`
			);
			term.writeln(`${RED}or reinstall to try again.${RESET}`);
		} else {
			term.writeln(
				`${DIM}Server is stopped. Press Start to boot it up.${RESET}`
			);
		}
	}, [state, templateName]);

	function submit(event: FormEvent) {
		event.preventDefault();
		const cmd = command.trim();
		if (!cmd || !canSend) {
			return;
		}
		termRef.current?.writeln(`${CYAN}> ${cmd}${RESET}`);
		onSend?.(cmd);
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
			setCommand(history[idx]);
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
				setCommand(history[idx]);
			}
		}
	}

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
