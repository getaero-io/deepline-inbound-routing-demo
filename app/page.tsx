import { InboundRouting } from "./routing";

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ email?: string | string[] }>;
}) {
  const query = await searchParams;
  const initialEmail = typeof query?.email === "string" ? query.email.slice(0, 254) : "";
  return (
    <main className="shell">
      <section className="copy">
        <span>DEEPLINE</span>
        <h1>
          Find your demo host.
          <br />
          <em>See why they matched.</em>
        </h1>
        <p>
          Enter your work email to see who you’ll meet, what informed the match,
          and which calendar to book.
        </p>
        <ul>
          <li>An existing HubSpot owner takes priority.</li>
          <li>For eligible new leads, industry and specialty help choose the host.</li>
          <li>A backup calendar opens if qualification takes too long.</li>
        </ul>
      </section>
      <InboundRouting initialEmail={initialEmail} />
    </main>
  );
}
