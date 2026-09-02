import api from './api';

const STUN_SERVERS = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
    ],
  },
];

const DEFAULT_TTL_SECONDS = 3600;
const REFRESH_FACTOR_MS = 800;

export const ICE_SERVERS = [...STUN_SERVERS];

let requestInFlight = null;
let expiresAt = 0;

function isTurnServer(server) {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.some((url) => /^turns?:/.test(String(url)));
}

export function hasRelay() {
  return ICE_SERVERS.some(isTurnServer);
}

export function callFailureMessage() {
  if (hasRelay()) {
    return 'Couldn’t connect the call — the network is blocking the media path.';
  }

  if (import.meta.env.DEV) {
    console.warn(
      '[ice] No TURN relay was offered. Configure TURN_SECRET on the API and verify /api/auth/turn-credentials.'
    );
  }

  return 'Couldn’t connect — calls between different networks need a relay server, and none is set up yet.';
}

function extractServers(data) {
  if (!data?.urls || !data?.username || !data?.credential) return [];

  return [
    {
      urls: data.urls,
      username: data.username,
      credential: data.credential,
    },
  ];
}

function replaceServers(servers) {
  const turnServers = servers.filter(isTurnServer);

  ICE_SERVERS.length = 0;
  ICE_SERVERS.push(...STUN_SERVERS, ...turnServers);
}

export function ensureIceServers() {
  if (requestInFlight) return requestInFlight;

  if (hasRelay() && Date.now() < expiresAt) {
    return Promise.resolve(ICE_SERVERS);
  }

  requestInFlight = api
    .get('/auth/turn-credentials')
    .then(({ data }) => {
      replaceServers(extractServers(data));

      const ttlSeconds = Number(data?.ttlSeconds) || DEFAULT_TTL_SECONDS;
      expiresAt = Date.now() + ttlSeconds * REFRESH_FACTOR_MS;

      return ICE_SERVERS;
    })
    .catch((error) => {
      replaceServers([]);
      expiresAt = 0;

      if (import.meta.env.DEV) {
        console.warn('[ice] Could not load TURN credentials:', error?.message);
      }

      return ICE_SERVERS;
    })
    .finally(() => {
      requestInFlight = null;
    });

  return requestInFlight;
}

export function resetIceServers() {
  replaceServers([]);
  expiresAt = 0;
  requestInFlight = null;
}
