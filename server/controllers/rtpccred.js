
import { resolveIceServers, iceStatus } from '../utils/iceServers.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getTurnCredentials = asyncHandler(async (req, res) => {
  const bundle = await resolveIceServers(String(req.user._id), 3600);
  // Preserve the original single-relay fields for older clients.
  const firstRelay = bundle.iceServers.find((server) =>
    [server.urls].flat().some((url) => /^turns?:/.test(url)));
  res.set('Cache-Control', 'no-store');
  res.json({ ...firstRelay, ...bundle, ...iceStatus() });
});
