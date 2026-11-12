# Inbound CRM matching

1. Look up the account by exact work-email domain and the contact by exact work email in parallel. Reuse unique HubSpot matches. Multiple matches leave that record unresolved.
2. On an exact contact miss, look up the LinkedIn profile URL returned by verified email enrichment. A unique CRM match on that URL can identify the same person across email or name variations, including Bob versus Robert. A name alone does not identify a record.
3. Use the account owner for routing when configured. Otherwise use an existing contact owner if the account is unassigned. When the known owner has no configured booking link, show a backup calendar and preserve ownership in HubSpot.
4. Apply enrichment to blank supported fields on the matched contact. This flow reuses existing records and does not merge CRM objects or change owners. Once the booking response is ready, late enrichment may update the context while the chosen calendar remains fixed.

Use `bun run test` to replay the nickname, conflicting-owner, and ambiguous-record fixtures before changing the matching rules. Add a fixture for each reviewed edge case so later changes to the Play can be compared against the same expected decision.
