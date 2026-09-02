const fs = require('fs');
const path = require('path');

const USERS_PATH = path.join(__dirname, '../data/users.json');

function getUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch (e) {
    return { tokens: {} };
  }
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

module.exports = { authMiddleware, seniorOnly, getUsers };
