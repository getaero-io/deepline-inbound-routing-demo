"use client";

import { FormEvent, useEffect, useState } from "react";

type Result = {
  company: {
    name: string | null;
    domain: string;
    employeeCount: number | null;
    logoUrl: string | null;
    auth?: {
      provider: string | null;
      confidence: "high" | "medium" | "none";
      source: "technology_profile" | "public_site" | "none";
      detail: string;
    };
    fullProfile?: Record<string, unknown>;
  };
  route: {
    owner: { name: string; bookingUrl: string };
    isFallback?: boolean;
  };
  qualification: { fitScore: number; tier: string; signals: string[] };
  person?: {
    fullName: string | null;
    email: string;
    title: string | null;
    seniority: string | null;
    role: string | null;
    location: string | null;
    linkedinUrl: string | null;
    enrichmentSource: string;
    fullProfile?: Record<string, unknown>;
  } | null;
  contact?: {
    title: string | null;
    revenue: string | null;
    calendar: string;
    calendarOwner: string;
    source: string;
    identityStatus: "verified" | "not_verified";
    hubspotSync?: "pending" | "updated" | "not_needed" | "not_applicable" | "failed";
  };
  trace: {
    providers: Array<{ name: string; status: string; detail: string }>;
    routing: {
      appliedRule: string;
      priorityScore: number;
      title: string | null;
      company: {
        employeeCount: number | null;
        salesTeamSize: number | null;
        industry: string | null;
        location: string | null;
        technologies: string[];
      };
      attributes?: Array<{ name: string; value: string }>;
    };
  };
  elapsedMs: number;
  enrichment?: { leadId: string; status: "pending" | "completed" | "failed" | "unavailable" };
};

