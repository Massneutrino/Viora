"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PixelSphere } from "@viora/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

type LeadType = "employer" | "worker";
type SubmitState = "idle" | "sending" | "sent" | "error";
type Context = "modal" | "page";

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function splitRoles(value: string | undefined) {
  return value ? value.split(",").map((role) => role.trim()).filter(Boolean) : [];
}

/** Success copy tailored to the lead type — mirrors the API's confirmation tone. */
function successCopy(type: LeadType) {
  return type === "employer"
    ? {
        title: "You're on the list.",
        body: "I will get in touch to set up your organisation — pilot users are onboarded in waves.",
      }
    : {
        title: "You're on the early worker pool.",
        body: "I will get in touch as soon as I have shifts that fit you.",
      };
}

/**
 * The shared pilot lead-capture form: org/worker toggle, fields, submit, and
 * tailored success/error states. Used by the homepage modal (`context="modal"`)
 * and the /register page (`context="page"`), which each provide their own chrome.
 * Field contract matches the server schema in apps/api/src/routes/pilot.ts.
 */
export function LeadForm({
  context,
  onDone,
  header,
  initialType = "employer",
}: {
  context: Context;
  onDone?: () => void;
  initialType?: LeadType;
  /** Optional intro shown above the form and hidden in the success state (page chrome). */
  header?: ReactNode;
}) {
  const [type, setType] = useState<LeadType>(initialType);
  const [state, setState] = useState<SubmitState>("idle");
  const isEmployer = type === "employer";

  useEffect(() => {
    setType(initialType);
    setState("idle");
  }, [initialType]);

  function selectType(next: LeadType) {
    setType(next);
    setState("idle");
  }

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
      if (!res.ok) throw new Error("Lead submit failed");
      target.reset();
      setState("sent");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    const copy = successCopy(type);
    if (context === "page") {
      return (
        <div className="reg-done">
          <PixelSphere state="confirmed" size={88} />
          <h1>{copy.title}</h1>
          <p>{copy.body}</p>
          <a className="reg-back" href="/">
            ← Back to Viora
          </a>
        </div>
      );
    }
    return (
      <div className="qf-done">
        <p className="vc-confirmed">{copy.title}</p>
        <p className="form-description">{copy.body}</p>
        <button type="button" className="qf-submit" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <>
      {header}
      <div className="qf-toggle" role="tablist" aria-label="I am">
        <button
          type="button"
          role="tab"
          aria-selected={isEmployer}
          className={isEmployer ? "on" : ""}
          onClick={() => selectType("employer")}
        >
          Organisation
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isEmployer}
          className={!isEmployer ? "on" : ""}
          onClick={() => selectType("worker")}
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
              Role (optional)
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
              Roles (optional)
              <input name="workerRoleTypes" placeholder="Supply teacher, TA, cover supervisor..." />
            </label>
            <label>
              Compliance (optional)
              <input name="complianceReadiness" placeholder="DBS ready, QTS, Right to Work..." />
            </label>
          </>
        )}

        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Phone (optional)
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
        <p className="form-trust">Pilot access — no spam, unsubscribe anytime.</p>
        {state === "error" && (
          <p className="submit-note error">
            Couldn&apos;t send that — try again, or email{" "}
            <a href="mailto:hello@viora.ai">hello@viora.ai</a>.
          </p>
        )}
      </form>
    </>
  );
}
