import type { ReactNode } from "react";
import { Button } from "./Button";
import { JellyfinMark } from "./JellyfinLogo";

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <JellyfinMark size={40} />
      <h3 className="state__title">{title}</h3>
      {body && <p className="state__body">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="state" role="alert">
      <h3 className="state__title">Couldn't load this</h3>
      <p className="state__body">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-label={label}>
      <span />
    </div>
  );
}

export function FullScreenLoader() {
  return (
    <div className="fullscreen-loader">
      <JellyfinMark size={56} />
    </div>
  );
}
