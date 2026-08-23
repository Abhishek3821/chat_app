# Running your own TURN server (coturn)

You do not need metered.ca, Cloudflare, or any managed provider. ChatKonect's relay
support was written against **coturn**, the standard open-source TURN server —
`TURN_SECRET` *is* coturn's `static-auth-secret`, and the credentials the app mints are
byte-for-byte what coturn's `use-auth-secret` mode validates.

**No code changes. Two environment variables.** And you do not have to do the steps below
by hand:

```bash
# on the relay box
sudo ./install-coturn.sh --domain turn.yourdomain.com --email you@yourdomain.com

# from your laptop, once it is configured — a real TURN Allocate, not a port check
node deploy/turn/check-relay.mjs --env
```

Both live in **[deploy/turn/](../deploy/turn/)** with a runbook. The sections below are
what the installer does and why, for when you want to understand or adjust it — and §7
is worth reading either way, because a relay that looks configured and never allocates is
the normal failure.

- Why a relay is needed at all: [SCALING_CALLS.md §6](SCALING_CALLS.md)
- App-side config reference: [ENVIRONMENT.md](ENVIRONMENT.md)

---

## 1. What the app expects

```
username    = "<unix-expiry>:<scope>"
credential  = base64( HMAC-SHA1( static-auth-secret, username ) )
```

That is coturn's REST / `use-auth-secret` scheme exactly. `server/utils/turnCredentials.js`
mints it, `tests/turn-relay.mjs` recomputes the HMAC independently to prove it, and the
secret never leaves your server — the browser only ever receives an expiring
username/credential pair.

So the only question is running coturn correctly.

---

## 2. What you need

| Requirement | Why |
|---|---|
| A VPS with a **public IP** | A relay behind NAT cannot relay. Cloud VMs with 1:1 NAT (AWS/GCP/Azure) work but need `external-ip` — see §4 |
| A subdomain, e.g. `turn.yourdomain.com` | Needed for the TLS certificate `turns:` uses |
| Open ports | 3478 TCP+UDP, 5349 TCP+UDP, plus a UDP relay range |
| Bandwidth | The real cost. See §8 |

CPU and RAM barely matter — TURN forwards packets, it does not transcode. The cheapest
tier anywhere has enough compute; you are buying **transfer**.

---

## 3. Install

Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y coturn
# coturn ships disabled on purpose
sudo sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

A TLS certificate for `turns:` (strongly recommended — see §6):

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d turn.yourdomain.com
```

---

## 4. Configure

Generate the secret — this exact value also goes in ChatKonect's `TURN_SECRET`:

```bash
openssl rand -hex 32
```

`/etc/turnserver.conf`:

```conf
listening-port=3478
tls-listening-port=5349

# Bind everywhere, but tell coturn its PUBLIC address.
# `external-ip` is REQUIRED on any cloud VM whose public IP is not on the NIC
# (AWS / GCP / Azure / most cloud VPS). Without it coturn advertises the private
# address, every relay candidate is unusable, and it looks like a firewall
# problem. This is the single most common self-hosting mistake.
listening-ip=0.0.0.0
external-ip=YOUR.PUBLIC.IP.HERE

realm=turn.yourdomain.com
server-name=turn.yourdomain.com

# Credential mode. Do NOT also enable lt-cred-mech — the two conflict.
use-auth-secret
static-auth-secret=PASTE_THE_OPENSSL_OUTPUT_HERE

# TLS, for turns:. coturn drops privileges to the `turnserver` user and cannot
# read /etc/letsencrypt/live — copy the files instead, see §5.
cert=/etc/coturn/certs/fullchain.pem
pkey=/etc/coturn/certs/privkey.pem

# Relay port range — one port per concurrent relayed stream.
min-port=49160
max-port=49300

fingerprint
no-multicast-peers
no-cli
stale-nonce=600

# ── Security: do not skip this block ──────────────────────────────
# An open TURN server is a proxy into whatever it can reach — your own VPC,
# cloud metadata endpoints, localhost. Denying the private ranges is what stops
# your relay being turned against your own infrastructure.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff

# WebRTC does not need TCP relaying, and it widens the proxy surface.
no-tcp-relay

