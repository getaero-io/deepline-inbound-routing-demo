# Booking-aware follow-up after a demo request

The form now launches `plays/inbound-lead-nurture.play.ts` after routing and enrichment when `INBOUND_DEMO_NURTURE_PLAY_NAME` is set. `automated` mode persists a due time in HubSpot, waits durably in Deepline, then reads a trusted booking check before creating an owner task or enrolling an existing HubSpot sequence. The calendar response never waits for the grace period.

Email-only captures are separate from submitted demo requests and do not trigger outreach. Browser calendar-open, iframe-load, page-close and missing Calendly events are not booking evidence.

## Flow

1. Visitor clicks Continue with work email. KV retains `email_captured` for 24 hours when configured.
2. Visitor submits name and email. The record becomes `submitted`; existing enrichment and routing run.
3. Post-response enrichment supplies verified company/title, score, routed owner and calendar to the nurture Play. With execution enabled, a missing HubSpot contact is created by exact email after a second lookup. An ambiguous create is reconciled by email rather than blindly retried.
4. The Play writes `queued`, event key and due time, then sleeps until the grace period plus a one-minute booking-sync allowance.
5. A trusted HubSpot workflow checks the scheduler at the due time and writes booking status, check timestamp and eligibility. Configure this integration before enabling execution.
6. The Play rereads those properties through Deepline. `booked` suppresses outreach. `not_booked` must be checked at or after due time, within the last five minutes, and not in the future. Missing or malformed data, another email, or ineligible contacts go to review.
7. A confirmed unbooked, eligible lead gets a personalized task draft. If a reviewed sequence is configured, its subject/context/calendar fields are written before enrollment. An active enrollment is not repeated; unknown enrollment status fails closed.

## Configuration and activation

- Engineering: publish the supplied Play to the intended workspace before configuring `INBOUND_DEMO_NURTURE_PLAY_NAME`.
- RevOps: create the properties and booking workflow below before enabling execution.
- Calendar owner: ensure every routed calendar is covered by the authoritative lookup before activation.
- RevOps: review sender, sequence, suppression and automatic unenrollment on replies/bookings before activation.
- Engineering: keep `INBOUND_DEMO_NURTURE_EXECUTE=false` for the first form-to-Play dry run; inspect the draft and identity, then enable only after booked and unbooked fixtures pass.

Set `INBOUND_DEMO_NURTURE_GRACE_MINUTES` (default 60, maximum seven days). Optional sequence enrollment requires all three of `INBOUND_DEMO_NURTURE_SEQUENCE_ID`, `INBOUND_DEMO_NURTURE_SENDER_EMAIL` and `INBOUND_DEMO_NURTURE_USER_ID`. Without a sequence the Play creates an owner task only. A Play name alone does not send emails or create CRM contacts; execution remains off by default.

```sh
deepline plays check plays/inbound-lead-nurture.play.ts
deepline plays publish plays/inbound-lead-nurture.play.ts
```

This change does not publish a Play, change deployment settings, provision HubSpot properties or enable a live sequence.

## HubSpot properties and booking workflow

Create these contact properties:

| Property                       | Type / purpose                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `deepline_nurture_state`       | text: queued or nurture                                                                           |
| `deepline_nurture_key`         | text: event correlation, not an exactly-once lock                                                 |
| `deepline_followup_due_at`     | date-time: authoritative booking check due time                                                   |
| `deepline_fit_score_v1`        | number                                                                                            |
| `deepline_engagement_score_v1` | number                                                                                            |
| `deepline_score_version`       | text                                                                                              |
| `deepline_booking_status`      | text: booked, not_booked, unknown                                                                 |
| `deepline_booking_checked_at`  | date-time: actual scheduler lookup time                                                           |
| `deepline_followup_eligible`   | boolean: explicit eligibility, including reply, opt-out, bounce and existing-customer suppression |
| `deepline_followup_subject`    | text: personalized subject                                                                        |
| `deepline_followup_context`    | text: factual company/title context                                                               |
| `deepline_followup_calendar`   | text: routed booking URL                                                                          |

Trigger/re-enroll the trusted workflow on a new `deepline_nurture_key`, delay until `deepline_followup_due_at`, then query the booking source across relevant calendars for the exact email. Write `not_booked` only after a complete successful lookup with no matching active booking. On provider errors, incomplete calendar coverage or ambiguous identity write `unknown` and set eligibility false. Do not initialize every lead to `not_booked` at form submission. Booking webhooks should update status immediately, and the due-time workflow should refresh it. Timestamp the completed lookup, not the form submit.

The sequence should use subject and context personalization tokens and a descriptive hyperlink whose destination is the calendar property. Use the Play's `draft.htmlBody` for reviewed HTML preview; its plain `body` fallback contains no raw URLs. Configure the signature for the actual sender and honor suppression. HubSpot's [sequence API requirements](https://developers.hubspot.com/docs/api-reference/latest/automation/sequences/guide) include user-level app access and an eligible sales/service seat; a connected CRM alone does not prove enrollment permission.

## Delivery and verification limits

Deepline persists waits and tool receipts within a run. The existing form's `after()` callback launches the Play; it is not a transactional outbox. A process failure before launch can lose a launch, and repeated separate submissions can start separate runs. Check failed launches in deployment logs and reconcile before replaying. The event key is for correlation; it does not make HubSpot task creation exactly once across runs. Enrollment checks reduce repeats but are not an atomic cross-run lock.

The Play stops when booking evidence is stale or unavailable. No 20% conversion claim is made: the quoted experiment is anecdotal and not a measured outcome here. Measure submitted requests, confirmed bookings, eligible unbooked leads, enrollments and later attributed bookings separately.

## Existing manual callers

`queue` and `evaluate` modes remain available. Queue prepares due-time state. A trusted caller supplies current booking status and `evaluatedAt` for evaluation. Prefer automated mode from the form so the check is performed after the durable wait. Reuse an event ID for correlation, not global deduplication.

## Docebo comparison

The public [Docebo demo page](https://www.docebo.com/demo/) markets a demo request. The supplied HTML analysis describes a HubSpot submit and soft thank-you path, but those private automation details and the tweet's conversion rate were not independently established here. This implementation preserves direct calendar booking and treats a submitted request and a confirmed booking as separate events.
