/**
 * /api/kill-switch — emergency stop.
 *
 * Body: { state: "on"|"off" }
 * Auth: X-Admin-Key
 *
 * When on, the cron poller and /api/poll endpoint both skip everything.
 */

export async function handleKillSwitch(req, env) {
  const body = await req.json().catch(() => ({}));
  const state = body.state === "on" ? "on" : "off";
  await env.STATE_KV.put("kill_switch:email_ai", state);
  return new Response(JSON.stringify({ ok: true, kill_switch: state }), {
    headers: { "content-type": "application/json" },
  });
}
