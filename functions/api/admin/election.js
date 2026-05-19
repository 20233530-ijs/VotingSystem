function requireAdmin(request, env) {
  const key = request.headers.get('X-Admin-Key');
  return key && key === env.ADMIN_API_KEY;
}

export async function onRequestPost({ request, env }) {
  if (!requireAdmin(request, env))
    return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { title } = await request.json();
  if (!title || !title.trim())
    return Response.json({ error: 'Title is required' }, { status: 400 });

  await env.DB.prepare(
    `INSERT INTO election (id, title, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = CURRENT_TIMESTAMP`
  ).bind(title.trim()).run();

  return Response.json({ success: true }, { status: 201 });
}
