const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { callAI } = require('../lib/ai');

const SKILLS_DIR = path.join(__dirname, '../data/skills');

function loadSkill(name) {
  try {
    return fs.readFileSync(path.join(SKILLS_DIR, `${name}.txt`), 'utf8').trim();
  } catch (e) {
    throw new Error(`Skill file "${name}.txt" not found.`);
  }
}

// Same three providers as callAI(), but no JSON-mode forcing — for routes
// that want free-form text back (bullet points, prose) rather than the
// structured object /api/analyze needs.
async function callAIPlainText(provider, apiKey, model, systemPrompt, userMessage, temperature) {
  if (provider === 'openai' || provider === 'deepseek') {
    const isOpenAI = provider === 'openai';
    const url = isOpenAI
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.deepseek.com/chat/completions';

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        temperature
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { temperature }
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

function formatMarkdown(text) {
  return text
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/## (.*?)<br>/g, "<h3 style='color:#FF0000; margin-top:12px;'>$1</h3>");
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

// POST /api/summarize — home tab 對話內容重點, deferred until 查看更多 is
// first clicked (not run as part of /api/analyze). Split out into its own
// skill file/call on 2026-09-04 so a rep who only wants tags/labels (the
// common case) never pays for summary generation at all — /api/analyze used
// to always generate both together in one call.
router.post('/summarize', authMiddleware, async (req, res) => {
  const { provider, apiKey, messages, latestStage } = req.body;
  if (!provider || !apiKey || !messages) {
    return res.status(400).json({ error: 'Missing provider, apiKey, or messages.' });
  }
  try {
    const systemPrompt = loadSkill('conversation-summary');
    // latestStage is the REAL stage classification already determined (see
    // getLatestStage() in content.js) — passed explicitly so the summary's
    // 回覆頻率 skip-decision is grounded in that, not a second, independent
    // (and potentially disagreeing) guess made by this separate call, which
    // only ever sees the raw messages otherwise.
    const userMessage = `Messages to analyze:\n${JSON.stringify(messages)}\n\nLatest stage (most recent brand message's real stage, from classification — use this, do not re-derive the stage yourself): ${latestStage || 'none yet — no brand message has a real stage'}`;
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
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        response_format: { type: 'json_object' }
      };
      // o3-mini is a reasoning model and rejects a custom temperature — only
      // deepseek-reasoner gets one, same as before this route returned JSON.
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
          generationConfig: { temperature: 0.5, responseMimeType: 'application/json' }
        })
      });
      if (!aiRes.ok) throw new Error(`Gemini API error: ${aiRes.status}`);
      const data = await aiRes.json();
      result = data.candidates[0].content.parts[0].text;
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    // Raw JSON string, same shape as /api/analyze — the extension parses it
    // and renders the accordion itself, instead of receiving pre-formatted HTML.
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/suggest-followup — home tab "建議追問" button. Takes the summary
// /api/analyze already generated (not the raw chat) and suggests concrete
// next questions/talking points. Kept as a separate lightweight call rather
// than re-running full chat analysis, since the summary already has what's
// needed as context.
router.post('/suggest-followup', authMiddleware, async (req, res) => {
  const { provider, apiKey, summary, labelCounts, latestStage } = req.body;
  if (!provider || !apiKey || !summary) {
    return res.status(400).json({ error: 'Missing provider, apiKey, or summary.' });
  }
  try {
    const systemPrompt = loadSkill('followup-suggestions');
    let userMessage = `Conversation summary:\n${summary}`;
    if (labelCounts && typeof labelCounts === 'object') {
      const countsText = Object.entries(labelCounts).map(([label, count]) => `${label}: ${count}`).join('\n');
      if (countsText) userMessage += `\n\nBrand message count per stage:\n${countsText}`;
    }
    userMessage += `\n\nLatest stage (most recent brand message's stage, i.e. where the conversation currently stands): ${latestStage || 'none yet — no brand message has a real stage'}`;
    const model = provider === 'openai' ? 'gpt-4o-mini' : provider === 'gemini' ? 'gemini-2.5-flash' : 'deepseek-chat';
    const result = await callAIPlainText(provider, apiKey, model, systemPrompt, userMessage, 0.3);
    res.json({ success: true, data: formatMarkdown(result) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
