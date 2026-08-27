# Deepline inbound routing demo

A forkable Next.js reference app for real-time inbound routing with the Deepline SDK. A visitor enters a name and work email, receives a booking route immediately, and sees company, contact, CRM, and optional technical signals update as they arrive.

## The SDK pattern

The app connects to Deepline once, then runs ordered CrustData → People Data Labs waterfalls. Company enrichment advances after a miss, error, or unusable profile. Contact enrichment also advances when CrustData verifies the exact email but omits required professional fields; verified fields from both sources are then merged.

```ts
import { enrichCompany, enrichPerson } from "@/lib/enrichment";

const [companyResult, personResult] = await Promise.all([
  enrichCompany(domain),
  enrichPerson({ email, firstName, lastName }),
]);
```

The cached `Deepline.connect()` client and `tools.execute()` wrapper live in [`lib/deepline.ts`](lib/deepline.ts). The company and contact waterfalls, exact-match inputs, requested fields, normalization, and merge rules live in [`lib/enrichment.ts`](lib/enrichment.ts).

CrustData, People Data Labs, and HubSpot connections are owned by the configured Deepline workspace. The application does not handle their vendor credentials. `DEEPLINE_API_KEY` is the only required data credential.

## Change the data sources

The provider order and Deepline tool IDs are declared together in `lib/enrichment.ts`. To try another source:

1. Find the provider tool in Deepline.
2. Add or replace one entry in the ordered waterfall.
3. Normalize a successful result into the small company or person contract.

The route, UI, timeout behavior, and CRM logic do not need to change. A successful first step records the later step as `skipped`; a miss advances to the next source. Provider errors are evidence, not visitor-facing blockers.

## Runtime flow

1. Validate the name and work email.
2. Check HubSpot ownership through the Deepline SDK.
3. Run CrustData first for company and contact enrichment.
4. Run People Data Labs only for an unresolved company or exact-email person miss.
5. Preserve a mapped CRM owner or apply the routing rules.
6. Return a calendar before the five-second route deadline.
7. Continue unfinished enrichment in the background and update the result page.

The visible result keeps these concerns separate:

- **Live contact enrichment** — exact work-email identity, title, seniority, role, location, and source.
- **Company enrichment** — firmographics and the raw provider payload used by the decision.
- **HubSpot record** — CRM match and fill-only sync status. Populated fields are never overwritten.
- **Optional signals** — Brandfetch logo and public authentication fingerprinting. These never determine whether the visitor can book.

If every external source fails or exceeds the deadline, the visitor still receives the safe default calendar while the trace records what happened.

## Routing rules

1. A configured HubSpot owner wins.
2. Existing customers route to Anand.
3. Sales teams above 20 and companies with at least 250 employees route to Jai.
4. Deployment/customer-success roles route to Anand; GTM systems roles route to Jai.
5. Other verified SMB accounts route to Chirag.
6. An unresolved route defaults to Anand before five seconds.

The fit score uses firmographic and persona signals. It does not expose CRM relationship status.

## Run locally

```sh
cp env.example .env.local
bun install
bun run dev
```

Set `DEEPLINE_API_KEY` in `.env.local`. Do not prefix it with `NEXT_PUBLIC_` or commit the file.

Everything else in `env.example` is optional:

- HubSpot owner IDs map workspace CRM owners to the three calendars. Optional
  contact-property mappings enable fill-only revenue and calendar writes.
- Vercel KV stores background enrichment results for browser polling.
- Brandfetch adds a logo after routing.
- HTTP Basic Auth protects a shared production demo.
- Deepline Play names enable optional post-response workflows.

Without KV, the synchronous route still works, but a browser cannot retrieve enrichment that finishes after the response. A production deployment without `INBOUND_DEMO_ACCESS_PASSWORD` fails closed.

## Try the API

```sh
curl -sS -X POST http://localhost:3000/api/inbound-lead/qualify \
  -H 'content-type: application/json' \
  --data @examples/valid-work-email.json
```

`examples/invalid-personal-email.json` verifies that invalid non-work input is rejected before any provider call. Common personal-email domains are rejected by the same validation path.

For a password-protected deployment, use your own deployment URL and test-owned work email:

```sh
curl -sS -u "deepline:$INBOUND_DEMO_ACCESS_PASSWORD" \
  -X POST https://YOUR_DEPLOYMENT/api/inbound-lead/qualify \
  -H 'content-type: application/json' \
  --data '{"firstName":"Test","lastName":"Lead","email":"test@example-business.com"}'
```

Live requests can consume Deepline workspace credits. Do not place credentials in browser-visible requests.

## Verify the result

Confirm that:

1. A booking route appears even while deeper enrichment is pending.
2. A known HubSpot owner remains the owner.
3. The SDK waterfall shows each source as `hit`, `partial`, `miss`, `skipped`, or `error`.
4. Contact enrichment appears only after an exact work-email match.
5. Background data updates the page when KV is configured.
6. HubSpot fills supported empty fields without overwriting populated fields.

## Optional Plays

`plays/inbound-lead-async.play.ts` is the minimal post-response workflow. It is safe to extend with persistence, Slack, or other actions because it runs after the calendar response.

```sh
deepline plays check plays/inbound-lead-async.play.ts
deepline plays publish plays/inbound-lead-async.play.ts
```

No email action is enabled by default. The separate booking-aware HubSpot nurture example is documented in [`docs/advanced-nurture.md`](docs/advanced-nurture.md).
