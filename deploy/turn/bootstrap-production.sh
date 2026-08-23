#!/usr/bin/env bash
#
# One paste, on the API box: deploy the relay code, stand up coturn, wire the two
# together, and prove it works. For a single-box deployment (API and relay on the
# same machine), which is the normal starting point.
#
#   curl -fsSL <raw url>/bootstrap-production.sh | sudo bash
#   # or, from a checkout on the box:
#   sudo ./deploy/turn/bootstrap-production.sh
#
# Why one script rather than a list of steps: the failure mode of this particular
# setup is doing four things out of five. The API without a relay is STUN-only,
# the relay without the API restart is unused, and either way calls fail
# identically — so the useful unit is all of it, verified, or a clear statement of
# what is missing.
#
# Options:
#   --repo <path>       repo location (default: auto-detect, then this script's own)
#   --service <name>    systemd unit or pm2 process to restart (default: auto-detect)
#   --domain <host>     relay hostname; enables turns: on 5349 via Let's Encrypt.
#                       Omit and the box's public IP is used — no DNS, no TLS.
#   --email <addr>      for Let's Encrypt, with --domain
#   --skip-relay        deploy the code only
#   --skip-deploy       install the relay only
#   --dry-run           show what would happen
#
set -euo pipefail

REPO=""
SERVICE=""
DOMAIN=""
EMAIL=""
SKIP_RELAY=0
SKIP_DEPLOY=0
DRY_RUN=0

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { echo ""; echo "✗ $*" >&2; exit 1; }
note() { echo "  $*"; }
step() { echo ""; echo "▸ $*"; }
run() { if [ "$DRY_RUN" = "1" ]; then echo "    [dry-run] $*"; else eval "$@"; fi; }

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --service) SERVICE="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --skip-relay) SKIP_RELAY=1; shift ;;
    --skip-deploy) SKIP_DEPLOY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ "$(id -u)" = "0" ] || [ "$DRY_RUN" = "1" ] || die "run with sudo — coturn install and service restart need root"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo " ChatKonect — relay bootstrap"
echo "════════════════════════════════════════════════════════════════"

# ── Find the repo ──────────────────────────────────────────────────────
step "Locating the repo"
if [ -z "$REPO" ]; then
  # The script usually lives inside the repo it is deploying.
  if [ -f "$SELF_DIR/../../server/server.js" ]; then
    REPO="$(cd "$SELF_DIR/../.." && pwd)"
  else
    for c in /var/www/chatkonect /var/www/chat_app /opt/chatkonect /opt/chat_app \
             /root/chatkonect /root/chat_app /home/ubuntu/chatkonect /home/ubuntu/chat_app \
             /srv/chatkonect /srv/chat_app; do
      [ -f "$c/server/server.js" ] && { REPO="$c"; break; }
    done
  fi
fi
[ -n "$REPO" ] && [ -f "$REPO/server/server.js" ] || die "could not find the repo — pass --repo /path/to/chat_app"
note "$REPO"

ENV_FILE="$REPO/server/.env"
[ -f "$ENV_FILE" ] || die "no $ENV_FILE — this does not look like the live deployment (refusing to guess)"

# ── Which process runs the API ─────────────────────────────────────────
step "Finding how the API is run"
RESTART_CMD=""
if [ -n "$SERVICE" ]; then
  if command -v pm2 >/dev/null 2>&1 && pm2 describe "$SERVICE" >/dev/null 2>&1; then
    RESTART_CMD="pm2 restart $SERVICE"
  else
    RESTART_CMD="systemctl restart $SERVICE"
  fi
  note "as told: $RESTART_CMD"
else
  if command -v pm2 >/dev/null 2>&1 && [ -n "$(pm2 jlist 2>/dev/null | tr -d '[:space:]' | sed 's/\[\]//')" ]; then
    RESTART_CMD="pm2 restart all --update-env"
    note "pm2 is managing it"
    pm2 list 2>/dev/null | head -12 || true
  else
    UNIT="$(systemctl list-units --type=service --no-legend --no-pager 2>/dev/null \
            | awk '{print $1}' | grep -iE 'chatkonect|chat-app|chat_app' | head -1 || true)"
    if [ -n "$UNIT" ]; then
      RESTART_CMD="systemctl restart $UNIT"
      note "systemd unit: $UNIT"
    fi
  fi
