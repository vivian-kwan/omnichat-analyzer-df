// routes/templates.js — shared, senior-curated reply templates.
// GET is open to any authenticated user (every rep's panel benefits from
// the token savings); POST/PUT/DELETE are senior-only, same pattern as
// routes/skills.js.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authMiddleware, seniorOnly } = require('../middleware/auth');

const TEMPLATES_PATH = path.join(__dirname, '../data/templates.json');

// Keep in sync with LABEL_ORDER in Plug-in/content.js and the categories
// in AGENTS/skills/home-analysis-skill.md.
const VALID_STAGES = ['邀請報價', '提供報價', '推進考慮', '邀請預約上門', '成功預約上門'];

function loadTemplates() {
  try {
    return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveTemplates(templates) {
  fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2), 'utf8');
}

// GET /api/templates
router.get('/templates', authMiddleware, (req, res) => {
  res.json({ success: true, data: loadTemplates() });
});

// POST /api/templates  { stage, text }
router.post('/templates', authMiddleware, seniorOnly, (req, res) => {
  const { stage, text } = req.body;
  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ success: false, error: `stage must be one of: ${VALID_STAGES.join(', ')}` });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'text is required.' });
  }
  const templates = loadTemplates();
  const entry = { id: uuidv4(), stage, text: text.trim(), addedBy: req.user.name, addedAt: new Date().toISOString() };
  templates.push(entry);
  saveTemplates(templates);
  res.json({ success: true, data: entry });
});

// PUT /api/templates/:id  { stage, text }
router.put('/templates/:id', authMiddleware, seniorOnly, (req, res) => {
  const { stage, text } = req.body;
  if (stage !== undefined && !VALID_STAGES.includes(stage)) {
    return res.status(400).json({ success: false, error: `stage must be one of: ${VALID_STAGES.join(', ')}` });
  }
  const templates = loadTemplates();
  const entry = templates.find(t => t.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Template not found.' });
  if (stage !== undefined) entry.stage = stage;
  if (typeof text === 'string' && text.trim()) entry.text = text.trim();
  saveTemplates(templates);
  res.json({ success: true, data: entry });
});

// DELETE /api/templates/:id
router.delete('/templates/:id', authMiddleware, seniorOnly, (req, res) => {
  const templates = loadTemplates();
  const next = templates.filter(t => t.id !== req.params.id);
  if (next.length === templates.length) return res.status(404).json({ success: false, error: 'Template not found.' });
  saveTemplates(next);
  res.json({ success: true });
});

module.exports = router;
