export async function onRequestGet({ env, params }) {
  const candidate = await env.DB.prepare(
    'SELECT on_chain_id AS onChainId, name, image_url AS imageUrl FROM candidates WHERE on_chain_id = ?'
  ).bind(params.onChainId).first();

  if (!candidate) return Response.json({ error: 'Candidate not found' }, { status: 404 });
  return Response.json(candidate);
}
