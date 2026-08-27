import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { InboundRouting } from "../app/routing";

describe("inbound routing result UI", () => {
  test("renders canonical enrichment values and Jai's embedded calendar", () => {
    const markup = renderToStaticMarkup(
      <InboundRouting
        initialResult={{
          company: {
            name: "Salesbricks",
            domain: "salesbricks.com",
            employeeCount: 25,
            employeeRange: null,
            salesTeamSize: 1,
            revenue: "$10M-$25M",
            industry: "software development",
            location: "San Mateo, California, United States",
            technologies: [],
            enrichmentSource: "People Data Labs",
            logoUrl: null,
            auth: {
              provider: null,
              confidence: "none",
              source: "none",
              detail: "No public authentication-provider fingerprint detected",
            },
            fullProfile: { inferred_revenue: "$10M-$25M" },
          },
          person: {
            fullName: "Avery Morgan",
            email: "avery@salesbricks.com",
            title: "Revenue Operations Manager",
            seniority: "Manager",
            role: "Go-to-market",
            location: "San Mateo, California, United States",
            linkedinUrl: null,
            enrichmentSource: "People Data Labs",
          },
          route: {
            owner: {
              name: "Jai Toor",
              bookingUrl: "https://calendly.com/jptoor/30min",
            },
          },
          qualification: {
            fitScore: 80,
            tier: "strong_fit",
            signals: ["GTM systems role"],
          },
          contact: {
            title: "Revenue Operations Manager",
            revenue: "$10M-$25M",
            calendar: "https://calendly.com/jptoor/30min",
            calendarOwner: "Jai Toor",
            source: "People Data Labs",
            identityStatus: "verified",
            hubspotSync: "not_applicable",
            hubspotContactMatched: false,
            hubspotCompanyMatched: true,
            hubspotContactUnavailable: false,
            hubspotCompanyUnavailable: false,
          },
          trace: {
            waterfalls: [],
            providers: [],
            routing: {
              appliedRule: "GTM systems roles route to Jai.",
              priorityScore: 80,
              title: "Revenue Operations Manager",
              company: {
                employeeCount: 25,
                employeeRange: null,
                salesTeamSize: 1,
                industry: "software development",
                location: "San Mateo, California, United States",
                technologies: [],
              },
              attributes: [],
            },
          },
          elapsedMs: 800,
          enrichment: { leadId: "fixture", status: "completed" },
        }}
      />,
    );

    for (const expected of [
      "25",
      "$10M-$25M",
      "software development",
      "San Mateo, California, United States",
      "Revenue Operations Manager",
      "Manager",
      "Go-to-market",
      "People Data Labs",
      "No provider found",
      "CRM account",
      "Matched",
      "Open calendar in a new tab",
    ])
      expect(markup).toContain(expected);
    expect(markup).toContain('class="calendar-cta"');
    expect(markup).toContain('href="https://calendly.com/jptoor/30min"');
    expect(markup).toContain('class="calendar-embed"');
    expect(markup).toContain('<iframe');
    expect(markup).toContain('src="https://calendly.com/jptoor/30min"');
    expect(markup).toContain('title="Book time with Jai Toor"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain(
      'aria-label="Open Jai Toor calendar in a new tab"',
    );
    expect(markup.indexOf("Live contact enrichment")).toBeLessThan(
      markup.indexOf("Deepline SDK waterfall"),
    );
    expect(markup.indexOf("Live company enrichment")).toBeLessThan(
      markup.indexOf("Deepline SDK waterfall"),
    );
  });
});
