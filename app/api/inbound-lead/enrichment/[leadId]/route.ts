import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { leadId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(leadId))
    return NextResponse.json({ error: "Invalid enrichment id." }, { status: 400 });
  const url = process.env.KV_REST_API_URL?.replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN?.trim();
  if (!url || !token)
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  const response = await fetch(
    `${url}/get/${encodeURIComponent(`inbound-enrichment:${leadId}`)}`,
    {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(1_800),
    },
  );
  const body = (await response.json().catch(() => null)) as {
    result?: string | null;
  } | null;
  if (!response.ok)
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  if (!body?.result) return NextResponse.json({ status: "pending" });
  try {
    return NextResponse.json(JSON.parse(body.result) as unknown);
  } catch {
    return NextResponse.json(
      { status: "failed", error: "Saved enrichment data could not be read." },
      { status: 502 },
    );
  }
}
