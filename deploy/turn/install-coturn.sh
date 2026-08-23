#!/usr/bin/env bash
#
# Stand up one ChatKonect TURN relay, on Ubuntu or Debian.
#
# Run this once per box. Each box is independent — there is no clustering to set
# up, because the browser is handed the whole list and picks. Run it in two
# regions and you have a relay network; run it in one and you have a relay.
#
#   sudo ./install-coturn.sh --domain turn.example.com --email you@example.com
#
# What it does, and why each part is here rather than left to you:
#   • installs coturn and enables it (it ships disabled)
#   • writes /etc/turnserver.conf with use-auth-secret, the private-range denies,
#     and external-ip set from the actual public address — the three things that
#     are either security holes or silent failures when left out
#   • gets a Let's Encrypt certificate for turns:, and installs a renewal hook,
#     because certbot writes root-only files and coturn drops privileges
#   • opens the ports it needs
#   • prints the exact TURN_URL / TURN_SECRET to paste into the server env
#
# Options:
#   --domain <fqdn>     required; must already resolve to this box
#   --email <addr>      for Let's Encrypt expiry notices (recommended)
#   --secret <hex>      reuse an existing secret instead of generating one
#   --no-tls            skip certbot; UDP+TCP only (fine to start, weaker reach)
#   --ports <min-max>   relay port range (default 49160-49300)
#   --label <name>      cosmetic, used in the summary (e.g. "india")
#   --dry-run           print what would happen, change nothing
#
set -euo pipefail

DOMAIN=""
EMAIL=""
SECRET=""
USE_TLS=1
PORT_RANGE="49160-49300"
LABEL=""
DRY_RUN=0

die() { echo "✗ $*" >&2; exit 1; }
note() { echo "  $*"; }
step() { echo ""; echo "▸ $*"; }
run() {
  if [ "$DRY_RUN" = "1" ]; then echo "    [dry-run] $*"; else eval "$@"; fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --secret) SECRET="${2:-}"; shift 2 ;;
    --ports) PORT_RANGE="${2:-}"; shift 2 ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --no-tls) USE_TLS=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$DOMAIN" ] || die "--domain is required (e.g. --domain turn.example.com)"
[ "$(id -u)" = "0" ] || [ "$DRY_RUN" = "1" ] || die "run this with sudo"

MIN_PORT="${PORT_RANGE%-*}"
MAX_PORT="${PORT_RANGE#*-}"
[ "$MIN_PORT" -lt "$MAX_PORT" ] 2>/dev/null || die "--ports must look like 49160-49300"

step "Working out this machine's addresses"
# A relay MUST advertise its public address. On any cloud VM the public IP is not
# on the NIC — it is 1:1 NAT — and coturn then advertises the private address,
# every relay candidate is unusable, and it presents exactly like a firewall
# problem. This is the single most common way self-hosted TURN silently fails.
PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
[ -n "$PUBLIC_IP" ] || PUBLIC_IP="$(curl -fsS --max-time 10 https://ifconfig.me 2>/dev/null || true)"
[ -n "$PUBLIC_IP" ] || die "could not determine this box's public IP — pass it by editing external-ip after install"
LOCAL_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
note "public:  $PUBLIC_IP"
note "on NIC:  ${LOCAL_IP:-unknown}"
if [ -n "$LOCAL_IP" ] && [ "$LOCAL_IP" != "$PUBLIC_IP" ]; then
  note "→ behind 1:1 NAT, so external-ip is required. Setting it."
  EXTERNAL_LINE="external-ip=$PUBLIC_IP/$LOCAL_IP"
else
  EXTERNAL_LINE="external-ip=$PUBLIC_IP"
fi

step "Checking $DOMAIN points here"
RESOLVED="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"
if [ -z "$RESOLVED" ]; then
  echo "  ⚠ $DOMAIN does not resolve yet."
  [ "$USE_TLS" = "1" ] && die "certbot cannot issue a certificate until it does. Add the A record, or pass --no-tls."
