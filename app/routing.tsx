"use client";

import { FormEvent, useEffect, useState } from "react";

import { authProviderLabel } from "../lib/presentation";

type Result = {
  company: {
    name: string | null;
    domain: string;
    employeeCount: number | null;
    employeeRange: string | null;
    salesTeamSize: number | null;
    revenue: string | null;
    industry: string | null;
    location: string | null;
    technologies: string[];
    enrichmentSource: string;
    logoUrl: string | null;
    auth?: {
      provider: string | null;
      confidence: "high" | "medium" | "none";
      source: "technology_profile" | "public_site" | "public_auth_endpoint" | "none";
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
    hubspotContactMatched: boolean;
    hubspotCompanyMatched: boolean;
    hubspotContactUnavailable: boolean;
    hubspotCompanyUnavailable: boolean;
  };
  trace: {
    waterfalls?: Array<{
      entity: "company" | "person";
      attempts: Array<{
        order: number;
        provider: string;
        tool: string;
        status: "hit" | "partial" | "miss" | "error" | "skipped" | "pending";
        durationMs: number;
        detail: string;
      }>;
    }>;
    providers: Array<{ name: string; status: string; detail: string }>;
    routing: {
      appliedRule: string;
      priorityScore: number;
      title: string | null;
      company: {
        employeeCount: number | null;
        employeeRange: string | null;
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
          signal: AbortSignal.timeout(2_500),
        });
        const update = (await response.json().catch(() => ({}))) as Partial<Result> & {
          status?: "pending" | "completed" | "failed" | "unavailable";
          error?: string;
        };
        if (cancelled) return;
        const pollStatus = update.enrichment?.status ?? update.status;
        if (pollStatus === "completed") {
          setResult((current) =>
            current
              ? {
                  ...current,
                  ...update,
                  company: update.company ?? current.company,
                  qualification: update.qualification ?? current.qualification,
                  person: update.person ?? current.person,
                  contact: update.contact ?? current.contact,
                  route: update.route ?? current.route,
                  trace: update.trace ?? current.trace,
                  // Late enrichment must not rewrite how long the booking route took.
                  elapsedMs: current.elapsedMs,
                  enrichment: { leadId, status: "completed" },
                }
              : current,
          );
          return;
        }
        if (pollStatus === "pending" && (update.company || update.person || update.contact)) {
          setResult((current) =>
            current
              ? {
                  ...current,
                  company: update.company ?? current.company,
                  qualification: update.qualification ?? current.qualification,
                  person: update.person ?? current.person,
                  contact: update.contact ?? current.contact,
                  trace: update.trace ?? current.trace,
                  enrichment: { leadId, status: "pending" },
                }
              : current,
          );
        }
        if (pollStatus === "failed" || pollStatus === "unavailable" || attempts >= 18) {
          setResult((current) =>
            current
              ? {
                  ...current,
                  enrichment: {
                    leadId,
                    status: pollStatus === "unavailable" ? "unavailable" : "failed",
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
            <img
              src={result.company.logoUrl}
              alt={`${result.company.name || result.company.domain} logo`}
            />
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
              className="calendar-cta"
              href={result.route.owner.bookingUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open calendar in a new tab ↗
            </a>
          )}
          {isChiragRoute && (
            <div className="calendar-embed">
              <iframe
                src={result.route.owner.bookingUrl}
                title="Book time with Chirag Toprani"
                loading="eager"
              />
              <a
                className="calendar-cta"
                href={result.route.owner.bookingUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open calendar in a new tab ↗
              </a>
            </div>
          )}
        </section>
        {result.trace.waterfalls && (
          <details className="evidence sdk-waterfall" open>
            <summary>Deepline SDK waterfall</summary>
            <p>
              Company and contact checks run together. Inside each lane,
              People Data Labs runs only when CrustData does not return a usable match.
            </p>
            {result.trace.waterfalls.map((waterfall) => (
              <div className="waterfall-lane" key={waterfall.entity}>
                <h3>{waterfall.entity} enrichment</h3>
                {waterfall.attempts.map((attempt) => (
                  <div className="waterfall-step" key={`${waterfall.entity}-${attempt.order}`}>
                    <span className="waterfall-order">{attempt.order}</span>
                    <div>
                      <b>{attempt.provider}</b>
                      <code>{attempt.tool}</code>
                      <small>{attempt.detail}</small>
                    </div>
                    <div className="waterfall-outcome">
                      <em data-status={attempt.status}>{attempt.status}</em>
                      {attempt.durationMs > 0 && <small>{attempt.durationMs}ms</small>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <p className="sdk-note">
              Every provider call above uses <code>deepline.tools.execute()</code>.
              Provider credentials stay in the Deepline workspace.
            </p>
          </details>
        )}
        {result.person && (
          <details className="evidence person-enrichment" open>
            <summary>Live contact enrichment</summary>
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
        <details className="evidence company-enrichment" open>
          <summary>Live company enrichment</summary>
          <div className="evidence-grid">
            <span>People <b>{result.company.employeeRange ?? result.company.employeeCount?.toLocaleString() ?? "Not returned"}</b></span>
            <span>Sales team <b>{result.company.salesTeamSize?.toLocaleString() ?? "Not returned"}</b></span>
            <span>Revenue <b>{result.company.revenue ?? "Not returned"}</b></span>
            <span>Industry <b>{result.company.industry || "Not returned"}</b></span>
            <span>Geo <b>{result.company.location || "Not returned"}</b></span>
            <span>Technology <b>{result.company.technologies.join(", ") || "Not returned"}</b></span>
            <span>Source <b>{result.company.enrichmentSource}</b></span>
          </div>
        </details>
        {result.contact && (
          <details className="evidence" open>
            <summary>HubSpot record</summary>
            <div className="evidence-grid">
              <span>CRM contact <b>{result.contact.hubspotContactMatched ? "Matched" : result.contact.hubspotContactUnavailable ? "Lookup unavailable" : "No matching contact"}</b></span>
              <span>CRM account <b>{result.contact.hubspotCompanyMatched ? "Matched" : result.contact.hubspotCompanyUnavailable ? "Lookup unavailable" : "No matching account"}</b></span>
              <span>Fill-only sync <b>{result.contact.hubspotSync === "updated" ? "Updated missing fields" : result.contact.hubspotSync === "not_needed" ? "Already complete" : result.contact.hubspotSync === "failed" ? "Needs retry" : result.contact.hubspotSync === "pending" ? "In progress" : "Not applicable"}</b></span>
            </div>
            <p className="contact-note">CRM fields stay separate from live enrichment. When a contact exists, only empty supported fields are filled; populated fields are never overwritten.</p>
          </details>
        )}
        {result.company.auth && (
          <details className="evidence" aria-label="Optional authentication stack fingerprint">
            <summary>Optional custom signal · authentication stack</summary>
            <h3>{result.company.auth.provider ?? "No public fingerprint found"}</h3>
            <p>{result.company.auth.detail}</p>
            <div className="evidence-grid">
              <span>Confidence <b>{result.company.auth.confidence}</b></span>
              <span>Source <b>{result.company.auth.source.replaceAll("_", " ")}</b></span>
            </div>
          </details>
        )}
        <details className="evidence">
          <summary>Show live routing evidence</summary>
          <h3>Supporting checks</h3>
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
                {result.trace.routing.company.employeeRange ??
                  result.trace.routing.company.employeeCount?.toLocaleString() ??
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
              Auth{" "}
              <b>
                {authProviderLabel(
                  result.company.auth,
                  result.enrichment?.status,
                )}
              </b>
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
              Complete selected provider payload. The fields above are
              reconciled from this source; no provider key or internal
              credential is included.
            </p>
            <pre>{JSON.stringify(result.company.fullProfile, null, 2)}</pre>
          </details>
        )}
        {result.person?.fullProfile && (
          <details className="evidence full-enrichment">
            <summary>Professional contact payload</summary>
            <p>
              Only professional fields from an exact work-email match are
              requested and shown. Personal emails and phone numbers never
              reach the browser.
            </p>
            <pre>{JSON.stringify(result.person.fullProfile, null, 2)}</pre>
          </details>
        )}
        <details className="evidence routing-logic">
          <summary>How this route was chosen</summary>
          <ol>
            <li>A confirmed HubSpot owner always wins and keeps the relationship intact.</li>
            <li>Existing customers go to Anand.</li>
            <li>Sales teams over 20 or companies with 250+ people go to Jai.</li>
            <li>Deployment roles go to Anand; GTM systems roles go to Jai.</li>
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
          <span>Checking HubSpot while Deepline runs CrustData → PDL on misses.</span>
          <span>We’ll always give you a person to book with.</span>
        </div>
      )}
      <button disabled={busy}>
        {busy ? "Finding your person…" : "Find my person →"}
      </button>
    </form>
  );
}
