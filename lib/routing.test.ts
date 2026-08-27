import { describe, expect, test } from "bun:test";
import type { CompanyProfile, PersonProfile } from "./contracts";
import {
  CALENDARS,
  resolveFastEnrichmentRoute,
  routeLead,
} from "./routing";

const company = (overrides: Partial<CompanyProfile> = {}): CompanyProfile => ({
  name: "Example",
  domain: "example.com",
  employeeCount: 40,
  employeeRange: null,
  salesTeamSize: 5,
  revenue: null,
  industry: "Software",
  location: "New York, United States",
  technologies: [],
  enrichmentSource: "CrustData",
  fullProfile: {},
  ...overrides,
});

const person = (overrides: Partial<PersonProfile> = {}): PersonProfile => ({
  fullName: "Avery Morgan",
  email: "avery@example.com",
  title: "Product Manager",
  seniority: "Manager",
  role: "Product",
  location: "New York, United States",
  linkedinUrl: null,
  enrichmentSource: "CrustData",
  fullProfile: {},
  ...overrides,
});

describe("routeLead", () => {
  test("HubSpot owner has highest priority", () => {
    const result = routeLead({
      company: company({ employeeCount: 10_000 }),
      person: person({ title: "GTM Engineer" }),
      crmTitle: null,
      existingCustomer: false,
      owner: CALENDARS.anand,
    });
    expect(result.owner).toBe(CALENDARS.anand);
  });

  test("an enriched GTM title routes an unknown contact to Jai", () => {
    const result = routeLead({
      company: company(),
      person: person({ title: "GTM Engineer" }),
      crmTitle: null,
      existingCustomer: false,
      owner: null,
    });
    expect(result.owner).toBe(CALENDARS.jai);
  });

  test("an unowned SMB lead in the Americas routes to Chirag", () => {
    const result = routeLead({
      company: company(),
      person: person(),
      crmTitle: null,
      existingCustomer: false,
      owner: null,
    });
    expect(result.owner).toBe(CALENDARS.chirag);
  });

  test("enterprise scale deterministically outranks a deployment title", () => {
    const result = routeLead({
      company: company({ employeeCount: 600 }),
      person: person({ title: "Director of Deployment" }),
      crmTitle: null,
      existingCustomer: false,
      owner: null,
    });

    expect(result.owner).toBe(CALENDARS.jai);
  });
});

describe("resolveFastEnrichmentRoute", () => {
  test("a decisive CRM title does not wait for either enrichment lane", async () => {
    const never = new Promise<never>(() => undefined);
    const result = await resolveFastEnrichmentRoute({
      companyWork: never,
      personWork: never,
      crmTitle: "VP Sales",
      timeoutMs: 1_000,
    });

    expect(result.route?.owner).toBe(CALENDARS.jai);
  });

  test("a decisive enterprise company does not wait for the person lane", async () => {
    const neverPerson = new Promise<never>(() => undefined);
    const started = Date.now();
    const result = await resolveFastEnrichmentRoute({
      companyWork: Promise.resolve({
        company: company({ employeeCount: 1_000 }),
        trace: { entity: "company", attempts: [] },
      }),
      personWork: neverPerson,
      crmTitle: null,
      timeoutMs: 1_000,
    });

    expect(result.route?.owner).toBe(CALENDARS.jai);
    expect(Date.now() - started).toBeLessThan(250);
  });

  test("a decisive GTM title does not wait for the company lane", async () => {
    const neverCompany = new Promise<never>(() => undefined);
    const result = await resolveFastEnrichmentRoute({
      companyWork: neverCompany,
      personWork: Promise.resolve({
        person: person({ title: "GTM Engineer" }),
        trace: { entity: "person", attempts: [] },
      }),
      crmTitle: null,
      timeoutMs: 1_000,
    });

    expect(result.route?.owner).toBe(CALENDARS.jai);
  });

  test("a deployment title waits for a delayed higher-priority enterprise signal", async () => {
    const result = await resolveFastEnrichmentRoute({
      companyWork: new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              company: company({ employeeCount: 600 }),
              trace: { entity: "company", attempts: [] },
            }),
          15,
        ),
      ),
      personWork: Promise.resolve({
        person: person({ title: "Director of Deployment" }),
        trace: { entity: "person", attempts: [] },
      }),
      crmTitle: null,
      timeoutMs: 1_000,
    });

    expect(result.route?.owner).toBe(CALENDARS.jai);
  });

  test("returns the safe-fallback signal when neither lane finishes", async () => {
    const never = new Promise<never>(() => undefined);
    const result = await resolveFastEnrichmentRoute({
      companyWork: never,
      personWork: never,
      crmTitle: null,
      timeoutMs: 10,
    });

    expect(result.route).toBeNull();
    expect(result.timedOut).toBe(true);
  });
});
