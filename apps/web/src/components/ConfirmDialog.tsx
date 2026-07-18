import { useEffect, useState } from 'react';

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger' | 'neutral';
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key === 'Enter' && !busy) void handleConfirm();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  if (!open) return null;

  async function handleConfirm() {
    try {
      setBusy(true);
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  const confirmClass =
    variant === 'danger'
      ? 'border border-alert/40 text-alert hover:bg-alert/10'
      : variant === 'neutral'
      ? 'border border-panelBorder hover:border-ink/30'
      : 'bg-signal text-canvas hover:brightness-110';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[440px] bg-panel border border-panelBorder rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-muted">{description}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={busy}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-panelBorder text-muted hover:text-ink disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className={`focus-ring text-sm px-3 py-1.5 rounded-md ${confirmClass} disabled:opacity-50`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