elif [ "$RESOLVED" != "$PUBLIC_IP" ]; then
  echo "  ⚠ $DOMAIN resolves to $RESOLVED, not $PUBLIC_IP."
  [ "$USE_TLS" = "1" ] && die "certbot will fail. Fix the A record, or pass --no-tls."
else
  note "resolves to this box ✓"
fi

step "Installing coturn"
run "export DEBIAN_FRONTEND=noninteractive"
run "apt-get update -qq"
run "apt-get install -y -qq coturn"
# Debian/Ubuntu ship it disabled so that installing the package does not
# immediately expose a relay.
run "sed -i 's/^#\\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn"
grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn 2>/dev/null || \
  run "echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn"

if [ -z "$SECRET" ]; then
  step "Generating the shared secret"
  SECRET="$(openssl rand -hex 32)"
  note "generated (printed in the summary below — save it, it is not recoverable from here)"
else
  step "Using the secret you supplied"
fi

CERT_DIR="/etc/coturn/certs"
if [ "$USE_TLS" = "1" ]; then
  step "Getting a TLS certificate for turns:"
  run "apt-get install -y -qq certbot"
  if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    note "certificate already exists — reusing it"
  else
    # coturn is stopped for this: certbot --standalone needs port 80, and if
    # anything else is bound there the issuance fails confusingly.
    run "systemctl stop coturn 2>/dev/null || true"
    if [ -n "$EMAIL" ]; then
      run "certbot certonly --standalone --non-interactive --agree-tos -m '$EMAIL' -d '$DOMAIN'"
    else
      run "certbot certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email -d '$DOMAIN'"
    fi
  fi

  step "Making the certificate readable by coturn"
  # coturn drops privileges to the turnserver user and cannot read
  # /etc/letsencrypt/live. Without this copy, TLS silently fails to start and
  # only turns: is affected — so calls work until they reach a network that
  # needs 5349, which is the worst possible time to find out.
  run "mkdir -p '$CERT_DIR'"
  HOOK=/etc/letsencrypt/renewal-hooks/deploy/coturn-copy-certs.sh
  run "mkdir -p /etc/letsencrypt/renewal-hooks/deploy"
  if [ "$DRY_RUN" = "1" ]; then
    echo "    [dry-run] write $HOOK"
  else
    cat > "$HOOK" <<HOOKEOF
