import { useEffect, useSyncExternalStore } from "react";

// One app-wide toast for quick confirmations ("Copied", "Refreshing…"), optionally with
// an action ("Undo") or two.

interface ToastAction {
  label: string;
  run: () => void;
}

let current: { id: number; text: string; actions: ToastAction[] } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function showToast(text: string, action?: ToastAction | ToastAction[]) {
  current = { id: (current?.id ?? 0) + 1, text, actions: action ? ([] as ToastAction[]).concat(action) : [] };
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
      toast.actions.length ? 6000 : 3200,
    );
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.actions.length ? "toast--action" : ""}`} role="status" key={toast.id}>
      {toast.text}
      {toast.actions.map((action) => (
        <button
          key={action.label}
          className="toast__action"
          onClick={() => {
            action.run();
            current = null;
            emit();
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
