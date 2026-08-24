import { after, NextResponse } from "next/server";
import { ConfigError, Deepline, type DeeplineContext } from "deepline";

export const runtime = "nodejs";
const DEADLINE_MS = 4_800;
const PROVIDER_TIMEOUT_MS = 3_600;
const PERSONAL =
  /@(gmail|googlemail|yahoo|hotmail|outlook|icloud|aol|protonmail|proton|live|msn|me|ymail)\./i;
const CALENDARS = {
  jai: {
    name: "Jai Toor",
    email: "jai@deepline.com",
    bookingUrl: "https://calendly.com/jptoor/30min",
  },
  anand: {
    name: "Anand Hastak",
    email: "anand@deepline.com",
    bookingUrl: "https://calendly.com/d/d3h5-fgk-n29/deepline-deployment",
  },
  chirag: {
    name: "Chirag Toprani",
    email: "chirag@deepline.com",
    bookingUrl:
      "https://calendly.com/d/d2g4-ntr-67g/deepline-technical-recruiting",
  },
} as const;
type Owner = (typeof CALENDARS)[keyof typeof CALENDARS];
type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function count(value: unknown): number | null {
  const raw = String(value ?? "").replace(/,/g, "");
  const result = Number(raw);
  if (!Number.isFinite(result)) {
    const range = [...raw.matchAll(/\d+(?:\.\d+)?/g)].map((match) =>
      Number(match[0]),
    );
    return range.length ? Math.max(...range) : null;
  }
  return Number.isFinite(result) && result >= 0 ? result : null;
}
function records(value: unknown): RecordValue[] {
  const seen = new Set<unknown>(),
    queue: unknown[] = [value],
    output: RecordValue[] = [];
  while (queue.length && output.length < 100) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) queue.push(...current);
    else if (isRecord(current)) {
      output.push(current);
      for (const key of [
        "data",
        "result",
        "results",
        "raw",
        "matches",
        "company_data",
      ])
        if (key in current) queue.push(current[key]);
    }
  }
  return output;
}
function properties(record: RecordValue) {
  return isRecord(record.properties) ? record.properties : record;
}
function configuredOwner(ownerId: string | null): Owner | null {
  if (!ownerId) return null;
  const map: Array<[string | undefined, Owner]> = [
    [process.env.INBOUND_DEMO_HUBSPOT_OWNER_JAI_IDS, CALENDARS.jai],
    [process.env.INBOUND_DEMO_HUBSPOT_OWNER_ANAND_IDS, CALENDARS.anand],
    [process.env.INBOUND_DEMO_HUBSPOT_OWNER_CHIRAG_IDS, CALENDARS.chirag],
  ];
  return (
    map.find(([ids]) =>
      ids
        ?.split(",")
        .map((id) => id.trim())
        .includes(ownerId),
    )?.[1] ?? null
  );
}
function brandLogo(domain: string) {
  const client = process.env.INBOUND_DEMO_BRANDFETCH_CLIENT_ID?.trim();
  return client
    ? `https://cdn.brandfetch.io/domain/${encodeURIComponent(domain)}/h/128/w/128/theme/light/fallback/404/icon?c=${encodeURIComponent(client)}`
    : null;
}
function timezoneFromLocation(location: string | null) {
  const value = location?.toLowerCase() ?? "";
  if (/united kingdom|ireland|france|germany|spain|italy|netherlands|europe/.test(value))
    return "Europe/London";
  if (/india|singapore|japan|australia|new zealand|korea|hong kong/.test(value))
    return "Asia-Pacific";
  if (/canada|united states|usa|new york|california|texas/.test(value))
    return "Americas";
  return "Unknown";
}
class UpstreamTimeoutError extends Error {
  constructor() {
    super("Timed out");
    this.name = "UpstreamTimeoutError";
  }
}
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  ms = PROVIDER_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, ms));
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new UpstreamTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function timeout<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expires = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamTimeoutError()), Math.max(1, ms));
  });
  return Promise.race([promise, expires]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
function deadline(ms: number) {
  return new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Timed out")), ms),
  );
}
async function saveEnrichment(leadId: string, value: RecordValue) {
  const url = process.env.KV_REST_API_URL?.replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) return;
  const response = await fetchWithTimeout(`${url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([["SET", `inbound-enrichment:${leadId}`, JSON.stringify(value), "EX", "900"]]),
  });
  if (!response.ok) throw new Error("Could not save enrichment status.");
}
// A single shared SDK context. `Deepline.connect()` resolves the API key and
// base URL from DEEPLINE_API_KEY / DEEPLINE_HOST_URL and applies the request
// timeout and transient-failure retries that this route previously hand-rolled.
let connection: Promise<DeeplineContext> | null = null;
function deepline() {
  // `connect()` resolves credentials from DEEPLINE_API_KEY or the CLI's stored
  // auth, so a missing key surfaces as ConfigError rather than being guessed at
  // here. A failed connect is not cached, letting the next request retry.
  connection ??= Deepline.connect({
    baseUrl: process.env.INBOUND_DEMO_DEEPLINE_API_BASE_URL,
    timeout: PROVIDER_TIMEOUT_MS,
    // The route already races every provider against its own deadline, so a
    // retry here would only spend the caller's remaining budget.
    maxRetries: 0,
  }).catch((error) => {
    connection = null;
    throw error instanceof ConfigError
      ? new Error("Live enrichment is not configured for this demo.")
      : error;
  });
  return connection;
}
async function execute(tool: string, payload: RecordValue) {
  const context = await deepline();
  const result = await context.tools.execute(tool, payload);
  // `records()` walks the `raw` envelope, so provider payloads reach the
  // normalizer in the same shape the direct HTTP calls returned.
  return result.toolResponse as unknown as RecordValue;
}
function enrichWithCrustData(domain: string) {
  return execute("crustdata_v3_company_enrich", {
    domains: [domain],
    fields: ["basic_info", "headcount", "taxonomy", "locations"],
  });
}
function launchAsyncWorkflow(input: RecordValue) {
  const playName = process.env.INBOUND_DEMO_ASYNC_PLAY_NAME?.trim();
  if (!playName) return;
  after(async () => {
    try {
      const context = await deepline();
      await timeout(context.play(playName).run(input), 4_500);
    } catch (error) {
      console.error("[inbound-routing] async workflow launch failed", error);
    }
  });
}
async function crm(email: string, domain: string) {
  const hubspotKey = process.env.HUBSPOT_API_KEY?.trim();
  if (hubspotKey) {
    const search = async (objectType: "contacts" | "companies", filter: RecordValue, properties: string[]) => {
      const response = await fetchWithTimeout(
        `https://api.hubapi.com/crm/v3/objects/${objectType}/search`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${hubspotKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            filterGroups: [{ filters: [filter] }],
            properties,
            limit: 1,
          }),
        },
      );
      if (!response.ok) throw new Error(`HubSpot returned ${response.status}.`);
      return (await response.json()) as RecordValue;
    };
    const outcomes = await Promise.allSettled([
      search(
        "contacts",
        { propertyName: "email", operator: "EQ", value: email },
        [
          "email",
          "firstname",
          "lastname",
          "jobtitle",
          "city",
          "state",
          "country",
          "hs_linkedin_url",
          "hubspot_owner_id",
          "lifecyclestage",
        ],
      ),
      search(
        "companies",
        { propertyName: "domain", operator: "EQ", value: domain },
        ["hubspot_owner_id", "lifecyclestage", "annualrevenue"],
      ),
    ]);
    const firstFailure = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    if (outcomes.every((outcome) => outcome.status === "rejected"))
      throw firstFailure?.reason ?? new Error("HubSpot lookup failed.");
    const values = outcomes.flatMap((outcome) =>
      outcome.status === "fulfilled"
        ? records(outcome.value)
            .filter((row) => "properties" in row)
            .map(properties)
        : [],
    );
    const contactOutcome = outcomes[0];
    const contactProfile =
      contactOutcome.status === "fulfilled"
        ? records(contactOutcome.value)
            .filter((row) => "properties" in row)
            .map(properties)[0] ?? null
        : null;
    const contactId =
      contactOutcome.status === "fulfilled"
        ? text(
            records(contactOutcome.value)
              .filter((row) => "properties" in row)[0]?.id,
          )
        : null;
    return {
      ownerId: values.map((row) => text(row.hubspot_owner_id)).find(Boolean) ?? null,
      existing: values.some((row) => ["customer", "evangelist"].includes(String(row.lifecyclestage ?? "").toLowerCase())),
      title: values.map((row) => text(row.jobtitle)).find(Boolean) ?? null,
      person: contactProfile ? personFromHubSpot(email, contactProfile) : null,
      contactId,
      hubspotContact: contactProfile,
      revenue: values.map((row) => text(row.annualrevenue)).find(Boolean) ?? null,
    };
  }
  const [contact, company] = await Promise.all([
    execute("hubspot_search_objects", {
      object_type: "contacts",
      properties: ["email", "firstname", "lastname", "jobtitle", "hubspot_owner_id", "lifecyclestage"],
      limit: 1,
      filter_groups: [
        { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
      ],
    }),
    execute("hubspot_search_objects", {
      object_type: "companies",
      properties: ["hubspot_owner_id", "lifecyclestage", "annualrevenue"],
      limit: 1,
      filter_groups: [
        {
          filters: [{ propertyName: "domain", operator: "EQ", value: domain }],
        },
      ],
    }),
  ]);
  const values = [
    ...records(contact).filter((row) => "properties" in row),
    ...records(company).filter((row) => "properties" in row),
  ].map(properties);
  return {
    ownerId:
      values.map((row) => text(row.hubspot_owner_id)).find(Boolean) ?? null,
    existing: values.some((row) =>
      ["customer", "evangelist"].includes(
        String(row.lifecyclestage ?? "").toLowerCase(),
      ),
    ),
    title: values.map((row) => text(row.jobtitle)).find(Boolean) ?? null,
    person: null,
    contactId: null,
    hubspotContact: null,
    revenue: values.map((row) => text(row.annualrevenue)).find(Boolean) ?? null,
  };
}
async function company(domain: string) {
  const [crust, pdl] = await Promise.allSettled([
    enrichWithCrustData(domain),
    execute("peopledatalabs_enrich_company", { domain }),
  ]);
  const crustProfiles: RecordValue[] = crust.status === "fulfilled"
    ? records(crust.value).flatMap((row) => {
        const companyData = isRecord(row.company_data) ? row.company_data : row;
        const basic = isRecord(companyData.basic_info)
          ? companyData.basic_info
          : companyData;
        const headcount = isRecord(companyData.headcount)
          ? companyData.headcount
          : {};
        const taxonomy = isRecord(companyData.taxonomy)
          ? companyData.taxonomy
          : {};
        const locations = Array.isArray(companyData.locations)
          ? companyData.locations[0]
          : companyData.locations;
        return [
          {
            ...companyData,
            ...basic,
            employee_count: headcount.total ?? basic.employee_count,
            industry:
              taxonomy.professional_network_industry ??
              taxonomy.industry ??
              basic.industries,
            location: locations ?? companyData.location,
          } as RecordValue,
        ];
      })
    : [];
  const profile = [
    ...crustProfiles,
    ...(pdl.status === "fulfilled" ? records(pdl.value) : []),
  ].find((row) => {
    const people = row.employee_count ?? row.employeeCount ?? row.size;
    return (
      count(people) !== null &&
      Boolean(
        text(row.company_name) ??
          text(row.name) ??
          text(row.website) ??
          text(row.primary_domain),
      )
    );
  });
  if (!profile) {
    const result = [crust, pdl]
      .map((source, index) => {
        const name = index === 0 ? "CrustData" : "People Data Labs";
        return source.status === "rejected"
          ? `${name}: error`
          : `${name}: no verified profile`;
      })
      .join("; ");
    throw new Error(`Company enrichment did not return a verified profile. ${result}`);
  }
  const location = isRecord(profile.location)
    ? [profile.location.city, profile.location.state, profile.location.country]
        .map(text)
        .filter(Boolean)
        .join(", ")
    : text(profile.location);
  const roles =
    isRecord(profile.roles) && isRecord(profile.roles.distribution)
      ? profile.roles.distribution
      : {};
  const technologies = Array.isArray(profile.technologies)
    ? profile.technologies
        .map((value) =>
          typeof value === "string"
            ? value
            : isRecord(value)
              ? text(value.name)
              : null,
        )
        .filter((value): value is string => Boolean(value))
    : [];
  return {
    name:
      text(profile.company_name) ?? text(profile.name) ?? null,
    // The submitted work-email domain is the identity anchor. Provider records
    // can legitimately nominate a careers or redirect domain as primary.
    domain,
    employeeCount: count(
      profile.employee_count ?? profile.employeeCount ?? profile.size,
    ),
    salesTeamSize: count(roles.sales),
    revenue: text(profile.annual_revenue) ?? text(profile.revenue) ?? text(profile.estimated_revenue),
    industry: text(profile.industry),
    location: location || null,
    technologies,
    logoUrl:
      brandLogo(domain) || text(profile.logo_url),
    enrichmentSource:
      crust.status === "fulfilled" && crustProfiles.length > 0
        ? "CrustData"
        : "People Data Labs",
    // Deliberately preserve the full provider record used by this decision so
    // the client can show all returned signals, not a curated subset.
    fullProfile: profile,
  };
}
type PersonProfile = {
  fullName: string | null;
  email: string;
  title: string | null;
  seniority: string | null;
  role: string | null;
  location: string | null;
  linkedinUrl: string | null;
  enrichmentSource: string;
  fullProfile: RecordValue;
};

