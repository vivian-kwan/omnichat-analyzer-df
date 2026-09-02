// routes/templates.js — shared reply templates, open to every authenticated
// user with per-template ownership rather than a single senior/standard gate.
// GET is open to all. POST (add) is open to all. PUT/DELETE are open to the
// template's own creator; senior/admin can PUT/DELETE any template.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

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

function isPrivileged(role) {
  return role === 'senior' || role === 'admin';
}

// Sort tier for each stage's list: admin-authored first, then senior, then
// standard. Templates created before per-user attribution existed have no
// createdByRole — they're treated as senior tier (product decision: only
// senior users could add templates before this feature, so that's the
// closest true answer, not just a neutral default).
function roleRank(role) {
  if (role === 'admin') return 3;
  if (role === 'senior') return 2;
  return 1; // standard
}

// senior/admin can manage (edit/delete) any template; anyone else only their
// own — matched by comparing their own token (attached by authMiddleware)
// against the token recorded when the template was created.
function canManage(req, entry) {
  return isPrivileged(req.user.role) || entry.createdByToken === req.user.token;
}

// Strips createdByToken before anything reaches a client — it exists only
// for the server-side ownership check above and must never be exposed,
// since GET /api/templates is readable by every authenticated user and the
// token is effectively that creator's login credential. canManage tells the
// extension whether to show Edit/Delete for this row without ever handing
// it another user's token to compare itself.
function toClientShape(entry, req) {
  const { createdByToken, ...rest } = entry;
  return { ...rest, canManage: canManage(req, entry) };
}

// GET /api/templates — sorted per stage (creator role, then creator name,
// then newest-created first) so the client can group the already-sorted
// list by stage into each accordion without re-sorting itself.
router.get('/templates', authMiddleware, (req, res) => {
  const templates = loadTemplates();
  const sorted = [...templates].sort((a, b) => {
    const roleDiff = roleRank(b.createdByRole || 'senior') - roleRank(a.createdByRole || 'senior');
    if (roleDiff !== 0) return roleDiff;
    const nameDiff = (a.addedBy || '').localeCompare(b.addedBy || '', 'zh-Hant');
    if (nameDiff !== 0) return nameDiff;
    return new Date(b.addedAt) - new Date(a.addedAt);
  });
  res.json({ success: true, data: sorted.map(t => toClientShape(t, req)) });
});

// POST /api/templates  { stage, text } — open to any authenticated user.
router.post('/templates', authMiddleware, (req, res) => {
  const { stage, text } = req.body;
  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ success: false, error: `stage must be one of: ${VALID_STAGES.join(', ')}` });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'text is required.' });
  }
  const templates = loadTemplates();
  const entry = {
    id: uuidv4(),
    stage,
    text: text.trim(),
    addedBy: req.user.name,
    addedAt: new Date().toISOString(),
    createdByToken: req.user.token,
    createdByRole: req.user.role
  };
  templates.push(entry);
  saveTemplates(templates);
  res.json({ success: true, data: toClientShape(entry, req) });
});

// PUT /api/templates/:id  { stage?, text? } — creator, or senior/admin for
// any template. Ownership fields (createdByToken/addedBy/createdByRole)
// never change on edit, even when senior/admin edits someone else's entry —
// editing doesn't transfer authorship.
router.put('/templates/:id', authMiddleware, (req, res) => {
  const { stage, text } = req.body;
  if (stage !== undefined && !VALID_STAGES.includes(stage)) {
    return res.status(400).json({ success: false, error: `stage must be one of: ${VALID_STAGES.join(', ')}` });
  }
  const templates = loadTemplates();
  const entry = templates.find(t => t.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Template not found.' });
  if (!canManage(req, entry)) {
    return res.status(403).json({ success: false, error: 'You can only edit templates you created.' });
  }
  if (stage !== undefined) entry.stage = stage;
  if (typeof text === 'string' && text.trim()) entry.text = text.trim();
  saveTemplates(templates);
  res.json({ success: true, data: toClientShape(entry, req) });
});

// DELETE /api/templates/:id — same ownership rule as PUT.
router.delete('/templates/:id', authMiddleware, (req, res) => {
  const templates = loadTemplates();
  const entry = templates.find(t => t.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Template not found.' });
  if (!canManage(req, entry)) {
    return res.status(403).json({ success: false, error: 'You can only delete templates you created.' });
  }
  const next = templates.filter(t => t.id !== req.params.id);
  saveTemplates(next);
  res.json({ success: true });
});

module.exports = router;
