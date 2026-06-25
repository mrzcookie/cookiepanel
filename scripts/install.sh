#!/bin/sh
# CookiePanel daemon installer.
#
# Downloads the cookied release binary for this box's architecture, verifies it
# against its published SHA-256, installs it to /usr/local/bin, enrolls the node
# against the panel with a single-use bootstrap token, and starts it under
# systemd. This is the target of the one-line install command the panel hands
# out at node creation, e.g.:
#
#   curl -fsSL https://<panel>/install.sh | sudo sh -s -- \
#       --panel https://<panel> --node <node-id> --token <bootstrap-token>
#
# Configuration may be passed as flags (above) or environment variables:
#   PANEL_URL, NODE_ID, BOOTSTRAP_TOKEN   (required)
#   FQDN                                  (optional; reported to the panel)
#   VERSION                               (default: latest)
#   RELEASE_BASE_URL                      (default: GitHub Releases for this repo)
#
# POSIX sh; no bashisms. Must run as root (it installs a system binary + unit).
set -eu

# --- Defaults ----------------------------------------------------------------
# Where release assets live. The panel builds its update URLs from the same base
# (DAEMON_RELEASE_BASE_URL); keep these in sync if you self-host the binaries.
RELEASE_BASE_URL="${RELEASE_BASE_URL:-https://github.com/mrzcookie/cookiepanel/releases}"
VERSION="${VERSION:-latest}"
PANEL_URL="${PANEL_URL:-}"
NODE_ID="${NODE_ID:-}"
BOOTSTRAP_TOKEN="${BOOTSTRAP_TOKEN:-}"
FQDN="${FQDN:-}"

INSTALL_PATH="/usr/local/bin/cookied"
UNIT_PATH="/etc/systemd/system/cookied.service"

# --- Flag parsing ------------------------------------------------------------
while [ $# -gt 0 ]; do
	case "$1" in
		--panel) PANEL_URL="$2"; shift 2 ;;
		--node) NODE_ID="$2"; shift 2 ;;
		--token) BOOTSTRAP_TOKEN="$2"; shift 2 ;;
		--fqdn) FQDN="$2"; shift 2 ;;
		--version) VERSION="$2"; shift 2 ;;
		--release-base-url) RELEASE_BASE_URL="$2"; shift 2 ;;
		-h|--help)
			sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

die() { echo "error: $*" >&2; exit 1; }

# --- Preconditions -----------------------------------------------------------
[ "$(id -u)" = "0" ] || die "must run as root (try: sudo sh install.sh ...)"
[ -n "$PANEL_URL" ] || die "missing --panel / PANEL_URL"
[ -n "$NODE_ID" ] || die "missing --node / NODE_ID"
[ -n "$BOOTSTRAP_TOKEN" ] || die "missing --token / BOOTSTRAP_TOKEN"
command -v systemctl >/dev/null 2>&1 || die "systemd (systemctl) is required"

# A downloader: prefer curl, fall back to wget.
if command -v curl >/dev/null 2>&1; then
	fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
	fetch() { wget -qO "$2" "$1"; }
else
	die "need curl or wget to download the daemon"
fi

# A SHA-256 verifier: sha256sum (coreutils) or shasum (busybox/macOS).
if command -v sha256sum >/dev/null 2>&1; then
	sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
	sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
	die "need sha256sum or shasum to verify the download"
fi

# --- Resolve the asset URL ---------------------------------------------------
case "$(uname -m)" in
	x86_64|amd64) ARCH="amd64" ;;
	aarch64|arm64) ARCH="arm64" ;;
	*) die "unsupported architecture: $(uname -m) (need x86_64 or aarch64)" ;;
esac
ASSET="cookied-linux-${ARCH}"

# GitHub serves the newest release at /releases/latest/download/<asset>, and a
# pinned version at /releases/download/v<version>/<asset>. The panel's update
# path always uses the pinned form; the installer additionally supports latest.
case "$VERSION" in
	latest) ASSET_URL="${RELEASE_BASE_URL%/}/latest/download/${ASSET}" ;;
	*) ASSET_URL="${RELEASE_BASE_URL%/}/download/v${VERSION#v}/${ASSET}" ;;
esac

case "$ASSET_URL" in
	https://*) : ;;
	*) die "release base url must be https" ;;
esac

# --- Download + verify -------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo ">> downloading ${ASSET} (${VERSION}) from ${ASSET_URL}"
fetch "$ASSET_URL" "$TMP/cookied" || die "download failed: $ASSET_URL"
fetch "${ASSET_URL}.sha256" "$TMP/cookied.sha256" || die "checksum download failed: ${ASSET_URL}.sha256"

WANT="$(tr -d '[:space:]' < "$TMP/cookied.sha256" | cut -d' ' -f1)"
GOT="$(sha256_of "$TMP/cookied")"
case "$WANT" in
	[0-9a-f][0-9a-f]*) : ;;
	*) die "malformed published checksum: $WANT" ;;
esac
[ "$GOT" = "$WANT" ] || die "checksum mismatch: got $GOT, want $WANT"
echo ">> checksum ok ($GOT)"

# --- Install the binary ------------------------------------------------------
install -m 0755 "$TMP/cookied" "$INSTALL_PATH"
echo ">> installed $($INSTALL_PATH version 2>/dev/null || echo cookied) to $INSTALL_PATH"

# --- Enroll (exchange the bootstrap token for durable credentials) -----------
echo ">> enrolling node $NODE_ID against $PANEL_URL"
set -- configure --panel "$PANEL_URL" --node "$NODE_ID" --token "$BOOTSTRAP_TOKEN"
[ -n "$FQDN" ] && set -- "$@" --fqdn "$FQDN"
"$INSTALL_PATH" "$@"

# --- systemd unit ------------------------------------------------------------
# The daemon manages Docker/host state and must come back across reboots and
# self-update (which restarts the service). Root is required by design.
cat > "$UNIT_PATH" <<EOF
[Unit]
Description=CookiePanel daemon (cookied)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=$INSTALL_PATH run
Restart=always
RestartSec=5
# The self-update path swaps this binary and restarts the unit.
KillMode=process

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now cookied
echo ">> cookied is running. check status with: systemctl status cookied"