function personFromHubSpot(email: string, profile: RecordValue): PersonProfile | null {
  const returnedEmail = text(profile.email)?.toLowerCase();
  if (returnedEmail !== email.toLowerCase()) return null;
  const title = text(profile.jobtitle);
  const normalizedTitle = title?.toLowerCase() ?? "";
  const seniority = /chief|\bc[eofo]o\b|founder|owner|partner/.test(normalizedTitle)
    ? "Executive"
    : /\bvp\b|vice president/.test(normalizedTitle)
      ? "VP"
      : /head of|director/.test(normalizedTitle)
        ? "Director"
        : /manager|lead/.test(normalizedTitle)
          ? "Manager"
          : null;
  const role = /founder|owner|partner/.test(normalizedTitle)
    ? "Founder"
    : /engineer|developer|technical/.test(normalizedTitle)
    ? "Engineering"
    : /sales|revenue|gtm|marketing/.test(normalizedTitle)
      ? "Go-to-market"
      : /customer success|implementation|deployment/.test(normalizedTitle)
        ? "Customer"
        : null;
  return {
    fullName:
      [text(profile.firstname), text(profile.lastname)].filter(Boolean).join(" ") || null,
    email: returnedEmail,
    title,
    seniority,
    role,
    location: text(profile.city) ?? text(profile.state) ?? text(profile.country),
    linkedinUrl: text(profile.hs_linkedin_url),
    enrichmentSource: "HubSpot contact record",
    fullProfile: profile,
  };
}

