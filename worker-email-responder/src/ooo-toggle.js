/**
 * /api/ooo-toggle — flip the OOO flag and inbox watch flag.
 *
 * Body: { ooo: "on"|"off", watchInbox: "on"|"off" }
 * Auth: X-Admin-Key
 *
 * KV keys set:
 *   ooo:chris            → "on" | "off"
 *   ooo:chris:watchInbox → "on" | "off"
 */

export async function handleOooToggle(req, env) {
  const body = await req.json().catch(() => ({}));
  const ooo = body.ooo === "on" ? "on" : "off";
  const watch = body.watchInbox === "on" ? "on" : "off";

  await Promise.all([
    env.STATE_KV.put("ooo:chris", ooo),
    env.STATE_KV.put("ooo:chris:watchInbox", watch),
  ]);

  // Reset historyId cursor when turning on so we start clean
  if (ooo === "on" && watch === "on") {
    await env.STATE_KV.delete("cursor:chris_ooo");
  }

  return new Response(JSON.stringify({
    ok: true,
    ooo,
    watchInbox: watch,
    sendMode: env.SEND_MODE,
    note: env.SEND_MODE === "dry_run"
      ? "Worker is in dry_run mode — nothing will actually send. Set SEND_MODE=draft_only or auto_send to enable replies."
      : null,
  }), { headers: { "content-type": "application/json" } });
}
