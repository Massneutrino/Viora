"use client";

// "What makes Viora different" — a live, both-sides match scene.
// The organisation (left) and the worker (right) both feed a central Viora
// Memory core (the V identity): agents negotiate, the rate settles, compliance
// is verified and the shift fills in minutes. The whole sequence plays once when
// the section scrolls into view (IntersectionObserver), and settles on the match.
// Memory is the heart but stays a black box — no internals are shown.

import { useEffect, useRef, useState } from "react";
import { PixelSphere, type WaveState } from "@viora/ui";

type IconName = "building" | "person" | "exchange" | "sparkles" | "clock" | "shield";

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
  if (name === "sparkles")
    return (
      <svg {...common}>
        <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
        <path d="M18.5 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
      </svg>
    );
  if (name === "clock")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.6 1.5" />
      </svg>
    );
  if (name === "shield")
    return (
      <svg {...common}>
        <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
        <path d="M9 12l2.2 2.2L15 10" />
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

const VALUE_PROPS: { icon: IconName; title: string; desc: string }[] = [
  { icon: "exchange", title: "Agents on each side", desc: "Find, match and negotiate the best outcome." },
  { icon: "sparkles", title: "Viora Memory", desc: "Powers the pool, learning what matters." },
  { icon: "clock", title: "Timely cover", desc: "Well-placed, the moment you need it." },
  { icon: "shield", title: "Fair & compliant", desc: "Right pay, verified — every time." },
];

const COMPLIANCE = ["Right to Work", "DBS", "Safeguarding", "QTS"];

export function WhatsDifferent() {
  const sectionRef = useRef<HTMLElement>(null);
  const [sphereState, setSphereState] = useState<WaveState>("rest");

  useEffect(() => {
    const root = sectionRef.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const rowEl = root.querySelector<HTMLElement>(".vmx-row");
    const rateVal = root.querySelector<HTMLElement>(".vmx-rateval");
    const rateEl = root.querySelector<HTMLElement>(".vmx-rate");
    const matchingEl = root.querySelector<HTMLElement>(".vmx-matching");
    const matchedEl = root.querySelector<HTMLElement>(".vmx-matched");
    const wfoot = root.querySelector<HTMLElement>(".vmx-wfoot");
    const ripple = root.querySelector<HTMLElement>(".vmx-ripple");
    const checks = Array.from(root.querySelectorAll<HTMLElement>(".vmx-chk"));
    const pgs = Array.from(root.querySelectorAll<HTMLElement>(".vmx-pg"));
    const outcome = root.querySelector<HTMLElement>(".vmx-outcome");
    const queue = root.querySelector<HTMLElement>(".vmx-queuen");
    const sceneEl = root.querySelector<HTMLElement>(".vmx-scene");
    const consoleEl = root.querySelector<HTMLElement>(".vmx-console");

    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const eo = (p: number) => 1 - Math.pow(1 - p, 3);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    let raf = 0;
    let startT = 0;
    let running = false;
    let curSphere: WaveState = "rest";
    const setSphere = (s: WaveState) => {
      if (curSphere !== s) {
        curSphere = s;
        setSphereState(s);
      }
    };
    const setNode = (i: number, cls: string) => {
      if (pgs[i]) pgs[i].className = "vmx-pg" + (cls ? " " + cls : "");
    };

    const END = 6.4;
    const PERIOD = 9.2;
    const FADE_IN = 1.5;
    const FADE_OUT = 0.9;
    const smooth = (t: number) => {
      const c = t < 0 ? 0 : t > 1 ? 1 : t;
      return c * c * (3 - 2 * c);
    };

    const apply = (ph: number) => {
      const neg = ph >= 0.5 && ph < 4.6;
      const filled = ph >= 4.6;
      const mp = eo(clamp((ph - 3.0) / 0.6, 0, 1));
      const rateN = ph < 0.7 ? 146 : ph < 3.0 ? Math.round(lerp(146, 152, eo(clamp((ph - 0.7) / 2.0, 0, 1)))) : 152;

      if (rowEl) rowEl.className = "vmx-row" + (filled ? " is-matched" : neg ? " is-neg" : "");
      if (rateVal) {
        rateVal.textContent = "£" + rateN;
        rateVal.style.color = filled ? "var(--success)" : "var(--accent)";
      }
      if (rateEl) rateEl.style.color = filled ? "var(--success)" : "var(--muted)";
      if (matchingEl) matchingEl.style.opacity = String(1 - mp);
      if (matchedEl) matchedEl.style.opacity = String(mp);
      checks.forEach((c, i) => {
        c.style.opacity = String(eo(clamp((ph - (3.9 + i * 0.28)) / 0.25, 0, 1)));
      });

      if (ph < 0.5) {
        setNode(0, "is-active"); setNode(1, ""); setNode(2, ""); setNode(3, "");
      } else if (ph < 3.0) {
        setNode(0, "is-done"); setNode(1, "is-active"); setNode(2, ""); setNode(3, "");
      } else if (ph < 4.6) {
        setNode(0, "is-done"); setNode(1, "is-done"); setNode(2, "is-active"); setNode(3, "");
      } else {
        setNode(0, "is-done"); setNode(1, "is-done"); setNode(2, "is-done"); setNode(3, "is-fill");
      }

      if (filled) {
        if (wfoot) { wfoot.textContent = "✓ Filled in 2 min · 09:43"; wfoot.classList.add("is-filled"); }
        if (outcome) { outcome.textContent = "Filled in 2 min ✓"; outcome.classList.add("is-filled"); }
        if (queue) queue.textContent = "33";
        const rp = clamp((ph - 4.6) / 1.0, 0, 1);
        if (ripple) { ripple.style.opacity = String(0.5 * (1 - rp)); ripple.style.transform = "scale(" + (1 + rp) + ")"; }
        setSphere("confirmed");
      } else {
        if (wfoot) { wfoot.textContent = "matching · 09:42"; wfoot.classList.remove("is-filled"); }
        if (outcome) { outcome.textContent = "in progress"; outcome.classList.remove("is-filled"); }
        if (queue) queue.textContent = "34";
        if (ripple) ripple.style.opacity = "0";
        setSphere(neg ? "processing" : "rest");
      }
    };

    const frame = (now: number) => {
      const ph = ((now - startT) / 1000) % PERIOD;
      apply(Math.min(ph, END));
      let fade = 1;
      if (ph < FADE_IN) fade = smooth(ph / FADE_IN);
      else if (ph > PERIOD - FADE_OUT) fade = smooth((PERIOD - ph) / FADE_OUT);
      const op = String(fade);
      if (sceneEl) sceneEl.style.opacity = op;
      if (consoleEl) consoleEl.style.opacity = op;
      if (running) raf = requestAnimationFrame(frame);
    };

    const run = () => {
      if (running) return;
      if (reduce) {
        apply(END);
        return;
      }
      running = true;
      startT = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const reset = () => {
      cancelAnimationFrame(raf);
      running = false;
      apply(0);
      if (sceneEl) sceneEl.style.opacity = "1";
      if (consoleEl) consoleEl.style.opacity = "1";
    };

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) run();
          else if (!reduce) reset();
        });
      },
      { threshold: 0.35 },
    );
    io.observe(root);
    apply(0);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="memory" id="memory" ref={sectionRef}>
      <div className="memory-head">
        <h2>
          <span className="memory-brand">Viora</span> — the only agency you need.
        </h2>
        <p className="vmx-kicker">
          The agency, reimagined as intelligence — an agent on each side, one memory across both
          sides, the right match <strong>in minutes.</strong>
        </p>
      </div>

      <div className="vmx-scene">
        <article className="vmx-card">
          <div className="vmx-chead">
            <span className="vmx-pi">
              <CardIcon name="building" />
            </span>
            <span className="vmx-clabel">Organisation</span>
          </div>
          <div className="vmx-cmain">Emergency cover · today</div>
          <div className="vmx-cmeta">KS2 · all day · Manchester</div>
          <div className="vmx-cfoot">
            <span className="vmx-fdot" />
            Request received · 09:41
          </div>
        </article>

        <div className="vmx-center">
          <div className="vmx-agents-label">Viora agents negotiate</div>
          <div className="vmx-row">
            <span className="vmx-dots org">
              <i />
              <i />
              <i />
              <i />
            </span>
            <div className="vmx-orb">
              <div className="vmx-ripple" />
              <PixelSphere state={sphereState} size={128} ariaLabel="Viora memory core" />
            </div>
            <span className="vmx-dots wrk">
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
          <div className="vmx-rate">
            fair pay · <span className="vmx-rateval">£146</span>/day
          </div>
          <div className="vmx-memlabel">powered by Viora Memory</div>
        </div>

        <article className="vmx-card">
          <div className="vmx-chead">
            <span className="vmx-pi">
              <CardIcon name="person" />
            </span>
            <span className="vmx-clabel">Worker</span>
          </div>
          <div className="vmx-matching">
            <span className="vmx-mdot" />
            finding best match…
          </div>
          <div className="vmx-matched">
            <div className="vmx-badge">★ Best match</div>
            <div className="vmx-mrole">Cover Supervisor</div>
            <div className="vmx-mpay">£152/day · fair pay</div>
            <div className="vmx-checks">
              {COMPLIANCE.map((c) => (
                <div className="vmx-check" key={c}>
                  <span>{c}</span>
                  <span className="vmx-chk">✓</span>
                </div>
              ))}
            </div>
            <div className="vmx-trust">Governed memory — it works for you, never on you.</div>
          </div>
          <div className="vmx-wfoot">matching · 09:42</div>
        </article>
      </div>

      <div className="vmx-console">
        <div className="vmx-live">
          <span className="vmx-livedot" />
          Live Matching Console
        </div>
        <div className="vmx-queue">
          <span className="vmx-queuen">34</span> covers matching now · every 5s
        </div>
        <div className="vmx-prog">
          <span className="vmx-pg">
            <span className="vmx-pgd" />
            Request
          </span>
          <span className="vmx-pgc" />
          <span className="vmx-pg">
            <span className="vmx-pgd" />
            Matching
          </span>
          <span className="vmx-pgc" />
          <span className="vmx-pg">
            <span className="vmx-pgd" />
            Shortlisting
          </span>
          <span className="vmx-pgc" />
          <span className="vmx-pg">
            <span className="vmx-pgd" />
            Filled
          </span>
        </div>
        <div className="vmx-outcome">in progress</div>
      </div>

      <div className="vmx-vps">
        {VALUE_PROPS.map((v) => (
          <div className="vmx-vp" key={v.title}>
            <span className="vmx-vp-ic">
              <CardIcon name={v.icon} />
            </span>
            <div>
              <div className="vmx-vp-t">{v.title}</div>
              <div className="vmx-vp-d">{v.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="memory-guarantee">
        Viora&apos;s agents match on fit and fair pay — never on eligibility. DBS, Right to Work,
        safeguarding and QTS are always verified, every time.
      </p>
    </section>
  );
}