// CrustData v3 nests a person under `person_data`, splitting identity across a
// `basic_profile` section and `contact.business_emails` objects. Flatten each
// match into the single record carrying both an email and a name that
// `matchingPersonProfile` matches on, so the exact-work-email check still
// decides whether this is a verified person or company-only evidence.
function flattenCrustPeople(value: unknown): RecordValue {
  const emails = (source: unknown) =>
    (Array.isArray(source) ? source : [])
      .map((entry) =>
        isRecord(entry) ? text(entry.email) : text(entry),
      )
      .filter((entry): entry is string => Boolean(entry));
  const people = records(value).flatMap((row) => {
    const data = isRecord(row.person_data) ? row.person_data : null;
    if (!data) return [];
    const basic = isRecord(data.basic_profile) ? data.basic_profile : {};
    const contact = isRecord(data.contact) ? data.contact : {};
    const network = isRecord(data.professional_network)
      ? data.professional_network
      : {};
    const social = isRecord(data.social_handles) ? data.social_handles : {};
    const networkHandle = isRecord(social.professional_network_identifier)
      ? social.professional_network_identifier
      : {};
    return [
      {
        ...data,
        ...basic,
        business_email: emails(contact.business_emails),
        email: emails(contact.business_emails),
        title: basic.current_title ?? basic.headline,
        linkedin_profile_url:
          networkHandle.profile_url ?? network.professional_network_url,
        location: isRecord(basic.location)
          ? basic.location.raw ??
            [basic.location.city, basic.location.state, basic.location.country]
              .map(text)
              .filter(Boolean)
              .join(", ")
          : basic.location,
      } as RecordValue,
    ];
  });
  return { data: people };
}

