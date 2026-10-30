import { randomUUID } from "node:crypto";

export function workEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const domain = email.split("@")[1];
  if (
    new Set([
      "gmail.com",
      "googlemail.com",
      "yahoo.com",
      "hotmail.com",
      "outlook.com",
      "icloud.com",
      "aol.com",
      "protonmail.com",
      "proton.me",
      "live.com",
      "msn.com",
      "me.com",
      "ymail.com",
    ]).has(domain)
  )
    return null;
  return email;
}

async function command(parts: unknown[]) {
  const url = process.env.KV_REST_API_URL?.replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token) return null;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(parts),
    signal: AbortSignal.timeout(1800),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Progress storage unavailable.");
  const body = await response.json();
  if (body.error) throw new Error("Progress storage rejected the request.");
  return body.result;
}

// Only an explicit Continue action captures an email, never keystrokes or blur.
// These records are not outreach consent and never trigger nurture.
export async function captureEmail(email: string) {
  const captureId = randomUUID();
  const result = await command([
    "SET",
    `inbound-progress:${captureId}`,
    JSON.stringify({
      email,
      stage: "email_captured",
      capturedAt: new Date().toISOString(),
    }),
    "EX",
    86400,
  ]);
  return {
    captureId: result === "OK" ? captureId : null,
    persisted: result === "OK",
  };
}

export async function markSubmitted(captureId: unknown, email: string) {
  if (typeof captureId !== "string" || !/^[0-9a-f-]{36}$/.test(captureId)) return;
  // Compare and update atomically; an ID cannot be reused for another email.
  const script = `local v=redis.call('GET',KEYS[1]); if not v then return 0 end; local r=cjson.decode(v); if r.email~=ARGV[1] then return 0 end; r.stage='submitted'; r.submittedAt=ARGV[2]; redis.call('SET',KEYS[1],cjson.encode(r),'KEEPTTL'); return 1`;
  await command([
    "EVAL",
    script,
    1,
    `inbound-progress:${captureId}`,
    email,
    new Date().toISOString(),
  ]);
}

export async function readCapture(captureId: string) {
  if (!/^[0-9a-f-]{36}$/.test(captureId)) return null;
  const value = await command(["GET", `inbound-progress:${captureId}`]);
  return typeof value === "string" ? JSON.parse(value) : null;
}
