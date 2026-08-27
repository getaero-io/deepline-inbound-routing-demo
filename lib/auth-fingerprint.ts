import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type AuthFingerprint = {
  provider: string | null;
  confidence: "high" | "medium" | "none";
  source: "technology_profile" | "public_site" | "public_auth_endpoint" | "none";
  detail: string;
};

const FINGERPRINTS: Array<[string, RegExp]> = [
  ["Better Auth", /\b(?:better-auth|betterauth)\b/i],
  ["Auth0", /\bauth0(?:\.com)?\b/i],
  ["WorkOS", /\bworkos(?:\.com)?\b/i],
  ["Okta", /\bokta(?:\.com)?\b/i],
  ["Clerk", /\bclerk(?:\.dev)?\b/i],
  ["Stytch", /\bstytch(?:\.com)?\b/i],
  ["Descope", /\bdescope(?:\.com)?\b/i],
  ["Frontegg", /\bfrontegg(?:\.com)?\b/i],
  ["Supabase Auth", /\bsupabase(?:\.co)?\b/i],
  ["Firebase Authentication", /\bfirebase(?:app|auth)?\b/i],
  ["Amazon Cognito", /\b(?:aws)?cognito\b/i],
  ["Keycloak", /\bkeycloak\b/i],
  ["Microsoft Entra ID", /\b(?:microsoftonline|entra)\b/i],
];

const NONE: AuthFingerprint = {
  provider: null,
  confidence: "none",
  source: "none",
  detail: "No public authentication-provider fingerprint detected",
};

function fingerprint(value: string, source: AuthFingerprint["source"]): AuthFingerprint {
  const match = FINGERPRINTS.find(([, pattern]) => pattern.test(value));
  if (!match) return NONE;
  return {
    provider: match[0],
    confidence: source === "technology_profile" ? "high" : "medium",
    source,
    detail:
      source === "technology_profile"
        ? "Matched in the Deepline technology profile"
        : "Matched in public site headers or markup",
  };
}

export function authFromTechnologies(technologies: string[]) {
  return fingerprint(technologies.join(" "), "technology_profile");
}

function validDomain(value: string) {
  const domain = value.trim().toLowerCase();
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    ? domain
    : null;
}

function privateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

async function assertPublicHost(hostname: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expires = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Public signal DNS lookup timed out.")),
      900,
    );
  });
  try {
    const addresses = await Promise.race([lookup(hostname, { all: true }), expires]);
    if (!addresses.length || addresses.some(({ address }) => privateAddress(address)))
      throw new Error("Public signal host did not resolve to a public address.");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function safeFetch(domain: string, path = "/") {
  let url = new URL(path, `https://${domain}`);
  for (let redirect = 0; redirect < 2; redirect += 1) {
    if (
      url.protocol !== "https:" ||
      (url.hostname !== domain && url.hostname !== `www.${domain}`)
    )
      throw new Error("Public signal redirect left the submitted domain.");
    await assertPublicHost(url.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_400);
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Deepline inbound routing fingerprint/1.0" },
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      url = new URL(location, url);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Public signal redirect limit reached.");
}

export async function detectAuthProvider(domainInput: string): Promise<AuthFingerprint> {
  const domain = validDomain(domainInput);
  if (!domain) return { ...NONE, detail: "Public authentication check was skipped" };
  try {
    const response = await safeFetch(domain);
    const headers = [...response.headers]
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n");
    const markup = (await response.text()).slice(0, 180_000);
    const detected = fingerprint(`${headers}\n${markup}`, "public_site");
    if (detected.provider) return detected;
  } catch {
    return { ...NONE, detail: "Public authentication fingerprint was unavailable" };
  }

  try {
    const response = await safeFetch(domain, "/api/auth/ok");
    const body = (await response.text()).slice(0, 1_000).trim();
    if (response.ok && /^\{\s*"ok"\s*:\s*true\s*\}$/.test(body))
      return {
        provider: "Better Auth",
        confidence: "medium",
        source: "public_auth_endpoint",
        detail: "Public endpoint behavior is consistent with Better Auth",
      };
  } catch {
    // This signal is optional and never participates in routing.
  }
  return NONE;
}
