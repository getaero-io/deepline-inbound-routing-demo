# Advanced booking-aware HubSpot nurture

The core demo stops after enrichment, routing, and the optional fill-only HubSpot update. `plays/inbound-lead-nurture.play.ts` is a separate example for teams that want to schedule follow-up without delaying the form.

Calendar management remains outside this application. The Play consumes a definitive booking signal from HubSpot or another trusted scheduler.

## Flow

1. Call the Play with `mode: "queue"` after routing. It prepares the versioned score, state, idempotency key, follow-up time, and manual-list memberships.
2. After the grace period, have a HubSpot workflow or signed scheduler call the same Play with `mode: "evaluate"` and the current booking status.
3. A `booked` result skips outreach.
4. An `unknown` result goes to review.
5. A definitive `not_booked` result creates an owner task and can enroll the contact in a configured HubSpot sequence.

## Safety defaults

The Play defaults to a dry run. Set `execute: true` only after reviewing its returned plan and creating the referenced HubSpot properties and manual lists.

Use the same `eventId` for the queue and evaluate calls. It becomes part of the stable execution key, making a retried inbound event observable and replay-safe.

The Play requires both a HubSpot contact ID and a definitive booking result before it can create outreach. It checks existing sequence enrollment before adding another sequence.

## HubSpot properties

Create the following contact properties before enabling execution:

- `deepline_nurture_state`
- `deepline_nurture_key`
- `deepline_followup_due_at`
- `deepline_fit_score_v1`
- `deepline_engagement_score_v1`
- `deepline_score_version`

Pass their names through `followUp.propertyNames`. Manual-list IDs and sequence configuration are optional inputs; they are not stored in the repository.

## Queue input

The first call records future evaluation state:

```json
{
  "eventId": "stable-inbound-event-id",
  "mode": "queue",
  "execute": false,
  "contact": {
    "id": "hubspot-contact-id",
    "email": "test@example-business.com",
    "ownerId": "hubspot-owner-id"
  },
  "route": {
    "ownerName": "Jai Toor",
    "fitScore": 82,
    "scoreVersion": "fit-v1"
  },
  "engagement": {
    "score": 40,
    "lastEngagedAt": null,
    "source": "hubspot"
  },
  "booking": {
    "status": "unknown",
    "checkedAt": null
  },
  "evaluatedAt": "2026-08-26T14:00:00.000Z",
  "followUp": {
    "dueAt": "2026-08-27T14:00:00.000Z"
  }
}
```

Pass timestamps from the caller or scheduler. The Play does not derive wall-clock time during a durable run.

## Evaluate input

Reuse the queue payload and update:

- `mode` to `"evaluate"`
- `evaluatedAt` to the scheduler's current timestamp
- `booking.status` to `"booked"`, `"not_booked"`, or `"unknown"`
- `booking.checkedAt` to the timestamp of the authoritative check

Keep `execute: false` until the returned plan contains the intended decision, lists, properties, task, and optional sequence.

## Publish

Authenticate the Deepline CLI to the intended workspace, then run:

```sh
deepline plays check plays/inbound-lead-nurture.play.ts
deepline plays publish plays/inbound-lead-nurture.play.ts
```

Call the published Play from the HubSpot workflow or signed scheduler that owns the delayed booking check. The core application does not launch this branch.
