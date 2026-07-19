import { useEffect } from 'react';
import { useToastStore, type Toast, type ToastVariant } from '../store/toastStore';

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'border-signal/40 bg-signal/10 text-signal',
  error: 'border-alert/40 bg-alert/10 text-alert',
  info: 'border-panelBorder bg-panel text-ink',
};

const VARIANT_ICON: Record<ToastVariant, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (toast.duration <= 0) return;
    const t = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-lg backdrop-blur-sm animate-toast-in ${VARIANT_CLASSES[toast.variant]}`}
    >
      <span className="text-[13px] leading-none">{VARIANT_ICON[toast.variant]}</span>
      <span className="max-w-[240px]">{toast.message}</span>
      <button
        onClick={() => dismiss(toast.id)}
        className="focus-ring ml-1 text-inherit opacity-60 hover:opacity-100 leading-none"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

/** Global toast viewport — mount once (in AppShell). Renders whatever is
 *  currently in useToastStore, bottom-right, stacked newest-on-top. */
export default function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
