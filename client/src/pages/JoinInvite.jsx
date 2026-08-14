import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Loader2, Users, UserPlus, AlertTriangle, Check } from 'lucide-react';
import Button from '@/components/ui/Button';
import Avatar from '@/components/ui/Avatar';
import { LogoMark } from '@/components/brand/Logo';
import api from '@/lib/api';
import { useChat } from '@/store/useChat';
import { useContacts } from '@/store/useContacts';
import { useAuth } from '@/store/useAuth';

/**
 * Landing screen for a scanned/opened invite link.
 *
 *   /invite/g/:code      group invite   (Chat.inviteCode)
 *   /invite/u/:code      person invite  (username)
 *
 * Both resolve, join/open the conversation, then drop the user into it. This is
 * also what makes the group QR meaningful: the server has had
 * `POST /groups/join/:inviteCode` all along, but nothing in the UI ever called it.
 */
export default function JoinInvite({ kind }) {
  const { code } = useParams();
  const navigate = useNavigate();
  const addChat = useChat((s) => s.addChat);
  const setActiveChat = useChat((s) => s.setActiveChat);
  const openDirectChat = useChat((s) => s.openDirectChat);
  const sendRequest = useContacts((s) => s.sendRequest);
  const me = useAuth((s) => s.user);
  const [error, setError] = useState(null);
  // Set when the scan ended in a contact request rather than an open chat.
  const [requested, setRequested] = useState(null);
  // Invites are side-effecting (joining a group). StrictMode double-invokes
  // effects in dev, so guard to keep this to exactly one attempt.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        if (kind === 'group') {
          const { data } = await api.post(`/groups/join/${encodeURIComponent(code)}`);
          if (data?.chat) {
            addChat(data.chat);
            setActiveChat(data.chat._id);
          }
          navigate('/', { replace: true });
          return;
        }

        // Person invite: resolve the username (exact-match search is global, so
        // a stranger scanning from another account still finds them).
        const { data } = await api.get('/users/search', { params: { q: code } });
        const list = data?.users || data?.results || [];
        const match = list.find((u) => String(u.username).toLowerCase() === String(code).toLowerCase());
        if (!match) {
          setError(`No account found for “${code}”.`);
          return;
        }
        if (String(match._id) === String(me?._id)) {
          // Scanning your own code — nothing to do, and the server would 400.
          navigate('/contacts', { replace: true });
          return;
        }

        /* Opening a 1:1 chat requires you to ALREADY be mutual contacts, which
           is the opposite of what a personal QR is for: you scan a stranger's
           code precisely because you aren't connected yet. This used to call
           openDirectChat unconditionally, so every scan by someone new died on
           "Send a contact request and get accepted before you can chat" — the
           code only worked for people who could already message each other.
           Try the chat first (already-connected scans go straight in), and fall
           back to sending the contact request the QR was meant to start. */
        try {
          await openDirectChat(match._id);
          navigate('/', { replace: true });
        } catch {
          let connectedNow = false;
          try {
            // `autoAccepted` = they had already requested me, so scanning
            // completed the handshake and we're contacts as of this moment.
            const res = await sendRequest(match._id);
            connectedNow = Boolean(res?.autoAccepted);
          } catch (reqErr) {
            // 409s are both "your side is already done": 'Request already sent.'
            // and 'You are already connected.' Neither is a failure to report —
            // the scanner asked to connect and the ask is on record.
            if (!/already/i.test(reqErr?.message || '')) throw reqErr;
            connectedNow = /already connected/i.test(reqErr.message);
          }
          if (connectedNow) {
            await openDirectChat(match._id).catch(() => {});
            navigate('/', { replace: true });
            return;
          }
          setRequested(match);
        }
      } catch (e) {
        setError(e?.message || 'This invite could not be opened.');
      }
    })();
  }, [kind, code, addChat, setActiveChat, openDirectChat, sendRequest, me?._id, navigate]);

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[rgb(var(--app-bg))] p-4">
      <div className="card w-full max-w-sm p-6 text-center shadow-soft-lg sm:p-8">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-500/10">
          <LogoMark size={30} />
        </span>

        {requested ? (
          <>
            <Avatar src={requested.avatar} name={requested.name} size="xl" className="mx-auto mb-3" />
            <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
              <Check size={18} />
            </span>
            <h1 className="font-display text-lg font-bold text-content">Request sent to {requested.name}</h1>
            <p className="mt-1.5 text-sm text-content-muted">
              You&apos;ll be able to chat as soon as they accept. We&apos;ll let you know.
            </p>
            <Button as={Link} to="/contacts" variant="primary" className="mt-5 w-full justify-center">
              Go to Contacts
            </Button>
          </>
        ) : error ? (
          <>
            <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-red-500/10 text-red-500">
              <AlertTriangle size={18} />
            </span>
            <h1 className="font-display text-lg font-bold text-content">Invite didn&apos;t work</h1>
            <p className="mt-1.5 break-words text-sm text-content-muted">{error}</p>
            <Button as={Link} to="/" variant="primary" className="mt-5 w-full justify-center">
              Go to ChatKonect
            </Button>
          </>
        ) : (
          <>
            <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full neu-inset bg-brand-500/10 text-brand-600 dark:text-brand-300">
              {kind === 'group' ? <Users size={18} /> : <UserPlus size={18} />}
            </span>
            <h1 className="font-display text-lg font-bold text-content">
              {kind === 'group' ? 'Joining the group…' : 'Opening the chat…'}
            </h1>
            <p className="mt-1.5 text-sm text-content-muted">One moment while we set this up.</p>
            <Loader2 size={20} className="mx-auto mt-5 animate-spin text-brand-500" />
          </>
        )}
      </div>
    </div>
  );
}
