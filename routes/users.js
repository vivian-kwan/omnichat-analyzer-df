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

// GET /api/users — core + managed users combined (core marked isCore:true,
// read-only). Token is included (unlike other resources' createdByToken
// stripping): it's the thing being managed, and the admin needs to be able
// to read/copy it to hand a new user their login token.
router.get('/users', authMiddleware, adminOnly, (req, res) => {
  const core = loadCoreUsers().tokens;
  const managed = loadManagedUsers().tokens;
  const list = [
    ...Object.entries(core).map(([token, u]) => ({
      token, name: u.name, role: u.role, disabled: !!u.disabled,
      createdAt: u.createdAt || null, createdBy: u.createdBy || null, isCore: true
    })),
    ...Object.entries(managed).map(([token, u]) => ({
      token, name: u.name, role: u.role, disabled: !!u.disabled,
      createdAt: u.createdAt || null, createdBy: u.createdBy || null, isCore: false
    }))
  ];
  list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  res.json({ success: true, data: list });
});

// POST /api/users  { name, role } — always creates in the managed
// (gitignored) tier. Generates the token server-side.
router.post('/users', authMiddleware, adminOnly, (req, res) => {
  const { name, role } = req.body;
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
    createdBy: req.user.name
  };
  data.tokens[token] = entry;
  saveManagedUsers(data);
  res.json({ success: true, data: { token, ...entry, isCore: false } });
});

// PUT /api/users/:token  { name?, role?, disabled? } — partial update,
// managed tier only. A core token is looked up but never written to; it
// gets a clear 403 instead of a silent no-op or a 404 that reads as "not
// found" when it obviously exists in the list the admin is looking at.
router.put('/users/:token', authMiddleware, adminOnly, (req, res) => {
  const { name, role, disabled } = req.body;
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

  saveManagedUsers(data);
  res.json({ success: true, data: { token: req.params.token, ...entry, isCore: false } });
});

module.exports = router;
