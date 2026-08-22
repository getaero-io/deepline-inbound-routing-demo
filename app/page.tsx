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
          <li>Usually ready in under two seconds</li>
          <li>Work email only — no company form field</li>
          <li>Existing account ownership stays intact</li>
        </ul>
      </section>
      <InboundRouting />
    </main>
  );
}
