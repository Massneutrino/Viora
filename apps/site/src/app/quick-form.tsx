"use client";

import { useEffect } from "react";
import { LeadForm } from "./lead-form";

export function QuickFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="qf-overlay" role="dialog" aria-modal="true" aria-label="Quick form" onMouseDown={onClose}>
      <div className="qf-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qf-head">
          <strong>Join the pilot</strong>
          <button type="button" className="qf-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <LeadForm context="modal" onDone={onClose} />
      </div>
    </div>
  );
}
