import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Input } from './ui/Input';
import QrScanner, { canScanQr } from './QrScanner';
import { parseInvite } from '../lib/invite';

/**
 * Scan a ChatConnect QR (or paste the code) to open the group / person it points at.
 *
 * Manual entry is always offered, not just as a fallback: `BarcodeDetector` is
 * missing on Safari/iOS, and a link someone sent over another app is pasted far
 * more often than it is scanned.
 */
export default function ScanQrModal({ open, onClose }) {
  const navigate = useNavigate();
  const [manual, setManual] = useState('');

  const go = useCallback(
    (text) => {
      const path = parseInvite(text);
      if (!path) {
        toast.error("That doesn't look like a ChatConnect invite.");
        return;
      }
      onClose?.();
      navigate(path);
    },
    [navigate, onClose]
  );

  return (
    <Modal open={open} onClose={onClose} title="Scan invite code" size="sm">
      <div className="space-y-4">
        {canScanQr() ? (
          <QrScanner onResult={go} />
        ) : (
          <p className="rounded-xl neu-inset bg-surface-2 px-3 py-2.5 text-xs text-content-muted">
            This browser can&apos;t use the camera to scan. Paste the invite link or code below instead.
          </p>
        )}

        <div className="space-y-2">
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Paste invite link or code" />
          <Button variant="primary" className="w-full justify-center" disabled={!manual.trim()} onClick={() => go(manual)}>
            Open invite
          </Button>
        </div>
      </div>
    </Modal>
  );
}
