# Your own TURN network

Chat works between any two people anywhere — the server relays it. **Calls do not.**
Audio calls, video calls and meetings are peer-to-peer, and when both people are behind
symmetric NAT or CGNAT — mobile data, most office wifi, a lot of hotel networks — there is
no direct path. Those calls ring, both sides accept, and then there is no media and it
drops. It looks like a bug in the app. It is a missing relay.

A TURN relay is the fix, and it is the only fix. This directory sets one up.

---

## Which route to take

|  | Your own coturn | Cloudflare TURN |
|---|---|---|
| Cost | A VPS. €4–6/mo covers a small user base; you pay for transfer | Per GB, no floor |
| Setup | One command, this directory | Two env vars |
| Control | Total — logs, quotas, which regions | None |
| Per-user attribution | Yes, the credential carries a user scope | No, one credential is shared |
| Failure mode | Your box, your problem | Cloudflare's anycast network |

**Do both.** They are additive, not exclusive: with `TURN_URL` *and* the Cloudflare vars
set, your own relays are offered first and Cloudflare is the fallback for when a box is
down or a network cannot reach it. That is the cheapest redundancy available, and it is
why the config does not make you choose.

---

## Everything at once, on an existing API box

If the API already runs on a box with a public IP, this does the whole job — pulls the
code, installs coturn, writes `TURN_URL`/`TURN_SECRET` into `server/.env`, restarts the
API, and verifies each part:

```bash
sudo ./deploy/turn/bootstrap-production.sh
```

One script rather than a checklist because the failure mode here is doing four steps out
of five: the API without a relay is STUN-only, the relay without an API restart is never
asked for, and both fail identically from the outside. `--dry-run` shows everything first.

It re-uses the `TURN_SECRET` already in `.env` if there is one, so re-running does not
invalidate credentials in flight, and it backs the file up before touching it.

Two things it cannot do, and it says so at the end: open your **cloud security group**
(the outer firewall — a relay that works from the box and nowhere else is always this),
and rebuild the frontend.

Add `--domain turn.yourdomain.com --email you@…` to get `turns:` on 5349 as well. Without
it the box’s public IP is used — no DNS record needed, but no TLS either, so the
strictest networks are not covered.

---

## Route 1 — your own relay, in one command

You need a VPS with a **public IP** and a subdomain pointing at it
(`turn.yourdomain.com`). Cheapest tier anywhere is enough: TURN forwards packets, it does
not transcode. You are buying transfer, not CPU.

```bash
scp deploy/turn/install-coturn.sh root@your-vps:/root/
ssh root@your-vps
chmod +x install-coturn.sh
./install-coturn.sh --domain turn.yourdomain.com --email you@yourdomain.com
```

It installs coturn, writes a config with the three things that are otherwise either
security holes or silent failures (`external-ip`, `use-auth-secret`, the private-range
denies), gets a TLS certificate with a renewal hook that survives coturn's privilege drop,
opens the ports, and prints the exact env values to paste.

Add `--dry-run` to see everything it would do without changing anything.

Then in the server environment:

```
TURN_URL=turn:turn.yourdomain.com:3478?transport=udp,turn:turn.yourdomain.com:3478?transport=tcp,turns:turn.yourdomain.com:5349
TURN_SECRET=<printed by the script>
```

All three URLs earn their place: UDP is the normal case, TCP gets through networks that
block UDP outright, and `turns:` on 5349 looks like ordinary TLS to a firewall doing deep
packet inspection.

### More than one — that is the network

Run the script again on a second box in another region. Then join them with `|`, nearest
to most of your users first, because the browser tries them **in order**:

```
TURN_URL=turn:in.yourdomain.com:3478?transport=udp,turns:in.yourdomain.com:5349 | turn:eu.yourdomain.com:3478?transport=udp
TURN_SECRET=secret-from-box-1 | secret-from-box-2
```

Groups and secrets are matched positionally. A group with no matching secret is **dropped
and warned about at boot** rather than signed with the wrong one — a credential the relay
rejects only burns ICE time and then fails, which reads exactly like an outage.

No clustering, no load balancer, no shared state. Each box is independent.

---

## Route 2 — Cloudflare

Cloudflare dashboard → **Calls** → **TURN keys** → create one. You get a key ID and an API
token.

```
CLOUDFLARE_TURN_KEY_ID=<key id>
CLOUDFLARE_TURN_API_TOKEN=<api token>
```