fi
if [ -z "$RESTART_CMD" ]; then
  echo "  ⚠ Could not tell how the API is started."
  echo "    Everything else will run; you will have to restart it yourself at the end."
  echo "    Re-run with --service <pm2 name|systemd unit> to have it done here."
fi

# ── Deploy ─────────────────────────────────────────────────────────────
if [ "$SKIP_DEPLOY" = "0" ]; then
  step "Pulling the latest code"
  # The relay endpoint (GET /api/v1/ice) does not exist in an older checkout, so
  # without this the relay below would be configured and never asked for.
  if [ -d "$REPO/.git" ]; then
    BEFORE="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    run "git -C '$REPO' pull --ff-only"
    AFTER="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    note "$BEFORE → $AFTER"
    if [ "$BEFORE" = "$AFTER" ] && [ "$DRY_RUN" != "1" ]; then
      note "already up to date"
    fi
  else
    echo "  ⚠ $REPO is not a git checkout — skipping pull. Copy the new files yourself."
  fi

  step "Installing server dependencies"
  run "cd '$REPO/server' && npm ci --omit=dev --no-audit --no-fund"
fi

# ── Relay ──────────────────────────────────────────────────────────────
TURN_URLS=""
TURN_SECRET_VAL=""
if [ "$SKIP_RELAY" = "0" ]; then
  step "Installing the relay"
  INSTALLER="$REPO/deploy/turn/install-coturn.sh"
  [ -f "$INSTALLER" ] || die "missing $INSTALLER — the pull must have failed"
  chmod +x "$INSTALLER" 2>/dev/null || true

  # Reuse the secret already in .env if there is one, so re-running this does not
  # invalidate credentials that are currently in use.
  EXISTING_SECRET="$(grep -E '^TURN_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
  # Only reuse a single secret; a "|"-separated set belongs to a multi-relay
  # setup this single-box script must not try to rewrite.
  case "$EXISTING_SECRET" in *"|"*) EXISTING_SECRET="" ;; esac

  TARGET="$DOMAIN"
  if [ -z "$TARGET" ]; then
    TARGET="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
    [ -n "$TARGET" ] || die "no --domain given and could not detect this box's public IP"
    note "no --domain given, using this box's IP: $TARGET (turn: only, no TLS)"
  fi

  ARGS="--domain $TARGET"
  [ -n "$EMAIL" ] && ARGS="$ARGS --email $EMAIL"
  [ -n "$EXISTING_SECRET" ] && { ARGS="$ARGS --secret $EXISTING_SECRET"; note "reusing the TURN_SECRET already in .env"; }
  [ "$DRY_RUN" = "1" ] && ARGS="$ARGS --dry-run"

  INSTALL_OUT="$(mktemp)"
  # shellcheck disable=SC2086
  bash "$INSTALLER" $ARGS 2>&1 | tee "$INSTALL_OUT"

  TURN_URLS="$(grep -E '^TURN_URL=' "$INSTALL_OUT" | head -1 | cut -d= -f2-)"
  TURN_SECRET_VAL="$(grep -E '^TURN_SECRET=' "$INSTALL_OUT" | head -1 | cut -d= -f2-)"
  rm -f "$INSTALL_OUT"
  [ -n "$TURN_URLS" ] && [ -n "$TURN_SECRET_VAL" ] || die "the installer did not report a TURN_URL/TURN_SECRET — read its output above"

  step "Writing the relay into server/.env"
  if [ "$DRY_RUN" = "1" ]; then
    echo "    [dry-run] set TURN_URL and TURN_SECRET in $ENV_FILE"
  else
    cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
    # Node rather than sed: this file holds live credentials and a bad in-place
    # edit costs more than the dependency. Values are passed via argv, never
    # interpolated into the script.
    node -e '
      const fs = require("fs");
      const [file, urls, secret] = process.argv.slice(1);
      let text = fs.readFileSync(file, "utf8");
      const upsert = (key, value) => {
        const line = key + "=" + value;
        const re = new RegExp("^" + key + "=.*$", "m");
        if (re.test(text)) { text = text.replace(re, line); return "updated"; }
        text = text.replace(/\s*$/, "\n") + line + "\n";
        return "added";
      };
      const a = upsert("TURN_URL", urls);
      const b = upsert("TURN_SECRET", secret);
      fs.writeFileSync(file, text);
      console.log("  TURN_URL " + a + ", TURN_SECRET " + b);
    ' "$ENV_FILE" "$TURN_URLS" "$TURN_SECRET_VAL"
    note "backup kept alongside it"
  fi
