import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: IconName;
  group: string;
}

const sectionId = (id: string) => `settings-${id}`;

/** One block of settings: an icon, a title, a line on where it applies, then its rows. */
export function SettingsSection({ id, icon, title, desc, children }: { id: string; icon: IconName; title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section id={sectionId(id)} className="settings-section" aria-labelledby={`${sectionId(id)}-title`}>
      <header className="settings-section__head">
        <span className="settings-section__icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <div className="settings-section__heading">
          <h2 id={`${sectionId(id)}-title`} className="settings-section__title">
            {title}
          </h2>
          {desc && <p className="settings-section__desc">{desc}</p>}
        </div>
      </header>
      <div className="panel settings-section__body">{children}</div>
    </section>
  );
}

/**
 * The menu beside the settings (a strip above them on phones). It follows your scrolling
 * and jumps to a section when picked.
 */
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const stripRef = useRef<HTMLElement>(null);
  // While a picked section scrolls into view, don't let the sections passed on the way light up.
  const jumping = useRef(0);

  useEffect(() => {
    const els = items.map((i) => document.getElementById(sectionId(i.id))).filter((e): e is HTMLElement => Boolean(e));
    if (!els.length) return;
    const update = () => {
      if (Date.now() < jumping.current) return;
      // The last section whose top has passed a line a little below the header.
      const line = window.innerHeight * 0.3;
      let current = els[0].id;
      for (const el of els) if (el.getBoundingClientRect().top <= line) current = el.id;
      // At the very bottom, the last sections may never reach the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = els[els.length - 1].id;
      setActive(current.replace(/^settings-/, ""));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [items]);

  // Keep the active item visible in the phone strip.
  useEffect(() => {
    const strip = stripRef.current;
    const link = strip?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!strip || !link || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: link.offsetLeft - strip.clientWidth / 2 + link.offsetWidth / 2, behavior: "smooth" });
  }, [active]);

  const go = (id: string) => {
    const el = document.getElementById(sectionId(id));
    if (!el) return;
    setActive(id);
    jumping.current = Date.now() + 700;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const groups: { name: string; items: SettingsNavItem[] }[] = [];
  for (const item of items) {
    const g = groups.find((x) => x.name === item.group);
    if (g) g.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  return (
    <nav ref={stripRef} className="settings__nav" aria-label="Settings sections">
      {groups.map((g) => (
        <div key={g.name} className="settings__group">
          <span className="settings__group-label">{g.name}</span>
          {g.items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-section={item.id}
              className={`settings__link${active === item.id ? " is-active" : ""}`}
              aria-current={active === item.id ? "location" : undefined}
              onClick={() => go(item.id)}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
