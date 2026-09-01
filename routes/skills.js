const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authMiddleware, seniorOnly } = require('../middleware/auth');
const { callAI } = require('../lib/ai');

const SKILLS_DIR = path.join(__dirname, '../data/skills');
const VERSIONS_DIR = path.join(SKILLS_DIR, 'versions');
fs.mkdirSync(VERSIONS_DIR, { recursive: true });

function safeName(raw) {
  return String(raw || '').replace(/[^a-z0-9\-_]/gi, '');
}

function versionsFilePath(name) {
  return path.join(VERSIONS_DIR, `${name}.json`);
}

function loadVersionHistory(name) {
  try {
    return JSON.parse(fs.readFileSync(versionsFilePath(name), 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveVersionHistory(name, history) {
  fs.writeFileSync(versionsFilePath(name), JSON.stringify(history, null, 2), 'utf8');
}

// Line-level LCS diff — not a full unified diff, just enough to report an
// added/removed line count per version for the history list. Skill files
// are at most a few hundred lines, so the O(lines^2) table is negligible
// and only ever runs on save/read, not in any hot path.
function diffLineCounts(oldText, newText) {
  const a = (oldText || '').split('\n');
  const b = (newText || '').split('\n');
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lcsLen = dp[0][0];
  return { added: n - lcsLen, removed: m - lcsLen };
}

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
  const name = safeName(req.params.name);
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

// PUT /api/skills/:name — update a skill file (senior only). Whatever was
// live gets snapshotted into the version-history file BEFORE being
// overwritten, so every save is restorable — nothing is ever silently lost.
router.put('/skills/:name', authMiddleware, seniorOnly, (req, res) => {
  const name = safeName(req.params.name);
  const filePath = path.join(SKILLS_DIR, `${name}.txt`);
  if (!filePath.startsWith(SKILLS_DIR)) {
    return res.status(400).json({ error: 'Invalid skill name.' });
  }
  const { content, label } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Missing content.' });
  }
  try {
    let previousContent = '';
    try { previousContent = fs.readFileSync(filePath, 'utf8'); } catch (e) { /* first-ever save — nothing to snapshot */ }

    const history = loadVersionHistory(name);
    if (previousContent) {
      const priorEntryContent = history.length ? history[history.length - 1].content : '';
      const diff = diffLineCounts(priorEntryContent, previousContent);
      history.push({
        id: Date.now(),
        timestamp: new Date().toISOString(),
        author: req.user.name || 'Unknown',
        label: (label || '').trim(),
        content: previousContent,
        diffAdded: diff.added,
        diffRemoved: diff.removed
      });
      saveVersionHistory(name, history);
    }

    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ success: true, message: `Skill "${name}" saved.`, version: history.length + 1 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/skills/:name/versions — history list, newest first. Content is
// omitted here (full text only via the endpoint below or the live GET) to
// keep the list cheap even once a skill has a long history.
router.get('/skills/:name/versions', authMiddleware, seniorOnly, (req, res) => {
  const name = safeName(req.params.name);
  const filePath = path.join(SKILLS_DIR, `${name}.txt`);
  if (!filePath.startsWith(SKILLS_DIR)) {
    return res.status(400).json({ error: 'Invalid skill name.' });
  }
  try {
    const history = loadVersionHistory(name);
    const liveContent = fs.readFileSync(filePath, 'utf8');
    const lastEntryContent = history.length ? history[history.length - 1].content : '';
    const liveDiff = diffLineCounts(lastEntryContent, liveContent);

    const versions = history.map((v, i) => ({
      id: v.id, version: i + 1, timestamp: v.timestamp, author: v.author, label: v.label,
      diffAdded: v.diffAdded, diffRemoved: v.diffRemoved, current: false
    }));
    versions.push({
      id: 'current', version: history.length + 1, timestamp: null, author: null, label: '',
      diffAdded: liveDiff.added, diffRemoved: liveDiff.removed, current: true
    });
    versions.reverse();
    res.json({ success: true, versions });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/skills/:name/versions/:id — full content of one historical
// version, for Preview or Restore-to-draft.
router.get('/skills/:name/versions/:id', authMiddleware, seniorOnly, (req, res) => {
  const name = safeName(req.params.name);
  try {
    const history = loadVersionHistory(name);
    const entry = history.find(v => String(v.id) === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Version not found.' });
    res.json({ success: true, content: entry.content, timestamp: entry.timestamp, author: entry.author, label: entry.label });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/skills/:name/test — runs an UNSAVED draft prompt against sample
// conversations pasted in from a 下載對話 CSV export, so an admin can see
// what a prompt change would actually produce before committing it. Never
// touches the skill file or version history — :name only scopes the route,
// the draft text itself comes from the request body. Runs samples
// sequentially (not Promise.all) to stay under provider rate limits; a
// batch of ~10 takes a handful of seconds per sample, acceptable for a
// manual pre-save check rather than a hot path.
router.post('/skills/:name/test', authMiddleware, seniorOnly, async (req, res) => {
  const { content, provider, apiKey, samples } = req.body;
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Missing draft content.' });
  }
  if (!provider || !apiKey) {
    return res.status(400).json({ error: 'Missing provider or apiKey.' });
  }
  if (!Array.isArray(samples) || samples.length === 0) {
    return res.status(400).json({ error: 'Missing sample conversations.' });
  }

  const results = [];
  for (const sample of samples.slice(0, 10)) {
    try {
      const userMessage = `Messages to analyze:\n${JSON.stringify(sample.messages)}`;
      const raw = await callAI(provider, apiKey, content, userMessage);
      results.push({ name: sample.name, success: true, raw });
    } catch (e) {
      results.push({ name: sample.name, success: false, error: e.message });
    }
  }
  res.json({ success: true, results });
});

module.exports = router;
