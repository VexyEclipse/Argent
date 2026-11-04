import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { closeDialog } from "./store";

interface Props {
  title: string;
  /** Shown under the title: usually the item's name. */
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** While saving, Escape and the backdrop don't close it. */
  busy?: boolean;
}

/** The frame every management dialog shares. */
export function Dialog({ title, subtitle, children, footer, wide, busy }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        e.stopPropagation();
        closeDialog();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && closeDialog()} data-nav-trap>
      <div className={`modal mdialog ${wide ? "mdialog--wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="mdialog__head">
          <div className="mdialog__titles">
            <h2 className="modal__title">{title}</h2>
            {subtitle && <p className="mdialog__sub">{subtitle}</p>}
          </div>
          <Button variant="icon" icon="close" onClick={closeDialog} disabled={busy} aria-label="Close" />
        </header>
        <div className="mdialog__body">{children}</div>
        {footer && <footer className="mdialog__foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** "Name" or "Name and 3 more", for dialogs acting on a selection. */
export function namesOf(items: { Name: string }[]): string {
  if (items.length === 1) return items[0].Name;
  return `${items[0].Name} and ${items.length - 1} more`;
}
