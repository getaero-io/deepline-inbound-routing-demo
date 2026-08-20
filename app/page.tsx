import { InboundRouting } from "./routing";

export default function Page() {
  return (
    <main className="shell">
      <section className="copy">
        <span>DEEPLINE / INBOUND</span>
        <h1>
          The right meeting.
          <br />
          <em>Before the tab closes.</em>
        </h1>
        <p>
          Live company signals, HubSpot ownership, deterministic qualification,
          then the right calendar.
        </p>
        <ul>
          <li>HubSpot ownership is preserved</li>
          <li>20+ sales team, enterprise, and GTM roles route to Jai</li>
          <li>Existing customers and deployment roles route to Anand</li>
          <li>SMB and incomplete profiles route to Chirag</li>
        </ul>
      </section>
      <InboundRouting />
    </main>
  );
}
