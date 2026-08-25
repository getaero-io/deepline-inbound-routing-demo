# Deepline inbound routing demo

A standalone Next.js inbound form that takes only a first name, last name, and work email—then verifies the account, preserves existing CRM ownership, enriches company and contact signals, and presents the right Deepline calendar. The fast route returns immediately; deeper enrichment and non-destructive HubSpot contact updates continue in the background.

## What a visitor experiences

1. Enter a name and work email.
2. Receive a matching Deepline expert and booking route, normally in a few seconds.
3. See clear evidence: verified person data when an exact email match exists, company verification when it does not, and the data still arriving after a fast route.
4. For Chirag routes, book directly in the embedded calendar.

The UI never represents company data as a verified person profile. If no exact work-email match is returned, it says so explicitly and still keeps the booking route available.

The routing evidence also shows a non-blocking authentication-stack fingerprint
when available (for example WorkOS, Auth0, Okta, Clerk, or Cognito). It first
uses the returned technology profile, then performs a short public-site scan
only after routing. “No provider found” means no public fingerprint was
detected; it is not evidence that a company has no authentication provider.

## Routing order

1. Preserve a configured HubSpot owner.
2. Existing customers and deployment roles route to Anand.
3. Sales team above 20, company size above 250, and GTM systems roles route to Jai.
4. SMB and incomplete profiles route to Chirag.

The public fit score uses firmographic and persona signals. It deliberately does not expose CRM relationship status.

## Run locally

```sh
cp env.example .env.local
bun install
bun run dev
```

Required deployment values are in `env.example`. `DEEPLINE_API_KEY` and `CRUSTDATA_API_KEY` are server-only. Never prefix either with `NEXT_PUBLIC_` or commit them. The demo uses Deepline for HubSpot lookups and People Data Labs; direct CrustData is a server-side real-time fallback when the Deepline provider layer has no company result. Brandfetch uses a client ID to make a browser-side logo request after the route response, so logo loading adds no qualification latency.

The production app is protected with HTTP Basic Auth. Set `INBOUND_DEMO_ACCESS_PASSWORD` only in the production environment and use `deepline` as the username. A production deployment without this value fails closed.

When `INBOUND_DEMO_ASYNC_PLAY_NAME` is set, the API starts the included Play with `after()` after returning the calendar. Its launch is capped and never holds the response open.

## Test the production app

Use the deployed form with a work email and confirm the following:

1. The result includes a Deepline owner and booking path, even if enrichment is still pending.
2. A known HubSpot owner remains with that owner.
3. The `Contact verification` panel distinguishes an exact person match from company-only verification.
4. The page updates automatically after background enrichment completes.
5. `Show live routing evidence` lists the provider outcomes and applied routing rule.

For a request-level smoke test, use a test-owned work email—not a customer email—against the production endpoint:

```sh
curl -sS -X POST https://YOUR_DEPLOYMENT/api/inbound-lead/qualify \
  -H 'content-type: application/json' \
  --data '{"firstName":"Test","lastName":"Lead","email":"test@example-business.com"}'
```

This makes live enrichment requests and may consume provider credits. Never send credentials in browser-visible requests or commit `.env.local`.

## Examples

```sh
curl -X POST http://localhost:3000/api/inbound-lead/qualify \
  -H 'content-type: application/json' \
  --data @examples/valid-work-email.json
```

`examples/invalid-personal-email.json` verifies the malformed-input, no-enrichment rejection path. The API also rejects personal email domains before calling providers.

## Async workflow

`plays/inbound-lead-async.play.ts` is the included post-response Deepline Play. Validate and publish it with the Deepline CLI after authenticating to the intended workspace:

```sh
deepline plays check plays/inbound-lead-async.play.ts
deepline plays publish plays/inbound-lead-async.play.ts
```

No email action is enabled by default.

## Booking-aware HubSpot nurture

`plays/inbound-lead-nurture.play.ts` is a separate post-route Play. It keeps
calendar management outside this app and supports the following durable flow:

1. On route completion, call the Play with `mode: "queue"` to write the
   versioned score, state, idempotency key, and follow-up due time to the HubSpot
   contact, plus the appropriate manual lists.
2. Have a HubSpot workflow (or a signed webhook scheduler) call it again with
   `mode: "evaluate"` after the grace period, including a definitive
   `booking.status` from HubSpot activity.
3. `booked` skips outreach. `unknown` is sent to review. Only `not_booked`
   creates the owner task and, when configured, enrolls the contact in a
   HubSpot sequence.

The Play defaults to a dry run. Set `execute: true` only after creating the
manual lists and custom contact properties referenced by the input:

- `deepline_nurture_state`
- `deepline_nurture_key`
- `deepline_followup_due_at`
- `deepline_fit_score_v1`
- `deepline_engagement_score_v1`
- `deepline_score_version`

Use `eventId` as the stable inbound-lead ID for both calls. That makes replay
safe and leaves a clear receipt for each list write, property update, sequence
enrollment, and owner task. Do not call the evaluate branch unless the booking
signal is definitive.

```sh
deepline plays check plays/inbound-lead-nurture.play.ts
deepline plays publish plays/inbound-lead-nurture.play.ts
```
