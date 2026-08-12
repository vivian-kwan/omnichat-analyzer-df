const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

const SKILLS_DIR = path.join(__dirname, '../data/skills');

function loadSkill(name) {
  try {
    return fs.readFileSync(path.join(SKILLS_DIR, `${name}.txt`), 'utf8').trim();
  } catch (e) {
    throw new Error(`Skill file "${name}.txt" not found.`);
  }
}

async function callAI(provider, apiKey, systemPrompt, userMessage) {
  if (provider === 'openai' || provider === 'deepseek') {
    const isOpenAI = provider === 'openai';
    const url = isOpenAI
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.deepseek.com/chat/completions';
    const model = isOpenAI ? 'gpt-4o-mini' : 'deepseek-chat';

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `${provider} API error: ${res.status}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API error: ${res.status}`);
    }
    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// POST /api/analyze — home tab chat analysis
router.post('/analyze', authMiddleware, async (req, res) => {
  const { provider, apiKey, messages } = req.body;
  if (!provider || !apiKey || !messages) {
    return res.status(400).json({ error: 'Missing provider, apiKey, or messages.' });
  }
  try {
    const systemPrompt = loadSkill('home-analysis');
    const userMessage = `Messages to analyze:\n${JSON.stringify(messages)}`;
    const result = await callAI(provider, apiKey, systemPrompt, userMessage);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/deep-analyze — insights tab batch analysis
router.post('/deep-analyze', authMiddleware, async (req, res) => {
  const { provider, apiKey, chatData } = req.body;
  if (!provider || !apiKey || !chatData) {
    return res.status(400).json({ error: 'Missing provider, apiKey, or chatData.' });
  }
  try {
    const systemPrompt = loadSkill('deep-insights');
    const userMessage = JSON.stringify(chatData);

    let result;
    if (provider === 'openai' || provider === 'deepseek') {
      const isOpenAI = provider === 'openai';
      const url = isOpenAI
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://api.deepseek.com/chat/completions';
      const model = isOpenAI ? 'o3-mini' : 'deepseek-reasoner';
      const payload = {
        model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }]
      };
      if (provider === 'deepseek') payload.temperature = 0.5;
      const aiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload)
      });
      if (!aiRes.ok) throw new Error(`${provider} API error: ${aiRes.status}`);
      const data = await aiRes.json();
      result = data.choices[0].message.content;
    } else if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
      const aiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.5 }
        })
      });
      if (!aiRes.ok) throw new Error(`Gemini API error: ${aiRes.status}`);
      const data = await aiRes.json();
      result = data.candidates[0].content.parts[0].text;
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    // Format markdown for extension UI
    const formatted = result
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/## (.*?)<br>/g, "<h3 style='color:#FF0000; margin-top:12px;'>$1</h3>");

    res.json({ success: true, data: formatted });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
