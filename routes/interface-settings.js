// routes/interface-settings.js — team-wide values behind Settings → 介面設置
// (品牌活躍度提醒 ratio, 訊息格式權重, 格式分佈提示門檻). These used to live in
// each person's own Chrome profile, so a senior's change only affected their
// own panel. GET is open to any authenticated user (every rep's extension
// reads it); PUT is senior/admin, same as who can see the card in the
// extension. data/interface-settings.json is runtime-written, so it is
// gitignored; a missing/corrupt file (or any invalid field in it) falls back
// to DEFAULTS, which must match defaultSettings in the extension's content.js.
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authMiddleware, seniorOnly } = require('../middleware/auth');

const SETTINGS_PATH = path.join(__dirname, '../data/interface-settings.json');

const DEFAULTS = {
  ratioThreshold: 2,
  mediaWeightText: 1,
  mediaWeightImage: 0.25,
  mediaWeightVideo: 0.5,
  mediaWeightAudio: 1,
  formatAdviceMinMessages: 5
};

const RULES = {
  ratioThreshold:          { min: 0.01, max: 100,  integer: false, label: '品牌 ÷ 客人訊息比例' },
  mediaWeightText:         { min: 0,    max: 100,  integer: false, label: '文字權重' },
  mediaWeightImage:        { min: 0,    max: 100,  integer: false, label: '圖片權重' },
  mediaWeightVideo:        { min: 0,    max: 100,  integer: false, label: '影片權重' },
  mediaWeightAudio:        { min: 0,    max: 100,  integer: false, label: '錄音權重' },
  formatAdviceMinMessages: { min: 0,    max: 1000, integer: true,  label: '格式分佈提示門檻' }
};

// Returns { value } or { error }.
function validate(key, raw) {
  const rule = RULES[key];
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (raw === '' || raw === null || !Number.isFinite(n)) return { error: `${rule.label}要係數字。` };
  if (rule.integer && !Number.isInteger(n)) return { error: `${rule.label}要係整數。` };
  if (n < rule.min || n > rule.max) return { error: `${rule.label}要喺 ${rule.min} 至 ${rule.max} 之間。` };
  return { value: n };
}

function loadSettings() {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) || {}; } catch (e) { /* defaults */ }
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (key in stored) {
      const r = validate(key, stored[key]);
      if (r.value !== undefined) out[key] = r.value;
    }
  }
  return out;
}

// GET /api/interface-settings
router.get('/interface-settings', authMiddleware, (req, res) => {
  res.json({ success: true, data: loadSettings() });
});

// PUT /api/interface-settings  { ratioThreshold?, mediaWeightText?, ... }
// Partial update: only known keys present in the body are validated and
// changed; everything else keeps its current value. Unknown keys are ignored.
router.put('/interface-settings', authMiddleware, seniorOnly, (req, res) => {
  const body = req.body || {};
  const next = loadSettings();
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in body)) continue;
    const r = validate(key, body[key]);
    if (r.error) return res.status(400).json({ success: false, error: r.error });
    next[key] = r.value;
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  res.json({ success: true, data: next });
});

module.exports = router;
