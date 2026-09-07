// routes/users.js — admin-only CRUD over data/users.json's token→{name,role}
// map. Stricter than most admin-only features (adminOnly, not seniorOnly —
// see middleware/auth.js): this controls who can log in at all, including
// who else is senior/admin, so senior shouldn't inherit access to it.
// No hard delete — disable is the only removal path, so a disabled user's
// token never orphans the addedBy/createdByToken references it left behind
// in templates/customer-questions/ad-suggestions.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authMiddleware, adminOnly, getUsers } = require('../middleware/auth');

const USERS_PATH = path.join(__dirname, '../data/users.json');
const VALID_ROLES = ['admin', 'senior', 'standard'];

function saveUsers(data) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Matches the shape of the one hand-crafted token already in use
// (vivian-1014d195-2026): {slugified-name}-{8 hex chars}-{year}.
function generateToken(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  const hex = uuidv4().replace(/-/g, '').slice(0, 8);
  const year = new Date().getFullYear();
  return `${slug}-${hex}-${year}`;
}

// GET /api/users — token is included (unlike other resources' createdByToken
// stripping): it's the thing being managed, and the admin needs to be able
// to read/copy it to hand a new user their login token.
router.get('/users', authMiddleware, adminOnly, (req, res) => {
  const { tokens } = getUsers();
  const list = Object.entries(tokens).map(([token, u]) => ({
    token,
    name: u.name,
    role: u.role,
    disabled: !!u.disabled,
    createdAt: u.createdAt || null,
    createdBy: u.createdBy || null
  }));
  list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  res.json({ success: true, data: list });
});

// POST /api/users  { name, role } — generates the token server-side.
router.post('/users', authMiddleware, adminOnly, (req, res) => {
  const { name, role } = req.body;
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ success: false, error: 'name is required.' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }
  const data = getUsers();
  let token = generateToken(name);
  while (data.tokens[token]) token = generateToken(name); // astronomically unlikely, but stay correct
  const entry = {
    name: name.trim(),
    role,
    disabled: false,
    createdAt: new Date().toISOString(),
    createdBy: req.user.name
  };
  data.tokens[token] = entry;
  saveUsers(data);
  res.json({ success: true, data: { token, ...entry } });
});

// PUT /api/users/:token  { name?, role?, disabled? } — partial update.
router.put('/users/:token', authMiddleware, adminOnly, (req, res) => {
  const { name, role, disabled } = req.body;
  const data = getUsers();
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

  saveUsers(data);
  res.json({ success: true, data: { token: req.params.token, ...entry } });
});

module.exports = router;
