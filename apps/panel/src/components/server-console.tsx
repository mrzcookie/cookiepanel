import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { SendHorizontal } from "lucide-react";
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
import "@xterm/xterm/css/xterm.css";

// The live server console. xterm.js renders the streamed stdout/stderr (the
// daemon will pipe the container's real output here over a WebSocket); for now
// it replays believable, state-driven log lines. Input is a separate command bar
// — the terminal itself is read-only (`disableStdin`) — so it stays accessible
// and the command flow matches the rest of the panel. This module is loaded only
// on the client (lazy + ClientOnly), since xterm touches the DOM at import.

// A calm, conventional dark terminal palette (zinc) that reads the same in both
// app themes — terminals are dark by convention. Re-skin alongside the design
// language later. `background` mirrors the `--color-terminal` token (the
// `bg-terminal` surface behind the canvas); xterm needs a concrete color string.
const THEME = {
	background: "#09090b",
	foreground: "#e4e4e7",
	cursor: "#e4e4e7",
	cursorAccent: "#09090b",
	selectionBackground: "#3f3f46",
	black: "#27272a",
	red: "#f87171",
	green: "#34d399",
	yellow: "#fbbf24",
	blue: "#60a5fa",
	magenta: "#c084fc",
	cyan: "#22d3ee",
	white: "#e4e4e7",
	brightBlack: "#52525b",
	brightRed: "#fca5a5",
	brightGreen: "#6ee7b7",
	brightYellow: "#fcd34d",
	brightBlue: "#93c5fd",
	brightMagenta: "#d8b4fe",
	brightCyan: "#67e8ff",
	brightWhite: "#fafafa",
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
		line("INFO", "Done — players can connect now"),
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
				`${DIM}Running the install script in an isolated container…${RESET}`
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
		<div className="space-y-3">
			<div
				className="h-96 overflow-hidden rounded-lg bg-terminal p-3"
				ref={mountRef}
			/>
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
