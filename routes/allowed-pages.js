// routes/allowed-pages.js — which Omnichat pages the extension's 分析 buttons
// are enabled on (the "conversation page gate" in content.js). Previously a
// hardcoded `pathname.includes('/conversation')`, which silently disabled the
// tool on any other screen that also shows a chat (e.g. the inbox). GET is
// open to any authenticated user (every rep's extension reads it); PUT is
// senior/admin, edited from the admin panel.
// data/allowed-pages.json is runtime-written, so it is gitignored — and a
// missing/corrupt file falls back to DEFAULT_PAGES rather than an empty list,
// so a fresh deploy can never leave every rep's 分析 button disabled.
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authMiddleware, seniorOnly } = require('../middleware/auth');

const PAGES_PATH = path.join(__dirname, '../data/allowed-pages.json');
const REQUIRED_HOST = 'console.omnichat.ai'; // the extension's content script only runs here
const MAX_PAGES = 20;
const DEFAULT_PAGES = [
  'https://console.omnichat.ai/conversation',
  'https://console.omnichat.ai/inbox'
];

// "https://console.omnichat.ai/inbox/?x=1#y" -> "https://console.omnichat.ai/inbox"
// Returns { value } or { error }. A bare site root is rejected: it would match
// every page and make the gate meaningless.
function normalizePage(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { error: '網址唔可以留空。' };
  let u;
  try { u = new URL(raw.trim()); } catch (e) { return { error: `唔係有效網址：${raw}` }; }
  if (u.protocol !== 'https:' || u.hostname !== REQUIRED_HOST) {
    return { error: `只接受 https://${REQUIRED_HOST}/… 嘅網址：${raw}` };
  }
  const p = u.pathname.replace(/\/+$/, '');
  if (!p) return { error: `請填寫具體頁面路徑，唔可以只係網站首頁：${raw}` };
  return { value: u.origin + p };
}

function loadPages() {
  try {
    const data = JSON.parse(fs.readFileSync(PAGES_PATH, 'utf8'));
    const pages = (Array.isArray(data) ? data : data.pages || [])
      .map(normalizePage).filter(r => r.value).map(r => r.value);
    if (pages.length > 0) return [...new Set(pages)];
  } catch (e) { /* fall through to defaults */ }
  return [...DEFAULT_PAGES];
}

// GET /api/allowed-pages
router.get('/allowed-pages', authMiddleware, (req, res) => {
  res.json({ success: true, data: loadPages() });
});

// PUT /api/allowed-pages  { pages: ["https://console.omnichat.ai/inbox", ...] }
router.put('/allowed-pages', authMiddleware, seniorOnly, (req, res) => {
  const { pages } = req.body;
  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ success: false, error: '至少要有一個網址。' });
  }
  if (pages.length > MAX_PAGES) {
    return res.status(400).json({ success: false, error: `最多 ${MAX_PAGES} 個網址。` });
  }
  const cleaned = [];
  for (const raw of pages) {
    const r = normalizePage(raw);
    if (r.error) return res.status(400).json({ success: false, error: r.error });
    cleaned.push(r.value);
  }
  const unique = [...new Set(cleaned)];
  fs.writeFileSync(PAGES_PATH, JSON.stringify({ pages: unique }, null, 2), 'utf8');
  res.json({ success: true, data: unique });
});

module.exports = router;
