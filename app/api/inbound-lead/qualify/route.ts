import { after, NextResponse } from "next/server";

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
  const result = Number(String(value ?? "").replace(/,/g, ""));
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
      for (const key of ["data", "result", "results", "raw"])
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
    [process.env.HUBSPOT_OWNER_JAI_IDS, CALENDARS.jai],
    [process.env.HUBSPOT_OWNER_ANAND_IDS, CALENDARS.anand],
    [process.env.HUBSPOT_OWNER_CHIRAG_IDS, CALENDARS.chirag],
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
  const client = process.env.BRANDFETCH_CLIENT_ID?.trim();
  return client
    ? `https://cdn.brandfetch.io/domain/${encodeURIComponent(domain)}/h/128/w/128/theme/light/fallback/404/icon?c=${encodeURIComponent(client)}`
    : null;
}
function timeout<T>(promise: Promise<T>, ms: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out")), ms),
    ),
  ]);
}
async function execute(tool: string, payload: RecordValue) {
  const key = process.env.DEEPLINE_API_KEY?.trim();
  if (!key) throw new Error("Live enrichment is not configured for this demo.");
  const base = (
    process.env.DEEPLINE_API_BASE_URL || "https://code.deepline.com"
  ).replace(/\/$/, "");
  const response = await fetch(
    `${base}/api/v2/integrations/${encodeURIComponent(tool)}/execute`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-deepline-execute-response-contract": "v2-tool-response",
        "x-deepline-execute-response-intent": "raw",
      },
      body: JSON.stringify({ payload }),
    },
  );
  const body = (await response.json()) as RecordValue;
  if (!response.ok)
    throw new Error(
      text(body.error) || `Deepline returned ${response.status}.`,
    );
  return body;
}
function launchAsyncWorkflow(input: RecordValue) {
  const playName = process.env.ASYNC_PLAY_NAME?.trim(),
    key = process.env.DEEPLINE_API_KEY?.trim();
  if (!playName || !key) return;
  const base = (
    process.env.DEEPLINE_API_BASE_URL || "https://code.deepline.com"
  ).replace(/\/$/, "");
  after(async () => {
    try {
      await timeout(
        fetch(`${base}/api/v2/plays/run`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ name: playName, input }),
        }),
        4_500,
      );
    } catch (error) {
      console.error("[inbound-routing] async workflow launch failed", error);
    }
  });
}
async function crm(email: string, domain: string) {
  const [contact, company] = await Promise.all([
    execute("hubspot_search_objects", {
      object_type: "contacts",
      properties: ["hubspot_owner_id", "lifecyclestage", "jobtitle"],
      limit: 1,
      filter_groups: [
        { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
      ],
    }),
    execute("hubspot_search_objects", {
      object_type: "companies",
      properties: ["hubspot_owner_id", "lifecyclestage"],
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
  };
}
async function company(domain: string, name?: string) {
  const response = await execute("crustdata_enrich_company", {
    domain,
    ...(name ? { name } : {}),
  });
  const profile =
    records(response).find(
      (row) => "employee_count" in row || "company_name" in row,
    ) ?? {};
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
    name: text(profile.company_name) ?? name ?? null,
    domain: text(profile.company_domain) ?? domain,
    employeeCount: count(profile.employee_count),
    salesTeamSize: count(roles.sales),
    industry: text(profile.industry),
    location: location || null,
    technologies,
    logoUrl:
      brandLogo(text(profile.company_domain) ?? domain) ||
      text(profile.logo_url),
  };
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
  };
}
export async function POST(request: Request) {
  const started = Date.now();
  const body = (await request.json().catch(() => null)) as RecordValue | null;
  const firstName = text(body?.firstName),
    lastName = text(body?.lastName),
    email = text(body?.email)?.toLowerCase(),
    name = text(body?.company);
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
  try {
    const [crmResult, companyResult] = await timeout(
      Promise.all([
        timeout(crm(email, domain), PROVIDER_TIMEOUT_MS),
        timeout(company(domain, name ?? undefined), PROVIDER_TIMEOUT_MS),
      ]),
      DEADLINE_MS,
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
      qualification: {
        fitScore: route.fitScore,
        tier: route.tier,
        signals: route.signals,
      },
      elapsedMs,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Live account signals could not be resolved.";
    return NextResponse.json(
      {
        error:
          message === "Timed out"
            ? "A live signal did not respond fast enough. Please try again."
            : "Live account signals could not be resolved. Please try again.",
      },
      { status: message === "Timed out" ? 504 : 502 },
    );
  }
}
