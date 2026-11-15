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
export const PERSON_CRUST_TOOL = "crustdata_v3_person_enrich";
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
    value.persons,
    value.contacts,
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

function employeeCountSignal(...values: unknown[]) {
  for (const value of values) {
    const raw = stringValue(value);
    if (raw && /\d\s*(?:-|–|—|\+)\s*\d*\s*$/.test(raw)) continue;
    const count = numericValue(value);
    if (count !== null) return { count, range: null };
  }
  for (const value of values) {
    const raw = stringValue(value);
    if (!raw) continue;
    const numbers = [...raw.matchAll(/\d[\d,]*/g)].map((match) =>
      Number(match[0].replace(/,/g, "")),
    );
    if (
      numbers.length &&
      /(?:-|–|—|\+)/.test(raw) &&
      numbers.every(Number.isFinite)
    )
      return { count: Math.min(...numbers), range: raw };
  }
  return { count: null, range: null };
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
  const fullLocation =
    stringValue(location.name) ?? stringValue(location.location);
  if (fullLocation) return fullLocation;
  return (
    [
      location.city ?? location.locality,
      location.state ?? location.region,
      location.country,
    ]
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
    const employeeSignal = employeeCountSignal(
      headcount.total ??
        current.total ??
        current.count ??
        basic.employee_count ??
        basic.employeeCount,
      current.range,
      headcount.range,
    );
    if (
      !name ||
      employeeSignal.count === null ||
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
      employeeCount: employeeSignal.count,
      employeeRange: employeeSignal.range,
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
  const employeeSignal = employeeCountSignal(
    profile.employee_count,
    profile.employeeCount,
    profile.size,
  );
  if (
    !name ||
    employeeSignal.count === null ||
    !providerDomainMatches(
      domain,
      profile.primary_domain,
      profile.domain,
      profile.website,
      profile.website_url,
    )
  )
    return null;
  const location = locationValue(profile.location);
  const roles = isRecord(profile.roles) && isRecord(profile.roles.distribution)
    ? profile.roles.distribution
    : {};
  const roleCounts = isRecord(profile.employee_count_by_role)
    ? profile.employee_count_by_role
    : {};
  const technologyPayload =
    profile.technologies ?? profile.technology_names ?? profile.technology;
  const technologies = Array.isArray(technologyPayload)
    ? technologyPayload
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
    employeeCount: employeeSignal.count,
    employeeRange: employeeSignal.range,
    salesTeamSize: numericValue(roleCounts.sales ?? roles.sales),
    revenue:
      revenueValue(profile.annual_revenue) ??
      revenueValue(profile.revenue) ??
      revenueValue(profile.estimated_revenue) ??
      revenueValue(profile.inferred_revenue),
    industry:
      stringValue(profile.industry_v2) ?? stringValue(profile.industry),
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
  const location =
    locationValue(profile.location) ?? stringValue(profile.location_name);
  const providerName = [
    stringValue(profile.first_name),
    stringValue(profile.last_name),
  ]
    .filter(Boolean)
    .join(" ");
  const fullName =
    stringValue(profile.full_name) ??
    stringValue(profile.name) ??
    stringValue(providerName);
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

function crustPersonProfile(value: unknown, input: PersonInput): PersonProfile | null {
  const email = input.email.trim().toLowerCase();
  const matches = candidateRecords(value).flatMap((row) => {
    if (row.match_type !== "business_email" ||
        stringValue(row.matched_on)?.toLowerCase() !== email ||
        !Array.isArray(row.matches)) return [];

    return row.matches.flatMap((match: unknown) => {
      if (!isRecord(match) || !isRecord(match.person_data)) return [];
      const score = match.confidence_score;
      if (typeof score !== "number" || !Number.isFinite(score) || score > 100) return [];
      const confidence = score > 1 ? score / 100 : score;
      return confidence >= 0.7 ? [{ confidence, data: match.person_data }] : [];
    });
  });
  const data = matches.sort((a, b) => b.confidence - a.confidence)[0]?.data;
  if (!data) return null;

  const basic = isRecord(data.basic_profile) ? data.basic_profile : {};
  const social = isRecord(data.social_handles) ? data.social_handles : {};
  const linkedin = isRecord(social.professional_network_identifier)
    ? social.professional_network_identifier : {};
  const employment = isRecord(data.experience) && isRecord(data.experience.employment_details)
    ? data.experience.employment_details.current : null;
  const current = Array.isArray(employment) ? employment.find(isRecord) : undefined;
  return personProfile({
    work_email: email,
    full_name: basic.name,
    first_name: basic.first_name,
    last_name: basic.last_name,
    title: stringValue(basic.current_title) ?? current?.title,
    seniority: current?.seniority_level,
    headline: basic.headline,
    location: basic.location,
    linkedin_url: linkedin.profile_url,
  }, input, "CrustData");
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

export function describeLookupFailure(error: unknown) {
  const record = isRecord(error) ? error : {};
  const safe = (value: unknown) =>
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : null;
  const code = safe(record.code);
  const status = typeof record.statusCode === "number" ? record.statusCode : null;
  const category = safe(record.category);
  const origin = safe(record.origin);
  const networkKind = safe(record.networkKind);
  const timeout = /timeout|timed out/i.test(
    [code, category, networkKind, error instanceof Error ? error.message : ""].join(" "),
  );
  const reason = timeout ? "Lookup timed out" : status === 429 ? "Rate or quota limit" :
    status === 401 || status === 403 ? "Access denied" :
    category ? category.replace(/_/g, " ") : networkKind ?? "Lookup failed";
  const detail = [origin, status ? `HTTP ${status}` : null, code].filter(Boolean);
  return { code, status, category, origin, networkKind,
    summary: detail.length ? `${reason} (${detail.join(", ")}).` : `${reason}.` };
}

function mergePersonProfiles(
  primary: PersonProfile,
  fallback: PersonProfile,
): PersonProfile {
  const merged = {
    fullName: primary.fullName ?? fallback.fullName,
    email: primary.email,
    title: primary.title ?? fallback.title,
    seniority: primary.seniority ?? fallback.seniority,
    role: primary.role ?? fallback.role,
    location: primary.location ?? fallback.location,
    linkedinUrl: primary.linkedinUrl ?? fallback.linkedinUrl,
    enrichmentSource: `${primary.enrichmentSource} + ${fallback.enrichmentSource}`,
  };
  return {
    ...merged,
    fullProfile: {
      ...merged,
      workEmail: merged.email,
      matchBasis: "Exact work email",
    },
  };
}

type Source<T> = {
  provider: string;
  tool: string;
  lookup: () => Promise<T | null>;
  usable?: (value: T) => boolean;
};

async function lookupTogether<T>(
  sources: Source<T>[],
  choose: (matches: T[]) => T | null,
  progress: (result: T | null, attempts: ProviderAttempt[]) => void,
) {
  const completed: Array<{ value: T | null; attempt: ProviderAttempt } | undefined> =
    new Array(sources.length).fill(undefined);
  const snapshot = () => {
    const results = completed.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    return {
      result: choose(results.flatMap(({ value }) => value ? [value] : [])),
      attempts: results.map((entry) => entry.attempt),
    };
  };
  await Promise.all(sources.map(async (source, index) => {
    const started = Date.now();
    let value: T | null = null;
    let status: ProviderAttempt["status"] = "miss";
    let detail = "No verified usable match.";
    try {
      value = await source.lookup();
      if (value) {
        status = source.usable && !source.usable(value) ? "partial" : "hit";
        detail = status === "partial" ? "Verified match is missing a name or title." : "Verified match returned.";
      }
    } catch (error) {
      status = "error";
      const failure = describeLookupFailure(error);
      detail = failure.summary;
      console.warn("[inbound-routing] lookup failed", {
        tool: source.tool, ...failure, durationMs: Date.now() - started,
      });
    }
    completed[index] = { value, attempt: attempt(index + 1, source.provider, source.tool, status, started, detail) };
    const current = snapshot();
    progress(current.result, current.attempts);
  }));
  return snapshot();
}

export async function enrichCompany(
  domain: string,
  runner: ToolRunner = executeTool,
  onProgress?: (result: CompanyWaterfallResult) => void,
): Promise<CompanyWaterfallResult> {
  const pack = (company: CompanyProfile | null, attempts: ProviderAttempt[]): CompanyWaterfallResult =>
    ({ company, trace: { entity: "company", attempts } });
  const { result, attempts } = await lookupTogether([
    { provider: "CrustData", tool: COMPANY_CRUST_TOOL, lookup: async () =>
      companyProfileFromCrust(await runner(COMPANY_CRUST_TOOL, {
        domains: [domain], exact_match: true,
        fields: ["basic_info", "revenue", "headcount", "taxonomy", "locations"],
      }), domain) },
    { provider: "People Data Labs", tool: COMPANY_PDL_TOOL, lookup: async () =>
      companyProfileFromPdl(await runner(COMPANY_PDL_TOOL, {
        domain, min_likelihood: 6, include_if_matched: true, required: "employee_count",
      }), domain) },
  ], (matches) => matches[0] ?? null, (profile, trace) => onProgress?.(pack(profile, trace)));
  return pack(result, attempts);
}

export async function enrichPerson(
  input: PersonInput,
  runner: ToolRunner = executeTool,
  onProgress?: (result: PersonWaterfallResult) => void,
): Promise<PersonWaterfallResult> {
  const pack = (person: PersonProfile | null, attempts: ProviderAttempt[]): PersonWaterfallResult =>
    ({ person, trace: { entity: "person", attempts } });
  const sources: Source<PersonProfile>[] = [
    { provider: "CrustData", tool: PERSON_CRUST_TOOL, lookup: async () =>
      crustPersonProfile(await runner(PERSON_CRUST_TOOL, {
        business_emails: [input.email],
        fields: ["basic_profile", "experience", "social_handles"],
      }), input) },
    { provider: "People Data Labs", tool: PERSON_PDL_TOOL, lookup: async () =>
      personProfile(await runner(PERSON_PDL_TOOL, {
        email: input.email,
        ...(input.firstName ? { first_name: input.firstName } : {}),
        ...(input.lastName ? { last_name: input.lastName } : {}),
        min_likelihood: 6, include_if_matched: true,
        data_include: "full_name,first_name,last_name,work_email,job_title,job_title_role,job_title_levels,location_name,linkedin_url",
      }), input, "People Data Labs") },
    { provider: "Prospeo", tool: "prospeo_enrich_person", lookup: async () => {
      const raw = await runner("prospeo_enrich_person", { email: input.email, only_verified_email: true });
      const matches = candidateRecords(raw).flatMap((row) => {
        if (!isRecord(row.email) || row.email.status !== "VERIFIED") return [];
        return [{ work_email: row.email.email, full_name: row.full_name ?? row.name,
          title: (isRecord(row.job) ? row.job.title : null) ?? row.current_job_title ?? row.title,
          linkedin_url: row.linkedin_url }];
      });
      return personProfile(matches, input, "Prospeo");
    } },
  ];
  if (input.verifiedLinkedInUrl) sources.push({ provider: "Deepline Native", tool: "search_contact", lookup: async () => {
      const linkedin = await input.verifiedLinkedInUrl;
      if (!linkedin) return null;
      const key = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "").toLowerCase();
      const raw = await runner("search_contact", {
        contact_linkedin: `https://www.linkedin.com/in/${key(linkedin).split("/").at(-1)}/`,
        page_number: 1,
        page_size: 3,
        free_only: true,
      });
      const matches = candidateRecords(raw).filter((row) => {
        const url = stringValue(row.linkedin_url);
        return url && key(url) === key(linkedin);
      });
      return matches.length === 1
        ? personProfile({ ...matches[0], work_email: input.email }, input, "HubSpot + Deepline Native")
        : null;
    } });
  const { result, attempts } = await lookupTogether(sources.map((source) => ({
    ...source, usable: (person: PersonProfile) => Boolean(person.fullName && person.title),
  })), (matches) => matches.reduce<PersonProfile | null>((best, profile) =>
    best ? mergePersonProfiles(best, profile) : profile, null),
  (profile, trace) => onProgress?.(pack(profile, trace)));
  return pack(result, attempts);
}