function matchingPersonProfile(
  value: unknown,
  email: string,
  source: string,
): PersonProfile | null {
  const normalizedEmail = email.toLowerCase();
  const profile = records(value).find((row) => {
    const candidates = [row.email, row.work_email, row.business_email].flatMap(
      (candidate) =>
        Array.isArray(candidate)
          ? candidate.map(text).filter((value): value is string => Boolean(value))
          : text(candidate)
            ? [text(candidate) as string]
            : [],
    );
    return candidates.some((candidate) => candidate.toLowerCase() === normalizedEmail);
  });
  if (!profile) return null;
  const levels = profile.job_title_levels ?? profile.seniority ?? profile.seniority_level;
  return {
    fullName:
      text(profile.full_name) ??
      text(profile.name) ??
      ([text(profile.first_name), text(profile.last_name)]
        .filter(Boolean)
        .join(" ") || null),
    email: normalizedEmail,
    title: text(profile.job_title) ?? text(profile.title) ?? text(profile.headline),
    seniority: Array.isArray(levels)
      ? levels.map(text).filter(Boolean).join(", ") || null
      : text(levels),
    role: text(profile.job_title_role) ?? text(profile.role),
    location: text(profile.location_name) ?? text(profile.location),
    linkedinUrl: text(profile.linkedin_url) ?? text(profile.linkedin_profile_url),
    enrichmentSource: source,
    fullProfile: profile,
  };
}

async function person(
  email: string,
  firstName: string,
  lastName: string,
): Promise<PersonProfile | null> {
  const [pdl, crust] = await Promise.allSettled([
    execute("peopledatalabs_enrich_contact", {
      email,
      first_name: firstName,
      last_name: lastName,
    }),
    execute("crustdata_v3_person_enrich", {
      business_emails: [email],
      fields: [
        "basic_profile",
        "professional_network",
        "contact",
        "experience",
        "social_handles",
      ],
    }).then(flattenCrustPeople),
  ]);
  return (
    (pdl.status === "fulfilled"
      ? matchingPersonProfile(pdl.value, email, "People Data Labs person identity")
      : null) ??
    (crust.status === "fulfilled"
      ? matchingPersonProfile(crust.value, email, "CrustData person")
      : null)
  );
}

type ContactEnrichment = {
  title: string | null;
  titleIsNew: boolean;
  revenue: string | null;
  calendar: string;
  calendarOwner: string;
  source: string;
  linkedinUrl: string | null;
  companyName: string | null;
  hubspotContact: RecordValue | null;
  identityStatus: "verified" | "not_verified";
};

