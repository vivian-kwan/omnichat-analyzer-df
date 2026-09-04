// routes/announcement.js — the dismissible bar shown at the top of every
// rep's panel. GET is open to any authenticated user (it's shown to
// everyone); PUT and version history are senior/admin only, same as
// skills.js — edited via the rich-text fields in public/admin/skills.html,
// not from within the extension itself.
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authMiddleware, seniorOnly } = require('../middleware/auth');

const ANNOUNCEMENT_PATH = path.join(__dirname, '../data/announcement.json');
const VERSIONS_PATH = path.join(__dirname, '../data/announcement-versions.json');

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

function loadVersionHistory() {
  try {
    return JSON.parse(fs.readFileSync(VERSIONS_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveVersionHistory(history) {
  fs.writeFileSync(VERSIONS_PATH, JSON.stringify(history, null, 2), 'utf8');
}

// Stand-in for skills.js's line-diff, adapted for a multi-field object
// (bar text + 2 CTA labels + 2 rich-HTML bodies) rather than one text blob —
// a line diff doesn't mean much across 5 mixed fields, so this is a simple
// combined character-count delta instead.
function combinedLength(a) {
  return (a.content || '').length + (a.cta1Text || '').length + (a.cta1Content || '').length
    + (a.cta2Text || '').length + (a.cta2Content || '').length;
}

// GET /api/announcement
router.get('/announcement', authMiddleware, (req, res) => {
  res.json({ success: true, data: loadAnnouncement() });
});

// PUT /api/announcement  { content?, cta1Text?, cta1Content?, cta2Text?, cta2Content?, label? }
// Whatever was live BEFORE this update gets snapshotted into version history
// FIRST — same "snapshot before overwrite" mechanic as routes/skills.js, so
// every save is restorable. cta*Content is rich HTML from the admin panel's
// editor — trusted, senior/admin-authored content, rendered via innerHTML
// client-side (same trust model as skill file content).
router.put('/announcement', authMiddleware, seniorOnly, (req, res) => {
  const { content, cta1Text, cta1Content, cta2Text, cta2Content, label } = req.body;
  const current = loadAnnouncement();
  const updated = {
    content: typeof content === 'string' ? content : current.content,
    cta1Text: typeof cta1Text === 'string' ? cta1Text : current.cta1Text,
    cta1Content: typeof cta1Content === 'string' ? cta1Content : current.cta1Content,
    cta2Text: typeof cta2Text === 'string' ? cta2Text : current.cta2Text,
    cta2Content: typeof cta2Content === 'string' ? cta2Content : current.cta2Content
  };

  const history = loadVersionHistory();
  const priorEntry = history.length ? history[history.length - 1] : null;
  const priorSnapshot = priorEntry ? priorEntry.data : DEFAULT_ANNOUNCEMENT;
  history.push({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    author: req.user.name || 'Unknown',
    label: (label || '').trim(),
    data: current,
    charDiff: combinedLength(current) - combinedLength(priorSnapshot)
  });
  saveVersionHistory(history);

  saveAnnouncement(updated);
  res.json({ success: true, data: updated, version: history.length + 1 });
});

// GET /api/announcement/versions — history list, newest first. data is
// omitted here (full content only via the endpoint below) to keep the list
// cheap once there's a long history — same pattern as skills.js.
router.get('/announcement/versions', authMiddleware, seniorOnly, (req, res) => {
  const history = loadVersionHistory();
  const live = loadAnnouncement();
  const lastEntry = history.length ? history[history.length - 1] : null;
  const lastSnapshot = lastEntry ? lastEntry.data : DEFAULT_ANNOUNCEMENT;
  const liveDiff = combinedLength(live) - combinedLength(lastSnapshot);

  const versions = history.map((v, i) => ({
    id: v.id, version: i + 1, timestamp: v.timestamp, author: v.author, label: v.label,
    charDiff: v.charDiff, current: false
  }));
  versions.push({
    id: 'current', version: history.length + 1, timestamp: null, author: null, label: '',
    charDiff: liveDiff, current: true
  });
  versions.reverse();
  res.json({ success: true, versions });
});

// GET /api/announcement/versions/:id — full snapshot of one historical
// version, for Preview or Restore-to-draft.
router.get('/announcement/versions/:id', authMiddleware, seniorOnly, (req, res) => {
  const history = loadVersionHistory();
  const entry = history.find(v => String(v.id) === req.params.id);
  if (!entry) return res.status(404).json({ error: 'Version not found.' });
  res.json({ success: true, data: entry.data, timestamp: entry.timestamp, author: entry.author, label: entry.label });
});

module.exports = router;
