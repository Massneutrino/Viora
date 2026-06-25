"use client";

import { useState } from "react";

type Lens = "organisation" | "worker";
type Visibility = "private" | "operational" | "shared";
type Source = "user_entered" | "agent_inferred" | "feedback";

type MemItem = {
  id: string;
  kind: string;
  title: string;
  content: string;
  source: Source;
  visibility: Visibility;
  confirmed: boolean;
};

const ORG_MEMORY: MemItem[] = [
  {
    id: "o1",
    kind: "briefing note",
    title: "Arrival & sign-in",
    content: "Visitors sign in at reception; ask for Mrs Owens. Gate code rotates termly.",
    source: "user_entered",
    visibility: "shared",
    confirmed: true,
  },
  {
    id: "o2",
    kind: "preference",
    title: "Preferred cover supervisors",
    content: "Send A. Shah and M. Jones first — strong behaviour management here.",
    source: "user_entered",
    visibility: "operational",
    confirmed: true,
  },
  {
    id: "o3",
    kind: "pattern",
    title: "Recurring Friday PE cover",
    content: "Most Fridays need PE cover, 8:30–3:30. V can pre-warm the pool.",
    source: "agent_inferred",
    visibility: "operational",
    confirmed: false,
  },
  {
    id: "o4",
    kind: "pay signal",
    title: "Rate pattern",
    content: "Approves up to £160/day for cover supervisor without escalation.",
    source: "agent_inferred",
    visibility: "operational",
    confirmed: true,
  },
];

const WORKER_MEMORY: MemItem[] = [
  {
    id: "w1",
    kind: "availability",
    title: "Free on Fridays",
    content: "Available most Fridays, up to 10 hours a week.",
    source: "user_entered",
    visibility: "operational",
    confirmed: true,
  },
  {
    id: "w2",
    kind: "fit signal",
    title: "Strong with KS2",
    content: "Consistently high post-shift feedback for KS2 cover.",
    source: "feedback",
    visibility: "operational",
    confirmed: true,
  },
  {
    id: "w3",
    kind: "pay signal",
    title: "Pay floor",
    content: "Won't accept work under £130/day.",
    source: "user_entered",
    visibility: "operational",
    confirmed: true,
  },
  {
    id: "w4",
    kind: "preference",
    title: "Private note",
    content: "Prefers mornings — caring responsibilities. Not shown to employers.",
    source: "user_entered",
    visibility: "private",
    confirmed: true,
  },
];

const VIS_LABEL: Record<Visibility, string> = {
  private: "Private to you",
  operational: "V uses it",
  shared: "Shared",
};
const VIS_NEXT: Record<Visibility, Visibility> = {
  private: "operational",
  operational: "shared",
  shared: "private",
};
const SOURCE_LABEL: Record<Source, string> = {
  user_entered: "You told V",
  agent_inferred: "V noticed",
  feedback: "From feedback",
};

function MemoryCard({ item, onCycle, onDelete }: { item: MemItem; onCycle: () => void; onDelete: () => void }) {
  return (
    <div className="md-card">
      <div className="md-card-top">
        <span className="md-kind">{item.kind}</span>
        {!item.confirmed && <span className="md-pending">Confirm?</span>}
      </div>
      <strong className="md-title">{item.title}</strong>
      <p className="md-content">{item.content}</p>
      <div className="md-card-foot">
        <span className="md-source">{SOURCE_LABEL[item.source]}</span>
        <div className="md-actions">
          <button type="button" className={`md-vis ${item.visibility}`} onClick={onCycle}>
            {VIS_LABEL[item.visibility]}
          </button>
          <button type="button" className="md-del" onClick={onDelete} aria-label="Forget this">
            Forget
          </button>
        </div>
      </div>
    </div>
  );
}

export function MemoryDemo() {
  const [lens, setLens] = useState<Lens>("organisation");
  const [org, setOrg] = useState<MemItem[]>(ORG_MEMORY);
  const [worker, setWorker] = useState<MemItem[]>(WORKER_MEMORY);

  const items = lens === "organisation" ? org : worker;
  const setItems = lens === "organisation" ? setOrg : setWorker;

  const cycle = (id: string) =>
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, visibility: VIS_NEXT[m.visibility] } : m)));
  const remove = (id: string) => setItems((prev) => prev.filter((m) => m.id !== id));

  return (
    <section className="memory" id="memory">
      <div className="memory-head">
        <p className="eyebrow">Viora Memory</p>
        <h2>V remembers the work.</h2>
        <p className="memory-sub">
          The context a good agency keeps in someone&apos;s head — site quirks, who fits where, what you&apos;ll
          pay, when you&apos;re free — V keeps for you. You own it: see it, change it, make it private, or forget
          it.
        </p>
      </div>

      <div className="memory-toggle" role="tablist" aria-label="Whose memory">
        <button
          type="button"
          role="tab"
          aria-selected={lens === "organisation"}
          className={lens === "organisation" ? "on" : ""}
          onClick={() => setLens("organisation")}
        >
          Organisation memory
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={lens === "worker"}
          className={lens === "worker" ? "on" : ""}
          onClick={() => setLens("worker")}
        >
          Worker memory
        </button>
      </div>

      <div className="memory-grid">
        {items.map((m) => (
          <MemoryCard key={m.id} item={m} onCycle={() => cycle(m.id)} onDelete={() => remove(m.id)} />
        ))}
        {items.length === 0 && <p className="memory-empty">Forgotten. V starts fresh here.</p>}
      </div>

      <p className="memory-guarantee">
        Memory sharpens matching — it never overrides eligibility. DBS, Right to Work, safeguarding, QTS and SIA
        stay deterministic checks, always.
      </p>
    </section>
  );
}
