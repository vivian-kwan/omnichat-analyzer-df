const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authMiddleware, seniorOnly } = require('../middleware/auth');

const SKILLS_DIR = path.join(__dirname, '../data/skills');

// GET /api/skills — list available skill names (senior only)
router.get('/skills', authMiddleware, seniorOnly, (req, res) => {
  try {
    const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.txt'));
    const skills = files.map(f => f.replace('.txt', ''));
    res.json({ success: true, skills });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/skills/:name — read a skill file (senior only)
router.get('/skills/:name', authMiddleware, seniorOnly, (req, res) => {
  const name = req.params.name.replace(/[^a-z0-9\-_]/gi, '');
  const filePath = path.join(SKILLS_DIR, `${name}.txt`);
  if (!filePath.startsWith(SKILLS_DIR)) {
    return res.status(400).json({ error: 'Invalid skill name.' });
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ success: true, name, content });
  } catch (e) {
    res.status(404).json({ success: false, error: `Skill "${name}" not found.` });
  }
});

// PUT /api/skills/:name — update a skill file (senior only)
router.put('/skills/:name', authMiddleware, seniorOnly, (req, res) => {
  const name = req.params.name.replace(/[^a-z0-9\-_]/gi, '');
  const filePath = path.join(SKILLS_DIR, `${name}.txt`);
  if (!filePath.startsWith(SKILLS_DIR)) {
    return res.status(400).json({ error: 'Invalid skill name.' });
  }
  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Missing content.' });
  }
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ success: true, message: `Skill "${name}" saved.` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
