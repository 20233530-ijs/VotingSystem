export async function onRequestGet({ env }) {
  const election = await env.DB.prepare(
    'SELECT * FROM election WHERE id = 1'
  ).first();

  const { results: candidates } = await env.DB.prepare(
    'SELECT on_chain_id AS onChainId, name, image_url AS imageUrl FROM candidates ORDER BY on_chain_id'
  ).all();

  return Response.json({ title: election ? election.title : null, candidates });
}
