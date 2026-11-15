"use client";

import { FormEvent, useEffect, useState } from "react";

const EMBEDDED_CALENDAR_OWNERS = new Set(["Jai Toor", "Chirag Toprani"]);

function isCalendlyUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "calendly.com";
  } catch {
    return false;
  }
}

function CalendarEmbed({ bookingUrl, ownerName }: { bookingUrl: string; ownerName: string }) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
  }, [bookingUrl]);

  useEffect(() => {
    if (loaded) return;
    const timer = window.setTimeout(() => setSlow(true), 5_000);
    return () => window.clearTimeout(timer);
  }, [bookingUrl, loaded]);

  return (
    <div className="calendar-embed">
      <a
        className="calendar-cta"
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${ownerName} calendar in a new tab`}
      >
        Open calendar in a new tab<span aria-hidden="true"> ↗</span>
      </a>
      <div className="calendar-frame">
        {!loaded && (
          <div className="calendar-loading" role="status" aria-live="polite">
            {slow
              ? "Calendar couldn’t load here — open it in a new tab."
              : `Loading ${ownerName}’s available times…`}
          </div>
        )}
        <iframe
          src={bookingUrl}
          title={`Book time with ${ownerName}`}
          loading="eager"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setSlow(true)}
        />
      </div>
    </div>
  );
}

export type Result = {
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
  enrichment?: {
    leadId: string;
    status: "pending" | "completed" | "failed" | "unavailable";
  };
};

export function InboundRouting({
  initialResult = null,
  initialEmail = "",
}: {
  initialResult?: Result | null;
  initialEmail?: string;
} = {}) {
  const [email, setEmail] = useState(initialEmail);
  const [emailAccepted, setEmailAccepted] = useState(false);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [progressSaved, setProgressSaved] = useState(false);
  const [result, setResult] = useState<Result | null>(initialResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [demoSession, setDemoSession] = useState<string | null>(null);
  let bookingUrl = result?.route.owner.bookingUrl ?? '';
  if (demoSession && isCalendlyUrl(bookingUrl)) {
    const tracked = new URL(bookingUrl);
    tracked.searchParams.set('utm_source', 'deepline-demo');
    tracked.searchParams.set('utm_content', demoSession);
    bookingUrl = tracked.toString();
  }
  const hasEmbeddedCalendar = Boolean(
    result &&
    EMBEDDED_CALENDAR_OWNERS.has(result.route.owner.name) &&
    isCalendlyUrl(result.route.owner.bookingUrl),
  );
  useEffect(() => {
    const leadId = result?.enrichment?.leadId;
    if (!leadId || result.enrichment?.status === "completed") return;
    if (result.enrichment?.status === "failed" || result.enrichment?.status === "unavailable")
      return;
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
                  route: current.route,
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
      if (!emailAccepted) {
        const response = await fetch("/api/inbound-lead/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const captured = await response.json();
        if (!response.ok) throw new Error(captured.error || "Could not save your progress.");
        setCaptureId(captured.captureId);
        setProgressSaved(captured.persisted === true);
        setEmailAccepted(true);
        return;
      }
      const activeSession = dryRun ? (demoSession || `inbound-demo-${crypto.randomUUID()}`) : null;
      if (activeSession) {
        setDemoSession(activeSession);
        const started = await fetch('/api/booking-demo/start', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session_id: activeSession, email, dry_run: true }),
        });
        const receipt = await started.json();
        if (!started.ok) throw new Error(receipt.error || 'Could not start the cloud timer.');
      }
      const response = await fetch("/api/inbound-lead/qualify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, captureId, dryRun }),
      });
      const payload = (await response.json()) as Result & { error?: string };
      if (!response.ok || !payload.route)
        throw new Error(payload.error || "Could not qualify this lead.");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not qualify this lead.");
    } finally {
      setBusy(false);
    }
  }
  if (result)
    return (
      <section className="card result">
        {demoSession && <div role="status" style={{padding:16,background:'#f4f3ff',marginBottom:16}}>
          <b>30-minute cloud check started</b>
          <p>Leave this calendar unbooked. Deepline will log the result. No follow-up email is sent.</p>
          <small>Session: {demoSession}</small>
        </div>}
        <div className="company match-company">
          {result.company.logoUrl && (
            <img src={result.company.logoUrl} alt="" />
          )}
          <div>
            <small>{result.route.isFallback ? "Backup calendar" : "Demo host matched"}</small>
            <strong>{result.company.name || result.company.domain}</strong>
          </div>
        </div>
        <section className="owner" aria-label="Your routed Deepline expert">
          <div>
            <small>Your Deepline host</small>
            <h2>{result.route.owner.name}</h2>
            <p><strong>Why this host</strong> · {result.trace.routing.appliedRule}</p>
            <p className="owner-copy">Choose a time to meet.</p>
          </div>
          {!hasEmbeddedCalendar && (
            <a className="calendar-cta" href={bookingUrl} target="_blank" rel="noopener noreferrer">
              Open calendar in a new tab ↗
            </a>
          )}
          {hasEmbeddedCalendar && (
            <CalendarEmbed bookingUrl={bookingUrl} ownerName={result.route.owner.name} />
          )}
        </section>
        {result.enrichment?.status === "pending" && (
          <p className="match-progress" role="status">Checking for more details while you book.</p>
        )}
        <details className="evidence match-details">
          <summary>What Deepline checked</summary>
          <div className="evidence-grid">
            {result.contact && (
              <span>HubSpot <b>{result.contact.hubspotCompanyMatched || result.contact.hubspotContactMatched
                ? "Existing record found"
                : result.contact.hubspotCompanyUnavailable || result.contact.hubspotContactUnavailable
                  ? "Lookup unavailable" : "No existing record found"}</b></span>
            )}
            {result.person?.title && <span>Role <b>{result.person.title}</b></span>}
            {result.company.industry && <span>Industry <b>{result.company.industry}</b></span>}
            {(result.company.employeeCount !== null || result.company.employeeRange) && (
              <span>Company size <b>{result.company.employeeCount?.toLocaleString() ?? result.company.employeeRange}</b></span>
            )}
            {result.company.salesTeamSize !== null && (
              <span>Sales team <b>{result.company.salesTeamSize.toLocaleString()}</b></span>
            )}
          </div>
          <p>Deepline checks for an existing relationship first. For new accounts, company size,
            role, and industry help it choose a host. A backup calendar is available within
            five seconds if the checks are still running.</p>
          {result.trace.waterfalls?.some(({ attempts }) => attempts.length) && (
            <details className="provider-details">
              <summary>Provider activity</summary>
              {result.trace.waterfalls.map(({ entity, attempts }) => (
                <div className="waterfall-lane" key={entity}>
                  <h3>{entity === "company" ? "Company" : "Person"}</h3>
                  {attempts.map((attempt) => (
                    <div className="waterfall-step" key={attempt.order}>
                      <div>
                        <b>{attempt.provider}</b>
                        <small>{attempt.detail}</small>
                      </div>
                      <div className="waterfall-outcome">
                        <em data-status={attempt.status}>{attempt.status}</em>
                        {attempt.durationMs > 0 && <small>{attempt.durationMs} ms</small>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </details>
          )}
        </details>
        <button
          onClick={() => {
            setResult(null);
            setDemoSession(null);
            setEmailAccepted(false);
            setCaptureId(null);
          }}
        >
          Start over
        </button>
      </section>
    );
  return (
    <form className="card" onSubmit={submit}>
      <small>REALTIME ROUTING</small>
      <h2>Find your Deepline person.</h2>
      <p>Start with your work email. Then we’ll find the right calendar.</p>
      <label>
        Work email
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="avery@company.com"
          value={email}
          readOnly={emailAccepted}
          onChange={(event) => { setEmail(event.target.value); setDemoSession(null); }}
        />
      </label>
      {emailAccepted && (
        <button
          type="button"
          onClick={() => {
            setEmailAccepted(false);
            setCaptureId(null);
          }}
        >
          Change email
        </button>
      )}
      {emailAccepted && (
        <>
          <p>
            {progressSaved
              ? "Email saved for 24 hours. Submit below to request a demo and follow-up."
              : "Progress isn’t saved on this demo. Submit below to request a demo and follow-up."}
          </p>
        </>
      )}
      {!emailAccepted && (
        <p>
          Continue shares your email. Follow-up starts only after you request a demo.
        </p>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {emailAccepted && <label style={{display:'flex',alignItems:'start',gap:10}}>
        <input type="checkbox" checked={dryRun} onChange={event=>{ setDryRun(event.target.checked); if (!event.target.checked) setDemoSession(null); }} style={{width:'auto'}} />
        <span>Test the 30-minute follow-up check. Internal test email only; no messages or CRM updates.</span>
      </label>}
      {busy && emailAccepted && (
        <div className="routing-status" aria-live="polite">
          <b>Finding the fastest path</b>
          <span>Checking account ownership, company data, and rep fit.</span>
          <span>We’ll always give you a person to book with.</span>
        </div>
      )}
      <button disabled={busy}>
        {busy ? "Working…" : emailAccepted ? "Request a demo →" : "Continue →"}
      </button>
    </form>
  );
}
