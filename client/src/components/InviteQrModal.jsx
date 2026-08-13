import { useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Check, Share2 } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import QrCode from './QrCode';

/**
 * Shows an invite link as a scannable QR plus copy/share fallbacks.
 * Generic on purpose — used for both "my profile" and "this group".
 */
export default function InviteQrModal({ open, onClose, title, description, url }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Invite link copied.');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy the link.');
    }
  };

  const share = async () => {
    // Web Share is the nicer path on mobile; silently fall back to copy elsewhere.
    if (navigator.share) {
      try {
        await navigator.share({ title: title || 'ChatKonect invite', url });
        return;
      } catch {
        return; // user dismissed the sheet — not an error worth surfacing
      }
    }
    copy();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="flex flex-col items-center gap-4 text-center">
        {description && <p className="text-sm text-content-muted">{description}</p>}

        {url ? <QrCode value={url} size={216} /> : <p className="text-sm text-content-muted">No invite link available yet.</p>}

        {url && (
          <>
            {/* break-all: an invite URL is one unbreakable token and would
                otherwise widen the dialog past a 320px screen. */}
            <p className="w-full break-all rounded-xl bg-surface-2 px-3 py-2 text-xs text-content-muted">{url}</p>
            <div className="flex w-full flex-col gap-2 xs:flex-row">
              <Button variant="outline" className="w-full justify-center" onClick={copy}>
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button variant="primary" className="w-full justify-center" onClick={share}>
                <Share2 size={16} /> Share
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
