const express = require('express');
const router = express.Router();
const db = require('../db');

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.post('/election', adminAuth, (req, res) => {
  const { title } = req.body;
  if (!title || title.trim().length === 0) {
    return res.status(400).json({ error: 'Title is required' });
  }

  db.prepare(`
    INSERT INTO election (id, title, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = CURRENT_TIMESTAMP
  `).run(title.trim());

  res.status(201).json({ success: true });
});

router.post('/candidates', adminAuth, (req, res) => {
  const { onChainId, name, imageUrl } = req.body;

  if (!onChainId || !name || name.trim().length === 0) {
    return res.status(400).json({ error: 'onChainId and name are required' });
  }

  if (imageUrl && !/^https?:\/\//.test(imageUrl)) {
    return res.status(400).json({ error: 'Invalid imageUrl format' });
  }

  db.prepare(`
    INSERT INTO candidates (on_chain_id, name, image_url, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(on_chain_id) DO UPDATE SET
      name = excluded.name,
      image_url = excluded.image_url
  `).run(onChainId, name.trim(), imageUrl || null);

  res.status(201).json({ success: true });
});

module.exports = router;
