import User from '../models/User.js';
import Chat from '../models/Chat.js';

let timer;

export async function expireWorkspaceGuests(now = new Date()) {
  const guests = await User.find({ workspaceRole: 'guest', accountStatus: 'active', guestExpiresAt: { $lte: now, $ne: null } }).select('_id workspace guestAllowedChats').limit(100).lean();
  for (const guest of guests) {
    const claimed = await User.updateOne(
      { _id: guest._id, workspaceRole: 'guest', accountStatus: 'active', guestExpiresAt: { $lte: now, $ne: null } },
      { $set: { accountStatus: 'suspended' }, $inc: { tokenVersion: 1 } }
    );
    if (!claimed.modifiedCount) continue;
    await Chat.updateMany({ _id: { $in: guest.guestAllowedChats }, workspace: guest.workspace }, { $pull: { participants: { user: guest._id } } });
  }
}

export function startWorkspaceGuestExpiry() {
  if (timer) return;
  timer = setInterval(() => expireWorkspaceGuests().catch(() => {}), 60_000);
  timer.unref?.();
  expireWorkspaceGuests().catch(() => {});
}
