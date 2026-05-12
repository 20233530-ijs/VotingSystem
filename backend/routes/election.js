const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/election', (req, res) => {
  const election = db.prepare('SELECT * FROM election WHERE id = 1').get();
  const candidates = db
    .prepare('SELECT on_chain_id AS onChainId, name, image_url AS imageUrl FROM candidates ORDER BY on_chain_id')
    .all();

  res.json({
    title: election ? election.title : null,
    candidates
  });
});

router.get('/candidates', (req, res) => {
  const candidates = db
    .prepare('SELECT on_chain_id AS onChainId, name, image_url AS imageUrl FROM candidates ORDER BY on_chain_id')
    .all();
  res.json(candidates);
});

router.get('/candidates/:onChainId', (req, res) => {
  const candidate = db
    .prepare('SELECT on_chain_id AS onChainId, name, image_url AS imageUrl FROM candidates WHERE on_chain_id = ?')
    .get(req.params.onChainId);

  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }

  res.json(candidate);
});

module.exports = router;
