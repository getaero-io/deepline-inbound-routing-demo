import { expect, test } from "bun:test";
import nurture from "../plays/inbound-lead-nurture.play";
import { followupDraft } from "./nurture";

const input = () => ({
  eventId: "fixture",
  mode: "automated" as const,
  execute: true,
  contact: { id: "test-contact", email: "test@example.com", ownerId: null },
  route: { ownerName: "Jai", fitScore: 80, scoreVersion: "fit-v1" as const },
  engagement: { score: null, lastEngagedAt: null, source: "none" as const },
  booking: { status: "unknown" as const, checkedAt: null },
  evaluatedAt: "2026-10-30T10:00:00.000Z",
  followUp: {
    dueAt: "2026-10-30T11:00:00.000Z",
    bookingProperties: {
      status: "booking",
      checkedAt: "checked",
      eligible: "eligible",
    },
    propertyNames: {
      state: "state",
      key: "key",
      dueAt: "due",
      fitScore: "fit",
      engagementScore: "engagement",
      scoreVersion: "version",
    },
    sequence: {
      id: "test-sequence",
      senderEmail: "test@example.com",
      enrollingUserId: "test-user",
    },
  },
});

async function run(properties: Record<string, unknown>, enrolled: unknown = false) {
  const calls: string[] = [];
  const ctx = {
    sleep: async (ms: number) => {
      expect(calls).toEqual(["hubspot_update_object"]);
      expect(ms).toBe(3660000);
    },
    step: async () => "2026-10-30T11:01:00.000Z",
    log: () => {},
    tools: {
      execute: async (call: { tool: string }) => {
        calls.push(call.tool);
        return {
          toolResponse: {
            rawV2:
              call.tool === "hubspot_get_object"
                ? { data: { properties } }
                : { is_enrolled: enrolled },
          },
        };
      },
    },
  };
  const result = await nurture(ctx as never, input());
  return { result, calls };
}

const trusted = {
  email: "test@example.com",
  booking: "not_booked",
  checked: "2026-10-30T11:00:30.000Z",
  eligible: "true",
};

test("automated follow-up queues intent, sleeps, verifies booking, then enrolls", async () => {
  const { result, calls } = await run(trusted);
  expect(result.plan.decision).toBe("nurture");
  expect(calls).toContain("hubspot_enroll_contact_in_sequence");
});

test("HubSpot epoch-millisecond booking timestamps are recognized", async () => {
  const { result } = await run({
    ...trusted,
    checked: String(Date.parse(trusted.checked)),
  });
  expect(result.plan.decision).toBe("nurture");
});

test("bookings, missing signals, stale checks, wrong identity and ineligible leads suppress outreach", async () => {
  for (const properties of [
    { ...trusted, booking: "booked" },
    {},
    { ...trusted, checked: "2026-10-30T10:30:00.000Z" },
    { ...trusted, email: "other@example.com" },
    { ...trusted, eligible: "false" },
    { ...trusted, booking: "unexpected" },
    { ...trusted, checked: "2026-10-30T12:00:00.000Z" },
  ]) {
    const { calls } = await run(properties);
    expect(calls).not.toContain("hubspot_enroll_contact_in_sequence");
    expect(calls).not.toContain("hubspot_create_task");
  }
});

test("unknown sequence status fails closed and active enrollment is not repeated", async () => {
  await expect(run(trusted, null)).rejects.toThrow();
  const { calls } = await run(trusted, true);
  expect(calls).not.toContain("hubspot_enroll_contact_in_sequence");
});

test("dry run performs no writes or waits and includes the personalized draft", async () => {
  const data = { ...input(), execute: false };
  const result = await nurture({ log: () => {} } as never, data);
  expect(result.mode).toBe("dry_run");
  expect(result.applied).toEqual([]);
});

test("draft uses supplied facts, escapes HTML and keeps URLs out of plain fallback", () => {
  const draft = followupDraft({
    firstName: "Avery<script>",
    company: "Acme & Co",
    title: "RevOps",
    ownerName: "Jai",
    calendarUrl: "https://calendly.com/jptoor/30min",
  });
  expect(draft.htmlBody).toContain("&lt;script&gt;");
  expect(draft.htmlBody).toContain("<a href=");
  expect(draft.htmlBody).toContain("<b>Demo focus</b>");
  expect(draft.context).toContain("RevOps at Acme & Co");
  expect(draft.body).not.toContain("https://");
  expect(draft.body).not.toContain("—");
});
