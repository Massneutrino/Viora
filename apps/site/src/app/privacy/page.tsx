import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Viora",
  description: "How Viora handles the details you share during the pilot.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <a className="legal-back" href="/">
        ← Back to Viora
      </a>
      <h1>Privacy notice</h1>
      <p className="legal-updated">Pilot stage · last updated 24 June 2026</p>

      <section>
        <h2>What we collect</h2>
        <p>
          When you talk to V or fill in a pilot form, we collect the details you choose to share — your
          name and email, and depending on whether you&apos;re an organisation or a worker, things like your
          organisation name, role, postcode, the kinds of work you do, and your compliance readiness (for
          example DBS, QTS or Right to Work status). We also keep a record of the conversation so we can
          follow up accurately.
        </p>
      </section>

      <section>
        <h2>Why we collect it</h2>
        <p>
          We use these details for one purpose during the pilot: to contact you about Viora and to match
          organisations with suitable workers. We rely on your consent, which you give when you tick the box or
          submit the form. You can withdraw it at any time by emailing us.
        </p>
      </section>

      <section>
        <h2>How we handle it</h2>
        <p>
          Every action V takes on your data is logged in an audit trail. We don&apos;t sell your information or
          share it beyond what&apos;s needed to run the pilot. We keep it only as long as the pilot needs it.
        </p>
      </section>

      <section>
        <h2>Your rights &amp; contact</h2>
        <p>
          You can ask us to show, correct, or delete the information we hold about you. To do so, or for any
          privacy question, email{" "}
          <a href="mailto:privacy@viora.ai">privacy@viora.ai</a>.
        </p>
      </section>
    </main>
  );
}
