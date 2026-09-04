// routes/ad-suggestions.js — 廣告素材追問建議: a static reference list mapping
// an ad creative's name to a suggested follow-up question for reps to use
// once a customer from that ad reaches 邀請報價. Same ownership model and
// shape as routes/customer-questions.js, just two text fields (adName,
// suggestedQuestion) instead of one. Purely a manual lookup list — not
// matched against scraped chat data anywhere.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

const SUGGESTIONS_PATH = path.join(__dirname, '../data/ad-suggestions.json');

function loadSuggestions() {
  try {
    return JSON.parse(fs.readFileSync(SUGGESTIONS_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveSuggestions(suggestions) {
  fs.writeFileSync(SUGGESTIONS_PATH, JSON.stringify(suggestions, null, 2), 'utf8');
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

// createdByToken is a login credential and must never reach a client, even
// though GET is readable by every authenticated user.
function toClientShape(entry, req) {
  const { createdByToken, ...rest } = entry;
  return { ...rest, canManage: canManage(req, entry) };
}

// GET /api/ad-suggestions — sorted by creator role, then name, then newest-created first.
router.get('/ad-suggestions', authMiddleware, (req, res) => {
  const suggestions = loadSuggestions();
  const sorted = [...suggestions].sort((a, b) => {
    const roleDiff = roleRank(b.createdByRole || 'senior') - roleRank(a.createdByRole || 'senior');
    if (roleDiff !== 0) return roleDiff;
    const nameDiff = (a.addedBy || '').localeCompare(b.addedBy || '', 'zh-Hant');
    if (nameDiff !== 0) return nameDiff;
    return new Date(b.addedAt) - new Date(a.addedAt);
  });
  res.json({ success: true, data: sorted.map(s => toClientShape(s, req)) });
});

// POST /api/ad-suggestions  { adName, suggestedQuestion } — open to any authenticated user.
router.post('/ad-suggestions', authMiddleware, (req, res) => {
  const { adName, suggestedQuestion } = req.body;
  if (typeof adName !== 'string' || !adName.trim()) {
    return res.status(400).json({ success: false, error: 'adName is required.' });
  }
  if (typeof suggestedQuestion !== 'string' || !suggestedQuestion.trim()) {
    return res.status(400).json({ success: false, error: 'suggestedQuestion is required.' });
  }
  const suggestions = loadSuggestions();
  const entry = {
    id: uuidv4(),
    adName: adName.trim(),
    suggestedQuestion: suggestedQuestion.trim(),
    addedBy: req.user.name,
    addedAt: new Date().toISOString(),
    createdByToken: req.user.token,
    createdByRole: req.user.role
  };
  suggestions.push(entry);
  saveSuggestions(suggestions);
  res.json({ success: true, data: toClientShape(entry, req) });
});

// PUT /api/ad-suggestions/:id  { adName, suggestedQuestion } — creator, or senior/admin for any.
router.put('/ad-suggestions/:id', authMiddleware, (req, res) => {
  const { adName, suggestedQuestion } = req.body;
  const suggestions = loadSuggestions();
  const entry = suggestions.find(s => s.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Suggestion not found.' });
  if (!canManage(req, entry)) {
    return res.status(403).json({ success: false, error: 'You can only edit suggestions you created.' });
  }
  if (typeof adName === 'string' && adName.trim()) entry.adName = adName.trim();
  if (typeof suggestedQuestion === 'string' && suggestedQuestion.trim()) entry.suggestedQuestion = suggestedQuestion.trim();
  saveSuggestions(suggestions);
  res.json({ success: true, data: toClientShape(entry, req) });
});

// DELETE /api/ad-suggestions/:id — same ownership rule as PUT.
router.delete('/ad-suggestions/:id', authMiddleware, (req, res) => {
  const suggestions = loadSuggestions();
  const entry = suggestions.find(s => s.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Suggestion not found.' });
  if (!canManage(req, entry)) {
    return res.status(403).json({ success: false, error: 'You can only delete suggestions you created.' });
  }
  const next = suggestions.filter(s => s.id !== req.params.id);
  saveSuggestions(next);
  res.json({ success: true });
});

module.exports = router;
