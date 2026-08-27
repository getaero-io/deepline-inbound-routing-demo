export function authProviderLabel(
  auth: { provider: string | null } | undefined,
  enrichmentStatus: string | undefined,
) {
  if (auth) return auth.provider ?? "No provider found";
  return enrichmentStatus === "pending" ? "Checking…" : "Not checked";
}
