import { definePlay } from "deepline";

type InboundLead = {
  /** Stable ID for logs, persistence, and downstream idempotency. */
  leadId: string;
  person: { firstName: string; lastName: string; email: string };
  company: {
    name: string | null;
    domain: string;
    employeeCount: number | null;
    employeeRange: string | null;
    salesTeamSize: number | null;
  };
  route: {
    owner: { name: string; email: string; bookingUrl: string };
    fitScore: number;
    tier: string;
    signals: string[];
  };
};

export default definePlay(
  "inbound-lead-async-routing",
  async (ctx, input: InboundLead) => {
    ctx.log(
      `Accepted ${input.person.email} (${input.leadId}) for post-response follow-through.`,
    );
    return {
      leadId: input.leadId,
      route: input.route,
      account: input.company,
      nextActions: [
        "Persist the lead and deterministic routing evidence.",
        "Add CRM, Slack, or nurture actions here without delaying the form.",
      ],
      nurture: { enabled: false, status: "skipped" },
    };
  },
  {
    description: "Custom post-response workflow for an inbound qualified lead.",
  },
);
