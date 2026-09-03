// routes/customer-questions.js — shared library of known customer questions,
// used to skip sending a repeat question to the AI and to hide its raw text
// in the results list. Same ownership model as routes/templates.js (open
// add, own-only edit/delete for standard, any for senior/admin) — no
// `stage` field though, these aren't tied to a funnel stage the way brand
// reply templates are.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

const QUESTIONS_PATH = path.join(__dirname, '../data/customer-questions.json');

function loadQuestions() {
  try {
    return JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveQuestions(questions) {
  fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(questions, null, 2), 'utf8');
}

function isPrivileged(role) {
  return role === 'senior' || role === 'admin';
}

function roleRank(role) {
  if (role === 'admin') return 3;
  if (role === 'senior') return 2;
  return 1; // standard
}

function canManage(req, entry) {
  return isPrivileged(req.user.role) || entry.createdByToken === req.user.token;
}

// Same reasoning as templates.js's toClientShape — createdByToken is a login
// credential and must never reach a client, even though GET is readable by
// every authenticated user.
function toClientShape(entry, req) {
  const { createdByToken, ...rest } = entry;
  return { ...rest, canManage: canManage(req, entry) };
}

// GET /api/customer-questions — sorted by creator role, then name, then
// newest-created first, same as GET /api/templates.
router.get('/customer-questions', authMiddleware, (req, res) => {
  const questions = loadQuestions();
  const sorted = [...questions].sort((a, b) => {
    const roleDiff = roleRank(b.createdByRole || 'senior') - roleRank(a.createdByRole || 'senior');
    if (roleDiff !== 0) return roleDiff;
    const nameDiff = (a.addedBy || '').localeCompare(b.addedBy || '', 'zh-Hant');
    if (nameDiff !== 0) return nameDiff;
    return new Date(b.addedAt) - new Date(a.addedAt);
  });
  res.json({ success: true, data: sorted.map(q => toClientShape(q, req)) });
});

// POST /api/customer-questions  { text } — open to any authenticated user.
router.post('/customer-questions', authMiddleware, (req, res) => {
  const { text } = req.body;
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'text is required.' });
  }
  const questions = loadQuestions();
  const entry = {
    id: uuidv4(),
    text: text.trim(),
    addedBy: req.user.name,
    addedAt: new Date().toISOString(),
    createdByToken: req.user.token,
    createdByRole: req.user.role
  };
  questions.push(entry);
  saveQuestions(questions);
  res.json({ success: true, data: toClientShape(entry, req) });
});

// PUT /api/customer-questions/:id  { text } — creator, or senior/admin for any.
router.put('/customer-questions/:id', authMiddleware, (req, res) => {
  const { text } = req.body;
  const questions = loadQuestions();
  const entry = questions.find(q => q.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Question not found.' });
  if (!canManage(req, entry)) {
    return res.status(403).json({ success: false, error: 'You can only edit questions you created.' });
  }
  if (typeof text === 'string' && text.trim()) entry.text = text.trim();
  saveQuestions(questions);
  res.json({ success: true, data: toClientShape(entry, req) });
});

// DELETE /api/customer-questions/:id — same ownership rule as PUT.
router.delete('/customer-questions/:id', authMiddleware, (req, res) => {
  const questions = loadQuestions();
  const entry = questions.find(q => q.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Question not found.' });
  if (!canManage(req, entry)) {
    return res.status(403).json({ success: false, error: 'You can only delete questions you created.' });
  }
  const next = questions.filter(q => q.id !== req.params.id);
  saveQuestions(next);
  res.json({ success: true });
});

module.exports = router;
