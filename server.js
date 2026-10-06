#!/usr/bin/env node
/*
 * Job Matcher server. Zero dependencies (Node 18+).
 *   - Serves ./public
 *   - GET  /api/status  -> { ai: boolean, model }
 *   - POST /api/ai      -> optional AI rewrite via the Anthropic API (needs ANTHROPIC_API_KEY)
 *
 * All matching/scoring runs in the browser; the server never sees your resume
 * unless you click an AI button.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.JOBMATCHER_MODEL || 'claude-sonnet-5-5';
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 1_000_000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

const RULES = `You are an expert resume writer who knows how applicant tracking systems (ATS) and recruiters evaluate resumes.
Hard rules:
- NEVER invent employers, titles, dates, degrees, tools, or numbers. Use only facts present in the candidate's resume.
- Where a metric would strengthen a bullet but the candidate did not supply one, insert a clearly marked placeholder such as [ADD: % reduction in load time] instead of making up a number.
- Use the XYZ formula: "Accomplished [X] as measured by [Y], by doing [Z]". Start every bullet with a strong past-tense action verb (present tense for the current role).
- Mirror the job posting's exact terminology only for skills the candidate demonstrably has.
- Plain text only: no tables, columns, emojis or icons. Standard headings: SUMMARY, SKILLS, EXPERIENCE, EDUCATION.
- Never claim skills the candidate lacks. If the posting requires skills they lack, leave them out and do not mention them.`;

function buildPrompt(task, { resume, jd, analysis }) {
  const gaps = analysis && analysis.missing ? 'Skills the posting wants that the resume does NOT show (do not add unless clearly implied by the resume): ' + analysis.missing.join(', ') : '';
  const keep = analysis && analysis.matched ? 'Matched skills to emphasise: ' + analysis.matched.join(', ') : '';
  if (task === 'bullets') {
    return `Rewrite these weak resume bullets using the XYZ formula, tailored to the job. Return ONLY a numbered list matching the input order, one rewritten bullet per line, no commentary.\n\nJOB DESCRIPTION:\n${jd}\n\n${keep}\n\nBULLETS:\n${(analysis.bullets || []).map((b, i) => `${i + 1}. ${b}`).join('\n')}`;
  }
  if (task === 'cover') {
    return `Write a concise, genuine cover letter (250-350 words, 3-4 short paragraphs, plain text) for this job. Open with specific interest in the role, prove fit with 2-3 real, quantified achievements taken from the resume, address the most important requirements, and close politely. Do not repeat the resume line by line. Use [BRACKETED PLACEHOLDERS] for anything the candidate must supply (company motivation, hiring manager name). Output ONLY the letter.\n\n${keep}\n${gaps}\n\nJOB DESCRIPTION:\n${jd}\n\nCANDIDATE RESUME:\n${resume}`;
  }
  return `Rewrite the candidate's resume so it is tailored to the job posting below and scores well in ATS keyword matching and with human recruiters. Keep the candidate's real history; improve wording, ordering and keyword alignment. Output ONLY the finished resume text.\n\n${keep}\n${gaps}\n\nJOB DESCRIPTION:\n${jd}\n\nCANDIDATE RESUME:\n${resume}`;
}

async function callAnthropic(task, payload) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, system: RULES, messages: [{ role: 'user', content: buildPrompt(task, payload) }] }),
    signal: AbortSignal.timeout(120_000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || 'Anthropic API error ' + res.status);
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, { ai: !!API_KEY, model: API_KEY ? MODEL : null });
    if (req.method === 'POST' && url.pathname === '/api/ai') {
      if (!API_KEY) return send(res, 501, { error: 'AI is not configured. Start the server with ANTHROPIC_API_KEY set.' });
      const body = await readBody(req);
      if (!['tailor', 'bullets', 'cover'].includes(body.task) || typeof body.jd !== 'string') return send(res, 400, { error: 'Bad request' });
      const text = await callAnthropic(body.task, { resume: String(body.resume || ''), jd: body.jd, analysis: body.analysis || {} });
      return send(res, 200, { text });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
    });
  } catch (e) {
    send(res, 500, { error: e.message || 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Job Matcher running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}  (AI rewrite: ${API_KEY ? 'on, ' + MODEL : 'off, set ANTHROPIC_API_KEY to enable'})`);
});
