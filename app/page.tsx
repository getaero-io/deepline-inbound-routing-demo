import { InboundRouting } from "./routing";

export default function Page() {
  return (
    <main className="shell">
      <section className="copy">
        <span>DEEPLINE</span>
        <h1>
          Talk to us.
          <br />
          <em>We’ll find the right team.</em>
        </h1>
        <p>
          Tell us who you are. We’ll verify your company, preserve an existing
          Deepline relationship, and put the right calendar in front of you.
        </p>
        <ul>
          <li>Route first; enrichment updates live; safe handoff by five seconds</li>
          <li>Work email only — no company form field</li>
          <li>One Deepline key — swap data sources without rebuilding the app</li>
        </ul>
      </section>
      <InboundRouting />
    </main>
  );
}
