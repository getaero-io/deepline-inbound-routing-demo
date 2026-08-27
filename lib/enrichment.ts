import type {
  CompanyProfile,
  CompanyWaterfallResult,
  PersonInput,
  PersonProfile,
  PersonWaterfallResult,
  ProviderAttempt,
  RecordValue,
  ToolRunner,
} from "./contracts";
import { executeTool } from "./deepline";

const COMPANY_CRUST_TOOL = "crustdata_v3_company_enrich";
const COMPANY_PDL_TOOL = "peopledatalabs_enrich_company";
const PERSON_CRUST_TOOL = "crustdata_v2_enrich_person";
const PERSON_PDL_TOOL = "peopledatalabs_enrich_contact";

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (isRecord(value))
    return [value.email, value.address, value.value]
      .flatMap(stringValues);
  const normalized = stringValue(value);
  return normalized ? [normalized] : [];
}

function normalizedDomain(value: unknown): string | null {
  const raw = stringValue(value)?.toLowerCase();
  if (!raw) return null;
  try {
    const hostname = new URL(raw.includes("://") ? raw : `https://${raw}`)
      .hostname;
    return hostname.replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

function providerDomainMatches(
  submittedDomain: string,
  ...providerValues: unknown[]
) {
  const returnedDomains = providerValues
    .flatMap(stringValues)
    .map(normalizedDomain)
    .filter((value): value is string => value !== null);
  const submitted = normalizedDomain(submittedDomain);
  return (
    returnedDomains.length === 0 ||
    (submitted !== null && returnedDomains.includes(submitted))
  );
}

function candidateRecords(value: unknown, depth = 0): RecordValue[] {
  if (depth > 5) return [];
  if (Array.isArray(value))
    return value.flatMap((item) => candidateRecords(item, depth + 1));
  if (!isRecord(value)) return [];
  const nested = [
    value.data,
    value.result,
    value.results,
    value.matches,
    value.company_data,
    value.person,
    value.profile,
  ].flatMap((item) => candidateRecords(item, depth + 1));
  return [value, ...nested];
}

export function numericValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : null;

  const raw = String(value).replace(/,/g, "").trim();
  const direct = Number(raw);
  if (Number.isFinite(direct) && direct >= 0) return direct;

  const range = [...raw.matchAll(/\d+(?:\.\d+)?/g)].map((match) =>
    Number(match[0]),
  );
  return range.length ? Math.max(...range) : null;
}

function scalarString(value: unknown): string | null {
  const text = stringValue(value);
  if (text) return text;
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : null;
}

function locationValue(value: unknown): string | null {
  const location = Array.isArray(value) ? value[0] : value;
  if (!isRecord(location)) return stringValue(location);
  if (location.headquarters)
    return locationValue(location.headquarters);
  return (
    [location.location, location.city, location.state, location.country]
      .map(stringValue)
      .filter(Boolean)
      .join(", ") || null
  );
}

function revenueValue(value: unknown): string | null {
  if (!isRecord(value)) return scalarString(value);
  const estimated = isRecord(value.estimated) ? value.estimated : value;
  const readable =
    stringValue(value.annual_revenue_usd_readable) ??
    stringValue(value.estimated_revenue);
  if (readable) return readable;
  const lower = numericValue(
    estimated.lower_bound_usd ?? estimated.lower ?? value.annual_revenue_usd,
  );
  const upper = numericValue(estimated.upper_bound_usd ?? estimated.upper);
  if (lower !== null && upper !== null) return `${lower}-${upper}`;
  return scalarString(upper ?? lower);
}

function caseInsensitiveValue(record: RecordValue, key: string) {
  const match = Object.entries(record).find(
    ([candidate]) => candidate.toLowerCase() === key.toLowerCase(),
  );
  return match?.[1];
}

function companyProfileFromCrust(
  raw: unknown,
  domain: string,
): CompanyProfile | null {
  for (const candidate of candidateRecords(raw)) {
    const companyData = isRecord(candidate.company_data)
      ? candidate.company_data
      : candidate;
    const basic = isRecord(companyData.basic_info)
      ? companyData.basic_info
      : companyData;
    const headcount = isRecord(companyData.headcount)
      ? companyData.headcount
      : {};
    const current = isRecord(headcount.current) ? headcount.current : {};
    const name = stringValue(basic.company_name) ?? stringValue(basic.name);
    const employeeCount = numericValue(
      headcount.total ??
        current.total ??
        current.count ??
        current.range ??
        headcount.range ??
        basic.employee_count ??
        basic.employeeCount,
    );
    if (
      !name ||
      employeeCount === null ||
      !providerDomainMatches(
        domain,
        basic.primary_domain,
        basic.domain,
        basic.website,
        companyData.primary_domain,
        companyData.domain,
        companyData.website,
      )
    )
      continue;
    const byRole = isRecord(headcount.by_role_absolute)
      ? headcount.by_role_absolute
      : {};
    const taxonomy = isRecord(companyData.taxonomy)
      ? companyData.taxonomy
      : {};

    return {
      name,
      domain,
      employeeCount,
      salesTeamSize: numericValue(caseInsensitiveValue(byRole, "sales")),
      revenue: revenueValue(companyData.revenue),
      industry:
        stringValue(taxonomy.professional_network_industry) ??
        stringValue(taxonomy.industry) ??
        stringValue(stringValues(basic.industries).join(", ")),
      location: locationValue(companyData.locations ?? companyData.location),
      technologies: stringValues(companyData.technologies),
      enrichmentSource: "CrustData",
      fullProfile: companyData,
    };
  }
  return null;
}

function companyProfileFromPdl(
  raw: unknown,
  domain: string,
): CompanyProfile | null {
  if (!isRecord(raw)) return null;
  const profile = isRecord(raw.data) ? raw.data : raw;
  const name = stringValue(profile.company_name) ?? stringValue(profile.name);
  const employeeCount = numericValue(
    profile.employee_count ?? profile.employeeCount ?? profile.size,
  );
  if (
    !name ||
    employeeCount === null ||
    !providerDomainMatches(
      domain,
      profile.primary_domain,
      profile.domain,
      profile.website,
      profile.website_url,
    )
  )
    return null;
  const location = isRecord(profile.location)
    ? [profile.location.city, profile.location.state, profile.location.country]
        .map(stringValue)
        .filter(Boolean)
        .join(", ") || null
    : stringValue(profile.location);
  const roles = isRecord(profile.roles) && isRecord(profile.roles.distribution)
    ? profile.roles.distribution
    : {};
  const technologies = Array.isArray(profile.technologies)
    ? profile.technologies
        .map((value) =>
          typeof value === "string"
            ? stringValue(value)
            : isRecord(value)
              ? stringValue(value.name)
              : null,
        )
        .filter((value): value is string => value !== null)
    : [];

  return {
    name,
    domain,
    employeeCount,
    salesTeamSize: numericValue(roles.sales),
    revenue:
      revenueValue(profile.annual_revenue) ??
      revenueValue(profile.revenue) ??
      revenueValue(profile.estimated_revenue),
    industry: stringValue(profile.industry),
    location,
    technologies,
    enrichmentSource: "People Data Labs",
    fullProfile: profile,
  };
}

function titleSeniority(title: string | null): string | null {
  const value = title?.toLowerCase() ?? "";
  if (/chief|\bc[a-z]o\b|founder|owner|partner/.test(value)) return "Executive";
  if (/\bvp\b|vice president/.test(value)) return "VP";
  if (/head of|director/.test(value)) return "Director";
  if (/manager|lead/.test(value)) return "Manager";
  return null;
}

function titleRole(title: string | null): string | null {
  const value = title?.toLowerCase() ?? "";
  if (/founder|owner|partner/.test(value)) return "Founder";
  if (/sales|revenue|gtm|go-to-market|marketing/.test(value)) return "Go-to-market";
  if (/engineer|developer|technical/.test(value)) return "Engineering";
  if (/customer success|implementation|deployment/.test(value)) return "Customer";
  return null;
}

function personProfile(
  raw: unknown,
  input: PersonInput,
  source: string,
): PersonProfile | null {
  const email = input.email.trim().toLowerCase();
  const matchingProfiles = candidateRecords(raw).filter((candidate) => {
    const emails = [
      candidate.email,
      candidate.work_email,
      candidate.business_email,
      candidate.emails,
    ].flatMap(stringValues);
    return emails.some((candidateEmail) => candidateEmail.toLowerCase() === email);
  });
  const profile = matchingProfiles.sort((left, right) => {
    const completeness = (candidate: RecordValue) =>
      [
        candidate.job_title,
        candidate.title,
        candidate.headline,
        candidate.full_name,
        candidate.name,
        candidate.linkedin_url,
        candidate.linkedin_profile_url,
      ].filter((value) => stringValue(value)).length;
    return completeness(right) - completeness(left);
  })[0];
  if (!profile) return null;

  const title =
    stringValue(profile.job_title) ??
    stringValue(profile.title) ??
    stringValue(profile.headline);
  const levels =
    profile.job_title_levels ?? profile.seniority ?? profile.seniority_level;
  const seniority = stringValues(levels).join(", ") || titleSeniority(title);
  const role =
    stringValue(profile.job_title_role) ??
    stringValue(profile.role) ??
    titleRole(title);
  const location = isRecord(profile.location)
    ? [profile.location.name, profile.location.city, profile.location.state, profile.location.country]
        .map(stringValue)
        .filter(Boolean)
        .join(", ") || null
    : stringValue(profile.location_name) ?? stringValue(profile.location);
  const providerName = [
    stringValue(profile.first_name),
    stringValue(profile.last_name),
  ]
    .filter(Boolean)
    .join(" ");
  const submittedName = [input.firstName, input.lastName]
    .map(stringValue)
    .filter(Boolean)
    .join(" ");
  const fullName =
    stringValue(profile.full_name) ??
    stringValue(profile.name) ??
    stringValue(providerName) ??
    stringValue(submittedName);
  const linkedinUrl =
    stringValue(profile.linkedin_url) ??
    stringValue(profile.linkedin_profile_url);

  return {
    fullName,
    email,
    title,
    seniority,
    role,
    location,
    linkedinUrl,
    enrichmentSource: source,
    // Never serialize a provider's unrestricted person record to the browser.
    // This allowlist is intentionally limited to professional routing signals.
    fullProfile: {
      fullName,
      workEmail: email,
      title,
      seniority,
      role,
      location,
      linkedinUrl,
      matchBasis: "Exact work email",
    },
  };
}

function attempt(
  order: number,
  provider: string,
  tool: string,
  status: ProviderAttempt["status"],
  startedAt: number,
  detail: string,
): ProviderAttempt {
  return {
    order,
    provider,
    tool,
    status,
    durationMs: Math.max(0, Date.now() - startedAt),
    detail,
  };
}

export async function enrichCompany(
  domain: string,
  runner: ToolRunner = executeTool,
): Promise<CompanyWaterfallResult> {
  const attempts: ProviderAttempt[] = [];
  const startedAt = Date.now();
  try {
    const raw = await runner(COMPANY_CRUST_TOOL, {
      domains: [domain],
      exact_match: true,
      fields: ["basic_info", "revenue", "headcount", "taxonomy", "locations"],
    });
    const company = companyProfileFromCrust(raw, domain);
    if (company) {
      attempts.push(
        attempt(1, "CrustData", COMPANY_CRUST_TOOL, "hit", startedAt, "Usable company profile returned."),
        attempt(2, "People Data Labs", COMPANY_PDL_TOOL, "skipped", Date.now(), "Skipped because CrustData returned a usable company profile."),
      );
      return { company, trace: { entity: "company", attempts } };
    }
    attempts.push(
      attempt(1, "CrustData", COMPANY_CRUST_TOOL, "miss", startedAt, "No usable company profile returned."),
    );
  } catch {
    attempts.push(
      attempt(1, "CrustData", COMPANY_CRUST_TOOL, "error", startedAt, "Provider request failed; continuing to the next source."),
    );
  }

  const fallbackStartedAt = Date.now();
  try {
    const raw = await runner(COMPANY_PDL_TOOL, {
      domain,
      min_likelihood: 6,
      include_if_matched: true,
      required: "employee_count",
    });
    const company = companyProfileFromPdl(raw, domain);
    attempts.push(
      attempt(
        2,
        "People Data Labs",
        COMPANY_PDL_TOOL,
        company ? "hit" : "miss",
        fallbackStartedAt,
        company
          ? "Usable company profile returned."
          : "No usable company profile returned.",
      ),
    );
    return { company, trace: { entity: "company", attempts } };
  } catch {
    attempts.push(
      attempt(
        2,
        "People Data Labs",
        COMPANY_PDL_TOOL,
        "error",
        fallbackStartedAt,
        "Provider request failed; the company waterfall is exhausted.",
      ),
    );
    return { company: null, trace: { entity: "company", attempts } };
  }
}

export async function enrichPerson(
  input: PersonInput,
  runner: ToolRunner = executeTool,
): Promise<PersonWaterfallResult> {
  const attempts: ProviderAttempt[] = [];
  const startedAt = Date.now();
  try {
    const raw = await runner(PERSON_CRUST_TOOL, {
      business_email: input.email,
      enrich_realtime: true,
      fields:
        "linkedin_profile_url,name,location,email,business_email,title,headline,skills,current_employers,all_employers,all_titles",
    });
    const person = personProfile(raw, input, "CrustData");
    if (person) {
      attempts.push(
        attempt(1, "CrustData", PERSON_CRUST_TOOL, "hit", startedAt, "Exact-email person profile returned."),
        attempt(2, "People Data Labs", PERSON_PDL_TOOL, "skipped", Date.now(), "Skipped because CrustData returned an exact-email person profile."),
      );
      return { person, trace: { entity: "person", attempts } };
    }
    attempts.push(
      attempt(1, "CrustData", PERSON_CRUST_TOOL, "miss", startedAt, "No exact-email person profile returned."),
    );
  } catch {
    attempts.push(
      attempt(1, "CrustData", PERSON_CRUST_TOOL, "error", startedAt, "Provider request failed; continuing to the next source."),
    );
  }

  const fallbackStartedAt = Date.now();
  try {
    const raw = await runner(PERSON_PDL_TOOL, {
      email: input.email,
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
      min_likelihood: 6,
      include_if_matched: true,
      data_include:
        "full_name,first_name,last_name,work_email,job_title,job_title_role,job_title_levels,location_name,linkedin_url",
    });
    const person = personProfile(raw, input, "People Data Labs");
    attempts.push(
      attempt(
        2,
        "People Data Labs",
        PERSON_PDL_TOOL,
        person ? "hit" : "miss",
        fallbackStartedAt,
        person
          ? "Exact-email person profile returned."
          : "No exact-email person profile returned.",
      ),
    );
    return { person, trace: { entity: "person", attempts } };
  } catch {
    attempts.push(
      attempt(
        2,
        "People Data Labs",
        PERSON_PDL_TOOL,
        "error",
        fallbackStartedAt,
        "Provider request failed; the person waterfall is exhausted.",
      ),
    );
    return { person: null, trace: { entity: "person", attempts } };
  }
}
