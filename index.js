require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const analyzeRouter = require('./routes/analyze');
const skillsRouter = require('./routes/skills');
const templatesRouter = require('./routes/templates');
const { authMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static files (admin UI, updates.xml, .crx)
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/me — any authenticated user (not senior-only) looks up their own name/role,
// so the extension can gate UI locally (identity readout, senior-only settings fields)
// without granting any new server permissions.
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ success: true, data: { name: req.user.name, role: req.user.role } });
});

// API routes
app.use('/api', analyzeRouter);
app.use('/api', skillsRouter);
app.use('/api', templatesRouter);

// Local-dev-only routes (copy-inventory sync) — only exist at all when
// ENABLE_DEV_TOOLS=true is explicitly set in .env. Never set this on a
// deployed server; the routes shell out to a script that only makes sense
// on the developer's own machine.
if (process.env.ENABLE_DEV_TOOLS === 'true') {
  const devToolsRouter = require('./routes/dev-tools');
  app.use('/api', devToolsRouter);
  console.log('Dev tools enabled: POST /api/dev/sync-copy');
}

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Omnichat Analyzer server running on port ${PORT}`);
});