#!/bin/bash
# Installed by ChatKonect install-coturn.sh. Runs on every renewal.
set -e
SRC="/etc/letsencrypt/live/$DOMAIN"
cp "\$SRC/fullchain.pem" "\$SRC/privkey.pem" "$CERT_DIR/"
chown turnserver:turnserver "$CERT_DIR"/*.pem
chmod 600 "$CERT_DIR"/*.pem
systemctl restart coturn
HOOKEOF
    chmod +x "$HOOK"
    "$HOOK"
  fi
  note "renewal hook installed at $HOOK"
  TLS_LINES="cert=$CERT_DIR/fullchain.pem
pkey=$CERT_DIR/privkey.pem
tls-listening-port=5349"
else
  step "Skipping TLS (--no-tls)"
  note "turns: on 5349 is what gets through deep-packet-inspecting firewalls."
  note "Re-run without --no-tls once DNS is in place."
  TLS_LINES="# TLS not configured — no turns: on this relay"
fi

step "Writing /etc/turnserver.conf"
if [ -f /etc/turnserver.conf ] && [ "$DRY_RUN" != "1" ]; then
  BACKUP="/etc/turnserver.conf.bak.$(date +%s)"
  cp /etc/turnserver.conf "$BACKUP"
  note "existing config backed up to $BACKUP"
fi

CONF_BODY="# Managed by ChatKonect deploy/turn/install-coturn.sh
# Regenerating this file overwrites hand edits — keep changes below the marker.

listening-port=3478
listening-ip=0.0.0.0
$EXTERNAL_LINE

realm=$DOMAIN
server-name=$DOMAIN

# Credential mode: the app mints time-limited credentials signed with this
# secret, so nothing has to be stored or synchronised. Do NOT also enable
# lt-cred-mech — the two conflict and authentication starts failing.
use-auth-secret
static-auth-secret=$SECRET

$TLS_LINES

# One port per concurrent relayed stream.
min-port=$MIN_PORT
max-port=$MAX_PORT

fingerprint
no-multicast-peers
no-cli
stale-nonce=600

# An open TURN server is a proxy into whatever it can reach: your own VPC, the
# cloud metadata endpoint, localhost. These denies are what stop the relay being
# turned against your own infrastructure. Do not remove them.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff

# WebRTC never needs TCP relaying, and allowing it widens the proxy surface.
no-tcp-relay

# Caps, so one user cannot take the whole box. Bandwidth is the bill.
user-quota=12
total-quota=1200

# ── local edits below this line ──"

if [ "$DRY_RUN" = "1" ]; then
  echo "    [dry-run] would write /etc/turnserver.conf ($(echo "$CONF_BODY" | wc -l) lines)"
else
  printf '%s\n' "$CONF_BODY" > /etc/turnserver.conf
  chmod 640 /etc/turnserver.conf
  # The secret lives in here.
  chown root:turnserver /etc/turnserver.conf 2>/dev/null || true
fi

step "Opening ports"
if command -v ufw >/dev/null 2>&1; then
  run "ufw allow 3478/tcp >/dev/null"
  run "ufw allow 3478/udp >/dev/null"
  [ "$USE_TLS" = "1" ] && { run "ufw allow 5349/tcp >/dev/null"; run "ufw allow 5349/udp >/dev/null"; }
  run "ufw allow $MIN_PORT:$MAX_PORT/udp >/dev/null"
  note "ufw rules added"
else
  note "ufw not installed — skipping (nothing to do if there is no host firewall)"
fi
echo ""
echo "  ⚠ On a cloud VM this is NOT the outer firewall. Open the same ports in the"
echo "    provider's security group: 3478 tcp+udp$([ "$USE_TLS" = "1" ] && echo ", 5349 tcp+udp"), and $MIN_PORT-$MAX_PORT udp."
echo "    A closed UDP relay range is the second most common silent failure."

step "Starting coturn"
run "systemctl enable coturn >/dev/null 2>&1 || true"
run "systemctl restart coturn"
if [ "$DRY_RUN" != "1" ]; then
  sleep 2
  if systemctl is-active --quiet coturn; then
    note "running ✓"
  else
    echo ""
    journalctl -u coturn -n 30 --no-pager || true
    die "coturn did not start — the log above says why (usually the certificate paths)"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────
URLS="turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp"
[ "$USE_TLS" = "1" ] && URLS="$URLS,turns:$DOMAIN:5349"

cat <<SUMMARY

════════════════════════════════════════════════════════════════════
 Relay ready${LABEL:+ ($LABEL)}: $DOMAIN
════════════════════════════════════════════════════════════════════

Put these in the ChatKonect server environment (server/.env, and your host's
env for production):

TURN_URL=$URLS
TURN_SECRET=$SECRET

Adding this to relays you already have? Do NOT replace the values — append,
using | to separate relays and matching the secrets positionally:

TURN_URL=<existing> | $URLS
TURN_SECRET=<existing secret> | $SECRET

Put the relay nearest most of your users FIRST: the browser tries them in order.

Then, from your laptop — not from this box, which proves nothing:

  node deploy/turn/check-relay.mjs --url "turn:$DOMAIN:3478?transport=udp" \\
       --secret $SECRET

A relayed address in the output means this relay can carry a call between two
networks that cannot reach each other directly. Anything else, and the tool says
which of the firewall / external-ip / credentials is at fault.

Restart the API so it picks up the new env, and REBUILD THE FRONTEND — the
browser fetches credentials from /api/v1/ice at call time, and a bundle built
before that code existed never asks.

  systemctl status coturn        # is it running
  journalctl -u coturn -f        # watch allocations as you place a test call

SUMMARY
