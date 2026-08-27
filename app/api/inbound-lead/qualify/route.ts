import { after, NextResponse } from "next/server";

import type {
  CompanyProfile,
  CompanyWaterfallResult,
  PersonWaterfallResult,
  WaterfallTrace,
} from "../../../../lib/contracts";
import {
  authFromTechnologies,
  detectAuthProvider,
  type AuthFingerprint,
} from "../../../../lib/auth-fingerprint";
import { startPlay } from "../../../../lib/deepline";
import { enrichCompany, enrichPerson } from "../../../../lib/enrichment";
import {
  fillMissingHubSpotFields,
  lookupHubSpot,
  type HubSpotResult,
} from "../../../../lib/hubspot";
import {
  CALENDARS,
  configuredOwner,
  resolveFastEnrichmentRoute,
  routeLead,
} from "../../../../lib/routing";

export const runtime = "nodejs";

const ROUTE_DEADLINE_MS = 4_800;
const AUTH_DEADLINE_MS = 3_200;
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "live.com",
  "msn.com",
  "me.com",
  "ymail.com",
]);

const EMPTY_CRM: HubSpotResult & { unavailable: boolean } = {
  ownerId: null,
  existingCustomer: false,
  title: null,
  contactId: null,
  contactProperties: null,
  revenue: null,
  contactMatched: false,
  companyMatched: false,
  contactUnavailable: true,
  companyUnavailable: true,
  matched: false,
  unavailable: true,
};

const NO_AUTH: AuthFingerprint = {
  provider: null,
  confidence: "none",
  source: "none",
  detail: "No public authentication-provider fingerprint detected",
};

type RouteDecision = ReturnType<typeof routeLead> & { isFallback: boolean };
type HubSpotSync =
  | "pending"
  | "updated"
  | "not_needed"
  | "not_applicable"
  | "failed";

class RouteDeadlineError extends Error {
  constructor() {
    super("Routing deadline reached");
    this.name = "RouteDeadlineError";
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function brandLogo(domain: string) {
  const client = process.env.INBOUND_DEMO_BRANDFETCH_CLIENT_ID?.trim();
  return client
    ? `https://cdn.brandfetch.io/domain/${encodeURIComponent(domain)}/h/128/w/128/theme/light/fallback/404/icon?c=${encodeURIComponent(client)}`
    : null;
}

function hasBackgroundStore() {
  return Boolean(
    process.env.KV_REST_API_URL?.trim() && process.env.KV_REST_API_TOKEN?.trim(),
  );
}

async function withinDeadline<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expires = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new RouteDeadlineError()), Math.max(1, ms));
  });
  try {
    return await Promise.race([promise, expires]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function saveEnrichment(leadId: string, value: Record<string, unknown>) {
  const url = process.env.KV_REST_API_URL?.replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) return;
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      ["SET", `inbound-enrichment:${leadId}`, JSON.stringify(value), "EX", "900"],
    ]),
    signal: AbortSignal.timeout(1_800),
  });
  if (!response.ok) throw new Error("Could not save enrichment status.");
}

function pendingWaterfall(entity: "company" | "person") {
  return {
    entity,
    attempts: [
      {
        order: 1,
        provider: "CrustData",
        tool:
          entity === "company"
            ? "crustdata_v3_company_enrich"
            : "crustdata_v2_enrich_person",
        status: "pending",
        durationMs: 0,
        detail: "The primary Deepline SDK step is still running.",
      },
      {
        order: 2,
        provider: "People Data Labs",
        tool:
          entity === "company"
            ? "peopledatalabs_enrich_company"
            : "peopledatalabs_enrich_contact",
        status: "pending",
        durationMs: 0,
        detail: "Runs only if the CrustData step does not return a usable match.",
      },
    ],
  } as const;
}

function waterfallSummary(
  trace: WaterfallTrace | ReturnType<typeof pendingWaterfall>,
) {
  const hit = trace.attempts.find((attempt) => attempt.status === "hit");
  if (hit) return `${hit.provider} returned the selected ${trace.entity} profile.`;
  const partial = trace.attempts.find((attempt) => attempt.status === "partial");
  if (partial)
    return `${partial.provider} returned a verified partial ${trace.entity} profile.`;
  if (trace.attempts.some((attempt) => attempt.status === "pending"))
    return `${trace.entity === "company" ? "Company" : "Contact"} enrichment is still running.`;
  return `The ${trace.entity} waterfall completed without a usable match.`;
}

function crmRecordSummary(
  label: "Contact" | "Account",
  matched: boolean,
  unavailable: boolean,
) {
  if (unavailable) return `${label} lookup was unavailable.`;
  return matched ? `${label} record matched.` : `No ${label.toLowerCase()} record matched.`;
}

