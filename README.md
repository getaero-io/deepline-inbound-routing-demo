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
