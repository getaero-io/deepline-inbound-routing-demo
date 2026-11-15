import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyCalendly(raw: string, header: string, secret: string, now = Date.now()) {
  const fields = header.split(',').map(part => part.trim().split('='));
  const timestamps = fields.filter(([key]) => key === 't').map(([, value]) => value);
  const signatures = fields.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0] ?? '') || !secret) return false;
  const timestamp = timestamps[0];
  if (Math.abs(now / 1000 - Number(timestamp)) > 180) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest();
  return signatures.some(sig => /^[a-f0-9]{64}$/i.test(sig ?? '') && timingSafeEqual(expected, Buffer.from(sig, 'hex')));
}

export function normalizeCalendly(body: any) {
  const p = body?.payload;
  if (!['invitee.created', 'invitee.canceled'].includes(body?.event)) throw new Error('Unsupported event');
  const session = p?.tracking?.utm_content;
  if (typeof session !== 'string' || !/^inbound-demo-[a-zA-Z0-9_-]{8,70}$/.test(session)) throw new Error('No demo session');
  if (typeof p?.uri !== 'string' || !p.uri.startsWith('https://api.calendly.com/scheduled_events/')) throw new Error('Invalid invitee');
  if (!Number.isFinite(Date.parse(body.created_at ?? ''))) throw new Error('Invalid event time');
  return { action: 'booking_event', session_id: session, dry_run: true,
    event_id: `${body.event}:${p.uri}`, event_type: body.event, invitee_uri: p.uri, occurred_at: body.created_at };
}

export async function startDemoPlay(input: Record<string, unknown>) {
  const key = process.env.INBOUND_BOOKING_WEBHOOK_KEY;
  const url = process.env.INBOUND_BOOKING_WEBHOOK_URL;
  if (!key || !url || new URL(url).origin !== 'https://code.deepline.com') throw new Error('Booking demo is not configured');
  const body = JSON.stringify(input);
  const signature = createHmac('sha256',key).update(body).digest('hex');
  const response = await fetch(url, {
    method: 'POST', headers: { 'x-booking-demo-signature': `sha256=${signature}`, 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(20000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Deepline admission failed (${response.status})`);
  return result;
}
