import { executeTool } from "./deepline";
import type { ToolRunner } from "./contracts";

type JsonRecord = Record<string, unknown>;

export type HubSpotResult = {
  ownerId: string | null;
  existingCustomer: boolean;
  title: string | null;
  contactId: string | null;
  contactProperties: JsonRecord | null;
  revenue: string | null;
  contactMatched: boolean;
  companyMatched: boolean;
  contactUnavailable: boolean;
  companyUnavailable: boolean;
  matched: boolean;
};

export type HubSpotFill = {
  title: string | null;
  linkedinUrl: string | null;
  companyName: string | null;
  revenue: string | null;
  calendarUrl: string;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rows(value: unknown): JsonRecord[] {
  const root = record(value);
  const data = record(root?.data);
  const candidates = [root?.results, data?.results, root?.data, value];
  for (const candidate of candidates) {
    if (Array.isArray(candidate))
      return candidate.map(record).filter((row): row is JsonRecord => Boolean(row));
  }
  return [];
}

function properties(row: JsonRecord | undefined) {
  return record(row?.properties) ?? null;
}

export async function lookupHubSpot(
  email: string,
  domain: string,
  runner: ToolRunner = executeTool,
  verifiedLinkedInUrl?: string,
): Promise<HubSpotResult> {
  const revenueProperty =
    process.env.INBOUND_DEMO_HUBSPOT_CONTACT_REVENUE_PROPERTY?.trim();
  const calendarProperty =
    process.env.INBOUND_DEMO_HUBSPOT_CONTACT_CALENDAR_PROPERTY?.trim();
  const outcomes = await Promise.allSettled([
    runner("hubspot_search_objects", {
      object_type: "contacts",
      properties: [
        "email",
        "firstname",
        "lastname",
        "jobtitle",
        "company",
        "city",
        "state",
        "country",
        "hs_linkedin_url",
        "hubspot_owner_id",
        "lifecyclestage",
        ...(revenueProperty ? [revenueProperty] : []),
        ...(calendarProperty ? [calendarProperty] : []),
      ],
      limit: 2,
      filter_groups: [
        { filters: [{
          propertyName: verifiedLinkedInUrl ? "hs_linkedin_url" : "email",
          operator: "EQ",
          value: verifiedLinkedInUrl ?? email,
        }] },
      ],
    }),
    runner("hubspot_search_objects", {
      object_type: "companies",
      properties: ["hubspot_owner_id", "lifecyclestage", "annualrevenue"],
      limit: 2,
      filter_groups: [
        { filters: [{ propertyName: "domain", operator: "EQ", value: domain }] },
      ],
    }),
  ]);

  if (outcomes.every((outcome) => outcome.status === "rejected"))
    throw outcomes[0].status === "rejected"
      ? outcomes[0].reason
      : new Error("HubSpot lookup failed.");

  const contactRaw =
    outcomes[0].status === "fulfilled" ? outcomes[0].value : null;
  const companyRaw =
    outcomes[1].status === "fulfilled" ? outcomes[1].value : null;

  const contactRows = rows(contactRaw);
  const companyRows = rows(companyRaw);
  const contactRow = contactRows.length === 1 ? contactRows[0] : undefined;
  const companyRow = companyRows.length === 1 ? companyRows[0] : undefined;
  const contact = properties(contactRow);
  const company = properties(companyRow);
  const records = [contact, company].filter(
    (value): value is JsonRecord => Boolean(value),
  );

  return {
    ownerId:
      text(company?.hubspot_owner_id) ?? text(contact?.hubspot_owner_id),
    existingCustomer: records.some((value) =>
      ["customer", "evangelist"].includes(
        String(value.lifecyclestage ?? "").toLowerCase(),
      ),
    ),
    title: text(contact?.jobtitle),
    contactId: text(contactRow?.id),
    contactProperties: contact,
    revenue:
      (revenueProperty ? text(contact?.[revenueProperty]) : null) ??
      text(company?.annualrevenue),
    contactMatched: Boolean(contact),
    companyMatched: Boolean(company),
    contactUnavailable: outcomes[0].status === "rejected" || contactRows.length > 1,
    companyUnavailable: outcomes[1].status === "rejected" || companyRows.length > 1,
    matched: Boolean(contact || company),
  };
}

export async function fillMissingHubSpotFields(
  crm: HubSpotResult,
  enrichment: HubSpotFill,
  runner: ToolRunner = executeTool,
) {
  if (!crm.contactId || !crm.contactProperties) return "not_applicable" as const;
  const missing = (name: string) => !text(crm.contactProperties?.[name]);
  const properties: JsonRecord = {};
  if (enrichment.title && missing("jobtitle")) properties.jobtitle = enrichment.title;
  if (enrichment.linkedinUrl && missing("hs_linkedin_url"))
    properties.hs_linkedin_url = enrichment.linkedinUrl;
  if (enrichment.companyName && missing("company")) properties.company = enrichment.companyName;
  const revenueProperty =
    process.env.INBOUND_DEMO_HUBSPOT_CONTACT_REVENUE_PROPERTY?.trim();
  const calendarProperty =
    process.env.INBOUND_DEMO_HUBSPOT_CONTACT_CALENDAR_PROPERTY?.trim();
  if (revenueProperty && enrichment.revenue && missing(revenueProperty))
    properties[revenueProperty] = enrichment.revenue;
  if (calendarProperty && missing(calendarProperty))
    properties[calendarProperty] = enrichment.calendarUrl;
  if (!Object.keys(properties).length) return "not_needed" as const;

  await runner("hubspot_update_object", {
    object_type: "contacts",
    object_id: crm.contactId,
    properties,
  });
  return "updated" as const;
}
