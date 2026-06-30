"use client";

// "What makes Viora different" — three calm cards that come alive on hover.
// The organisation and the worker sit either side of a memory→match middle
// card; a bright glint orbits each border at rest (see globals.css). The lists
// are presentational mimics of the product — not wired to live data.

type IconName = "building" | "person" | "exchange";

function CardIcon({ name }: { name: IconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "building")
    return (
      <svg {...common}>
        <path d="M4 21V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16" />
        <path d="M16 9h3a1 1 0 0 1 1 1v11" />
        <path d="M8 8h1M12 8h1M8 12h1M12 12h1M8 16h1M12 16h1M3 21h18" />
      </svg>
    );
  if (name === "person")
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M6 8h11" />
      <path d="M14 5l3 3-3 3" />
      <path d="M18 16H7" />
      <path d="M10 13l-3 3 3 3" />
    </svg>
  );
}

const ORG_FILLS = [
  { title: "2 cover supervisors · tomorrow", meta: "8:30–3:30 · Manchester", status: "filled ✓" },
  { title: "Emergency cover · today", meta: "Jack off sick", status: "filled in 7 min ✓" },
  { title: "PE teacher · Mon–Wed", meta: "KS3", status: "filled ✓" },
  { title: "Teaching assistant · Friday", meta: "SEN", status: "filled ✓" },
];

type MatchRow =
  | { kind: string; text: string }
  | { matched: true; text: string; note: string };

const MATCH_ROWS: MatchRow[] = [
  { kind: "Remembers · org", text: "≤ £160/day · Friday PE cover" },
  { kind: "Remembers · worker", text: "≥ £130/day · free Fridays" },
  { kind: "Remembers · worker", text: "Strong with KS2" },
  { matched: true, text: "Matched — £152/day", note: "compliant ✓" },
];

const WORKER_MATCHES = [
  { role: "Cover Supervisor · Tue", pay: "£152", reason: "Compliant · close · great school" },
  { role: "KS2 cover · Thu", pay: "£140", reason: "Right time · strong fit" },
  { role: "PE cover · Fri", pay: "£155", reason: "Your kind of shift" },
  { role: "TA · Monday", pay: "£132", reason: "Above your floor" },
];

// Lists are duplicated so the upward scroll loops seamlessly.
const loop = <T,>(items: T[]) => [...items, ...items];

export function WhatsDifferent() {
  return (
    <section className="memory" id="memory">
      <div className="memory-head">
        <p className="eyebrow">What makes Viora different</p>
        <h2>
          <span className="memory-brand">Viora</span> — the only agency you need.
        </h2>
        <p className="memory-sub">
          AI agents working for each side find, match and negotiate the best outcomes to benefit
          organisations and workers. Viora Memory powers the pool, learning each side&apos;s
          preferences and ensuring well-placed, timely cover. Fair and compliant at all times.
        </p>
      </div>

      <div className="wd-grid">
        <article className="wd-card">
          <div className="wd-head">
            <span className="wd-pi">
              <CardIcon name="building" />
            </span>
            <span className="wd-title">For the organisation</span>
          </div>
          <div className="wd-view">
            <div className="wd-track">
              {loop(ORG_FILLS).map((r, i) => (
                <div className="wd-row" key={i}>
                  <div className="wd-t">{r.title}</div>
                  <div className="wd-row-line">
                    <span className="wd-m">{r.meta}</span>
                    <span className="wd-m wd-ok">{r.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="wd-foot">Tell V in plain words — it fills the shift.</p>
        </article>

        <article className="wd-card">
          <div className="wd-head">
            <span className="wd-pi">
              <CardIcon name="exchange" />
            </span>
            <span className="wd-title">V remembers &amp; matches</span>
          </div>
          <div className="wd-agents">
            <span className="wd-chip">Org agent</span>
            <CardIcon name="exchange" />
            <span className="wd-chip">Worker agent</span>
          </div>
          <div className="wd-view">
            <div className="wd-track fast">
              {loop(MATCH_ROWS).map((r, i) =>
                "matched" in r ? (
                  <div className="wd-matched" key={i}>
                    <div className="wd-row-line">
                      <span className="wd-ok wd-matched-label">
                        <span className="wd-dot" />
                        {r.text}
                      </span>
                      <span className="wd-m">{r.note}</span>
                    </div>
                  </div>
                ) : (
                  <div className="wd-row" key={i}>
                    <span className="wd-k">{r.kind}</span>
                    <div className="wd-t">{r.text}</div>
                  </div>
                ),
              )}
            </div>
          </div>
          <p className="wd-foot">An agent each side — fair fit, fair pay.</p>
        </article>

        <article className="wd-card">
          <div className="wd-head">
            <span className="wd-pi">
              <CardIcon name="person" />
            </span>
            <span className="wd-title">For the worker</span>
          </div>
          <div className="wd-view">
            <div className="wd-track">
              {loop(WORKER_MATCHES).map((r, i) => (
                <div className="wd-row" key={i}>
                  <div className="wd-row-line">
                    <span className="wd-t">{r.role}</span>
                    <span className="wd-pay">{r.pay}</span>
                  </div>
                  <div className="wd-m">{r.reason}</div>
                </div>
              ))}
            </div>
          </div>
          <p className="wd-foot">Better shifts, fair pay — you stay in control.</p>
        </article>
      </div>

      <p className="memory-guarantee">
        Agents match on fit and fair pay — never on eligibility. DBS, Right to Work, safeguarding, QTS
        and SIA stay deterministic checks, always.
      </p>
    </section>
  );
}
