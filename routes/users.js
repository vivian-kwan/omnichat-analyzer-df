// routes/users.js — admin-only CRUD, but ONLY over data/users-managed.json
// (the gitignored tier — see middleware/auth.js's loadCoreUsers/
// loadManagedUsers split). data/users.json (core) is never written here —
// it's git-tracked on purpose so at least one admin account always
// survives a from-scratch deploy; core entries show up in GET /api/users
// (isCore: true) for visibility but are read-only through this API.
// Stricter than most admin-only features (adminOnly, not seniorOnly — see
// middleware/auth.js): this controls who can log in at all, including who
// else is senior/admin, so senior shouldn't inherit access to it.
// No hard delete — disable is the only removal path, so a disabled user's
// token never orphans the addedBy/createdByToken references it left behind
// in templates/customer-questions/ad-suggestions.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authMiddleware, adminOnly, loadCoreUsers, loadManagedUsers } = require('../middleware/auth');

const MANAGED_USERS_PATH = path.join(__dirname, '../data/users-managed.json');
const VALID_ROLES = ['admin', 'senior', 'standard'];

function saveManagedUsers(data) {
  fs.writeFileSync(MANAGED_USERS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Matches the shape of the one hand-crafted token already in use
// (vivian-1014d195-2026): {slugified-name}-{8 hex chars}-{year}.
function generateToken(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  const hex = uuidv4().replace(/-/g, '').slice(0, 8);
  const year = new Date().getFullYear();
  return `${slug}-${hex}-${year}`;
}

// GET /api/users — managed users always included; core users only included
// (and marked isCore:true) when the REQUESTER is themselves a core admin.
// A managed-tier admin gets no trace of core accounts at all — not a
// filtered-in-the-UI row, genuinely absent from this response — since a
// client-side-only hide would still leak them to anyone inspecting network
// traffic. Token is included (unlike other resources' createdByToken
// stripping): it's the thing being managed, and the admin needs to be able
// to read/copy it to hand a new user their login token.
// Record-keeping only — these are NOT used by any AI call server-side (the
// extension still sends its own key fresh on every request, per
// routes/analyze.js). Purely so an admin can track which key was issued to
// whom. toRow() keeps GET's shape (and PUT/POST's response shape) in sync
// with one definition.
function toRow(token, u, isCore) {
  return {
    token, name: u.name, role: u.role, disabled: !!u.disabled,
    createdAt: u.createdAt || null, createdBy: u.createdBy || null, isCore,
    apiKeyOpenAI: u.apiKeyOpenAI || '', apiKeyGemini: u.apiKeyGemini || '', apiKeyDeepSeek: u.apiKeyDeepSeek || ''
  };
}

router.get('/users', authMiddleware, adminOnly, (req, res) => {
  const core = loadCoreUsers().tokens;
  const managed = loadManagedUsers().tokens;
  const requesterIsCore = !!core[req.user.token];
  const list = [
    ...(requesterIsCore ? Object.entries(core).map(([token, u]) => toRow(token, u, true)) : []),
    ...Object.entries(managed).map(([token, u]) => toRow(token, u, false))
  ];
  list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  res.json({ success: true, data: list });
});

// POST /api/users  { name, role, apiKeyOpenAI?, apiKeyGemini?,
// apiKeyDeepSeek? } — always creates in the managed (gitignored) tier.
// Generates the token server-side.
router.post('/users', authMiddleware, adminOnly, (req, res) => {
  const { name, role, apiKeyOpenAI, apiKeyGemini, apiKeyDeepSeek } = req.body;
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ success: false, error: 'name is required.' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }
  const core = loadCoreUsers().tokens;
  const data = loadManagedUsers();
  let token = generateToken(name);
  while (core[token] || data.tokens[token]) token = generateToken(name); // astronomically unlikely, but stay correct
  const entry = {
    name: name.trim(),
    role,
    disabled: false,
    createdAt: new Date().toISOString(),
    createdBy: req.user.name,
    apiKeyOpenAI: typeof apiKeyOpenAI === 'string' ? apiKeyOpenAI.trim() : '',
    apiKeyGemini: typeof apiKeyGemini === 'string' ? apiKeyGemini.trim() : '',
    apiKeyDeepSeek: typeof apiKeyDeepSeek === 'string' ? apiKeyDeepSeek.trim() : ''
  };
  data.tokens[token] = entry;
  saveManagedUsers(data);
  res.json({ success: true, data: toRow(token, entry, false) });
});

// PUT /api/users/:token  { name?, role?, disabled?, apiKeyOpenAI?,
// apiKeyGemini?, apiKeyDeepSeek? } — partial update, managed tier only. A
// core token is looked up but never written to; it gets a clear 403
// instead of a silent no-op or a 404 that reads as "not found" when it
// obviously exists in the list the admin is looking at. Key fields accept
// an empty string to explicitly clear a previously-recorded key (a plain
// `if (value)` check would make that impossible).
router.put('/users/:token', authMiddleware, adminOnly, (req, res) => {
  const { name, role, disabled, apiKeyOpenAI, apiKeyGemini, apiKeyDeepSeek } = req.body;
  const core = loadCoreUsers().tokens;
  if (core[req.params.token]) {
    return res.status(403).json({ success: false, error: '呢個係核心管理員帳戶，唔可以透過呢度修改 — 需要直接編輯 data/users.json 並部署。' });
  }
  const data = loadManagedUsers();
  const entry = data.tokens[req.params.token];
  if (!entry) return res.status(404).json({ success: false, error: 'User not found.' });

  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }
  if (disabled === true && req.params.token === req.user.token) {
    return res.status(400).json({ success: false, error: 'You cannot disable the account you are currently logged in as.' });
  }

  if (typeof name === 'string' && name.trim()) entry.name = name.trim();
  if (role !== undefined) entry.role = role;
  if (typeof disabled === 'boolean') entry.disabled = disabled;
  if (typeof apiKeyOpenAI === 'string') entry.apiKeyOpenAI = apiKeyOpenAI.trim();
  if (typeof apiKeyGemini === 'string') entry.apiKeyGemini = apiKeyGemini.trim();
  if (typeof apiKeyDeepSeek === 'string') entry.apiKeyDeepSeek = apiKeyDeepSeek.trim();

  saveManagedUsers(data);
  res.json({ success: true, data: toRow(req.params.token, entry, false) });
});

// POST /api/users/:token/regenerate — issues a fresh token for the same
// user, invalidating the old one immediately. Managed tier only, same
// reasoning as PUT above — but doubly so here: a regenerated core token
// would only exist at runtime, and the next git deploy would silently
// revert data/users.json back to the old (now-invalid) token, re-creating
// exactly the lockout this whole two-tier split exists to prevent.
router.post('/users/:token/regenerate', authMiddleware, adminOnly, (req, res) => {
  const core = loadCoreUsers().tokens;
  if (core[req.params.token]) {
    return res.status(403).json({ success: false, error: '呢個係核心管理員帳戶，唔可以透過呢度重新產生 Token — 需要直接編輯 data/users.json 並部署。' });
  }
  const data = loadManagedUsers();
  const entry = data.tokens[req.params.token];
  if (!entry) return res.status(404).json({ success: false, error: 'User not found.' });

  let newToken = generateToken(entry.name);
  while (core[newToken] || data.tokens[newToken]) newToken = generateToken(entry.name);

  delete data.tokens[req.params.token];
  data.tokens[newToken] = entry;
  saveManagedUsers(data);
  res.json({ success: true, data: toRow(newToken, entry, false) });
});

module.exports = router;
