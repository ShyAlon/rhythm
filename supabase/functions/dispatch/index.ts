// Rhythm reminder dispatcher.
// Called every 5 minutes by a GitHub Actions cron with a shared secret header.
// Sends Web Push (VAPID) reminders for habits whose reminder_time is due in the
// user's own timezone, at most once per habit per day, skipping completed ones.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const expected = Deno.env.get('DISPATCH_SECRET');
  if (!expected || req.headers.get('x-dispatch-secret') !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'https://github.com/ShyAlon/rhythm',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );

  const now = new Date();
  const { data: profiles, error } = await sb.from('profiles').select('user_id, tz');
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  let deduped = 0;
  let pruned = 0;
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const p of profiles ?? []) {
    const tz = p.tz || 'UTC';
    let parts: Record<string, string>;
    try {
      parts = {};
      for (const part of new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      }).formatToParts(now)) {
        parts[part.type] = part.value;
      }
    } catch {
      continue; // unknown timezone stored; skip this user
    }
    const hh = parts.hour === '24' ? '00' : parts.hour;
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    const dow = DOW.indexOf(parts.weekday ?? '');
    const minutesNow = parseInt(hh, 10) * 60 + parseInt(parts.minute, 10);

    const { data: habits } = await sb
      .from('habits')
      .select('id, name, emoji, recurrence, target_time, reminder_time')
      .eq('user_id', p.user_id)
      .eq('reminder_enabled', true)
      .eq('archived', false)
      .eq('deleted', false);

    for (const h of habits ?? []) {
      if (!h.reminder_time) continue;
      const [rh, rm] = (h.reminder_time as string).split(':').map(Number);
      const diff = minutesNow - (rh * 60 + rm);
      if (diff < 0 || diff > 10) continue; // 10-minute lookback to absorb cron jitter
      const rec = h.recurrence as { kind: string; days?: number[] };
      const dueToday = rec?.kind === 'daily' || (rec?.kind === 'weekly' && Array.isArray(rec.days) && rec.days.includes(dow));
      if (!dueToday) continue;

      // Dedupe: first writer wins for (user, habit, day)
      const { error: logErr } = await sb.from('push_log').insert({ user_id: p.user_id, habit_id: h.id, day });
      if (logErr) { deduped++; continue; }

      // Already done today? Then no nag.
      const { data: comp } = await sb.from('completions').select('done').eq('habit_id', h.id).eq('day', day).maybeSingle();
      if (comp?.done) continue;

      const { data: subs } = await sb.from('push_subscriptions').select('endpoint, keys').eq('user_id', p.user_id);
      const payload = JSON.stringify({
        title: `${h.emoji} ${h.name}`,
        body: h.target_time ? `Target time: ${h.target_time}` : 'Time to check in',
        tag: `${h.id}:${day}`,
        url: '/rhythm/',
      });
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
            pruned++;
          }
        }
      }
    }
  }

  return json({ ok: true, sent, deduped, pruned, users: profiles?.length ?? 0 });
});