export function InboundRouting() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isChiragRoute = result?.route.owner.name === "Chirag Toprani";
  useEffect(() => {
    const leadId = result?.enrichment?.leadId;
    if (!leadId || result.enrichment?.status === "completed") return;
    if (result.enrichment?.status === "failed" || result.enrichment?.status === "unavailable") return;
    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;
    const poll = async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/inbound-lead/enrichment/${leadId}`, {
          cache: "no-store",
        });
        const update = (await response.json().catch(() => ({}))) as Partial<Result> & {
          status?: "pending" | "completed" | "failed" | "unavailable";
          error?: string;
        };
        if (cancelled) return;
        if (update.status === "completed") {
          setResult((current) =>
            current
              ? {
                  ...current,
                  ...update,
                  company: update.company ?? current.company,
                  qualification: update.qualification ?? current.qualification,
                  person: update.person ?? current.person,
                  contact: update.contact ?? current.contact,
                  trace: update.trace ?? current.trace,
                  enrichment: { leadId, status: "completed" },
                }
              : current,
          );
          return;
        }
        if (update.status === "failed" || update.status === "unavailable" || attempts >= 18) {
          setResult((current) =>
            current
              ? {
                  ...current,
                  enrichment: {
                    leadId,
                    status: update.status === "unavailable" ? "unavailable" : "failed",
                  },
                  trace: update.trace ?? current.trace,
                }
              : current,
          );
          return;
        }
      } catch {
        if (attempts >= 18 && !cancelled) {
          setResult((current) =>
            current ? { ...current, enrichment: { leadId, status: "unavailable" } } : current,
          );
          return;
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, Math.min(2_500, 700 + attempts * 120));
    };
    timer = window.setTimeout(poll, 700);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [result?.enrichment?.leadId, result?.enrichment?.status]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/inbound-lead/qualify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Result & { error?: string };
      if (!response.ok || !payload.route)
        throw new Error(payload.error || "Could not qualify this lead.");
      setResult(payload);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not qualify this lead.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (result)
    return (
      <section className="card result">
        <div className="success">
          {result.route.isFallback
            ? "ROUTE RESERVED"
            : `ROUTED IN ${(result.elapsedMs / 1000).toFixed(1)}S`}
        </div>
        <div className="company">
          {result.company.logoUrl ? (
            <img src={result.company.logoUrl} alt="" />
          ) : (
            <b>{(result.company.name || result.company.domain)[0]}</b>
          )}
          <div>
            <small>{result.company.domain}</small>
            <h2>{result.company.name || "Your company"}</h2>
          </div>
        </div>
        <div className="score">
          <span>
            {result.route.isFallback ? "Verification status" : "Live fit score"}
          </span>
          <strong>
            {result.route.isFallback
              ? "You’re connected — details can follow"
              : `${result.qualification.fitScore}/100 · ${result.qualification.tier.replace("_", " ")}`}
          </strong>
          <i>
            <b style={{ width: `${result.qualification.fitScore}%` }} />
          </i>
          <p>
            {result.qualification.signals.join(" · ") ||
              "Limited public signals"}
          </p>
        </div>
        {result.enrichment?.status === "pending" && (
          <div className="routing-status" aria-live="polite">
            <b>Route is ready. Verification is still arriving.</b>
            <span>We’ll add the company profile here automatically.</span>
          </div>
        )}
        {(result.enrichment?.status === "failed" || result.enrichment?.status === "unavailable") && (
          <div className="routing-status" aria-live="polite">
            <b>Your booking route is ready.</b>
            <span>
              Company verification did not finish. Your route was kept available instead of blocking you.
            </span>
          </div>
        )}
        <section className="owner" aria-label="Your routed Deepline expert">
          <div>
            <small>
              {result.route.isFallback
                ? "Your verified handoff"
                : "Your Deepline expert"}
            </small>
            <h2>{result.route.owner.name}</h2>
            <p className="owner-copy">
              {isChiragRoute
                ? "Choose a time below—your routing is complete."
                : "Your route is ready. Choose a time that works for you."}
            </p>
          </div>
          {!isChiragRoute && (
            <a
              href={result.route.owner.bookingUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open calendar →
            </a>
          )}
          {isChiragRoute && (
            <div className="calendar-embed">
              <iframe
                src={result.route.owner.bookingUrl}
                title="Book time with Chirag Toprani"
                loading="eager"
              />
              <a href={result.route.owner.bookingUrl} target="_blank" rel="noreferrer">
                Open Chirag’s calendar in a new tab →
              </a>
            </div>
          )}
        </section>
        {result.company.auth && (
          <section className="evidence" aria-label="Authentication stack fingerprint">
            <small>AUTHENTICATION STACK</small>
            <h3>{result.company.auth.provider ?? "No provider found"}</h3>
            <p>{result.company.auth.detail}</p>
            <div className="evidence-grid">
              <span>Confidence <b>{result.company.auth.confidence}</b></span>
              <span>Source <b>{result.company.auth.source.replace("_", " ")}</b></span>
            </div>
          </section>
        )}
        {result.person && (
          <details className="evidence person-enrichment" open>
            <summary>Verified person profile</summary>
            <div className="evidence-grid">
              <span>Title <b>{result.person.title || "Not returned"}</b></span>
              <span>Seniority <b>{result.person.seniority || "Not returned"}</b></span>
              <span>Role <b>{result.person.role || "Not returned"}</b></span>
              <span>Location <b>{result.person.location || "Not returned"}</b></span>
              <span>Source <b>{result.person.enrichmentSource}</b></span>
              <span>Identity <b>Work email verified</b></span>
            </div>
            {result.person.linkedinUrl && (
              <a href={result.person.linkedinUrl} target="_blank" rel="noreferrer">
                View public profile →
              </a>
            )}
          </details>
        )}
        {result.contact && (
          <details className="evidence contact-enrichment" open>
            <summary>Contact verification</summary>
            <p className={`contact-verdict ${result.contact.identityStatus}`}>
              {result.contact.identityStatus === "verified"
                ? `Verified person · ${result.contact.source}`
                : "Company verified · no exact person profile returned for this work email"}
            </p>
            <div className="evidence-grid">
              <span>Email identity <b>{result.contact.identityStatus === "verified" ? "Exact work-email match" : "Not verified"}</b></span>
              <span>Title <b>{result.contact.identityStatus === "verified" ? result.contact.title || "Not returned" : "Not verified"}</b></span>
              <span>Company revenue <b>{result.contact.revenue || "Not returned by sources"}</b></span>
              <span>Calendar offered <b>{result.contact.calendarOwner}</b></span>
              <span>HubSpot sync <b>{result.contact.hubspotSync === "updated" ? "Updated without overwriting existing fields" : result.contact.hubspotSync === "not_needed" ? "Already complete" : result.contact.hubspotSync === "failed" ? "Needs retry" : result.contact.hubspotSync === "pending" ? "Syncing missing fields" : "No existing contact to update"}</b></span>
            </div>
            {result.contact.identityStatus === "not_verified" && (
              <p className="contact-note">The route uses verified company and CRM signals only. We do not infer a title, seniority, or person record without an exact email match.</p>
            )}
          </details>
        )}
        <details className="evidence">
          <summary>Show live routing evidence</summary>
          <h3>Parallel APIs</h3>
          {result.trace.providers.map((provider) => (
            <div className="evidence-row" key={provider.name}>
              <b>{provider.name}</b>
              <em>{provider.status.replace("_", " ")}</em>
              <small>{provider.detail}</small>
            </div>
          ))}
          <h3>Applied rule</h3>
          <p>{result.trace.routing.appliedRule}</p>
          <div className="evidence-grid">
            <span>
              Priority <b>{result.trace.routing.priorityScore}/100</b>
            </span>
            <span>
              Title <b>{result.trace.routing.title || "Not returned"}</b>
            </span>
            <span>
              People{" "}
              <b>
                {result.trace.routing.company.employeeCount?.toLocaleString() ||
                  "Not returned"}
              </b>
            </span>
            <span>
              Sales team{" "}
              <b>
                {result.trace.routing.company.salesTeamSize?.toLocaleString() ||
                  "Not returned"}
              </b>
            </span>
            <span>
              Geo{" "}
              <b>{result.trace.routing.company.location || "Not returned"}</b>
            </span>
            <span>
              Industry{" "}
              <b>{result.trace.routing.company.industry || "Not returned"}</b>
            </span>
            <span>
              Auth <b>{result.company.auth?.provider ?? "Checking…"}</b>
            </span>
          </div>
          {result.trace.routing.attributes && (
            <>
              <h3>Routing attributes</h3>
              <div className="evidence-grid">
                {result.trace.routing.attributes.map((attribute) => (
                  <span key={attribute.name}>
                    {attribute.name} <b>{attribute.value}</b>
                  </span>
                ))}
              </div>
            </>
          )}
        </details>
        {result.company.fullProfile && (
          <details className="evidence full-enrichment">
          <summary>Full company payload (advanced)</summary>
            <p>
              Every returned field used to verify this company. No provider key
              or internal credential is included.
            </p>
            <pre>{JSON.stringify(result.company.fullProfile, null, 2)}</pre>
          </details>
        )}
        {result.person?.fullProfile && (
          <details className="evidence full-enrichment">
            <summary>Full person enrichment payload</summary>
            <p>Only an exact work-email match is shown here.</p>
            <pre>{JSON.stringify(result.person.fullProfile, null, 2)}</pre>
          </details>
        )}
        <details className="evidence routing-logic">
          <summary>How this route was chosen</summary>
          <ol>
            <li>A confirmed HubSpot owner always wins and keeps the relationship intact.</li>
            <li>Existing customers and deployment roles go to Anand.</li>
            <li>GTM roles, sales teams over 20, or companies with 250+ people go to Jai.</li>
            <li>Other verified companies go to Chirag.</li>
            <li>If no confident route is available within five seconds, Anand is the safe default while enrichment continues.</li>
          </ol>
        </details>
        <button onClick={() => setResult(null)}>Start over</button>
      </section>
    );
  return (
    <form className="card" onSubmit={submit}>
      <small>REALTIME ROUTING</small>
      <h2>Find your Deepline person.</h2>
      <p>Share your name and work email. We’ll handle the rest.</p>
      <label>
        First name
        <input name="firstName" required placeholder="Avery" />
      </label>
      <label>
        Last name
        <input name="lastName" required placeholder="Morgan" />
      </label>
      <label>
        Work email
        <input
          name="email"
          type="email"
          required
          placeholder="avery@company.com"
        />
      </label>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {busy && (
        <div className="routing-status" aria-live="polite">
          <b>Finding the fastest path</b>
          <span>Checking your account, company, and existing owner in parallel.</span>
          <span>We’ll always give you a person to book with.</span>
        </div>
      )}
      <button disabled={busy}>
        {busy ? "Finding your person…" : "Find my person →"}
      </button>
    </form>
  );
}
