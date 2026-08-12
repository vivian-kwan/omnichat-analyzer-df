require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const analyzeRouter = require('./routes/analyze');
const skillsRouter = require('./routes/skills');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static files (admin UI, updates.xml, .crx)
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', analyzeRouter);
app.use('/api', skillsRouter);

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Omnichat Analyzer server running on port ${PORT}`);
});
