import { NextResponse } from 'next/server';
import { normalizeCalendly, startDemoPlay, verifyCalendly } from '../../../../lib/booking-demo';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = process.env.INBOUND_BOOKING_CALENDLY_SIGNING_KEY;
  if (!secret) return NextResponse.json({error:'Webhook not configured'}, {status:503});
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 65536) return NextResponse.json({error:'Payload too large'}, {status:413});
  if (!verifyCalendly(raw, request.headers.get('calendly-webhook-signature') ?? '', secret)) return NextResponse.json({error:'Invalid signature'}, {status:401});
  let input;
  try { input = normalizeCalendly(JSON.parse(raw)); }
  catch { return NextResponse.json({ignored:true,reason:'Not a supported, correlated demo booking'}); }
  try {
    const run = await startDemoPlay(input);
    return NextResponse.json({accepted:true,run});
  } catch { return NextResponse.json({error:'Event was not accepted; retry delivery'}, {status:502}); }
}
