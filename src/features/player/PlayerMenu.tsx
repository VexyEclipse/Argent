import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/Icon";

export interface MenuOption<T> {
  value: T;
  label: string;
  detail?: string;
}

interface Props<T> {
  title: string;
  options: MenuOption<T>[];
  value: T;
  onChange: (value: T) => void;
  onClose: () => void;
  footer?: ReactNode;
}

export function PlayerMenu<T extends string | number>({ title, options, value, onChange, onClose, footer }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selected = ref.current?.querySelector<HTMLElement>("[aria-checked='true']") ?? ref.current?.querySelector<HTMLElement>("button");
    selected?.focus({ preventScroll: false });
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest(".pc__menu-trigger")) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  return (
    <div className="pmenu" ref={ref} role="dialog" aria-label={title}>
      <div className="pmenu__title">{title}</div>
      <div className="pmenu__list" role="radiogroup" aria-label={title}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={o.value === value}
            className={`pmenu__item ${o.value === value ? "is-active" : ""}`}
            onClick={() => onChange(o.value)}
          >
            <span className="pmenu__check">{o.value === value && <Icon name="check" size={16} />}</span>
            <span className="pmenu__label">
              {o.label}
              {o.detail && <span className="pmenu__detail">{o.detail}</span>}
            </span>
          </button>
        ))}
      </div>
      {footer && <div className="pmenu__footer">{footer}</div>}
    </div>
  );
}
