/** @mermaid
 * flowchart TD
 * start["Save the demo session"] --> wait["Wait 30 minutes in the cloud"]
 * wait --> check["Read booking events again"]
 * check --> result["Log the decision; send nothing"]
 */
import { defineInput, definePlay } from 'deepline';

type Input = {
  action: 'start' | 'booking_event' | 'inspect';
  session_id: string;
  email?: string;
  dry_run: true;
  event_id?: string;
  event_type?: 'invitee.created' | 'invitee.canceled';
  invitee_uri?: string;
  occurred_at?: string;
};
const q = (value: string) => "'" + value.replace(/'/g, "''") + "'";

export default definePlay({
  id: 'booking-abandonment-demo',
  description: 'Dry run: save a demo session, wait 30 real minutes, then log whether a booking event was observed. Never sends messages or changes CRM contacts.',
  billing: { maxCreditsPerRun: 1 },
  bindings: { secrets: ['INBOUND_BOOKING_DEMO_WEBHOOK_KEY'], webhook: { hmac: {
    algorithm: 'sha256', secretEnv: 'INBOUND_BOOKING_DEMO_WEBHOOK_KEY', header: 'x-booking-demo-signature'
  } } },
  input: defineInput<Input>({ type: 'object', additionalProperties: false,
    required: ['action', 'session_id', 'dry_run'],
    properties: {
      action: { type: 'string', enum: ['start', 'booking_event', 'inspect'] },
      session_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,100}$' },
      email: { type: 'string' }, dry_run: { type: 'boolean', const: true },
      event_id: { type: 'string' }, event_type: { type: 'string', enum: ['invitee.created','invitee.canceled'] },
      invitee_uri: { type: 'string' }, occurred_at: { type: 'string' }
    }
  }),
  run: async (ctx, input: Input) => {
    if (input.dry_run !== true || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.session_id)) throw new Error('A valid dry-run session is required.');
    const sid = q(input.session_id);
    await ctx.customerDb.query(`CREATE TABLE IF NOT EXISTS storage.booking_demo_sessions_v1 (
      session_id text PRIMARY KEY, email text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
      due_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes', run_id text NOT NULL,
      decision text, checked_at timestamptz, delivery_enabled boolean NOT NULL DEFAULT false
    )`);
    await ctx.customerDb.query(`CREATE TABLE IF NOT EXISTS storage.booking_demo_events_v1 (
      event_id text PRIMARY KEY, session_id text NOT NULL, event_type text NOT NULL,
      invitee_uri text NOT NULL, occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
    )`);
    if (input.action === 'booking_event') {
      if (!input.event_id || input.event_id.length > 300 || !input.invitee_uri || input.invitee_uri.length > 500 ||
          !['invitee.created','invitee.canceled'].includes(input.event_type ?? '') ||
          !Number.isFinite(Date.parse(input.occurred_at ?? ''))) throw new Error('Invalid booking event.');
      await ctx.customerDb.query(`INSERT INTO storage.booking_demo_events_v1 (event_id,session_id,event_type,invitee_uri,occurred_at)
        VALUES (${q(input.event_id)},${sid},${q(input.event_type!)},${q(input.invitee_uri)},${q(input.occurred_at!)}::timestamptz)
        ON CONFLICT (event_id) DO NOTHING`);
      return { session_id: input.session_id, dry_run: true, delivery_enabled: false, events: await ctx.customerDb.query(`SELECT event_id,event_type,occurred_at FROM storage.booking_demo_events_v1 WHERE session_id=${sid}`) };
    }
    if (input.action === 'start') {
      const email = (input.email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !(email.endsWith('.example') || email.endsWith('@deepline.com'))) throw new Error('Use a reserved .example address or an internal Deepline test address.');
      // @mermaid-node start in:"input" out:"session"
      const session = await ctx.customerDb.query<{run_id:string}>(`INSERT INTO storage.booking_demo_sessions_v1 (session_id,email,run_id)
        VALUES (${sid},${q(email)},${q(ctx.run.id)}) ON CONFLICT (session_id) DO NOTHING RETURNING run_id`);
      if (!session.length) return { duplicate: true, delivery_enabled: false };
      // @mermaid-node wait
      await ctx.sleep(30 * 60 * 1000);
      // This query runs after the sleep boundary, so it sees events received while the run was parked.
      // Cancellation is terminal for an invitee URI; a reschedule creates a new URI.
      // @mermaid-node check
      await ctx.customerDb.query(`UPDATE storage.booking_demo_sessions_v1 s SET
        decision=CASE WHEN EXISTS (
          SELECT 1 FROM storage.booking_demo_events_v1 e WHERE e.session_id=s.session_id AND e.event_type='invitee.created'
          AND NOT EXISTS (SELECT 1 FROM storage.booking_demo_events_v1 c WHERE c.session_id=e.session_id AND c.invitee_uri=e.invitee_uri AND c.event_type='invitee.canceled')
        ) THEN 'booking_observed' ELSE 'no_booking_observed' END, checked_at=now()
        WHERE s.session_id=${sid} AND s.decision IS NULL AND s.due_at<=now()`);
    }
    // @mermaid-node result
    return { dry_run: true, delivery_enabled: false,
      rows: await ctx.customerDb.query(`SELECT session_id,email,started_at,due_at,checked_at,decision,delivery_enabled FROM storage.booking_demo_sessions_v1 WHERE session_id=${sid}`),
      note: 'Event observation only. This demo does not prove Calendly-to-HubSpot sync is complete and never sends a follow-up.'
    };
  }
});
