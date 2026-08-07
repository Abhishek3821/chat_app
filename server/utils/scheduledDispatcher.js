import ScheduledMessage from '../models/ScheduledMessage.js';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import { deliverMessage } from '../controllers/messageController.js';
import { emitToUser } from '../socket/index.js';

const TICK_MS = 30_000;
// A row claimed but not finished within this window is assumed orphaned by a
// process that died mid-dispatch, and becomes claimable again.
const CLAIM_STALE_MS = 5 * 60 * 1000;
// Bounded per tick so a large backlog can't monopolise the event loop.
const MAX_PER_TICK = 50;

let timer = null;

/**
 * Claim exactly one due row, atomically.
 *
 * The compare-and-set on `status` is the whole point: this app is built to run
 * multiple instances (there's a REDIS_URL flag and a Socket.IO adapter), and a
 * `find()`-then-`save()` loop would let two processes read the same pending row
 * and deliver the message twice. `findOneAndUpdate` resolves that in the
 * database — whichever process flips 'pending' -> 'sending' first wins, and the
 * loser gets null and moves on.
 */
async function claimNext(now) {
  return ScheduledMessage.findOneAndUpdate(
    {
      sendAt: { $lte: now },
      $or: [
        { status: 'pending' },
        // Reclaim a stale 'sending' row (previous process died before finishing).
        { status: 'sending', claimedAt: { $lte: new Date(now.getTime() - CLAIM_STALE_MS) } },
      ],
    },
    { $set: { status: 'sending', claimedAt: now } },
    { new: true, sort: { sendAt: 1 } }
  );
}

async function dispatchOne(row) {
  // Re-resolve chat + sender at send time, not schedule time: the user may have
  // left the group, been removed, or the chat may be gone.
  const chat = await Chat.findById(row.chat);
  if (!chat) throw new Error('Chat no longer exists.');
  if (!chat.participants.some((p) => String(p.user) === String(row.sender))) {
    throw new Error('You are no longer a participant of this chat.');
  }
  const sender = await User.findById(row.sender).select('name');
  if (!sender) throw new Error('Sender no longer exists.');

  const message = await deliverMessage({
    chat,
    sender,
    type: row.type,
    content: row.content,
    attachments: row.attachments?.length ? row.attachments : undefined,
    location: row.location,
    replyTo: row.replyTo,
    mentions: row.mentions?.length ? row.mentions : undefined,
  });

  row.status = 'sent';
  row.sentMessage = message._id;
  row.error = undefined;
  await row.save();

  // Let the author's own devices drop it from their "scheduled" list.
  emitToUser(String(row.sender), 'scheduled-message', {
    id: String(row._id),
    chatId: String(row.chat),
    status: 'sent',
  });
}

async function tick() {
  const now = new Date();
  for (let i = 0; i < MAX_PER_TICK; i += 1) {
    let row;
    try {
      row = await claimNext(now);
    } catch {
      return; // DB hiccup — try again next tick
    }
    if (!row) return; // nothing due

    try {
      await dispatchOne(row);
    } catch (e) {
      // Terminal failure: park it as 'failed' rather than retrying forever, and
      // tell the author so it doesn't fail silently.
      row.status = 'failed';
      row.error = e?.message?.slice(0, 300) || 'Could not send.';
      await row.save().catch(() => null);
      emitToUser(String(row.sender), 'scheduled-message', {
        id: String(row._id),
        chatId: String(row.chat),
        status: 'failed',
        error: row.error,
      });
    }
  }
}

/** Start the dispatcher loop. Idempotent. */
export function startScheduledDispatcher() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch(() => null);
  }, TICK_MS);
  // Don't hold the process open on shutdown.
  timer.unref?.();
}

export function stopScheduledDispatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}
