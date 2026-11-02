# Deepline inbound routing demo

A standalone Next.js inbound form that takes only a first name, last name, and work email—then verifies the account, preserves existing CRM ownership, enriches company and contact signals, and presents the right Deepline calendar. The fast route returns immediately; deeper enrichment and non-destructive HubSpot contact updates continue in the background.

## What a visitor experiences

1. Enter a name and work email.
2. Receive a matching Deepline expert and booking route, normally in a few seconds.
3. See clear evidence: verified person data when an exact email match exists, company verification when it does not, and the data still arriving after a fast route.
4. For Chirag routes, book directly in the embedded calendar.

The UI never represents company data as a verified person profile. If no exact work-email match is returned, it says so explicitly and still keeps the booking route available.

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

Required deployment values are in `env.example`. `DEEPLINE_API_KEY` is server-only. Never prefix it with `NEXT_PUBLIC_` or commit it. Every provider call — HubSpot lookups, People Data Labs, and CrustData — goes through the Deepline SDK, so CrustData needs no separate key and its credentials stay in the Deepline workspace. Brandfetch uses a client ID to make a browser-side logo request after the route response, so logo loading adds no qualification latency.

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

## Booking-abandonment dry run

Check **Test the 30-minute follow-up check** and use an internal `@deepline.com` address. The form starts a signed cloud Play before qualification. It saves a session, waits 30 real minutes, checks the saved booking events, and logs `booking_observed` or `no_booking_observed`. Test mode skips HubSpot contact updates and the legacy asynchronous workflow. Enrichment still runs and can consume credits.

The checkbox defaults off. Nothing in this test sends email, creates a meeting, or enrolls a contact in nurture. `no_booking_observed` means the demo has not received a booking event; it does not establish complete coverage of real Calendly bookings.

Publish `plays/booking-abandonment-demo.play.ts` in the intended Deepline workspace. Bind its play-scoped `INBOUND_BOOKING_DEMO_WEBHOOK_KEY`, then configure these server-only deployment values:

- `INBOUND_BOOKING_WEBHOOK_URL`: the Play's inbound webhook URL.
- `INBOUND_BOOKING_WEBHOOK_KEY`: the same signing key bound to the Play.
- `INBOUND_BOOKING_CALENDLY_SIGNING_KEY`: the signing key for a Calendly webhook subscription.

The app forwards only signed, session-correlated booking/cancellation events to Deepline. Session and event IDs deduplicate retries. Events can arrive before the session row is created. Cancellations invalidate their invitee URI; a reschedule has a new URI.

### Connect real Calendly delivery

The receiver is `/api/webhooks/calendly`. It verifies Calendly's timestamped HMAC signature and rejects timestamps outside a three-minute window. Only this exact route bypasses the demo's Basic Auth; the signature is its authentication.

Register an authorized Calendly webhook subscription for `invitee.created` and `invitee.canceled`, using this receiver URL and the configured signing key. The calendar URL includes the session in `utm_content`. Verify that both event types preserve that tracking value before relying on the decision. No Calendly subscription is provisioned by deploying this repository.

The live nurture workflow continues to use HubSpot meeting records. This receiver is a separate dry-run demonstration until Calendly delivery is connected and its coverage is verified.

### Validate

```sh
node --experimental-strip-types --test lib/booking-demo.test.mjs
npx tsc --noEmit
npm run build
```

For an end-to-end test, submit once in test mode, leave the calendar unbooked, and inspect `storage.booking_demo_sessions_v1` after `due_at`. Confirm `checked_at >= due_at`, the decision is saved once, and `delivery_enabled` remains false. Test the booked branch separately with a clearly labeled synthetic signed event. Do not create a real booking just to exercise this dry run.
