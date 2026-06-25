"use client";

import { useState, type FormEvent } from "react";
import { PixelSphere, Wordmark } from "@viora/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

type LeadType = "employer" | "worker";
type SubmitState = "idle" | "sending" | "sent" | "error";

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function splitRoles(value: string | undefined) {
  return value ? value.split(",").map((r) => r.trim()).filter(Boolean) : [];
}

export default function RegisterPage() {
  const [type, setType] = useState<LeadType>("employer");
  const [state, setState] = useState<SubmitState>("idle");
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
        }
      : {
          leadType: type,
          name: field(form, "name"),
          email: field(form, "email"),
          phone: field(form, "phone"),
          postcode: field(form, "postcode"),
          workerRoleTypes: splitRoles(field(form, "workerRoleTypes")),
          complianceReadiness: field(form, "complianceReadiness"),
        };

    setState("sending");
    try {
      const res = await fetch(`${API_URL}/v1/pilot/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("failed");
      target.reset();
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="reg-page">
      <a className="brand-link reg-brand" href="/">
        <PixelSphere state="rest" size={44} staticMark />
        <Wordmark scale={0.85} />
      </a>

      <div className="reg-card">
        {state === "sent" ? (
          <div className="reg-done">
            <PixelSphere state="confirmed" size={88} />
            <h1>You&apos;re on the waitlist.</h1>
            <p>
              V has your details. We&apos;re onboarding pilot users in waves — we&apos;ll email you when your
              access is ready.
            </p>
            <a className="reg-back" href="/">
              ← Back to Viora
            </a>
          </div>
        ) : (
          <>
            <div className="reg-head">
              <h1>Request access</h1>
              <p>Viora is in pilot. Join the waitlist and we&apos;ll set you up when a place opens.</p>
            </div>

            <div className="qf-toggle" role="tablist" aria-label="I am">
              <button type="button" role="tab" aria-selected={isEmployer} className={isEmployer ? "on" : ""} onClick={() => setType("employer")}>
                Organisation
              </button>
              <button type="button" role="tab" aria-selected={!isEmployer} className={!isEmployer ? "on" : ""} onClick={() => setType("worker")}>
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
                By joining you agree to be contacted about Viora. See our{" "}
                <a href="/privacy" target="_blank" rel="noreferrer">
                  privacy notice
                </a>
                .
              </p>

              <button type="submit" className="qf-submit" disabled={state === "sending"}>
                {state === "sending" ? "Joining..." : "Join the waitlist"}
              </button>
              {state === "error" && <p className="submit-note error">Could not send. Please try again.</p>}
            </form>
          </>
        )}
      </div>
    </main>
  );
}
