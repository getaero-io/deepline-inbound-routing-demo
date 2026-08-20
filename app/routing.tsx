"use client";

import { FormEvent, useState } from "react";

type Result = {
  company: {
    name: string | null;
    domain: string;
    employeeCount: number | null;
    logoUrl: string | null;
  };
  route: { owner: { name: string; bookingUrl: string } };
  qualification: { fitScore: number; tier: string; signals: string[] };
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
    };
  };
  elapsedMs: number;
};

export function InboundRouting() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          ROUTED IN {(result.elapsedMs / 1000).toFixed(1)}S
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
          <span>Live fit score</span>
          <strong>
            {result.qualification.fitScore}/100 ·{" "}
            {result.qualification.tier.replace("_", " ")}
          </strong>
          <i>
            <b style={{ width: `${result.qualification.fitScore}%` }} />
          </i>
          <p>
            {result.qualification.signals.join(" · ") ||
              "Limited public signals"}
          </p>
        </div>
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
          </div>
        </details>
        <div className="owner">
          <div>
            <small>Your Deepline expert</small>
            <h2>{result.route.owner.name}</h2>
          </div>
          <a
            href={result.route.owner.bookingUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open calendar →
          </a>
        </div>
        <button onClick={() => setResult(null)}>Start over</button>
      </section>
    );
  return (
    <form className="card" onSubmit={submit}>
      <small>REALTIME ROUTING</small>
      <h2>Find my person.</h2>
      <p>All signals run concurrently. Routing has a 4.8-second ceiling.</p>
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
      <label>
        Company <em>optional</em>
        <input name="company" placeholder="Acme" />
      </label>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <button disabled={busy}>
        {busy ? "Resolving live signals…" : "Find my person →"}
      </button>
    </form>
  );
}