That is all. The server exchanges them for time-limited credentials on first use and
caches them until 80% of their life is gone, so a busy deployment makes a handful of API
calls a day rather than one per call. The token never reaches a browser.

If the token is wrong you will not find out at boot — Cloudflare is only contacted on the
first call. Watch for `⚠️  Cloudflare TURN unavailable` in the log, and note that the
endpoint deliberately still answers with whatever else is configured rather than failing
the call.

---

## Prove it works — before trusting it with a call

This is the step people skip, and it is the one that matters: a config that *looks* right
but yields no relay candidate is the normal failure mode, and it is invisible until a real
call between two real networks fails.

```bash
# Every relay and every transport in server/.env:
node deploy/turn/check-relay.mjs --env

# One specific relay:
node deploy/turn/check-relay.mjs --url "turn:turn.yourdomain.com:3478?transport=udp" --secret <TURN_SECRET>

# Exactly what the browser was handed, credentials and all:
curl -s https://api.yourdomain.com/api/v1/ice -H "Authorization: Bearer <token>" \
  | node deploy/turn/check-relay.mjs --ice -
```

It performs a real RFC 5766 **Allocate** — the same request a browser makes — and reports
the relayed address the relay hands back:

```
  UDP  turn.yourdomain.com:3478 … ✓ relayed via 203.0.113.7:49200  (43ms, lifetime 600s)
       your address as the relay sees it: 198.51.100.42:51234
```

**That relayed address is the proof.** Nothing else is. An open port only proves something
is listening, and running `turnutils_uclient` on the relay itself tests it from the one
network you already know works.

When it fails it says which of the three causes it is, because they are indistinguishable
from the outside:

| Output | Cause |
|---|---|
| `no response at all` | Port filtered. Cloud security group first, then ufw, then whether coturn is running |
| `401 Unauthorized` | The secret here does not match `static-auth-secret` on the relay |
| `no relayed address came back` | Missing or wrong `external-ip` — the classic cloud-VM mistake |
| `unparseable reply` | Something other than coturn is on that port |

Run it **from your laptop**, and ideally once more from a phone on mobile data. Exit code
is 0 only if every endpoint allocated, so it also works as a deploy gate.

`node deploy/turn/check-relay.test.mjs` (25 checks) verifies the prober itself against a
TURN responder that independently validates the MESSAGE-INTEGRITY it sends — because a
prober that is silently malformed reports "✗" for every relay, and you would go and
reconfigure a firewall that was fine.

---

## Then, two things people forget

1. **Restart the API.** `TURN_URL` is read at boot. It logs what it loaded:
   `🔀 TURN relay configured — 2 relays via self-hosted + cloudflare, tried in the order listed.`
2. **Rebuild and redeploy the frontend.** The browser fetches credentials from
   `GET /api/v1/ice` at call time. A bundle built before that code existed never asks, so
   the relay sits there unused and the calls keep failing exactly as before.

Then make a real call between two devices on **different** networks, ideally one on mobile
data. That is the case STUN cannot solve, so it is the only one that proves anything.
While it connects:

```bash
journalctl -u coturn -f     # one allocation per relayed stream
```

A `401` in that log during setup is normal — TURN always challenges once before the
credential is presented.

---

## What this covers, and what it does not

Audio calls, video calls, group calls and meetings all take their ICE configuration from
the same place (`client/src/lib/iceServers.js` → `GET /api/v1/ice`), so one relay
configuration fixes all four. Nothing per-surface to set up.

Sizing: relayed media crosses the box twice, so a 1:1 720p video call is roughly 5 Mbps
through it, about 2 GB/hour. But only 15–20% of calls typically need the relay at all —
the rest connect directly and cost nothing. Do not size for 100%.

What a relay network does **not** give you:

- **Not load balancing.** The browser chooses; traffic follows list *order*, not capacity.
  For real distribution behind one hostname, use DNS across boxes that share a secret.
- **Not mid-call failover.** ICE only chooses at setup, so a relay dying *during* a call
  drops that call.
- **Not a fix for a mesh ceiling.** Above ~6 people in a meeting the problem is fan-out,
  not NAT — see [SCALING_CALLS.md](../../docs/SCALING_CALLS.md).

Full reference: **[docs/SELF_HOSTED_TURN.md](../../docs/SELF_HOSTED_TURN.md)** — config
line by line, sizing, cost, and the Docker route.
