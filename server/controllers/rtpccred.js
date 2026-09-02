
import crypto from "crypto";

export const getTurnCredentials = (req, res) => {
  const secret = process.env.TURN_SECRET;
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const userId = req.user?._id?.toString() || "guest";
  const username = `${expiry}:${userId}`;
  const credential = crypto
    .createHmac("sha1", secret)
    .update(username)
    .digest("base64");
  return res.json({
    username,
    credential,
    urls: [
      "turn:turn.aynzenix.com:3478?transport=udp",
      "turn:turn.aynzenix.com:3478?transport=tcp",
    ],
  });
};
