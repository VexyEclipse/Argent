import { useEffect, useSyncExternalStore } from "react";

// One app-wide toast for quick confirmations ("Copied", "Refreshing…"), optionally with
// one action ("Undo").

interface ToastAction {
  label: string;
  run: () => void;
}

let current: { id: number; text: string; action?: ToastAction } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function showToast(text: string, action?: ToastAction) {
  current = { id: (current?.id ?? 0) + 1, text, action };
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (!toast) return;
    // Longer when there's something to press.
    const t = window.setTimeout(
      () => {
        if (current?.id === toast.id) {
          current = null;
          emit();
        }
      },
      toast.action ? 6000 : 3200,
    );
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.action ? "toast--action" : ""}`} role="status" key={toast.id}>
      {toast.text}
      {toast.action && (
        <button
          className="toast__action"
          onClick={() => {
            toast.action!.run();
            current = null;
            emit();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
