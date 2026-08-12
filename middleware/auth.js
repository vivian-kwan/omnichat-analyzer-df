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

  req.user = user;
  next();
}

// Use after authMiddleware — blocks non-senior users
function seniorOnly(req, res, next) {
  if (req.user.role !== 'senior') {
    return res.status(403).json({ error: 'This action requires senior access.' });
  }
  next();
}

module.exports = { authMiddleware, seniorOnly, getUsers };
