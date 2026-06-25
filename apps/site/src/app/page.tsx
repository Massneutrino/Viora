"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PixelRings, PixelSphere, Wordmark, type WaveState } from "@viora/ui";
import { VConversation } from "./v-conversation";
import { QuickFormModal } from "./quick-form";
import { MemoryDemo } from "./memory-demo";

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
  action,
  primary,
  onClick,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  copy: string;
  action: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="audience-card" id={id} type="button" onClick={onClick}>
      <span className="audience-icon">{icon}</span>
      <span className="audience-copy">
        <strong>{title}</strong>
        <small>{copy}</small>
      </span>
      <span className={primary ? "card-action primary" : "card-action"}>{action}</span>
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
  const [seed, setSeed] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const typed = useTypewriter(EXAMPLES);

  const seedConversation = (text: string) => {
    setSeed(text);
    document.getElementById("talk-to-v")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <main className="pilot-page">
      <header className="pilot-nav">
        <a className="brand-link" href="/">
          <PixelSphere state="rest" size={36} />
          <Wordmark scale={0.9} />
        </a>
        <nav aria-label="Site navigation">
          <a href="#organisations">For organisations</a>
          <a href="#workers">For workers</a>
          <a href="#memory">Memory</a>
          <a className="sign-in" href="/register">
            Sign in
          </a>
          <a className="nav-cta" href="#talk-to-v">
            Speak with V
          </a>
        </nav>
      </header>

      <section className="hero" id="talk-to-v">
        <div className="hero-heading">
          <h1>Tell V. Fill the shift.</h1>
          <p className="hero-typewriter">
            &ldquo;{typed}
            <span className="tw-caret">▍</span>&rdquo;
          </p>
        </div>

        <div className="v-stage">
          <PixelRings state={waveState} centerY={150} innerRadius={86} intensity={0.08} />
          <div className="sphere-wrap">
            <PixelSphere state={waveState} size={172} ariaLabel="V" />
          </div>
          <span className="education-chip">
            <Icon name="cap" /> Starting with education
          </span>
        </div>

        <VConversation seed={seed} onStateChange={setWaveState} onOpenForm={() => setFormOpen(true)} />

        <div className="audience-grid">
          <AudienceCard
            id="organisations"
            icon={<Icon name="building" />}
            title="For organisations"
            copy="Real-time cover. Full compliance. Lower costs."
            action="Tell V you're hiring"
            primary
            onClick={() => seedConversation("I need to fill shifts")}
          />
          <AudienceCard
            id="workers"
            icon={<Icon name="person" />}
            title="For workers"
            copy="Better shifts. Fair pay. More control."
            action="Tell V you want work"
            onClick={() => seedConversation("I'm looking for work")}
          />
        </div>

        <div className="proof-strip" aria-label="Viora operating principles">
          <ProofItem icon={<Icon name="money" />} title="Lower agency overhead" copy="Keep more of your budget" />
          <ProofItem icon={<Icon name="trend" />} title="More value for workers" copy="Better pay. Better matches" />
          <ProofItem icon={<Icon name="shield" />} title="Always compliant" copy="Checks built in, always on" />
          <ProofItem icon={<Icon name="lock" />} title="Every action audited" copy="Complete visibility and trust" />
        </div>
      </section>

      <MemoryDemo />

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

      <QuickFormModal open={formOpen} onClose={() => setFormOpen(false)} />
    </main>
  );
}
