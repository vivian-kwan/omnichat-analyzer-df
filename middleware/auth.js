const fs = require('fs');
const path = require('path');

// Two-tier split, added 2026-09-08 after an outage where the single
// users.json got gitignored (matching the other runtime-written data
// files), a deploy wiped it, and NOTHING could authenticate afterward —
// not even to fix it, since this server's interactive SSH/SFTP users have
// no write access to data/ at all (only the deploy process does). Core
// users (data/users.json) stay git-tracked deliberately, so at least one
// admin account always survives a from-scratch deploy no matter what;
// everyone added via 用戶管理 lives in the separate, gitignored
// data/users-managed.json instead, which CAN wipe/reset across deploys
// without ever locking every admin out entirely.
const CORE_USERS_PATH = path.join(__dirname, '../data/users.json');
const MANAGED_USERS_PATH = path.join(__dirname, '../data/users-managed.json');

function loadCoreUsers() {
  try {
    return JSON.parse(fs.readFileSync(CORE_USERS_PATH, 'utf8'));
  } catch (e) {
    return { tokens: {} };
  }
}

function loadManagedUsers() {
  try {
    return JSON.parse(fs.readFileSync(MANAGED_USERS_PATH, 'utf8'));
  } catch (e) {
    return { tokens: {} };
  }
}

// Merged view for auth lookups. Core wins on a token collision — a
// managed-file entry (which routes/users.js writes to on every add/edit)
// should never be able to shadow or overwrite a core account.
function getUsers() {
  const core = loadCoreUsers();
  const managed = loadManagedUsers();
  return { tokens: { ...managed.tokens, ...core.tokens } };
}

// Validates X-Extension-Secret + X-Token, attaches user to req
function authMiddleware(req, res, next) {
  const secret = req.headers['x-extension-secret'];
  if (secret !== process.env.EXTENSION_SECRET) {
    return res.status(401).json({ error: 'Invalid extension secret.' });
  }

  const token = req.headers['x-token'];
  if (!token) {
    return res.status(401).json({ error: 'Missing user token.' });
  }

  const { tokens } = getUsers();
  const user = tokens[token];
  if (!user) {
    return res.status(403).json({ error: 'Unrecognised token. Ask your admin to add you.' });
  }
  if (user.disabled) {
    return res.status(403).json({ error: '此帳戶已被停用，請聯絡管理員。' });
  }

  // token itself is attached (not just name/role) so routes can do their own
  // per-resource ownership checks (e.g. "did this user create this
  // template?") without re-reading the header — see routes/templates.js.
  req.user = { ...user, token };
  next();
}

// Use after authMiddleware — blocks anyone who isn't senior or admin. Kept
// the name seniorOnly (rather than renaming everywhere) since admin is a
// strict superset of senior's access, not a separate tier with its own gate.
function seniorOnly(req, res, next) {
  if (req.user.role !== 'senior' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'This action requires senior access.' });
  }
  next();
}

// Stricter than seniorOnly — admin is not a superset gate here, it's the
// only tier allowed. User management controls who can log in at all
// (including who else is senior/admin), so it doesn't inherit senior's
// access the way most other admin-only features do.
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'This action requires admin access.' });
  }
  next();
}

module.exports = { authMiddleware, seniorOnly, adminOnly, getUsers, loadCoreUsers, loadManagedUsers };