function companyForClient(
  domain: string,
  profile: CompanyProfile | null,
  auth?: AuthFingerprint,
) {
  return {
    name: profile?.name ?? null,
    domain,
    employeeCount: profile?.employeeCount ?? null,
    employeeRange: profile?.employeeRange ?? null,
    salesTeamSize: profile?.salesTeamSize ?? null,
    revenue: profile?.revenue ?? null,
    industry: profile?.industry ?? null,
    location: profile?.location ?? null,
    technologies: profile?.technologies ?? [],
    logoUrl: brandLogo(domain),
    enrichmentSource: profile?.enrichmentSource ?? "No verified company match",
    ...(auth ? { auth } : {}),
    ...(profile ? { fullProfile: profile.fullProfile } : {}),
  };
}

function fallbackDecision(reason: string): RouteDecision {
  return {
    owner: CALENDARS.anand,
    reason,
    fitScore: 0,
    tier: "verification_pending",
    signals: ["Safe calendar fallback reserved"],
    timezone: "Unknown",
    title: null,
    isFallback: true,
  };
}

function makePayload(input: {
  domain: string;
  leadId: string;
  started: number;
  route: RouteDecision;
  crm: HubSpotResult & { unavailable: boolean };
  companyResult: CompanyWaterfallResult | null;
  personResult: PersonWaterfallResult | null;
  auth?: AuthFingerprint;
  hubspotSync: HubSpotSync;
  enrichmentStatus: "pending" | "completed" | "unavailable";
}) {
  const company = input.companyResult?.company ?? null;
  const person = input.personResult?.person ?? null;
  const companyTrace = input.companyResult?.trace ?? pendingWaterfall("company");
  const personTrace = input.personResult?.trace ?? pendingWaterfall("person");
  const title = person?.title ?? input.crm.title;
  const revenue = company?.revenue ?? input.crm.revenue;
  const sdkStatus =
    companyTrace.attempts.some((attempt) => attempt.status === "pending") ||
    personTrace.attempts.some((attempt) => attempt.status === "pending")
      ? "continuing"
      : company || person
        ? "completed"
        : "no_match";

  return {
    company: companyForClient(input.domain, company, input.auth),
    person,
    route: {
      owner: input.route.owner,
      ...(input.route.isFallback ? { isFallback: true } : {}),
    },
    contact: {
      title,
      revenue,
      calendar: input.route.owner.bookingUrl,
      calendarOwner: input.route.owner.name,
      source:
        person?.enrichmentSource ??
        (input.crm.title ? "HubSpot CRM" : "No verified person match"),
      identityStatus: person ? ("verified" as const) : ("not_verified" as const),
      hubspotSync: input.hubspotSync,
      hubspotContactMatched: input.crm.contactMatched,
      hubspotCompanyMatched: input.crm.companyMatched,
      hubspotContactUnavailable: input.crm.contactUnavailable,
      hubspotCompanyUnavailable: input.crm.companyUnavailable,
    },
    qualification: {
      fitScore: input.route.fitScore,
      tier: input.route.tier,
      signals: input.route.signals,
    },
    enrichment: { leadId: input.leadId, status: input.enrichmentStatus },
    trace: {
      waterfalls: [companyTrace, personTrace],
      providers: [
        {
          name: "HubSpot CRM via Deepline SDK",
          status: input.crm.unavailable
            ? "unavailable"
            : input.crm.contactUnavailable || input.crm.companyUnavailable
              ? "partial"
            : input.crm.matched
              ? "matched"
              : "no_match",
          detail: input.crm.unavailable
            ? "CRM was unavailable; routing continued."
            : `${crmRecordSummary(
                "Contact",
                input.crm.contactMatched,
                input.crm.contactUnavailable,
              )} ${crmRecordSummary(
                "Account",
                input.crm.companyMatched,
                input.crm.companyUnavailable,
              )}`,
        },
        {
          name: "Deepline enrichment",
          status: sdkStatus,
          detail: `${waterfallSummary(companyTrace)} ${waterfallSummary(personTrace)}`,
        },
        {
          name: "Authentication fingerprint",
          status: input.auth
            ? input.auth.provider
              ? "matched"
              : "no_match"
            : "deferred",
          detail: input.auth?.detail ?? "Optional public signal runs after routing.",
        },
        {
          name: "Brandfetch Logo CDN",
          status: process.env.INBOUND_DEMO_BRANDFETCH_CLIENT_ID?.trim()
            ? "deferred"
            : "not_configured",
          detail: "Logo loading never delays qualification.",
        },
      ],
      routing: {
        appliedRule: input.route.reason,
        priorityScore: input.route.fitScore,
        title,
        company: {
          employeeCount: company?.employeeCount ?? null,
          employeeRange: company?.employeeRange ?? null,
          salesTeamSize: company?.salesTeamSize ?? null,
          industry: company?.industry ?? null,
          location: company?.location ?? null,
          technologies: company?.technologies ?? [],
        },
        attributes: [
          {
            name: "CRM owner",
            value: configuredOwner(input.crm.ownerId)?.name ?? "No mapped owner",
          },
          {
            name: "Existing customer",
            value: input.crm.existingCustomer ? "Yes" : "No",
          },
          {
            name: "Company size",
            value:
              company?.employeeRange ??
              company?.employeeCount.toLocaleString() ??
              "Not returned",
          },
          {
            name: "Sales team",
            value: company?.salesTeamSize?.toLocaleString() ?? "Not returned",
          },
          { name: "Timezone", value: input.route.timezone },
          { name: "Title", value: title ?? "Not returned" },
          { name: "Industry", value: company?.industry ?? "Not returned" },
          {
            name: "Technology",
            value: company?.technologies.join(", ") || "Not returned",
          },
          {
            name: "Auth provider",
            value:
              input.auth?.provider ??
              (input.auth ? "No provider found" : "Checking…"),
          },
          { name: "Revenue", value: revenue ?? "Not returned" },
          { name: "Lead source", value: "Inbound form" },
          { name: "Campaign", value: "Not collected" },
          { name: "Calendar", value: input.route.owner.name },
        ],
      },
    },
    elapsedMs: Date.now() - input.started,
  };
}