async function updateExistingHubSpotContact(
  contactId: string | null,
  enrichment: ContactEnrichment,
) {
  const key = process.env.HUBSPOT_API_KEY?.trim();
  if (!contactId || !key) return "not_applicable" as const;
  const summary = JSON.stringify({
    ...enrichment,
    updatedAt: new Date().toISOString(),
  });
  const patch = async (properties: RecordValue) =>
    fetchWithTimeout(
      `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ properties }),
      },
      2_000,
    );
  const isBlank = (field: string) => !text(enrichment.hubspotContact?.[field]);
  const properties: RecordValue = {};
  if (isBlank("deepline_enrich")) properties.deepline_enrich = summary;
  if (isBlank("deepline_enrichment_status"))
    properties.deepline_enrichment_status = "completed";
  if (enrichment.titleIsNew && enrichment.title && isBlank("jobtitle"))
    properties.jobtitle = enrichment.title;
  if (enrichment.linkedinUrl && isBlank("hs_linkedin_url"))
    properties.hs_linkedin_url = enrichment.linkedinUrl;
  if (enrichment.companyName && isBlank("company"))
    properties.company = enrichment.companyName;
  if (!Object.keys(properties).length) return "not_needed" as const;
  let response = await patch(properties);
  // Existing customer portals may not have the optional Deepline properties.
  // Preserve the verified title update rather than failing the background task.
  if (!response.ok) {
    const native = Object.fromEntries(
      Object.entries(properties).filter(([key]) =>
        ["jobtitle", "hs_linkedin_url", "company"].includes(key),
      ),
    );
    if (Object.keys(native).length) response = await patch(native);
  }
  if (!response.ok) throw new Error(`HubSpot contact update returned ${response.status}.`);
  return "updated" as const;
}
function decision(
  input: Awaited<ReturnType<typeof company>> & {
    existing: boolean;
    title: string | null;
    owner: Owner | null;
  },
) {
  const title = input.title?.toLowerCase() ?? "",
    geo = input.location?.toLowerCase() ?? "",
    timezone = timezoneFromLocation(input.location),
    core = /united states|usa|canada|united kingdom|\buk\b|ireland/.test(geo),
    gtm =
      /gtm engineer|go-to-market engineer|revops|revenue operations|sales operations|sales engineer|solutions engineer|head of sales|vp sales|chief revenue/.test(
        title,
      ),
    deployment = /implementation|deployment|onboarding|customer success/.test(
      title,
    ),
    b2b =
      /software|saas|technology|business services|staffing|recruiting/i.test(
        input.industry ?? "",
      ),
    stack = input.technologies.some((value) =>
      /hubspot|salesforce|segment|snowflake|apollo|clay/i.test(value),
    );
  let score = 20;
  const signals: string[] = [];
  if ((input.employeeCount ?? 0) >= 1000) {
    score += 22;
    signals.push("Large company scale");
  } else if ((input.employeeCount ?? 0) >= 250) {
    score += 18;
    signals.push("Enterprise company scale");
  } else if ((input.employeeCount ?? 0) >= 50) {
    score += 10;
    signals.push("Established company scale");
  }
  if ((input.salesTeamSize ?? 0) > 20) {
    score += 20;
    signals.push("Scaled sales organization");
  } else if ((input.salesTeamSize ?? 0) >= 10) {
    score += 12;
    signals.push("Growing sales organization");
  }
  if (core) {
    score += 12;
    signals.push("Core go-to-market market");
  }
  if (gtm) {
    score += 18;
    signals.push("GTM systems role");
  }
  if (b2b) {
    score += 8;
    signals.push("B2B-oriented industry");
  }
  if (stack) {
    score += 5;
    signals.push("Modern GTM stack");
  }
  const known = [
    input.employeeCount,
    input.salesTeamSize,
    input.location,
    input.title,
    input.industry,
  ].filter(
    (value) => value !== null && value !== undefined && value !== "",
  ).length;
  const owner =
    input.owner ??
    (input.existing || deployment
      ? CALENDARS.anand
      : (input.salesTeamSize ?? 0) > 20 ||
          (input.employeeCount ?? 0) >= 250 ||
          gtm
        ? CALENDARS.jai
        : timezone === "Europe/London" || timezone === "Asia-Pacific"
          ? CALENDARS.anand
        : CALENDARS.chirag);
  return {
    owner,
    fitScore: Math.min(score, 100),
    tier:
      known === 0
        ? "needs_review"
        : score >= 70
          ? "strong_fit"
          : score >= 50
            ? "good_fit"
            : "emerging_fit",
    signals: signals.slice(0, 4),
    timezone,
  };
}
function fallbackResponse(input: {
  domain: string;
  started: number;
  reason: "timeout" | "pending" | "unverified" | "crm_unavailable";
  leadId?: string;
  owner?: Owner;
  confirmed?: boolean;
  contact?: {
    title: string | null;
    revenue: string | null;
    source: string;
    identityStatus: "verified" | "not_verified";
    hubspotSync: "pending" | "not_applicable";
  };
}) {
  const detail =
    input.reason === "timeout" || input.reason === "pending"
      ? "Live verification is still running; we reserved the deployment route."
      : input.reason === "unverified"
        ? "We could not verify the account with enough confidence; we reserved the deployment route."
        : "CRM ownership could not be checked; we reserved the deployment route.";
  return NextResponse.json({
    company: {
      name: null,
      domain: input.domain,
      employeeCount: null,
      salesTeamSize: null,
      industry: null,
      location: null,
      technologies: [],
      logoUrl: brandLogo(input.domain),
      enrichmentSource: "Verification pending",
    },
    route: { owner: input.owner ?? CALENDARS.anand, isFallback: !input.confirmed },
    contact: input.contact
      ? {
          ...input.contact,
          calendar: (input.owner ?? CALENDARS.anand).bookingUrl,
          calendarOwner: (input.owner ?? CALENDARS.anand).name,
        }
      : undefined,
    enrichment: input.leadId
      ? { leadId: input.leadId, status: "pending" }
      : undefined,
    qualification: {
      fitScore: 0,
      tier: "verification_pending",
      signals: ["A Deepline specialist will verify the account"],
    },
    trace: {
      providers: [
        {
          name: "HubSpot CRM",
          status: input.confirmed
            ? "matched"
            : input.reason === "crm_unavailable"
              ? "unavailable"
              : "pending",
          detail: input.confirmed
            ? "Existing HubSpot ownership preserved"
            : "Checked without blocking your booking route",
        },
        {
          name: "Live company verification",
          status:
            input.reason === "timeout" || input.reason === "pending"
              ? "continuing"
              : "unverified",
          detail,
        },
        {
          name: "Brandfetch Logo CDN",
          status: process.env.INBOUND_DEMO_BRANDFETCH_CLIENT_ID?.trim()
            ? "deferred"
            : "not_configured",
          detail: "Loads in the browser after routing",
        },
      ],
      routing: {
        appliedRule: input.confirmed
          ? `HubSpot already owns this relationship, so the route is preserved for ${input.owner?.name}.`
          : "No verified account signal arrived in time, so the safe deployment route goes to Anand.",
        priorityScore: 0,
        title: null,
        company: {
          employeeCount: null,
          salesTeamSize: null,
          industry: null,
          location: null,
          technologies: [],
        },
        attributes: [
          { name: "CRM owner", value: input.confirmed ? input.owner?.name ?? "Matched" : "Not confirmed" },
          { name: "Company size", value: "Pending enrichment" },
          { name: "Timezone", value: "Pending enrichment" },
          { name: "Revenue", value: "Not collected" },
          { name: "Lead source", value: "Not collected" },
          { name: "Calendar availability", value: "Not checked" },
        ],
      },
    },
    elapsedMs: Date.now() - input.started,
  });
}
export async function POST(request: Request) {
  const started = Date.now();
  const body = (await request.json().catch(() => null)) as RecordValue | null;
  const firstName = text(body?.firstName),
    lastName = text(body?.lastName),
    email = text(body?.email)?.toLowerCase();
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
  if (PERSONAL.test(email))
    return NextResponse.json(
      { error: "Use your work email so we can match the right account." },
      { status: 400 },
    );
  const domain = email.split("@")[1];
  if (!domain)
    return NextResponse.json(
      { error: "Use your work email so we can match the right account." },
      { status: 400 },
    );
  const leadId = crypto.randomUUID();
  // HubSpot is authoritative when it responds, but its transient failure must
  // never prevent a verified company signal from selecting a non-default route.
  const crmWork = crm(email, domain)
    .then((result) => ({ ...result, unavailable: false }))
    .catch((error) => {
      console.error("[inbound-routing] CRM lookup unavailable", {
        error: error instanceof Error ? error.message : "Unknown CRM error",
        emailDomain: domain,
      });
      return { ownerId: null, existing: false, title: null, person: null, contactId: null, hubspotContact: null, revenue: null, unavailable: true };
    });
  const enrichmentWork = company(domain);
  const personWork = person(email, firstName, lastName);
  after(async () => {
    const [crmOutcome, companyOutcome, personOutcome] = await Promise.allSettled([
      crmWork,
      enrichmentWork,
      personWork,
    ]);
    if (companyOutcome.status !== "fulfilled") {
      const message =
        companyOutcome.reason instanceof Error
          ? companyOutcome.reason.message
          : "Company verification did not complete.";
      try {
        await saveEnrichment(leadId, {
          status: "failed",
          error: "We could not complete company verification after routing.",
          person: personOutcome.status === "fulfilled" ? personOutcome.value : null,
          trace: {
            providers: [
              {
                name: "Live company verification",
                status: "failed",
                detail: message,
              },
            ],
          },
        });
      } catch (error) {
        console.error("[inbound-routing] could not persist enrichment failure", error);
      }
      return;
    }
    const crmResult = crmOutcome.status === "fulfilled"
      ? crmOutcome.value
      : { ownerId: null, existing: false, title: null, person: null, contactId: null, hubspotContact: null, revenue: null, unavailable: true };
    const verifiedPerson =
      (personOutcome.status === "fulfilled" ? personOutcome.value : null) ??
      crmResult.person;
    const route = decision({
      ...companyOutcome.value,
      existing: crmResult.existing,
      title: crmResult.title,
      owner: configuredOwner(crmResult.ownerId),
    });
    const contactEnrichment: ContactEnrichment = {
      title: verifiedPerson?.title ?? crmResult.title,
      titleIsNew: !crmResult.title && Boolean(verifiedPerson?.title),
      revenue: companyOutcome.value.revenue ?? crmResult.revenue,
      calendar: route.owner.bookingUrl,
      calendarOwner: route.owner.name,
      source: verifiedPerson?.enrichmentSource ?? "No verified person match",
      linkedinUrl: verifiedPerson?.linkedinUrl ?? null,
      companyName: companyOutcome.value.name,
      hubspotContact: crmResult.hubspotContact,
      identityStatus: verifiedPerson ? "verified" : "not_verified",
    };
    const hubspotSync = await updateExistingHubSpotContact(
      crmResult.contactId,
      contactEnrichment,
    ).catch((error) => {
      console.error("[inbound-routing] HubSpot contact update failed", error);
      return "failed" as const;
    });
    try {
      await saveEnrichment(leadId, {
        status: "completed",
        company: companyOutcome.value,
        person: verifiedPerson,
        contact: { ...contactEnrichment, hubspotSync },
        qualification: {
          fitScore: route.fitScore,
          tier: route.tier,
          signals: route.signals,
        },
        trace: {
          providers: [
            { name: "HubSpot CRM", status: crmResult.unavailable ? "unavailable" : "completed", detail: "Final CRM check" },
            { name: companyOutcome.value.enrichmentSource, status: "completed", detail: "Verified firmographic profile returned" },
            {
              name: "Person identity",
              status:
                verifiedPerson
                  ? "completed"
                  : "unavailable",
              detail:
                verifiedPerson
                  ? `${verifiedPerson.enrichmentSource}: verified work email match`
                  : "No email-verified person profile returned",
            },
            {
              name: "HubSpot contact sync",
              status: hubspotSync,
              detail:
                hubspotSync === "updated"
                  ? "Updated title and Deepline contact enrichment fields"
                  : hubspotSync === "not_applicable"
                    ? "No existing HubSpot contact to update"
                    : "Contact enrichment write did not complete",
            },
          ],
          routing: {
            appliedRule: "Enrichment completed after the initial route.",
            priorityScore: route.fitScore,
            title: crmResult.title,
            company: companyOutcome.value,
            attributes: [
              { name: "CRM owner", value: configuredOwner(crmResult.ownerId)?.name ?? "No mapped owner" },
              { name: "Existing customer", value: crmResult.existing ? "Yes" : "No" },
              { name: "Company size", value: companyOutcome.value.employeeCount?.toLocaleString() ?? "Not returned" },
              { name: "Timezone", value: route.timezone },
              { name: "Title", value: crmResult.title ?? "Not returned" },
              { name: "Industry", value: companyOutcome.value.industry ?? "Not returned" },
              { name: "Revenue", value: "Not returned" },
              { name: "Lead source", value: "Not collected" },
              { name: "Calendar availability", value: "Not checked" },
            ],
          },
        },
      });
    } catch (error) {
      console.error("[inbound-routing] could not persist enrichment", error);
    }
  });
  const confirmedRoute = crmWork.then((crmResult) => {
    const owner = configuredOwner(crmResult.ownerId);
    return owner || crmResult.existing
      ? { crmResult, owner: owner ?? CALENDARS.anand }
      : new Promise<never>(() => {});
  });
  try {
    const early = await Promise.race([
      confirmedRoute,
      deadline(600),
    ]).catch(() => null);
    if (early) {
      return fallbackResponse({
        domain,
        started,
        reason: "pending",
        leadId,
        owner: early.owner,
        confirmed: true,
        contact: {
          title: early.crmResult.person?.title ?? early.crmResult.title,
          revenue: early.crmResult.revenue,
          source: early.crmResult.person?.enrichmentSource ?? "HubSpot CRM",
          identityStatus: early.crmResult.person ? "verified" : "not_verified",
          hubspotSync: early.crmResult.contactId ? "pending" : "not_applicable",
        },
      });
    }
    // CRM ownership is the fast, authoritative route. Do not let a slower or
    // failed enrichment provider turn a known owner into the default fallback.
    const crmResult = await timeout(crmWork, DEADLINE_MS - (Date.now() - started));
    const crmOwner = configuredOwner(crmResult.ownerId);
    if (crmOwner || crmResult.existing) {
      return fallbackResponse({
        domain,
        started,
        reason: "pending",
        leadId,
        owner: crmOwner ?? CALENDARS.anand,
        confirmed: true,
        contact: {
          title: crmResult.person?.title ?? crmResult.title,
          revenue: crmResult.revenue,
          source: crmResult.person?.enrichmentSource ?? "HubSpot CRM",
          identityStatus: crmResult.person ? "verified" : "not_verified",
          hubspotSync: crmResult.contactId ? "pending" : "not_applicable",
        },
      });
    }
    const companyResult = await timeout(
      enrichmentWork,
      Math.max(1, DEADLINE_MS - (Date.now() - started)),
    );
    const route = decision({
      ...companyResult,
      existing: crmResult.existing,
      title: crmResult.title,
      owner: configuredOwner(crmResult.ownerId),
    });
    const elapsedMs = Date.now() - started;
    launchAsyncWorkflow({
      person: { firstName, lastName, email },
      company: companyResult,
      route: {
        owner: route.owner,
        fitScore: route.fitScore,
        tier: route.tier,
        signals: route.signals,
      },
    });
    return NextResponse.json({
      company: companyResult,
      route: { owner: route.owner },
      contact: {
        title: crmResult.person?.title ?? crmResult.title,
        revenue: companyResult.revenue ?? crmResult.revenue,
        calendar: route.owner.bookingUrl,
        calendarOwner: route.owner.name,
        source: crmResult.person?.enrichmentSource ?? "No verified person match",
        identityStatus: crmResult.person ? "verified" : "not_verified",
        hubspotSync: crmResult.contactId ? "pending" : "not_applicable",
      },
      // Company routing is ready, but the separately validated person profile
      // continues through the same non-blocking enrichment channel.
      enrichment: { leadId, status: "pending" },
      qualification: {
        fitScore: route.fitScore,
        tier: route.tier,
        signals: route.signals,
      },
      trace: {
        providers: [
          {
            name: "HubSpot CRM",
            status: crmResult.unavailable
              ? "unavailable"
              : crmResult.ownerId || crmResult.existing
                ? "matched"
                : "no_match",
            detail: crmResult.title
              ? "Contact record returned"
              : "No contact record returned",
          },
          {
            name: companyResult.enrichmentSource,
            status: "completed",
            detail: "Verified firmographic profile returned",
          },
          {
            name: "Brandfetch Logo CDN",
            status: process.env.INBOUND_DEMO_BRANDFETCH_CLIENT_ID?.trim()
              ? "deferred"
              : "not_configured",
            detail: process.env.INBOUND_DEMO_BRANDFETCH_CLIENT_ID?.trim()
              ? "Loads in the browser after routing"
              : "No Brandfetch client ID configured",
          },
        ],
        routing: {
          appliedRule:
            route.owner === CALENDARS.jai
              ? "Enterprise, scaled sales, or GTM role routes to Jai."
              : route.owner === CALENDARS.anand
                ? "Existing customer or deployment role routes to Anand."
                : "SMB or incomplete profile routes to Chirag.",
          priorityScore: Math.min(
            100,
            route.fitScore +
              (crmResult.ownerId ? 35 : 0) +
              (crmResult.existing ? 20 : 0),
          ),
          title: crmResult.title,
          company: {
            employeeCount: companyResult.employeeCount,
            salesTeamSize: companyResult.salesTeamSize,
            industry: companyResult.industry,
            location: companyResult.location,
            technologies: companyResult.technologies,
          },
          attributes: [
            { name: "CRM owner", value: configuredOwner(crmResult.ownerId)?.name ?? "No mapped owner" },
            { name: "Existing customer", value: crmResult.existing ? "Yes" : "No" },
            { name: "Company size", value: companyResult.employeeCount?.toLocaleString() ?? "Not returned" },
            { name: "Sales team", value: companyResult.salesTeamSize?.toLocaleString() ?? "Not returned" },
            { name: "Timezone", value: route.timezone },
            { name: "Title", value: crmResult.title ?? "Not returned" },
            { name: "Industry", value: companyResult.industry ?? "Not returned" },
            { name: "Technology", value: companyResult.technologies.join(", ") || "Not returned" },
            { name: "Revenue", value: "Not returned" },
            { name: "Lead source", value: "Not collected" },
            { name: "Campaign", value: "Not collected" },
            { name: "Calendar availability", value: "Not checked" },
          ],
        },
      },
      elapsedMs,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Live account signals could not be resolved.";
    console.error("[inbound-routing] qualification failed", {
      error: message,
      emailDomain: domain,
    });
    return fallbackResponse({
      domain,
      started,
      leadId,
      reason:
        message === "Timed out"
          ? "timeout"
          : message.startsWith("Company enrichment did not return")
            ? "unverified"
            : "crm_unavailable",
    });
  }
}
