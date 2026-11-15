import { NextResponse } from 'next/server';
import { startDemoPlay } from '../../../../lib/booking-demo';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({error:'Wrong origin'}, {status:403});
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (body?.dry_run !== true || !/^inbound-demo-[a-zA-Z0-9_-]{8,70}$/.test(body?.session_id ?? '') ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !(email.endsWith('.example') || email.endsWith('@deepline.com'))) {
    return NextResponse.json({error:'Use an internal Deepline test address or a reserved .example address.'}, {status:400});
  }
  try {
    const run = await startDemoPlay({action:'start',session_id:body.session_id,email,dry_run:true});
    return NextResponse.json({session_id:body.session_id,run,wait_minutes:30,delivery_enabled:false});
  } catch {
    return NextResponse.json({error:'Could not start the cloud timer. Retry with the same session ID.'}, {status:502});
  }
}
