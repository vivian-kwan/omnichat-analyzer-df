// routes/announcement.js — the dismissible bar shown at the top of every
// rep's panel. GET is open to any authenticated user (it's shown to
// everyone); PUT (editing) is senior/admin only, same as skills.js — edited
// via the rich-text fields in public/admin/skills.html, not from within the
// extension itself.
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authMiddleware, seniorOnly } = require('../middleware/auth');

const ANNOUNCEMENT_PATH = path.join(__dirname, '../data/announcement.json');

const DEFAULT_ANNOUNCEMENT = {
  content: '此軟件為試用版',
  cta1Text: '使用手冊',
  cta1Content: '',
  cta2Text: '每月KPI',
  cta2Content: ''
};

function loadAnnouncement() {
  try {
    return { ...DEFAULT_ANNOUNCEMENT, ...JSON.parse(fs.readFileSync(ANNOUNCEMENT_PATH, 'utf8')) };
  } catch (e) {
    return { ...DEFAULT_ANNOUNCEMENT };
  }
}

function saveAnnouncement(data) {
  fs.writeFileSync(ANNOUNCEMENT_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/announcement
router.get('/announcement', authMiddleware, (req, res) => {
  res.json({ success: true, data: loadAnnouncement() });
});

// PUT /api/announcement  { content?, cta1Text?, cta1Content?, cta2Text?, cta2Content? }
// cta*Content is rich HTML from the admin panel's editor — trusted, senior/
// admin-authored content, rendered via innerHTML client-side (same trust
// model as skill file content).
router.put('/announcement', authMiddleware, seniorOnly, (req, res) => {
  const { content, cta1Text, cta1Content, cta2Text, cta2Content } = req.body;
  const current = loadAnnouncement();
  const updated = {
    content: typeof content === 'string' ? content : current.content,
    cta1Text: typeof cta1Text === 'string' ? cta1Text : current.cta1Text,
    cta1Content: typeof cta1Content === 'string' ? cta1Content : current.cta1Content,
    cta2Text: typeof cta2Text === 'string' ? cta2Text : current.cta2Text,
    cta2Content: typeof cta2Content === 'string' ? cta2Content : current.cta2Content
  };
  saveAnnouncement(updated);
  res.json({ success: true, data: updated });
});

module.exports = router;
