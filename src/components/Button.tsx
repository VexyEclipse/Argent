import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "icon";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  size?: "sm" | "md" | "lg";
  active?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", icon, size = "md", active, className = "", children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`btn btn--${variant} btn--${size} ${active ? "is-active" : ""} ${className}`}
      aria-pressed={active === undefined ? undefined : active}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "lg" ? 22 : size === "sm" ? 16 : 19} />}
      {children && <span className="btn__label">{children}</span>}
    </button>
  );
});
