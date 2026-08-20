# Deepline inbound routing demo

A standalone Next.js demo for real-time, CRM-aware inbound routing. The API runs the HubSpot contact/company lookup and company enrichment concurrently, has a 4.8-second hard deadline, and immediately returns the booking link.

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

Required deployment values are in `env.example`. `DEEPLINE_API_KEY` is server-only. Never prefix it with `NEXT_PUBLIC_` or commit it. Brandfetch uses a client ID to make a browser-side logo request after the route response, so logo loading adds no qualification latency.

When `ASYNC_PLAY_NAME` is set, the API starts the included Play with `after()` after returning the calendar. Its launch is capped at 4.5 seconds and never holds the response open.

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
