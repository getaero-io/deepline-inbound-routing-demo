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
        <h1>Meet your Deepline demo host.</h1>
        <p>Enter your work email to see who you’ll meet, why they’re a fit, and when you can book.</p>
      </section>
      <InboundRouting initialEmail={initialEmail} />
    </main>
  );
}
