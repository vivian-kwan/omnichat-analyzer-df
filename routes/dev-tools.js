// Local-dev-only convenience routes. This router is only ever mounted when
// ENABLE_DEV_TOOLS=true is set in .env (see index.js) — .env is gitignored,
// so a fresh clone or a normal Cloudways deploy never has it set, and these
// routes simply don't exist there. They shell out to a Python script that
// reads a local Google Drive path on the developer's own Mac, so they are
// meaningless anywhere else anyway.
const express = require('express');
const path = require('path');
const { execFile } = require('child_process');
const router = express.Router();
const { authMiddleware, seniorOnly } = require('../middleware/auth');

const SYNC_SCRIPT = path.join(__dirname, '../docs/sync_copy_from_xlsx.py');

// POST /api/dev/sync-copy  { apply: boolean }
// apply=false (default) runs --dry-run and only reports what would change.
// apply=true actually writes content.js / skills.html.
router.post('/dev/sync-copy', authMiddleware, seniorOnly, (req, res) => {
  const apply = req.body && req.body.apply === true;
  const args = [SYNC_SCRIPT];
  if (!apply) args.push('--dry-run');

  execFile('python3', args, { timeout: 20000 }, (err, stdout, stderr) => {
    if (err && !stdout) {
      return res.status(500).json({ success: false, error: stderr || err.message });
    }
    res.json({ success: true, data: { output: stdout, applied: apply } });
  });
});

module.exports = router;
