import { useState } from "react";
import { Icon } from "@/components/Icon";
import { clearFinishedIdentify, mine, removeIdentify, retryIdentify, useIdentifyJobs, type IdentifyJob } from "./identifyQueue";

const STATE_LABEL: Record<IdentifyJob["state"], string> = {
  queued: "Waiting",
  running: "Identifying…",
  done: "Done",
  failed: "Failed",
};

const yearOf = (j: IdentifyJob) => j.match.ProductionYear ?? (j.match.PremiereDate ? new Date(j.match.PremiereDate).getFullYear() : undefined);

/** The background Identify queue: a small bar while it works, with the list behind it. */
export function IdentifyQueuePanel() {
  const jobs = mine(useIdentifyJobs());
  const [open, setOpen] = useState(false);
  if (!jobs.length) return null;

  const active = jobs.filter((j) => j.state === "queued" || j.state === "running");
  const failed = jobs.filter((j) => j.state === "failed");
  const done = jobs.filter((j) => j.state === "done");
  const current = jobs.find((j) => j.state === "running");
  const label = active.length
    ? `Identifying ${done.length + failed.length + 1} of ${jobs.length}`
    : failed.length
      ? `${failed.length} of ${jobs.length} couldn't be identified`
      : `Identified ${done.length} ${done.length === 1 ? "title" : "titles"}`;

  return (
    <div className={`idq ${open ? "is-open" : ""}`} role="region" aria-label="Identify queue">
      {open && (
        <ul className="idq__list">
          {jobs.map((j) => (
            <li key={j.id} className={`idq__job idq__job--${j.state}`}>
              <span className="idq__poster">
                {j.match.ImageUrl ? <img src={j.match.ImageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" /> : <Icon name="film" size={16} />}
              </span>
              <span className="idq__text">
                <span className="idq__name">{j.itemName}</span>
                <span className="idq__match">
                  as {j.match.Name}
                  {yearOf(j) ? ` (${yearOf(j)})` : ""} · {STATE_LABEL[j.state]}
                </span>
                {j.error && <span className="idq__error">{j.error}</span>}
              </span>
              {j.state === "failed" && (
                <button className="btn btn--ghost btn--sm" onClick={() => retryIdentify(j.id)}>
                  <Icon name="refresh" size={16} /> <span className="btn__label">Retry</span>
                </button>
              )}
              {j.state === "queued" && (
                <button className="btn btn--icon btn--sm" onClick={() => removeIdentify(j.id)} aria-label={`Don't identify ${j.itemName}`} title="Remove">
                  <Icon name="close" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="idq__bar">
        <button className="idq__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {active.length ? <span className="idq__spinner" aria-hidden="true" /> : <Icon name={failed.length ? "info" : "check"} size={16} />}
          <span className="idq__label">{label}</span>
          {current && <span className="idq__current">{current.itemName}</span>}
          <Icon name="chevronDown" size={16} className="idq__chevron" />
        </button>
        {!active.length && (
          <button className="btn btn--icon btn--sm" onClick={clearFinishedIdentify} aria-label="Clear the list" title="Clear">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