# Caps, so one user cannot take the whole box.
user-quota=12
total-quota=1200
```

---

## 5. Let coturn read the certificate, then open the ports

certbot writes root-only files, and coturn drops privileges — so TLS silently fails to
start. Copy them on every renewal:

```bash
sudo mkdir -p /etc/coturn/certs
sudo nano /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
```

Put this in that file (replace the domain):

```bash
#!/bin/bash
D=/etc/letsencrypt/live/turn.yourdomain.com
cp "$D/fullchain.pem" "$D/privkey.pem" /etc/coturn/certs/
chown turnserver:turnserver /etc/coturn/certs/*.pem
chmod 600 /etc/coturn/certs/*.pem
systemctl restart coturn
```

Then:

```bash
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn.sh
sudo /etc/letsencrypt/renewal-hooks/deploy/coturn.sh

sudo ufw allow 3478/tcp && sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp && sudo ufw allow 5349/udp
sudo ufw allow 49160:49300/udp

sudo systemctl enable --now coturn
sudo systemctl status coturn --no-pager
```

On a cloud VM, open the same ports in the provider's **security group** as well — ufw is
not the outer firewall there.

---

## 6. Point ChatKonect at it

In `server/.env` and your host's environment:

```
TURN_URL=turn:turn.yourdomain.com:3478?transport=udp,turn:turn.yourdomain.com:3478?transport=tcp,turns:turn.yourdomain.com:5349
TURN_SECRET=<the same static-auth-secret>
```

All three entries earn their place:

| Entry | Gets through |
|---|---|
| `turn:…?transport=udp` | The normal case, lowest latency — tried first |
| `turn:…?transport=tcp` | Networks that block UDP outright |
| `turns:…:5349` | Deep-packet-inspecting firewalls; looks like ordinary TLS |

Restart the API. It reports the state at boot:

```
🔀 TURN relay configured — 1 relay via self-hosted, tried in the order listed. Calls can traverse strict/symmetric NATs.
```

**Then rebuild and redeploy the frontend.** The browser fetches credentials from
`GET /api/v1/ice` at call time, so a bundle built before that code existed never asks.

---

## 7. Verify it actually relays

Config that *looks* right but yields no relay candidate is the normal failure mode, so
test for the candidate itself.

The fastest answer, which needs no browser and works from anywhere:

```bash
node deploy/turn/check-relay.mjs --env          # every relay, every transport
```

A relayed address in the output is the proof. It also names which of firewall /
`external-ip` / credentials is at fault when there is not one, because from the outside
those three are indistinguishable. The manual route, if you prefer it:

**1. Get real credentials.** Sign in, then:

```bash
curl -s https://api.yourdomain.com/api/v1/ice \
     -H "Authorization: Bearer <your access token>" | jq
```

You want an entry whose `urls` start with `turn:`/`turns:`, carrying a `username` and
`credential`.

**2. Paste them into Trickle ICE** —
<https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>
Remove the default server, add yours with that username/credential, gather candidates.

**A row of type `relay` is the proof.** `host` and `srflx` rows only prove STUN works. No
`relay` row means the relay is unreachable — check, in this order: `external-ip`, the UDP
relay range, the cloud security group.

**3. Watch the server while you test:**

```bash
sudo journalctl -u coturn -f
```

One allocation appears per relayed stream. A `401` during the handshake is normal — TURN
always challenges once before the credential is presented.

**4. Then make a real call** between two devices on **different** networks, ideally one on
mobile data. That is the case STUN cannot solve, so it is the only one that proves it.

---

## 8. Sizing and cost

Relayed media crosses your server twice — in and out — so budget both directions:

| Call type | Per participant, relayed |
|---|---|
| Audio only | ~50–100 kbps each way |
| Video 360p | ~350 kbps each way |
| Video 720p | ~1.2 Mbps each way |

A 1:1 720p video call relayed on both legs is roughly **5 Mbps** through the box, about
**2 GB/hour**. Two things follow:

- **Only some calls need the relay** — typically 15–20%. The rest connect directly and
  cost nothing. Do not size for 100%.
- **Transfer is the bill.** A €4–6/month VPS with 1–2 TB included transfer covers a small
  user base comfortably, and the CPU will sit near idle.

Put the relay **near your users**. It adds a round trip, so a small box in the right
region beats a big one in the wrong one.

---

## 9. Running a network of relays

One relay is one point of failure in one location, and a relay adds a round trip — so
somebody on the other side of the world pays for that distance on every packet. Several
relays fix both, and you need no clustering software: the browser is handed the list,
tries them **in the order you provide**, and uses whichever answers.

Put the relay nearest most of your users first.

### Same secret on every box — simplest

```
TURN_URL=turn:a.example.com:3478?transport=udp,turn:b.example.com:3478?transport=udp
TURN_SECRET=one-shared-secret
```

Both relays run the same `static-auth-secret`, so one credential is valid at either. This
becomes a single ICE entry listing both URLs.

### Independent secrets — recommended once you have more than one

Separate relays with `|`, and give each its own secret. Commas still separate the URLs
*within* one relay:

```
TURN_URL=turn:in.example.com:3478?transport=udp,turns:in.example.com:5349 | turn:eu.example.com:3478?transport=udp
TURN_SECRET=secret-for-india | secret-for-europe
```

That produces one ICE entry **per relay**, each signed with its own secret. Worth the
extra config for two reasons:

- a shared secret means one compromised box hands an attacker free bandwidth on **every**
  relay you own;
- rotating a shared secret takes all of them down at once, while per-relay secrets rotate
  independently.

Groups and secrets are matched **positionally**. A group with no matching secret is
**dropped**, and the server warns at boot — deliberately, because signing it with the
wrong secret produces a credential the relay rejects, and the browser then wastes ICE time
on it before failing. That reads exactly like an outage.

Boot output tells you what actually loaded:

```
🔀 TURN relay configured — 2 relays via self-hosted, tried in the order listed. …
⚠️  TURN config: TURN_URL has 3 relay group(s) but TURN_SECRET has 2 secret(s). …
```

The cap is 6 relays; beyond that ICE gathering slows measurably for no benefit.

### What this buys you, and what it does not

| | |
|---|---|
| ✅ Redundancy | One relay down, calls still connect through the next |
| ✅ Lower latency | A relay near the user beats a bigger one far away |
| ✅ Independent scaling | Add a region without touching the others |
| ❌ Not load balancing | The browser chooses; this is not a weighted pool. Traffic follows *order*, not capacity |
| ❌ Not mid-call failover | A relay dying **during** a call drops that call. ICE only chooses at setup |

If you want one hostname with real load balancing, use DNS instead — round-robin or
latency-based routing across several boxes that share a secret. Then it is a single
`TURN_URL` entry and your DNS provider distributes the traffic. That trades per-relay
secret isolation for simpler client config.

---

## 10. Cloudflare TURN instead, or as well

`deploy/turn/install-coturn.sh` is an evening's work at most, but you may not want to run
a box at all — and either way a second provider is cheap redundancy. Cloudflare's TURN
service needs no relay of your own:

```
CLOUDFLARE_TURN_KEY_ID=<from the dashboard: Calls → TURN keys>
CLOUDFLARE_TURN_API_TOKEN=<the API token issued with it>
```

That is the whole configuration. The server exchanges them for time-limited credentials
on first use — Cloudflare does not use coturn's HMAC scheme, so this is an authenticated
API call rather than a local computation — and caches the result until 80% of its life has
passed. A busy deployment makes a handful of API calls a day, not one per call. The token
is account-level and never reaches a browser.

**These are additive to `TURN_URL`, not a replacement.** With both configured:

```
🔀 TURN relay configured — 2 relays via self-hosted + cloudflare, tried in the order listed.
```

Your own relay is offered first and Cloudflare is the fallback for when that box is down
or a network cannot reach it. The browser walks the list in order, so the managed provider
only gets traffic — and only gets billed — when yours cannot carry the call.

Two things to know before choosing it as the only provider:

- **No per-user attribution.** Cloudflare generates one credential shared by every user for
  its lifetime. The coturn path signs a user scope into the username, so `journalctl -u
  coturn` can tell you who spent the bandwidth. Here, it cannot.
- **A bad token fails at the first call, not at boot**, because nothing is contacted until
  then. Watch for `⚠️  Cloudflare TURN unavailable` in the log. The endpoint deliberately
  keeps answering with whatever else is configured rather than failing the call — so a
  broken managed provider degrades to your own relay, or to STUN, instead of taking calls
  down.

Billing is per GB with no floor, against a VPS's flat rate with included transfer. Below a
few hundred GB a month the managed route is usually cheaper; above it, your own box wins
and keeps winning.

---

## 11. Should you self-host?

**Yes, if** you want predictable cost, no third-party dependency and no per-GB pricing.
coturn is mature, boring software and the setup above is an evening's work.

Watch out for:

- **Single point of failure.** One relay, one region. Two small VPSes beat one large one —
  see §9 for how to list them.
- **Bandwidth spikes** are the only way this gets expensive. Set `total-quota` (§4).
- **Never skip the `denied-peer-ip` block.** Open relays get found and abused.
- **`turns:` on 443** traverses the most hostile networks but collides with a web server
  on the same IP. Give the relay its own box or its own address.

---

## 12. Docker, if you prefer

```bash
docker run -d --name coturn --network host --restart unless-stopped \
  -v /etc/turnserver.conf:/etc/coturn/turnserver.conf:ro \
  -v /etc/coturn/certs:/etc/coturn/certs:ro \
  coturn/coturn -c /etc/coturn/turnserver.conf
```

`--network host` is not optional. TURN allocates a fresh port per stream, and Docker's
bridge cannot map a dynamic range — on a bridge you get no usable relay candidates, which
presents exactly like a firewall problem.
