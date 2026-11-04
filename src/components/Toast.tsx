import { useEffect, useSyncExternalStore } from "react";

// One app-wide toast for quick confirmations ("Copied", "Refreshing…").

let current: { id: number; text: string } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function showToast(text: string) {
  current = { id: (current?.id ?? 0) + 1, text };
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
    const t = window.setTimeout(() => {
      if (current?.id === toast.id) {
        current = null;
        emit();
      }
    }, 3200);
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      {toast.text}
    </div>
  );
}
