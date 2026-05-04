import { useEffect } from 'react';

export default function ConfirmSheet({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', destructive = false }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <div className={`fixed inset-0 z-50 flex flex-col justify-end ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-overlay/60 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div className={`relative rounded-t-panel bg-surface-base px-5 pb-10 pt-5 transition-transform duration-300 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="flex justify-center pb-4">
          <div className="h-1 w-10 rounded-full bg-app-border/60" />
        </div>
        <p className="text-base font-semibold text-app-text">{title}</p>
        {message && <p className="mt-1.5 text-sm text-app-muted">{message}</p>}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => { onConfirm(); onClose(); }}
            className={`h-14 w-full rounded-card text-sm font-semibold text-white transition active:opacity-85 ${
              destructive ? 'bg-accent-coral' : 'bg-accent-forest'
            }`}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-card bg-surface-soft text-sm font-semibold text-app-text transition active:opacity-70"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
