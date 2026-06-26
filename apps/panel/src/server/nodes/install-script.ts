import { env } from "@/server/env";

// The one-line node installer the enrollment command curls from the panel
// (`curl -fsSL <panel>/install.sh | sudo sh -s -- --panel … --node … --token …`).
// The panel renders it with the *current* pinned release baked in, so a fresh box
// always installs the latest daemon. The script downloads the arch-matched binary
// from the configured release base, verifies its sha256, installs it, exchanges
// the bootstrap token for durable credentials (`wings configure`), and brings
// up the systemd service. Absent release config → a script that fails loudly.

/** Render the install script as a shell-script HTTP response. */
export function renderInstallScript(): Response {
	const version = env.DAEMON_LATEST_VERSION?.replace(/^v/, "");
	const base = env.DAEMON_RELEASE_BASE_URL?.replace(/\/$/, "");
	const ok = version && base && /^[0-9A-Za-z.\-+]+$/.test(version);
	const body = ok ? installScript(version, base) : noReleaseScript();
	return new Response(body, {
		headers: {
			"content-type": "text/x-shellscript; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

function noReleaseScript(): string {
	return [
		"#!/bin/sh",
		'echo "This panel has no daemon release configured." >&2',
		'echo "Set DAEMON_LATEST_VERSION and DAEMON_RELEASE_BASE_URL on the panel." >&2',
		"exit 1",
		"",
	].join("\n");
}

// The script body uses only `$VAR` / `$(...)` shell syntax (no `${...}`, which a
// JS template literal would interpolate) — the only injected values are the two
// trusted, validated env settings below.
function installScript(version: string, base: string): string {
	return `#!/bin/sh
# wings installer — rendered by the panel for daemon v${version}.
set -eu

VERSION='${version}'
BASE='${base}'

PANEL=''; NODE=''; TOKEN=''; FQDN=''
while [ $# -gt 0 ]; do
  case "$1" in
    --panel) PANEL="$2"; shift 2 ;;
    --node)  NODE="$2";  shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --fqdn)  FQDN="$2";  shift 2 ;;
    *) echo "wings install: unknown option $1" >&2; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "wings install: run as root (use sudo)" >&2
  exit 1
fi
if [ -z "$PANEL" ] || [ -z "$NODE" ] || [ -z "$TOKEN" ]; then
  echo "wings install: missing --panel, --node, or --token" >&2
  exit 1
fi

for tool in curl sha256sum systemctl install; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "wings install: required tool not found: $tool" >&2
    exit 1
  fi
done

case "$(uname -m)" in
  x86_64|amd64)  ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "wings install: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "wings install: warning — Docker not found; install it to run servers." >&2
fi

URL="$BASE/v$VERSION/wings-linux-$ARCH"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "Downloading wings v$VERSION ($ARCH)..."
curl -fsSL "$URL" -o "$TMP"
SUM="$(curl -fsSL "$URL.sha256" | awk '{print $1}')"
if ! echo "$SUM  $TMP" | sha256sum -c - >/dev/null 2>&1; then
  echo "wings install: checksum verification failed" >&2
  exit 1
fi

install -m 0755 "$TMP" /usr/local/bin/wings

echo "Activating node..."
if [ -n "$FQDN" ]; then
  /usr/local/bin/wings configure --panel "$PANEL" --node "$NODE" --token "$TOKEN" --fqdn "$FQDN"
else
  /usr/local/bin/wings configure --panel "$PANEL" --node "$NODE" --token "$TOKEN"
fi

cat > /etc/systemd/system/wings.service <<'UNIT'
[Unit]
Description=RaptorPanel daemon (wings)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/wings run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now wings

echo "wings v$VERSION installed and running; the node will come online shortly."
`;
}