function launchPostRoutePlay(input: Record<string, unknown>) {
  const playName = process.env.INBOUND_DEMO_ASYNC_PLAY_NAME?.trim();
  if (!playName) return Promise.resolve();
  return startPlay(playName, input).then(() => undefined);
}

export async function POST(request: Request) {
  const started = Date.now();
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const firstName = text(body?.firstName);
  const lastName = text(body?.lastName);
  const email = text(body?.email)?.toLowerCase();

  if (
    !firstName ||
    !lastName ||
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    return NextResponse.json(
      { error: "First name, last name, and a valid work email are required." },
      { status: 400 },
    );
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain))
    return NextResponse.json(
      { error: "Use your work email so we can match the right account." },
      { status: 400 },
    );

  const leadId = crypto.randomUUID();
  const crmWork = lookupHubSpot(email, domain)
    .then((result) => ({ ...result, unavailable: false }))
    .catch((error) => {
      console.error("[inbound-routing] HubSpot lookup unavailable", {
        domain,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return EMPTY_CRM;
    });
  const companyWork = enrichCompany(domain);
  const personWork = enrichPerson({ email, firstName, lastName });
  const authWork = withinDeadline(
    companyWork.then(async ({ company }) => {
        const technologySignal = authFromTechnologies(company?.technologies ?? []);
        return technologySignal.provider
          ? technologySignal
          : await detectAuthProvider(domain);
      }),
    AUTH_DEADLINE_MS,
  )
    .catch(() => NO_AUTH);

  let crm = EMPTY_CRM;
  let companyResult: CompanyWaterfallResult | null = null;
  let personResult: PersonWaterfallResult | null = null;
  let route: RouteDecision;

  try {
    crm = await withinDeadline(
      crmWork,
      ROUTE_DEADLINE_MS - (Date.now() - started),
    );
    const owner = configuredOwner(crm.ownerId);
    if (owner || crm.existingCustomer) {
      route = {
        ...routeLead({
          company: null,
          person: null,
          crmTitle: crm.title,
          existingCustomer: crm.existingCustomer,
          owner,
        }),
        isFallback: false,
      };
    } else if (crm.contactUnavailable || crm.companyUnavailable) {
      route = fallbackDecision(
        "HubSpot relationship verification was incomplete, so the safe route goes to Anand rather than bypassing a possible existing owner.",
      );
    } else {
      const resolution = await resolveFastEnrichmentRoute({
        companyWork,
        personWork,
        crmTitle: crm.title,
        timeoutMs: ROUTE_DEADLINE_MS - (Date.now() - started),
      });
      companyResult = resolution.companyResult;
      personResult = resolution.personResult;
      if (!resolution.route) {
        route = fallbackDecision(
          resolution.timedOut
            ? "No high-confidence signal completed within five seconds, so the safe route goes to Anand while enrichment continues."
            : "Both enrichment waterfalls completed without a confident match, so the safe route goes to Anand.",
        );
      } else {
        route = {
          ...resolution.route,
          isFallback: false,
        };
      }
    }
  } catch (error) {
    console.error("[inbound-routing] route deadline fallback", {
      domain,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    const owner = configuredOwner(crm.ownerId);
    route = owner || crm.existingCustomer
      ? {
          ...routeLead({
            company: null,
            person: null,
            crmTitle: crm.title,
            existingCustomer: crm.existingCustomer,
            owner,
          }),
          isFallback: false,
        }
      : fallbackDecision(
          "No high-confidence route completed within five seconds, so the safe route goes to Anand while enrichment continues.",
        );
  }

  const stableRoute = route;
  after(async () => {
    const [finalCrmOutcome, companyOutcome, personOutcome] =
      await Promise.allSettled([crmWork, companyWork, personWork]);
    const finalCrm =
      finalCrmOutcome.status === "fulfilled" ? finalCrmOutcome.value : crm;
    const finalCompany =
      companyOutcome.status === "fulfilled" ? companyOutcome.value : companyResult;
    const finalPerson =
      personOutcome.status === "fulfilled" ? personOutcome.value : personResult;
    const technologyAuth = authFromTechnologies(
      finalCompany?.company?.technologies ?? [],
    );
    const refreshedSignals = routeLead({
      company: finalCompany?.company ?? null,
      person: finalPerson?.person ?? null,
      crmTitle: finalCrm.title,
      existingCustomer: finalCrm.existingCustomer,
      owner: configuredOwner(finalCrm.ownerId),
    });
    const enrichedRoute: RouteDecision = {
      ...stableRoute,
      fitScore: refreshedSignals.fitScore,
      tier: refreshedSignals.tier,
      signals: refreshedSignals.signals,
      timezone: refreshedSignals.timezone,
      title: refreshedSignals.title,
    };
    const corePayload = makePayload({
      domain,
      leadId,
      started,
      route: enrichedRoute,
      crm: finalCrm,
      companyResult: finalCompany,
      personResult: finalPerson,
      ...(technologyAuth.provider ? { auth: technologyAuth } : {}),
      hubspotSync: finalCrm.contactId ? "pending" : "not_applicable",
      enrichmentStatus: "pending",
    });
    await saveEnrichment(leadId, corePayload).catch((error) =>
      console.error("[inbound-routing] core enrichment persistence failed", error),
    );

    const hubspotWork = fillMissingHubSpotFields(finalCrm, {
      title: finalPerson?.person?.title ?? null,
      linkedinUrl: finalPerson?.person?.linkedinUrl ?? null,
      companyName: finalCompany?.company?.name ?? null,
      revenue: finalCompany?.company?.revenue ?? finalCrm.revenue,
      calendarUrl: stableRoute.owner.bookingUrl,
    });
    const playWork = launchPostRoutePlay({
      leadId,
      person: { firstName, lastName, email },
      company: {
        name: corePayload.company.name,
        domain: corePayload.company.domain,
        employeeCount: corePayload.company.employeeCount,
        employeeRange: corePayload.company.employeeRange,
        salesTeamSize: corePayload.company.salesTeamSize,
      },
      route: {
        owner: stableRoute.owner,
        fitScore: enrichedRoute.fitScore,
        tier: enrichedRoute.tier,
        signals: enrichedRoute.signals,
      },
    });
    const [authOutcome, hubspotOutcome] = await Promise.allSettled([
      authWork,
      hubspotWork,
    ]);
    const finalAuth =
      authOutcome.status === "fulfilled" ? authOutcome.value : NO_AUTH;
    const hubspotSync: HubSpotSync =
      hubspotOutcome.status === "fulfilled" ? hubspotOutcome.value : "failed";
    if (hubspotOutcome.status === "rejected")
      console.error(
        "[inbound-routing] HubSpot fill-only update failed",
        hubspotOutcome.reason,
      );
    const finalPayload = makePayload({
      domain,
      leadId,
      started,
      route: enrichedRoute,
      crm: finalCrm,
      companyResult: finalCompany,
      personResult: finalPerson,
      auth: finalAuth,
      hubspotSync,
      enrichmentStatus: "completed",
    });
    await Promise.all([
      saveEnrichment(leadId, finalPayload).catch((error) =>
        console.error("[inbound-routing] enrichment persistence failed", error),
      ),
      playWork.catch((error) =>
        console.error("[inbound-routing] post-route Play launch failed", error),
      ),
    ]);
  });

  const enrichmentStatus = hasBackgroundStore()
    ? "pending"
    : companyResult && personResult
      ? "completed"
      : "unavailable";
  const initialAuth = companyResult?.company
    ? authFromTechnologies(companyResult.company.technologies)
    : undefined;

  return NextResponse.json(
    makePayload({
      domain,
      leadId,
      started,
      route: stableRoute,
      crm,
      companyResult,
      personResult,
      ...(initialAuth?.provider ? { auth: initialAuth } : {}),
      hubspotSync: crm.contactId ? "pending" : "not_applicable",
      enrichmentStatus,
    }),
  );
}
