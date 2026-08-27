import { describe, expect, mock, test } from "bun:test";
import {
  fillMissingHubSpotFields,
  lookupHubSpot,
  type HubSpotResult,
} from "./hubspot";

const execute = mock(
  async (_tool: string, _input: Record<string, unknown>) => ({}),
);
const crm = (properties: Record<string, unknown>): HubSpotResult => ({
  ownerId: null,
  existingCustomer: false,
  title: typeof properties.jobtitle === "string" ? properties.jobtitle : null,
  contactId: "123",
  contactProperties: properties,
  revenue: null,
  contactMatched: true,
  companyMatched: false,
  contactUnavailable: false,
  companyUnavailable: false,
  matched: true,
});

describe("fillMissingHubSpotFields", () => {
  test("fills only blank supported fields", async () => {
    execute.mockClear();
    await fillMissingHubSpotFields(
      crm({ jobtitle: "VP Sales", hs_linkedin_url: "", company: null }),
      {
        title: "Chief Revenue Officer",
        linkedinUrl: "https://linkedin.com/in/example",
        companyName: "Example",
        revenue: "10000000",
        calendarUrl: "https://calendly.com/example",
      },
      execute,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[1]).toEqual({
      object_type: "contacts",
      object_id: "123",
      properties: {
        hs_linkedin_url: "https://linkedin.com/in/example",
        company: "Example",
      },
    });
  });

  test("does not write when existing fields are complete", async () => {
    execute.mockClear();
    const status = await fillMissingHubSpotFields(
      crm({
        jobtitle: "VP Sales",
        hs_linkedin_url: "https://linkedin.com/in/existing",
        company: "Existing",
      }),
      {
        title: "Different",
        linkedinUrl: "https://linkedin.com/in/different",
        companyName: "Different",
        revenue: "20000000",
        calendarUrl: "https://calendly.com/different",
      },
      execute,
    );
    expect(status).toBe("not_needed");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("lookupHubSpot", () => {
  test("normalizes contact and company matches returned by the SDK", async () => {
    let call = 0;
    const runner = mock(async () => {
      call += 1;
      return call === 1
        ? {
            results: [
              {
                id: "contact-1",
                properties: {
                  jobtitle: "VP Sales",
                  hubspot_owner_id: "owner-1",
                  lifecyclestage: "lead",
                },
              },
            ],
          }
        : {
            results: [
              {
                id: "company-1",
                properties: {
                  annualrevenue: "10000000",
                  lifecyclestage: "customer",
                },
              },
            ],
          };
    });

    const result = await lookupHubSpot("alex@example.com", "example.com", runner);
    expect(result).toMatchObject({
      ownerId: "owner-1",
      existingCustomer: true,
      title: "VP Sales",
      contactId: "contact-1",
      revenue: "10000000",
      contactMatched: true,
      companyMatched: true,
      matched: true,
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  test("keeps a contact owner when the company lookup fails", async () => {
    const runner = mock(async (_tool: string, input: Record<string, unknown>) => {
      if (input.object_type === "companies") throw new Error("company timeout");
      return {
        results: [
          {
            id: "contact-2",
            properties: {
              hubspot_owner_id: "owner-2",
              lifecyclestage: "lead",
            },
          },
        ],
      };
    });

    const result = await lookupHubSpot("owner@example.com", "example.com", runner);
    expect(result.ownerId).toBe("owner-2");
    expect(result.contactId).toBe("contact-2");
    expect(result.contactMatched).toBe(true);
    expect(result.companyMatched).toBe(false);
    expect(result.matched).toBe(true);
  });

  test("distinguishes a company-only match from a contact match", async () => {
    const runner = mock(async (_tool: string, input: Record<string, unknown>) =>
      input.object_type === "contacts"
        ? { results: [] }
        : {
            results: [
              {
                id: "company-2",
                properties: { annualrevenue: "25000000" },
              },
            ],
          },
    );

    const result = await lookupHubSpot("new@example.com", "example.com", runner);

    expect(result.contactMatched).toBe(false);
    expect(result.companyMatched).toBe(true);
    expect(result.matched).toBe(true);
  });

  test("preserves per-record unavailability instead of reporting a false miss", async () => {
    const runner = mock(async (_tool: string, input: Record<string, unknown>) => {
      if (input.object_type === "contacts")
        throw new Error("Contact search timed out");
      return { results: [] };
    });

    const result = await lookupHubSpot("new@example.com", "example.com", runner);

    expect(result.contactMatched).toBe(false);
    expect(result.companyMatched).toBe(false);
    expect(result.contactUnavailable).toBe(true);
    expect(result.companyUnavailable).toBe(false);
  });

  test("uses a configured contact revenue value before account revenue", async () => {
    const previous = process.env.INBOUND_DEMO_HUBSPOT_CONTACT_REVENUE_PROPERTY;
    process.env.INBOUND_DEMO_HUBSPOT_CONTACT_REVENUE_PROPERTY =
      "deepline_revenue";
    try {
      const runner = mock(
        async (_tool: string, input: Record<string, unknown>) =>
          input.object_type === "contacts"
            ? {
                results: [
                  {
                    id: "contact-3",
                    properties: { deepline_revenue: "$10M-$25M" },
                  },
                ],
              }
            : {
                results: [
                  {
                    id: "company-3",
                    properties: { annualrevenue: "1000000" },
                  },
                ],
              },
      );

      const result = await lookupHubSpot(
        "revenue@example.com",
        "example.com",
        runner,
      );

      expect(result.revenue).toBe("$10M-$25M");
    } finally {
      if (previous === undefined)
        delete process.env.INBOUND_DEMO_HUBSPOT_CONTACT_REVENUE_PROPERTY;
      else
        process.env.INBOUND_DEMO_HUBSPOT_CONTACT_REVENUE_PROPERTY = previous;
    }
  });
});
