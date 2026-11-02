import { captureEmail, readCapture, workEmail } from "../../../../lib/capture";

export async function GET(request: Request) {
  try {
    const record = await readCapture(new URL(request.url).searchParams.get("captureId") ?? "");
    return Response.json(record ?? { error: "Progress not found or expired." }, {
      status: record ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Progress storage unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = workEmail(body?.email);
  if (!email) return Response.json({ error: "Enter a valid work email." }, { status: 400 });
  try {
    return Response.json(await captureEmail(email), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Could not save your progress. Please try again." },
      { status: 503 },
    );
  }
}