fi

# ── Restart ────────────────────────────────────────────────────────────
if [ -n "$RESTART_CMD" ]; then
  step "Restarting the API"
  run "$RESTART_CMD"
  [ "$DRY_RUN" = "1" ] || sleep 4
fi

# ── Verify ─────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "Dry run complete — nothing was changed."
  exit 0
fi

step "Checking the API came back"
PORT="$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
[ -n "$PORT" ] || PORT=5000
HEALTH="http://127.0.0.1:$PORT/api/health"
OK=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "$HEALTH" >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
if [ "$OK" = "1" ]; then
  note "healthy on port $PORT"
else
  echo "  ⚠ No answer on $HEALTH. If the API listens elsewhere this is fine; otherwise check its log."
fi

step "Checking the relay endpoint exists"
# 401 is the PASS here: the route is there and refusing an anonymous caller,
# which is correct — relay bandwidth is billable. 404 means the code is old.
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:$PORT/api/v1/ice" || echo 000)"
case "$CODE" in
  401|403) note "GET /api/v1/ice → $CODE ✓ (route present, auth required — correct)" ;;
  404) echo "  ✗ GET /api/v1/ice → 404. The running process is still the OLD code."
       echo "    The pull or the restart did not take effect. Restart it manually and re-check." ;;
  000) echo "  ⚠ could not reach the API locally to check" ;;
  *)   note "GET /api/v1/ice → $CODE" ;;
esac

if [ "$SKIP_RELAY" = "0" ] && [ -n "$TURN_SECRET_VAL" ]; then
  step "Asking the relay to actually relay"
  FIRST_URL="$(echo "$TURN_URLS" | cut -d, -f1)"
  if node "$REPO/deploy/turn/check-relay.mjs" --url "$FIRST_URL" --secret "$TURN_SECRET_VAL" --timeout 5000; then
    note "the relay works from this box"
  else
    echo "  ⚠ It did not allocate even from the box itself — read the reason above."
    echo "    From here it cannot be the cloud firewall; look at coturn: journalctl -u coturn -n 40"
  fi
fi

# ── What is left ───────────────────────────────────────────────────────
MINPORT_LINE="$(grep -E '^min-port=' /etc/turnserver.conf 2>/dev/null | cut -d= -f2 || echo 49160)"
MAXPORT_LINE="$(grep -E '^max-port=' /etc/turnserver.conf 2>/dev/null | cut -d= -f2 || echo 49300)"

cat <<REMAINS

════════════════════════════════════════════════════════════════
 Two things this script cannot do for you
════════════════════════════════════════════════════════════════

1. OPEN THE PORTS IN YOUR CLOUD FIREWALL.
   ufw was handled here, but on AWS/GCP/Azure the security group is the outer
   firewall and it is closed by default. A relay that works from the box and
   nowhere else is this, every time. Add inbound:

       3478   TCP and UDP     from 0.0.0.0/0
       5349   TCP and UDP     from 0.0.0.0/0     (only if you used --domain)
       $MINPORT_LINE-$MAXPORT_LINE  UDP           from 0.0.0.0/0

   The UDP range is the one people forget. Without it TURN answers the
   handshake and then has no port to relay on.

2. REBUILD AND REDEPLOY THE FRONTEND.
   The browser fetches credentials from /api/v1/ice at call time. A bundle
   built before that code existed never asks, so the relay sits unused and the
   calls fail exactly as before.

Then, FROM YOUR LAPTOP — not from this box, which proves nothing about the
firewall:

    node deploy/turn/check-relay.mjs --env

A "relayed via …" line means two people on different networks can now call
each other. Then place a real call with one phone on mobile data.

    journalctl -u coturn -f      # one allocation per relayed stream

REMAINS
