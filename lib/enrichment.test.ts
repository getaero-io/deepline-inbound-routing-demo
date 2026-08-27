import { describe, expect, test } from "bun:test";

import { enrichCompany, enrichPerson } from "./enrichment";
import type { ToolRunner } from "./contracts";

describe("company enrichment waterfall", () => {
  test("a usable CrustData result skips People Data Labs", async () => {
    const calls: string[] = [];
    const runner: ToolRunner = async (tool) => {
      calls.push(tool);
      return {
        company_data: {
          basic_info: { company_name: "Acme", primary_domain: "acme.com" },
          headcount: { total: 640 },
        },
      };
    };

    const result = await enrichCompany("acme.com", runner);

    expect(result.company?.name).toBe("Acme");
    expect(result.company?.employeeCount).toBe(640);
    expect(calls).toEqual(["crustdata_v3_company_enrich"]);
    expect(result.trace.attempts.map(({ provider, status }) => ({ provider, status }))).toEqual([
      { provider: "CrustData", status: "hit" },
      { provider: "People Data Labs", status: "skipped" },
    ]);
  });

  test("normalizes the production CrustData V3 company envelope", async () => {
    const runner: ToolRunner = async () => [
      {
        matched_on: "acme.com",
        matches: [
          {
            company_data: {
              basic_info: {
                name: "Acme",
                primary_domain: "acme.com",
              },
              headcount: {
                current: { range: "501-1000" },
                by_role_absolute: { Sales: 42 },
              },
              revenue: {
                estimated: {
                  lower_bound_usd: 50_000_000,
                  upper_bound_usd: 100_000_000,
                },
              },
              taxonomy: { professional_network_industry: "Software" },
              locations: [{ city: "New York", country: "United States" }],
            },
          },
        ],
      },
    ];

    const result = await enrichCompany("acme.com", runner);

    expect(result.company).toMatchObject({
      name: "Acme",
      employeeCount: 501,
      employeeRange: "501-1000",
      salesTeamSize: 42,
      revenue: "50000000-100000000",
      industry: "Software",
      location: "New York, United States",
    });
  });

  test("normalizes a CrustData headquarters location", async () => {
    const runner: ToolRunner = async () => ({
      company_data: {
        basic_info: { name: "Acme", primary_domain: "acme.com" },
        headcount: { total: 300 },
        locations: {
          headquarters: {
            city: "London",
            country: "United Kingdom",
          },
        },
      },
    });

    const result = await enrichCompany("acme.com", runner);

    expect(result.company?.location).toBe("London, United Kingdom");
  });

  test("a CrustData miss invokes People Data Labs exactly once", async () => {
    const calls: string[] = [];
    const runner: ToolRunner = async (tool) => {
      calls.push(tool);
      if (tool === "crustdata_v3_company_enrich") return { matches: [] };
      return {
        name: "Fallback Systems",
        employee_count: "251-500",
        industry: "Computer Software",
        location: { city: "New York", country: "United States" },
      };
    };

    const result = await enrichCompany("fallback.example", runner);

    expect(result.company?.name).toBe("Fallback Systems");
    expect(result.company?.employeeCount).toBe(251);
    expect(result.company?.employeeRange).toBe("251-500");
    expect(calls).toEqual([
      "crustdata_v3_company_enrich",
      "peopledatalabs_enrich_company",
    ]);
    expect(result.trace.attempts.map(({ status }) => status)).toEqual([
      "miss",
      "hit",
    ]);
  });

  test("reconciles returned PDL revenue and sales-team fields", async () => {
    const runner: ToolRunner = async (tool) =>
      tool === "crustdata_v3_company_enrich"
        ? { matches: [] }
        : {
            name: "Salesbricks",
            website: "salesbricks.com",
            employee_count: 25,
            inferred_revenue: "$10M-$25M",
            industry: "computer software",
            industry_v2: "software development",
            location: {
              name: "san mateo, california, united states",
              locality: "san mateo",
              region: "california",
              country: "united states",
            },
            employee_count_by_role: { sales: 1 },
          };

    const result = await enrichCompany("salesbricks.com", runner);

    expect(result.company?.revenue).toBe("$10M-$25M");
    expect(result.company?.salesTeamSize).toBe(1);
    expect(result.company?.industry).toBe("software development");
    expect(result.company?.location).toBe(
      "san mateo, california, united states",
    );
  });

  test("a CrustData error invokes People Data Labs exactly once", async () => {
    const calls: string[] = [];
    const runner: ToolRunner = async (tool) => {
      calls.push(tool);
      if (tool === "crustdata_v3_company_enrich")
        throw new Error("sensitive upstream detail");
      return { name: "Recovered Co", employee_count: 800 };
    };

    const result = await enrichCompany("recovered.example", runner);

    expect(result.company?.name).toBe("Recovered Co");
    expect(calls).toEqual([
      "crustdata_v3_company_enrich",
      "peopledatalabs_enrich_company",
    ]);
    expect(result.trace.attempts.map(({ status }) => status)).toEqual([
      "error",
      "hit",
    ]);
    expect(result.trace.attempts[0]?.detail).not.toContain("sensitive");
  });

  test("a company without a numeric employee count is a miss", async () => {
    const calls: string[] = [];
    const runner: ToolRunner = async (tool) => {
      calls.push(tool);
      return tool === "crustdata_v3_company_enrich"
        ? { company_data: { basic_info: { company_name: "Unknown Scale" } } }
        : { name: "Unknown Scale", employee_count: "" };
    };

    const result = await enrichCompany("unknown-scale.example", runner);

    expect(result.company).toBeNull();
    expect(calls).toEqual([
      "crustdata_v3_company_enrich",
      "peopledatalabs_enrich_company",
    ]);
    expect(result.trace.attempts.map(({ status }) => status)).toEqual([
      "miss",
      "miss",
    ]);
  });

  test("a mismatched provider domain is a miss", async () => {
    const runner: ToolRunner = async (tool) =>
      tool === "crustdata_v3_company_enrich"
        ? {
            company_data: {
              basic_info: {
                company_name: "Wrong Company",
                primary_domain: "wrong.example",
              },
              headcount: { total: 900 },
            },
          }
        : {
            name: "Right Company",
            website: "https://right.example",
            employee_count: 450,
          };

    const result = await enrichCompany("right.example", runner);

    expect(result.company?.name).toBe("Right Company");
    expect(result.company?.enrichmentSource).toBe("People Data Labs");
    expect(result.trace.attempts.map(({ status }) => status)).toEqual([
      "miss",
      "hit",
    ]);
  });
});

