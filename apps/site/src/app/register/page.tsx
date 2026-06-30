"use client";

import { PixelSphere, Wordmark } from "@viora/ui";
import { LeadForm } from "../lead-form";

export default function RegisterPage() {
  return (
    <main className="reg-page">
      <a className="brand-link reg-brand" href="/">
        <PixelSphere state="rest" size={44} staticMark />
        <Wordmark scale={0.85} />
      </a>

      <div className="reg-card">
        <LeadForm
          context="page"
          header={
            <div className="reg-head">
              <h1>Request access</h1>
              <p>Viora is in pilot. Join the waitlist and we&apos;ll set you up when a place opens.</p>
            </div>
          }
        />
      </div>
    </main>
  );
}
