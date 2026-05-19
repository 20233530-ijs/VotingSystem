export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT on_chain_id AS onChainId, name, image_url AS imageUrl FROM candidates ORDER BY on_chain_id'
  ).all();
  return Response.json(results);
}
