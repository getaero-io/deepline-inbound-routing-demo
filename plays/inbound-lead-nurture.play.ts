import { definePlay } from "deepline";

type BookingStatus = "booked" | "not_booked" | "unknown";
type Mode = "queue" | "evaluate";

type NurtureInput = {
  /** Stable inbound event ID. Reuse it when retrying the same lead. */
  eventId: string;
  /** queue writes the future follow-up state; evaluate is called once it is due. */
  mode: Mode;
  /** Execution is opt-in so the same payload is safe to review first. */
  execute?: boolean;
  contact: {
    id: string | null;
    email: string;
    ownerId: string | null;
  };
  route: {
    ownerName: string;
    fitScore: number;
    scoreVersion: "fit-v1";
  };
  engagement: {
    score: number | null;
    lastEngagedAt: string | null;
    source: "hubspot" | "none";
  };
  booking: {
    status: BookingStatus;
    checkedAt: string | null;
  };
  /** Pass the scheduler's timestamp; do not derive wall-clock time in a durable Play. */
  evaluatedAt: string;
  followUp: {
    dueAt: string;
    /** Optional manual-list IDs. They must exist before execution is enabled. */
    allInboundListId?: string;
    priorityListId?: string;
    nurtureListId?: string;
    /** HubSpot custom properties created for this flow. */
    propertyNames?: {
      state: string;
      key: string;
      dueAt: string;
      fitScore: string;
      engagementScore: string;
      scoreVersion: string;
    };
    /** Optional HubSpot Sales sequence configuration. */
    sequence?: {
      id: string;
      senderEmail: string;
      enrollingUserId: string;
    };
  };
};

type RawEnrollment = { is_enrolled?: boolean };

const asEnrollment = (value: unknown): RawEnrollment => {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as { data?: RawEnrollment } & RawEnrollment;
  return raw.data ?? raw;
};

const due = (dueAt: string, evaluatedAt: string) => {
  const timestamp = Date.parse(dueAt);
  const evaluatedTimestamp = Date.parse(evaluatedAt);
  return (
    Number.isFinite(timestamp) &&
    Number.isFinite(evaluatedTimestamp) &&
    timestamp <= evaluatedTimestamp
  );
};

export default definePlay(
  "inbound-lead-nurture",
  async (ctx, input: NurtureInput) => {
    const executionKey = `${input.contact.id ?? input.contact.email}:inbound-nurture:${input.eventId}`;
    const automatic = input.execute === true;
    const hasContact = Boolean(input.contact.id);
    const propertyNames = input.followUp.propertyNames;
    const priority = input.route.fitScore >= 70 || (input.engagement.score ?? 0) >= 50;

    const decision = !hasContact
      ? "needs_review"
      : input.mode === "queue"
        ? "queued"
        : input.booking.status === "booked"
          ? "skip_booked"
          : input.booking.status === "unknown"
            ? "needs_review"
            : !due(input.followUp.dueAt, input.evaluatedAt)
              ? "not_due"
              : "nurture";

    const plan = {
      executionKey,
      decision,
      reason:
        decision === "queued"
          ? "The lead is marked for a later activity and booking check."
          : decision === "nurture"
            ? "No booked meeting was confirmed after the configured grace period."
            : decision === "skip_booked"
              ? "A booked meeting is a terminal conversion for this branch."
              : decision === "needs_review"
                ? "A HubSpot contact ID and a definitive booking result are both required before outreach."
                : "The follow-up window has not opened yet.",
      lists: [
        input.followUp.allInboundListId,
        priority ? input.followUp.priorityListId : undefined,
        decision === "nurture" ? input.followUp.nurtureListId : undefined,
      ].filter((value): value is string => Boolean(value)),
      properties: propertyNames
        ? {
            [propertyNames.state]: decision,
            [propertyNames.key]: executionKey,
            [propertyNames.dueAt]: input.followUp.dueAt,
            [propertyNames.fitScore]: String(input.route.fitScore),
            [propertyNames.engagementScore]: String(input.engagement.score ?? 0),
            [propertyNames.scoreVersion]: input.route.scoreVersion,
          }
        : null,
      task:
        decision === "nurture"
          ? {
              title: `Follow up with ${input.contact.email}`,
              priority: priority ? "HIGH" : "MEDIUM",
              dueDate: input.followUp.dueAt,
            }
          : null,
      sequence:
        decision === "nurture" && input.followUp.sequence
          ? { sequenceId: input.followUp.sequence.id }
          : null,
    };

    ctx.log(`${input.mode} decision for ${input.contact.email}: ${decision}.`);
    if (!automatic || !hasContact || decision === "needs_review" || decision === "skip_booked" || decision === "not_due") {
      return { mode: "dry_run", plan, applied: [] };
    }

    if (!input.contact.id) {
      return { mode: "dry_run", plan, applied: [] };
    }
    const contactId = input.contact.id;
    const applied: string[] = [];

    if (plan.properties) {
      await ctx.tools.execute({
        id: "set_nurture_state",
        tool: "hubspot_update_object",
        input: { object_type: "contacts", object_id: contactId, properties: plan.properties },
        description: "Persist the versioned inbound-routing state on the contact.",
      });
      applied.push("contact_properties");
    }

    for (const listId of plan.lists) {
      await ctx.tools.execute({
        id: "add_to_routing_list",
        tool: "hubspot_add_records_to_list",
        input: { list_id: listId, record_ids: [contactId] },
        description: "Add the contact to its deterministic inbound-routing list.",
      });
      applied.push(`list:${listId}`);
    }

    if (decision !== "nurture" || !plan.task) {
      return { mode: "executed", plan, applied };
    }

    const sequenceStatus = await ctx.tools.execute({
      id: "check_sequence_enrollment",
      tool: "hubspot_get_contact_sequence_enrollments",
      input: { contact_id: contactId },
      description: "Avoid enrolling a contact that is already in a HubSpot sequence.",
    });
    const enrolled = asEnrollment(sequenceStatus.toolResponse.rawV2).is_enrolled === true;

    if (!enrolled && input.followUp.sequence) {
      await ctx.tools.execute({
        id: "enroll_nurture_sequence",
        tool: "hubspot_enroll_contact_in_sequence",
        input: {
          sequence_id: input.followUp.sequence.id,
          contact_id: contactId,
          sender_email: input.followUp.sequence.senderEmail,
          user_id: input.followUp.sequence.enrollingUserId,
        },
        description: "Enroll the unbooked inbound lead in the configured HubSpot sequence.",
      });
      applied.push("sequence_enrollment");
    } else if (enrolled) {
      applied.push("sequence_already_active");
    }

    const taskPriority: "HIGH" | "MEDIUM" = priority ? "HIGH" : "MEDIUM";
    const taskInput = {
      task_type: "TODO" as const,
      title: plan.task.title,
      priority: taskPriority,
      due_date: plan.task.dueDate,
      notes: `Deepline inbound nurture key: ${executionKey}. Booking check: not booked.`,
      ...(input.contact.ownerId ? { assigned_to: input.contact.ownerId } : {}),
    };
    await ctx.tools.execute({
      id: "create_owner_followup_task",
      tool: "hubspot_create_task",
      input: taskInput,
      description: "Create one owner follow-up task for an unbooked inbound lead.",
    });
    applied.push("owner_task");

    return { mode: "executed", plan, applied };
  },
  {
    description:
      "Queue and evaluate a booking-aware, idempotent HubSpot nurture branch after inbound routing.",
  },
);
