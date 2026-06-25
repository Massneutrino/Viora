"use client";

import { useEffect, useState, type FormEvent } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

type LeadType = "employer" | "worker";
type SubmitState = "idle" | "sending" | "sent" | "error";

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function splitRoles(value: string | undefined) {
  return value
    ? value
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean)
    : [];
}

export function QuickFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [type, setType] = useState<LeadType>("employer");
  const [state, setState] = useState<SubmitState>("idle");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setState("idle");
  }, [open, type]);

  if (!open) return null;

  const isEmployer = type === "employer";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const payload = isEmployer
      ? {
          leadType: type,
          name: field(form, "name"),
          organisationName: field(form, "organisationName"),
          roleTitle: field(form, "roleTitle"),
          email: field(form, "email"),
          phone: field(form, "phone"),
          notes: field(form, "notes"),
        }
      : {
          leadType: type,
          name: field(form, "name"),
          email: field(form, "email"),
          phone: field(form, "phone"),
          postcode: field(form, "postcode"),
          workerRoleTypes: splitRoles(field(form, "workerRoleTypes")),
          complianceReadiness: field(form, "complianceReadiness"),
          notes: field(form, "notes"),
        };

    setState("sending");
    try {
      const res = await fetch(`${API_URL}/v1/pilot/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Lead submit failed");
      target.reset();
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="qf-overlay" role="dialog" aria-modal="true" aria-label="Quick form" onMouseDown={onClose}>
      <div className="qf-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qf-head">
          <strong>Join the pilot</strong>
          <button type="button" className="qf-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {state === "sent" ? (
          <div className="qf-done">
            <p className="vc-confirmed">You&apos;re on the waitlist.</p>
            <p className="form-description">We&apos;ll be in touch when your access is ready.</p>
            <button type="button" className="qf-submit" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="qf-toggle" role="tablist" aria-label="I am">
              <button
                type="button"
                role="tab"
                aria-selected={isEmployer}
                className={isEmployer ? "on" : ""}
                onClick={() => setType("employer")}
              >
                Organisation
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isEmployer}
                className={!isEmployer ? "on" : ""}
                onClick={() => setType("worker")}
              >
                Worker
              </button>
            </div>

            <form className="qf-form" onSubmit={submit}>
              <label>
                Name
                <input name="name" autoComplete="name" required />
              </label>

              {isEmployer ? (
                <>
                  <label>
                    Organisation
                    <input name="organisationName" autoComplete="organization" required />
                  </label>
                  <label>
                    Role
                    <input name="roleTitle" placeholder="Ops lead, cover manager, founder..." />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Postcode
                    <input name="postcode" autoComplete="postal-code" required />
                  </label>
                  <label>
                    Roles
                    <input name="workerRoleTypes" placeholder="Supply teacher, TA, security..." />
                  </label>
                  <label>
                    Compliance
                    <input name="complianceReadiness" placeholder="DBS ready, QTS, SIA, Right to Work..." />
                  </label>
                </>
              )}

              <label>
                Email
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label>
                Phone
                <input name="phone" autoComplete="tel" />
              </label>

              <p className="form-consent">
                By submitting you agree to be contacted about Viora. See our{" "}
                <a href="/privacy" target="_blank" rel="noreferrer">
                  privacy notice
                </a>
                .
              </p>

              <button type="submit" className="qf-submit" disabled={state === "sending"}>
                {state === "sending" ? "Sending..." : "Join the waitlist"}
              </button>
              {state === "error" && <p className="submit-note error">Could not send. Please try again.</p>}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
