import { startPlay } from "./deepline";
import { ensureHubSpotContact } from "./hubspot";

export function followupDraft(input: {
  firstName: string;
  company: string | null;
  title: string | null;
  ownerName: string;
  calendarUrl: string;
}) {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const url = new URL(input.calendarUrl);
  if (url.protocol !== "https:") throw new Error("A secure booking link is required.");
  const context =
    input.company && input.title
      ? `For your work as ${input.title} at ${input.company}, we can focus the demo on your team's workflow.`
      : input.company
        ? `We can focus the demo on your team's workflow at ${input.company}.`
        : "We can focus the demo on your team's workflow.";
  return {
    subject: "Your Deepline demo",
    context,
    body: `Hey ${input.firstName},\n\nWant to pick a time for your Deepline demo?\n\nDemo focus\n- ${context}\n\nNext step\n- ${input.firstName}: choose a time using the booking link in this message when you're ready.\n\n${input.ownerName}`,
    htmlBody: `<p>Hey ${escape(input.firstName)},</p><p>Want to <a href="${escape(url.href)}">pick a time for your Deepline demo</a>?</p><b>Demo focus</b><ul><li>${escape(context)}</li></ul><b>Next step</b><ul><li>${escape(input.firstName)}: choose a time when you're ready.</li></ul><p>${escape(input.ownerName)}</p>`,
  };
}

export async function launchNurture(input: {
  eventId: string;
  submittedAt: string;
  email: string;
  firstName: string;
  contactId: string | null;
  ownerId: string | null;
  ownerName: string;
  calendarUrl: string;
  fitScore: number;
  company: string | null;
  title: string | null;
}) {
  const name = process.env.INBOUND_DEMO_NURTURE_PLAY_NAME?.trim();
  if (!name) return { status: "not_configured" };
  const minutes = Number(process.env.INBOUND_DEMO_NURTURE_GRACE_MINUTES || 60);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080)
    throw new Error("Nurture grace must be 1-10080 minutes.");
  const draft = followupDraft(input);
  const execute = process.env.INBOUND_DEMO_NURTURE_EXECUTE === "true";
  const contactId = input.contactId ?? (execute ? await ensureHubSpotContact(input) : null);
  const sequence = process.env.INBOUND_DEMO_NURTURE_SEQUENCE_ID;
  const senderEmail = process.env.INBOUND_DEMO_NURTURE_SENDER_EMAIL;
  const enrollingUserId = process.env.INBOUND_DEMO_NURTURE_USER_ID;
  if (sequence && (!senderEmail || !enrollingUserId))
    throw new Error("Sequence sender and user are required.");
  return startPlay(name, {
    eventId: input.eventId,
    mode: "automated",
    execute,
    contact: { id: contactId, email: input.email, ownerId: input.ownerId },
    route: {
      ownerName: input.ownerName,
      fitScore: input.fitScore,
      scoreVersion: "fit-v1",
    },
    engagement: { score: null, lastEngagedAt: null, source: "none" },
    booking: { status: "unknown", checkedAt: null },
    evaluatedAt: input.submittedAt,
    followUp: {
      dueAt: new Date(Date.parse(input.submittedAt) + minutes * 60000).toISOString(),
      bookingProperties: {
        status: "deepline_booking_status",
        checkedAt: "deepline_booking_checked_at",
        eligible: "deepline_followup_eligible",
      },
      draft,
      calendarUrl: input.calendarUrl,
      propertyNames: {
        state: "deepline_nurture_state",
        key: "deepline_nurture_key",
        dueAt: "deepline_followup_due_at",
        fitScore: "deepline_fit_score_v1",
        engagementScore: "deepline_engagement_score_v1",
        scoreVersion: "deepline_score_version",
      },
      ...(sequence ? { sequence: { id: sequence, senderEmail, enrollingUserId } } : {}),
    },
  });
}
