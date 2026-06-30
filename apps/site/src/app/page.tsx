"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { PixelRings, PixelSphere, Wordmark, type WaveState } from "@viora/ui";
import { VConversation, type VConversationHandle } from "./v-conversation";

// Code-split the below-the-fold section and the click-gated modal so they leave
// the initial bundle — the hero hydrates (and the sphere settles) sooner.
const WhatsDifferent = dynamic(() => import("./whats-different").then((m) => m.WhatsDifferent));
const QuickFormModal = dynamic(() => import("./quick-form").then((m) => m.QuickFormModal), {
  ssr: false,
});

type LeadType = "employer" | "worker";

const EXAMPLES = [
  "I need cover for tomorrow, 8:30–3:30",
  "Jack called in sick — I need emergency cover",
  "I'm looking for a few hours each Friday",
  "I want to work 10 hours this week",
  "Two cover supervisors next Monday",
  "Supply teaching near M14, Tuesdays",
];

function useTypewriter(phrases: string[]) {
  const [display, setDisplay] = useState(phrases[0] ?? "");
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(phrases[0] ?? "");
      return;
    }
    let phrase = 0;
    let char = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = phrases[phrase] ?? "";
      if (!deleting) {
        char += 1;
        setDisplay(current.slice(0, char));
        if (char >= current.length) {
          deleting = true;
          timer = setTimeout(tick, 1700);
          return;
        }
        timer = setTimeout(tick, 55);
      } else {
        char -= 1;
        setDisplay(current.slice(0, Math.max(0, char)));
        if (char <= 0) {
          deleting = false;
          phrase = (phrase + 1) % phrases.length;
          timer = setTimeout(tick, 320);
          return;
        }
        timer = setTimeout(tick, 28);
      }
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, [phrases]);
  return display;
}

function Icon({ name }: { name: "building" | "person" | "money" | "trend" | "shield" | "lock" | "cap" }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<typeof name, ReactNode> = {
    building: (
      <>
        <path d="M4 21V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16" />
        <path d="M16 9h3a1 1 0 0 1 1 1v11" />
        <path d="M8 8h1M12 8h1M8 12h1M12 12h1M8 16h1M12 16h1M3 21h18" />
      </>
    ),
    person: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" />
      </>
    ),
    money: (
      <>
        <path d="M15 7c-.7-1.2-1.9-2-3.4-2C9.2 5 7.8 6.7 7.8 8.8c0 3.8.5 4.1.5 6.2H6.5" />
        <path d="M7 12h6.5M6 19h11" />
      </>
    ),
    trend: (
      <>
        <path d="M4 17l5-5 4 4 7-8" />
        <path d="M15 8h5v5" />
      </>
    ),
    shield: <path d="M12 3l7 3v5c0 4.4-2.8 7.7-7 10-4.2-2.3-7-5.6-7-10V6z" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    cap: (
      <>
        <path d="M3 9l9-4 9 4-9 4z" />
        <path d="M7 11v4c2.8 2 7.2 2 10 0v-4" />
      </>
    ),
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function AudienceCard({
  id,
  icon,
  title,
  copy,
  onClick,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  copy: string;
  onClick: () => void;
}) {
  return (
    <button className="audience-card" id={id} type="button" onClick={onClick}>
      <span className="audience-icon">{icon}</span>
      <span className="audience-copy">
        <strong>{title}</strong>
        <small>{copy}</small>
      </span>
    </button>
  );
}

function ProofItem({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return (
    <div className="proof-item">
      <span className="proof-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{copy}</small>
      </span>
    </div>
  );
}

export default function PilotPage() {
  const [waveState, setWaveState] = useState<WaveState>("rest");
  const [formOpen, setFormOpen] = useState(false);
  const [formMounted, setFormMounted] = useState(false);
  const [formType, setFormType] = useState<LeadType>("employer");
  const typed = useTypewriter(EXAMPLES);
  const vcRef = useRef<VConversationHandle>(null);

  const openForm = (type: LeadType) => {
    setFormType(type);
    setFormMounted(true);
    setFormOpen(true);
  };

  // Stagger above-the-fold elements into view on first paint.
  const reveal = (delay: number): CSSProperties => ({ "--reveal-delay": `${delay}ms` } as CSSProperties);

  return (
    <main className="pilot-page">
      <header className="pilot-nav">
        <a className="brand-link" href="/">
          <PixelSphere state="rest" size={44} staticMark />
          <Wordmark scale={0.9} />
        </a>
        <nav aria-label="Site navigation">
          <a className="sign-in" href="/register">
            Request access
          </a>
        </nav>
      </header>

      <section className="hero" id="talk-to-v">
        <div className="hero-heading">
          <span className="hero-eyebrow reveal" style={reveal(0)}>
            <Icon name="cap" /> Flexible staffing — starting with education
          </span>
          <h1 className="reveal" style={reveal(70)}>
            Tell V.<br />Fill Shifts. Find Work.
          </h1>
          <p className="hero-typewriter reveal" style={reveal(140)}>
            &ldquo;{typed}
            <span className="tw-caret">▍</span>&rdquo;
          </p>
        </div>

        <div className="v-stage reveal" style={reveal(210)}>
          <PixelRings state={waveState} centerY={150} innerRadius={86} intensity={0.08} />
          <div className="sphere-wrap">
            <PixelSphere
              state={waveState}
              size={172}
              ariaLabel="Tap to talk to V"
              onTap={() => vcRef.current?.handleSphereTap()}
            />
          </div>
        </div>

        <VConversation ref={vcRef} onStateChange={setWaveState} onOpenForm={() => openForm("employer")} />

        <div className="audience-grid reveal" style={reveal(280)}>
          <AudienceCard
            id="organisations"
            icon={<Icon name="building" />}
            title="For organisations"
            copy="Real-time cover. Compliance built in. Lower agency overhead."
            onClick={() => openForm("employer")}
          />
          <AudienceCard
            id="workers"
            icon={<Icon name="person" />}
            title="For workers"
            copy="Better-fit shifts. Fairer pay. You stay in control."
            onClick={() => openForm("worker")}
          />
        </div>

        <div className="proof-strip reveal" style={reveal(350)} aria-label="Viora operating principles">
          <ProofItem icon={<Icon name="money" />} title="Lower agency overhead" copy="Keep more of your budget" />
          <ProofItem icon={<Icon name="trend" />} title="Better for workers" copy="Fairer pay, better-fit shifts" />
          <ProofItem icon={<Icon name="shield" />} title="Always compliant" copy="Checks built in, always on" />
          <ProofItem icon={<Icon name="lock" />} title="Every action audited" copy="Full visibility, end to end" />
        </div>
      </section>

      <WhatsDifferent />

      <footer className="site-footer">
        <div className="footer-brand">
          <Wordmark scale={0.8} />
          <span>Flexible staffing, starting with education.</span>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <a href="#talk-to-v">Speak with V</a>
          <a href="/register">Join the pilot</a>
          <a href="/privacy">Privacy</a>
          <a href="mailto:hello@viora.ai">hello@viora.ai</a>
        </nav>
        <small>© {2026} Viora</small>
      </footer>

      {formMounted && (
        <QuickFormModal open={formOpen} initialType={formType} onClose={() => setFormOpen(false)} />
      )}
    </main>
  );
}
