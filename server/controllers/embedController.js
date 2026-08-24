import App from '../models/App.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { resolveIceServers, iceStatus } from '../utils/iceServers.js';

/**
 * Bootstrap for the drop-in embed.
 *
 * The whole point is that a host product configures NOTHING beyond its app id:
 * no socket URL, no API base, no TURN relay, no feature list duplicated in two
 * places. Every one of those was previously the integrator's problem, and each
 * was a place to get it subtly wrong and see a silent failure.
 *
 * `/config` is deliberately PUBLIC — it authenticates with the app id alone,
 * which is public by design ("Safe to ship to browsers", App model) — because a
 * browser has to be able to call it before it holds any user token. It therefore
 * returns only non-secret facts, and never relay credentials.
 */

/** This server's own public origin, honouring the proxy in front of it. */
function selfOrigin(req) {
  return process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

/** Where the embeddable UI is served from — the frontend origin, not the API. */
function embedOrigin() {
  return (process.env.EMBED_URL || process.env.CLIENT_URL || '').replace(/\/+$/, '');
}

const normaliseOrigin = (raw) => {
  if (!raw) return null;
  try {
    return new URL(String(raw)).origin;
  } catch {
    return String(raw).trim().replace(/\/+$/, '') || null;
  }
};

// GET /api/v1/embed/config?appId=app_xxx
export const getEmbedConfig = asyncHandler(async (req, res) => {
  const appId = String(req.query.appId || req.headers['x-cc-app-id'] || '');
  if (!appId) throw new ApiError(400, 'appId is required.');

  const tenant = await App.findOne({ appId }).select('appId name features limits allowedOrigins active');
  if (!tenant) throw new ApiError(404, 'Unknown app.');
  if (!tenant.active) throw new ApiError(403, 'This app is disabled.');

  /* Enforce the tenant's own origin pin. An empty list means "any origin", which
     is the documented default and what local development needs; a populated list
     is a promise we now actually keep. Note this is a usability guard, not a
     security boundary — an attacker can forge Origin outside a browser. The real
     boundary is that a user token only ever speaks for one end user, and only the
     partner's backend can mint one. */
  /* WHICH origin to check matters. When the embed calls this from inside the
     iframe, the `Origin` header is OUR OWN frontend origin — the browser has no
     reason to send the framing page's. So the embed declares its parent and we
     check THAT; a direct call from a partner's own frontend has no parentOrigin
     and is checked on its header instead. Getting this wrong meant the pin was
     compared against ourselves and could never fail.
     This is an integration guard, not a security boundary: Origin is forgeable
     outside a browser. The boundary is that a user token speaks for exactly one
     end user and only the partner's backend can mint one. */
  const claimed = normaliseOrigin(req.query.parentOrigin) || normaliseOrigin(req.get('origin'));
  const pinned = (tenant.allowedOrigins || []).map(normaliseOrigin).filter(Boolean);
  if (pinned.length && claimed && !pinned.includes(claimed)) {
    throw new ApiError(
      403,
      `Origin ${claimed} is not registered for this app. Add it to the app's allowed origins.`
    );
  }

  const api = selfOrigin(req);
  const embed = embedOrigin();

  res.json({
    success: true,
    app: { appId: tenant.appId, name: tenant.name, features: tenant.features },
    // Everything the embed needs to talk to us, resolved server-side so it can
    // never drift from how this deployment is actually wired.
    endpoints: {
      apiBaseUrl: `${api}/api`,
      // Socket.IO shares the API origin and uses the default /socket.io path.
      socketUrl: api,
      // The iframe the loader mounts. Empty when this deployment has no frontend
      // origin configured — the loader surfaces that instead of framing nothing.
      embedUrl: embed ? `${embed}/embed` : '',
    },
    // Relay credentials are NOT here on purpose: this endpoint is unauthenticated.
    // Call GET /api/v1/embed/ice with a user token to get them.
    ice: iceStatus(),
    userTokenSeconds: (Math.min(Math.max(Number(tenant.limits?.userTokenMinutes) || 60, 5), 1440)) * 60,
  });
});

// GET /api/v1/embed/ice — requires a user token (`protect` runs first)
export const getIceServers = asyncHandler(async (req, res) => {
  /* Behind auth because relay bandwidth is billable: handing minted TURN
     credentials to anonymous callers turns the relay into an open proxy. Scoped
     to the user so coturn's logs attribute usage, and short-lived so a pair
     copied out of devtools expires on its own. */
  /* ttlSeconds comes back from the resolver, not from this constant: a cached
     Cloudflare credential can be most of the way through its life, and the client
     refreshes at 80% of whatever it is told. Reporting the nominal 4h would let a
     long meeting hold a credential the relay has already stopped accepting. */
  const { iceServers, ttlSeconds } = await resolveIceServers(String(req.user._id), 4 * 3600);
  res.json({
    success: true,
    iceServers,
    ttlSeconds,
    ...iceStatus(),
  });
});
