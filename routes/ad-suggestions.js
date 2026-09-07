// routes/ad-suggestions.js — 廣告素材追問建議: a static reference list mapping
// an ad creative's name to a suggested follow-up question for reps to use
// once a customer from that ad reaches 邀請報價. Same split as
// routes/announcement.js: GET is open to any authenticated user (the
// extension's runSuggestFollowup() reads it to match against the chat's
// scraped Ad ID stub name), writes are senior/admin only — managed via
// public/admin/skills.html, never added/edited from within the extension.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authMiddleware, seniorOnly } = require('../middleware/auth');

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

// GET /api/ad-suggestions — sorted newest-created first. Open to any
// authenticated user (read-only) — see file header.
router.get('/ad-suggestions', authMiddleware, (req, res) => {
  const suggestions = loadSuggestions();
  const sorted = [...suggestions].sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  res.json({ success: true, data: sorted });
});

// POST /api/ad-suggestions  { adName, suggestedQuestion }
router.post('/ad-suggestions', authMiddleware, seniorOnly, (req, res) => {
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
    addedAt: new Date().toISOString()
  };
  suggestions.push(entry);
  saveSuggestions(suggestions);
  res.json({ success: true, data: entry });
});

// PUT /api/ad-suggestions/:id  { adName, suggestedQuestion }
router.put('/ad-suggestions/:id', authMiddleware, seniorOnly, (req, res) => {
  const { adName, suggestedQuestion } = req.body;
  const suggestions = loadSuggestions();
  const entry = suggestions.find(s => s.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Suggestion not found.' });
  if (typeof adName === 'string' && adName.trim()) entry.adName = adName.trim();
  if (typeof suggestedQuestion === 'string' && suggestedQuestion.trim()) entry.suggestedQuestion = suggestedQuestion.trim();
  saveSuggestions(suggestions);
  res.json({ success: true, data: entry });
});

// DELETE /api/ad-suggestions/:id
router.delete('/ad-suggestions/:id', authMiddleware, seniorOnly, (req, res) => {
  const suggestions = loadSuggestions();
  const entry = suggestions.find(s => s.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false, error: 'Suggestion not found.' });
  const next = suggestions.filter(s => s.id !== req.params.id);
  saveSuggestions(next);
  res.json({ success: true });
});

module.exports = router;
