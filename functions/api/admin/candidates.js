function requireAdmin(request, env) {
  const key = request.headers.get('X-Admin-Key');
  return key && key === env.ADMIN_API_KEY;
}

export async function onRequestPost({ request, env }) {
  if (!requireAdmin(request, env))
    return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { onChainId, name, imageUrl } = await request.json();
  if (!onChainId || !name || !name.trim())
    return Response.json({ error: 'onChainId and name are required' }, { status: 400 });

  if (imageUrl && !/^https?:\/\//.test(imageUrl))
    return Response.json({ error: 'Invalid imageUrl format' }, { status: 400 });

  await env.DB.prepare(
    `INSERT INTO candidates (on_chain_id, name, image_url, created_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(on_chain_id) DO UPDATE SET name = excluded.name, image_url = excluded.image_url`
  ).bind(onChainId, name.trim(), imageUrl || null).run();

  return Response.json({ success: true }, { status: 201 });
}