describe("person enrichment waterfall", () => {
  test("an exact-email CrustData result skips People Data Labs", async () => {
    const calls: string[] = [];
    const runner: ToolRunner = async (tool) => {
      calls.push(tool);
      return {
        name: "Alex Morgan",
        business_email: "alex@acme.com",
        title: "VP of Revenue Operations",
        location: "New York, New York, United States",
        linkedin_profile_url: "https://www.linkedin.com/in/alex-morgan",
      };
    };

    const result = await enrichPerson(
      { email: "alex@acme.com", firstName: "Alex", lastName: "Morgan" },
      runner,
    );

    expect(result.person?.title).toBe("VP of Revenue Operations");
    expect(result.person?.seniority).toBe("VP");
    expect(result.person?.role).toBe("Go-to-market");
    expect(calls).toEqual(["crustdata_v2_enrich_person"]);
    expect(result.trace.attempts.map(({ status }) => status)).toEqual([
      "hit",
      "skipped",
    ]);
  });

  test("a person profile must match the submitted email exactly", async () => {
    const calls: string[] = [];
    const inputs: Array<Record<string, unknown>> = [];
    const runner: ToolRunner = async (tool, input) => {
      calls.push(tool);
      inputs.push(input);
      if (tool === "crustdata_v2_enrich_person")
        return {
          business_email: "someone-else@acme.com",
          title: "Chief Revenue Officer",
        };
      return {
        data: {
          work_email: "alex@acme.com",
          full_name: "Alex Morgan",
          job_title: "Director of Sales Operations",
          job_title_levels: ["director"],
          job_title_role: "sales",
          personal_emails: ["private@example.net"],
          phone_numbers: ["+15555550123"],
        },
      };
    };

    const result = await enrichPerson(
      { email: "alex@acme.com", firstName: "Alex", lastName: "Morgan" },
      runner,
    );

    expect(result.person?.title).toBe("Director of Sales Operations");
    expect(result.person?.enrichmentSource).toBe("People Data Labs");
    expect(calls).toEqual([
      "crustdata_v2_enrich_person",
      "peopledatalabs_enrich_contact",
    ]);
    expect(result.trace.attempts.map(({ status }) => status)).toEqual([
      "miss",
      "hit",
    ]);
    expect(inputs[1]).toMatchObject({
      min_likelihood: 6,
      include_if_matched: true,
    });
    expect(String(inputs[1]?.data_include)).toContain("job_title");
    expect(String(inputs[1]?.data_include)).not.toContain("personal_emails");
    expect(JSON.stringify(result.person?.fullProfile)).not.toContain("private@example.net");
    expect(JSON.stringify(result.person?.fullProfile)).not.toContain("5555550123");
  });

  test("a title-less exact CrustData identity falls through and merges PDL fields", async () => {
    const calls: string[] = [];
    const runner: ToolRunner = async (tool) => {
      calls.push(tool);
      return tool === "crustdata_v2_enrich_person"
        ? {
            business_email: "alex@acme.com",
            linkedin_profile_url: "https://linkedin.com/in/alex",
          }
        : {
            data: {
              work_email: "alex@acme.com",
              full_name: "Alex Morgan",
              job_title: "Revenue Operations Manager",
              job_title_levels: ["manager"],
            },
          };
    };

    const result = await enrichPerson(
      { email: "alex@acme.com", firstName: "Alek", lastName: "Mrogan" },
      runner,
    );

    expect(calls).toEqual([
      "crustdata_v2_enrich_person",
      "peopledatalabs_enrich_contact",
    ]);
    expect(result.person?.fullName).toBe("Alex Morgan");
    expect(result.person?.title).toBe("Revenue Operations Manager");
    expect(result.person?.linkedinUrl).toBe("https://linkedin.com/in/alex");
    expect(result.person?.enrichmentSource).toBe(
      "CrustData + People Data Labs",
    );
    expect(result.trace.attempts.map(({ status }) => status)).toEqual([
      "partial",
      "hit",
    ]);
  });

  test("a CrustData person error invokes People Data Labs exactly once", async () => {
    const calls: string[] = [];
    const runner: ToolRunner = async (tool) => {
      calls.push(tool);
      if (tool === "crustdata_v2_enrich_person") throw new Error("upstream auth");
      return {
        work_email: "sam@enterprise.com",
        full_name: "Sam Rivera",
        job_title: "GTM Engineer",
      };
    };

    const result = await enrichPerson(
      { email: "sam@enterprise.com", firstName: "Sam", lastName: "Rivera" },
      runner,
    );

    expect(result.person?.title).toBe("GTM Engineer");
    expect(calls).toEqual([
      "crustdata_v2_enrich_person",
      "peopledatalabs_enrich_contact",
    ]);
    expect(result.trace.attempts.map(({ status }) => status)).toEqual([
      "error",
      "hit",
    ]);
  });
});
