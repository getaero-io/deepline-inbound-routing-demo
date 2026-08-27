import type {
  CompanyProfile,
  CompanyWaterfallResult,
  PersonProfile,
  PersonWaterfallResult,
} from "./contracts";

export const CALENDARS = {
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

export type Owner = (typeof CALENDARS)[keyof typeof CALENDARS];

export function configuredOwner(ownerId: string | null): Owner | null {
  if (!ownerId) return null;
  const mappings: Array<[string | undefined, Owner]> = [
    [process.env.INBOUND_DEMO_HUBSPOT_OWNER_JAI_IDS, CALENDARS.jai],
    [process.env.INBOUND_DEMO_HUBSPOT_OWNER_ANAND_IDS, CALENDARS.anand],
    [process.env.INBOUND_DEMO_HUBSPOT_OWNER_CHIRAG_IDS, CALENDARS.chirag],
  ];
  return (
    mappings.find(([ids]) =>
      ids
        ?.split(",")
        .map((id) => id.trim())
        .includes(ownerId),
    )?.[1] ?? null
  );
}

export function timezoneFromLocation(location: string | null) {
  const value = location?.toLowerCase() ?? "";
  if (/united kingdom|ireland|france|germany|spain|italy|netherlands|europe/.test(value))
    return "Europe/London";
  if (/india|singapore|japan|australia|new zealand|korea|hong kong/.test(value))
    return "Asia-Pacific";
  if (/canada|united states|usa|new york|california|texas/.test(value))
    return "Americas";
  return "Unknown";
}

export type RouteInput = {
  company: CompanyProfile | null;
  person: PersonProfile | null;
  crmTitle: string | null;
  existingCustomer: boolean;
  owner: Owner | null;
};

function hasGtmTitle(title: string | null) {
  const value = title?.toLowerCase() ?? "";
  return /gtm engineer|go-to-market engineer|revops|revenue operations|sales operations|sales engineer|solutions engineer|head of sales|vp sales|chief revenue/.test(
    value,
  );
}

function hasDeploymentTitle(title: string | null) {
  return /implementation|deployment|onboarding|customer success/.test(
    title?.toLowerCase() ?? "",
  );
}

export function hasDecisiveEnrichmentSignal(input: RouteInput) {
  const title = input.person?.title ?? input.crmTitle;
  return (
    (input.company?.salesTeamSize ?? 0) > 20 ||
    (input.company?.employeeCount ?? 0) >= 250 ||
    (hasGtmTitle(title) && !hasDeploymentTitle(title))
  );
}

export function routeLead(input: RouteInput) {
  const title = (input.person?.title ?? input.crmTitle)?.toLowerCase() ?? "";
  const location = input.company?.location ?? input.person?.location ?? null;
  const geo = location?.toLowerCase() ?? "";
  const timezone = timezoneFromLocation(location);
  const employeeCount = input.company?.employeeCount ?? null;
  const salesTeamSize = input.company?.salesTeamSize ?? null;
  const industry = input.company?.industry ?? "";
  const technologies = input.company?.technologies ?? [];
  const coreMarket = /united states|usa|canada|united kingdom|\buk\b|ireland/.test(geo);
  const gtmRole = hasGtmTitle(title);
  const deploymentRole = hasDeploymentTitle(title);
  const b2bIndustry =
    /software|saas|technology|business services|staffing|recruiting/i.test(industry);
  const modernGtmStack = technologies.some((value) =>
    /hubspot|salesforce|segment|snowflake|apollo|clay/i.test(value),
  );

  let score = 20;
  const signals: string[] = [];
  if ((employeeCount ?? 0) >= 1_000) {
    score += 22;
    signals.push("Large company scale");
  } else if ((employeeCount ?? 0) >= 250) {
    score += 18;
    signals.push("Enterprise company scale");
  } else if ((employeeCount ?? 0) >= 50) {
    score += 10;
    signals.push("Established company scale");
  }
  if ((salesTeamSize ?? 0) > 20) {
    score += 20;
    signals.push("Scaled sales organization");
  } else if ((salesTeamSize ?? 0) >= 10) {
    score += 12;
    signals.push("Growing sales organization");
  }
  if (coreMarket) {
    score += 12;
    signals.push("Core go-to-market market");
  }
  if (gtmRole) {
    score += 18;
    signals.push("GTM systems role");
  }
  if (b2bIndustry) {
    score += 8;
    signals.push("B2B-oriented industry");
  }
  if (modernGtmStack) {
    score += 5;
    signals.push("Modern GTM stack");
  }

  const knownSignals = [
    employeeCount,
    salesTeamSize,
    location,
    input.person?.title ?? input.crmTitle,
    industry,
  ].filter((value) => value !== null && value !== undefined && value !== "").length;

  const owner =
    input.owner ??
    (input.existingCustomer
      ? CALENDARS.anand
      : (salesTeamSize ?? 0) > 20 || employeeCount !== null && employeeCount >= 250
        ? CALENDARS.jai
        : deploymentRole
          ? CALENDARS.anand
          : gtmRole
            ? CALENDARS.jai
            : timezone === "Europe/London" || timezone === "Asia-Pacific"
              ? CALENDARS.anand
              : CALENDARS.chirag);

  const reason = input.owner
    ? `HubSpot already owns this relationship, so the route stays with ${input.owner.name}.`
    : input.existingCustomer
      ? "Existing customers route to Anand for deployment continuity."
      : (salesTeamSize ?? 0) > 20
        ? "Sales teams above 20 route to Jai."
        : employeeCount !== null && employeeCount >= 250
          ? "Companies with at least 250 employees route to Jai."
          : deploymentRole
            ? "Deployment and customer-success roles route to Anand."
            : gtmRole
              ? "GTM systems roles route to Jai."
              : timezone === "Europe/London" || timezone === "Asia-Pacific"
                ? "Unowned leads in Europe and Asia-Pacific route to Anand."
                : "Unowned SMB leads route to Chirag.";

  return {
    owner,
    reason,
    fitScore: Math.min(score, 100),
    tier:
      knownSignals === 0
        ? "needs_review"
        : score >= 70
          ? "strong_fit"
          : score >= 50
            ? "good_fit"
            : "emerging_fit",
    signals: signals.slice(0, 4),
    timezone,
    title: input.person?.title ?? input.crmTitle,
  };
}

type EnrichmentEvent =
  | { lane: "company"; result: CompanyWaterfallResult | null }
  | { lane: "person"; result: PersonWaterfallResult | null }
  | { lane: "deadline" };

export type FastRouteResolution = {
  route: ReturnType<typeof routeLead> | null;
  companyResult: CompanyWaterfallResult | null;
  personResult: PersonWaterfallResult | null;
  timedOut: boolean;
};

/**
 * Resolve on the first signal that an unresolved lane cannot override. A slower lane keeps
 * running for the background enrichment payload and never blocks the calendar.
 */
export async function resolveFastEnrichmentRoute(input: {
  companyWork: Promise<CompanyWaterfallResult>;
  personWork: Promise<PersonWaterfallResult>;
  crmTitle: string | null;
  timeoutMs: number;
}): Promise<FastRouteResolution> {
  let companyResult: CompanyWaterfallResult | null = null;
  let personResult: PersonWaterfallResult | null = null;
  const crmOnlyInput: RouteInput = {
    company: null,
    person: null,
    crmTitle: input.crmTitle,
    existingCustomer: false,
    owner: null,
  };
  if (hasDecisiveEnrichmentSignal(crmOnlyInput)) {
    return {
      route: routeLead(crmOnlyInput),
      companyResult,
      personResult,
      timedOut: false,
    };
  }
  const pending = new Map<"company" | "person", Promise<EnrichmentEvent>>([
    [
      "company",
      input.companyWork.then(
        (result) => ({ lane: "company", result }) as const,
        () => ({ lane: "company", result: null }) as const,
      ),
    ],
    [
      "person",
      input.personWork.then(
        (result) => ({ lane: "person", result }) as const,
        () => ({ lane: "person", result: null }) as const,
      ),
    ],
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<EnrichmentEvent>((resolve) => {
    timer = setTimeout(
      () => resolve({ lane: "deadline" }),
      Math.max(1, input.timeoutMs),
    );
  });

  try {
    while (pending.size) {
      const event = await Promise.race([...pending.values(), deadline]);
      if (event.lane === "deadline") {
        const available = companyResult?.company || personResult?.person;
        return {
          route: available
            ? routeLead({
                company: companyResult?.company ?? null,
                person: personResult?.person ?? null,
                crmTitle: input.crmTitle,
                existingCustomer: false,
                owner: null,
              })
            : null,
          companyResult,
          personResult,
          timedOut: true,
        };
      }

      pending.delete(event.lane);
      if (event.lane === "company") companyResult = event.result;
      else personResult = event.result;

      const routeInput: RouteInput = {
        company: companyResult?.company ?? null,
        person: personResult?.person ?? null,
        crmTitle: input.crmTitle,
        existingCustomer: false,
        owner: null,
      };
      if (hasDecisiveEnrichmentSignal(routeInput)) {
        return {
          route: routeLead(routeInput),
          companyResult,
          personResult,
          timedOut: false,
        };
      }
    }

    const available = companyResult?.company || personResult?.person;
    return {
      route: available
        ? routeLead({
            company: companyResult?.company ?? null,
            person: personResult?.person ?? null,
            crmTitle: input.crmTitle,
            existingCustomer: false,
            owner: null,
          })
        : null,
      companyResult,
      personResult,
      timedOut: false,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
