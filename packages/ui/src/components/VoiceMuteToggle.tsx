"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import { isVoiceMuted, setVoiceMuted, subscribeVoiceMuted } from "../speech";

/**
 * Small, discrete control that mutes/unmutes V's spoken voice globally.
 * State lives in the shared speech module, so toggling here silences V in
 * every app and persists across reloads. Self-styled with `currentColor` so it
 * inherits whatever colour the host (site / AppShell / ConsoleShell) sets.
 */
export function VoiceMuteToggle({
  className,
  style,
  size = 18,
}: {
  className?: string;
  style?: CSSProperties;
  size?: number;
}) {
  const muted = useSyncExternalStore(subscribeVoiceMuted, isVoiceMuted, () => false);

  const label = muted ? "Unmute V" : "Mute V";

  return (
    <button
      type="button"
      className={className}
      onClick={() => setVoiceMuted(!muted)}
      aria-label={label}
      aria-pressed={muted}
      title={label}
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: size + 10,
        height: size + 10,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: 0,
        lineHeight: 0,
        opacity: muted ? 1 : 0.7,
        ...style,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M11 5 6 9H2v6h4l5 4z" />
        {muted ? (
          <path d="M22 9l-6 6M16 9l6 6" />
        ) : (
          <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
        )}
      </svg>
    </button>
  );
}
