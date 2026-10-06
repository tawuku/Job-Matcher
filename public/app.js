(function () {
  'use strict';
  const JM = window.JobMatcher;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const store = {
    get(k, d) { try { const v = localStorage.getItem('jm:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('jm:' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  const el = {
    resume: $('#resume'), jd: $('#jd'), title: $('#jobTitle'), company: $('#company'),
    results: $('#results'), msg: $('#inputMsg'), tabpanel: $('#tabpanel')
  };
  let current = null;       // last analysis result
  let currentInput = null;  // { resume, jd, title, company }
  let activeTab = 'plan';
  let aiAvailable = false;
  let tailored = null;      // cached tailored output for the current analysis
  let aiDraft = null;

  /* ---------------- helpers ---------------- */
  const tone = (n) => (n >= 80 ? 'good' : n >= 65 ? 'ok' : n >= 50 ? 'warn' : 'bad');
  const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function updateHints() {
    $('#resumeHint').textContent = words(el.resume.value) + ' words';
    $('#jdHint').textContent = words(el.jd.value) + ' words';
  }

  /* ---------------- file import ---------------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ($('script[src="' + src + '"]')) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (/\.(txt|md|text)$/.test(name) || file.type.startsWith('text/')) return file.text();
    if (name.endsWith('.docx')) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
      const out = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return out.value;
    }
    if (name.endsWith('.pdf')) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      const pdfjs = window.pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      let text = '';
      for (let p = 1; p <= pdf.numPages; p++) {
        const content = await (await pdf.getPage(p)).getTextContent();
        let lastY = null, line = '';
        for (const it of content.items) {
          const y = Math.round(it.transform[5]);
          if (lastY !== null && Math.abs(y - lastY) > 3) { text += line.trim() + '\n'; line = ''; }
          line += it.str + (it.hasEOL ? '\n' : ' ');
          lastY = y;
        }
        text += line.trim() + '\n\n';
      }
      if (words(text) < 20) throw new Error('No readable text found. This PDF may be a scanned image, which ATS software cannot read either. Export a text-based PDF.');
      return text;
    }
    throw new Error('Unsupported file type. Use .pdf, .docx or .txt');
  }

  function wireFile(inputId, target) {
    $(inputId).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      setMsg('Reading ' + f.name + '…', false);
      try { target.value = await readFile(f); setMsg('', false); persist(); updateHints(); toast('Imported ' + f.name); }
      catch (err) { setMsg(err.message, true); }
      e.target.value = '';
    });
  }

  function setMsg(t, isErr) { el.msg.textContent = t; el.msg.style.color = isErr ? 'var(--bad)' : 'var(--muted)'; }

  function persist() {
    store.set('resume', el.resume.value); store.set('draft', { jd: el.jd.value, title: el.title.value, company: el.company.value });
  }

  /* ---------------- analyze ---------------- */
  function run(save) {
    const resume = el.resume.value, jd = el.jd.value;
    if (words(resume) < 25) return setMsg('Add your resume first (at least a few lines).', true);
    if (words(jd) < 25) return setMsg('Paste the full job description (at least a few lines).', true);
    setMsg('', false);
    currentInput = { resume, jd, title: el.title.value.trim(), company: el.company.value.trim() };
    current = JM.analyze(resume, jd, { jobTitle: currentInput.title });
    tailored = null; aiDraft = null;
    persist();
    renderSummary();
    el.results.hidden = false;
    setTab(activeTab);
    requestAnimationFrame(() => el.results.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  /* ---------------- summary ---------------- */
  function renderSummary() {
    const r = current;
    $('#scoreNum').textContent = r.score;
    const fg = $('#ringFg'); const C = 2 * Math.PI * 52;
    fg.style.stroke = 'var(--' + (tone(r.score) === 'ok' ? 'ok' : tone(r.score)) + ')';
    fg.style.strokeDashoffset = C; requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = C * (1 - r.score / 100); }));
    $('#verdict').textContent = r.verdict.label;
    $('#verdict').style.color = 'var(--' + (r.verdict.tone === 'ok' ? 'ok' : r.verdict.tone) + ')';
    $('#verdictText').textContent = r.verdict.text;
    const reqAll = [].concat(r.keywords.matched, r.keywords.partial, r.keywords.missing).filter((k) => k.level === 'required');
    const reqHave = reqAll.filter((k) => k.credit > 0).length;
    const chips = [];
    chips.push('<span class="chip ' + r.atsLikelihood.tone + '">ATS pass likelihood: ' + r.atsLikelihood.label + '</span>');
    if (reqAll.length) chips.push('<span class="chip ' + (reqHave / reqAll.length >= 0.8 ? 'good' : reqHave / reqAll.length >= 0.5 ? 'warn' : 'bad') + '">Must-have skills: ' + reqHave + '/' + reqAll.length + '</span>');
    if (r.jd.title) chips.push('<span class="chip">Role: ' + esc(r.jd.title) + '</span>');
    if (r.jd.years) chips.push('<span class="chip">Asks ' + r.jd.years.years + '+ yrs · you ~' + r.resume.years + '</span>');
    chips.push('<span class="chip">' + r.bulletStats.withMetric + '/' + r.bulletStats.count + ' bullets quantified</span>');
    $('#chips').innerHTML = chips.join('');
    $('#potential').innerHTML = '<b>' + r.potentialScore + '</b><span>potential after the honest fixes in your plan</span>';

    $('#bars').innerHTML = r.components.map((c) =>
      '<div class="bar"><div class="bar-l">' + esc(c.label) + '<small>weight ' + c.weight + '%</small></div>' +
      '<div class="bar-t"><div class="bar-f t-' + tone(c.score) + '" style="width:0" data-w="' + c.score + '"></div></div>' +
      '<div class="bar-n">' + c.score + '</div><div class="bar-d">' + esc(c.detail) + '</div></div>').join('');
    requestAnimationFrame(() => requestAnimationFrame(() => $$('.bar-f').forEach((b) => { b.style.width = b.dataset.w + '%'; })));
  }

  /* ---------------- tabs ---------------- */
  function setTab(name) {
    activeTab = name;
    $$('.tab').forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
    const fn = { plan: tabPlan, keywords: tabKeywords, gaps: tabGaps, bullets: tabBullets, ats: tabAts, tailor: tabTailor }[name];
    el.tabpanel.innerHTML = ''; fn();
  }

  function tabPlan() {
    const r = current;
    el.tabpanel.innerHTML = '<h2 class="h2">What to do to land the interview, in priority order</h2><div class="plan">' +
      r.plan.map((p) => '<div class="plan-item ' + p.priority + '"><div class="plan-top"><h3>' + esc(p.title) + '</h3><div class="plan-meta">' +
        '<span class="tag ' + p.priority + '">' + p.priority + '</span>' + (p.impact ? '<span class="tag gain">≈ +' + p.impact + ' pts</span>' : '') +
        '<span class="tag">' + esc(p.effort) + ' effort</span></div></div><p class="plan-why">' + esc(p.why) + '</p><ul>' +
        p.how.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul></div>').join('') + '</div>';
  }

  function kwChip(k, cls) {
    const w = k.where ? ' <small>' + (k.where === 'skills' ? 'skills list only' : k.where) + '</small>' : '';
    return '<span class="kw ' + cls + (k.level === 'preferred' ? ' preferred' : '') + '" title="' + esc(k.level + ' · appears ' + k.jdCount + '× in the job post') + '">' + esc(k.term) + w + '</span>';
  }

  function tabKeywords() {
    const k = current.keywords;
    const group = (title, items, cls, empty) => '<div class="kw-group"><h3>' + title + ' <span class="pill">' + items.length + '</span></h3>' +
      (items.length ? '<div class="kw-list">' + items.map((i) => kwChip(i, cls)).join('') + '</div>' : '<p class="legend">' + empty + '</p>') + '</div>';
    const other = k.other;
    el.tabpanel.innerHTML = '<p class="legend">Hover a keyword to see how often the posting uses it. <b>Required</b> = from the requirements section or the job title; <b>preferred</b> (grey) = nice-to-have. ATS ranks terms used inside experience bullets higher than terms that only sit in a skills list.</p><div class="kw-grid">' +
      group('Missing', k.missing, 'x', 'Nothing missing. Nice.') +
      group('Only in your Skills list (add proof in bullets)', k.partial, 'p', 'None.') +
      group('Matched', k.matched, 'm', 'No matches yet.') +
      (other.length ? '<div class="kw-group"><h3>Other phrases the job keeps repeating <span class="pill">' + other.length + '</span></h3><div class="kw-list">' +
        other.map((o) => '<span class="kw ' + (o.found ? 'm' : 'x') + '" title="appears ' + o.count + '×">' + esc(o.term) + '</span>').join('') + '</div></div>' : '') + '</div>';
  }

  function tabGaps() {
    const gaps = current.keywords.gaps.filter((g) => g.level !== 'preferred').concat(current.keywords.gaps.filter((g) => g.level === 'preferred'));
    if (!gaps.length) { el.tabpanel.innerHTML = '<div class="empty">No skill gaps found against this posting.</div>'; return; }
    const missing = Object.fromEntries(current.keywords.missing.map((m) => [m.term, m]));
    el.tabpanel.innerHTML = '<p class="legend">Be honest: only add a skill to your resume if you can discuss it in an interview. For each gap, here is the fastest legitimate way to close or bridge it.</p>' +
      gaps.map((g) => '<div class="gap"><h3>' + esc(g.term) + ' <span class="tag ' + (g.level === 'required' ? 'critical' : g.level === 'core' ? 'high' : '') + '">' + g.level + '</span>' +
        (g.bridge ? '<span class="tag gain">you have ' + esc(g.bridge) + '</span>' : '') + '</h3><p>' + esc(g.how) + '</p>' +
        (missing[g.term] && missing[g.term].context ? '<div class="ctx">From the posting: “' + esc(missing[g.term].context.slice(0, 220)) + '”</div>' : '') + '</div>').join('');
  }

  function tabBullets() {
    const r = current, s = r.bulletStats;
    const pct = (x) => Math.round(x * 100) + '%';
    let weakOnly = store.get('weakOnly', true);
    const draw = () => {
      const list = r.bullets.filter((b) => !weakOnly || b.quality !== 'strong' || !b.xyz);
      $('#bulletList').innerHTML = list.length ? list.map((b) =>
        '<div class="bullet ' + b.quality + '"><div class="bullet-role">' + esc(b.role || 'Experience') + ' · ' + b.points + '/100</div><div class="bullet-t">' + esc(b.text) + '</div>' +
        (b.flags.length ? '<ul class="flags">' + b.flags.map((f) => '<li>' + esc(f.text) + '</li>').join('') + '</ul>' : '<p class="legend" style="margin:6px 0 0">Strong: verb + result + method.</p>') +
        (b.suggestion ? '<div class="sugg"><b>XYZ rewrite template</b>' + esc(b.suggestion.template) + (b.related.length ? '<br><small>If true, weave in a missing job keyword: ' + esc(b.related.join(', ')) + '</small>' : '') +
          '<br><small>Stronger verbs: ' + esc(b.suggestion.verbs.join(', ')) + '</small></div>' : '') + '</div>').join('') :
        '<div class="empty">All bullets look strong.</div>';
    };
    el.tabpanel.innerHTML = '<div class="xyz-box"><b>The XYZ formula:</b> <code>Accomplished [X] as measured by [Y], by doing [Z]</code>. Example: <i>“Cut report generation time from 40s to 6s (Y) by rewriting the query layer with Redis caching (Z), speeding up the customer dashboard (X).”</i> Recruiters spend seconds per resume; a number and a method make a bullet credible and keyword-rich.</div>' +
      '<div class="stats"><div class="stat"><b>' + pct(s.metricPct) + '</b><span>bullets with a measurable result (aim 60%+)</span></div>' +
      '<div class="stat"><b>' + pct(s.verbPct) + '</b><span>open with a strong action verb</span></div>' +
      '<div class="stat"><b>' + pct(s.xyzPct) + '</b><span>full XYZ pattern (aim 40%+)</span></div>' +
      '<div class="stat"><b>' + s.count + '</b><span>bullets analysed</span></div></div>' +
      (s.count ? '<div class="row" style="justify-content:space-between;margin-bottom:12px"><label class="toggle"><input type="checkbox" id="weakOnly" ' + (weakOnly ? 'checked' : '') + '> Show only bullets that need work</label>' +
        (aiAvailable ? '<button class="btn small" id="aiBullets">Rewrite weak bullets with AI</button>' : '') + '</div><div id="bulletList"></div><div id="aiBulletsOut"></div>' :
        '<div class="empty">No bullet points detected. Put each achievement on its own line starting with “•” or “-”, under a heading like “Experience”.</div>');
    if (s.count) {
      draw();
      $('#weakOnly').addEventListener('change', (e) => { weakOnly = e.target.checked; store.set('weakOnly', weakOnly); draw(); });
      const ab = $('#aiBullets'); if (ab) ab.addEventListener('click', aiRewriteBullets);
    }
  }

  function tabAts() {
    const r = current.ats;
    el.tabpanel.innerHTML = '<p class="legend">ATS readability score: <b>' + r.score + '/100</b>. These checks run on the text of your resume. Also confirm manually: no photos or logos, no text in headers/footers or text boxes, standard fonts, and a text-based file (not a scan).</p>' +
      r.checks.slice().sort((a, b) => ({ fail: 0, warn: 1, pass: 2 }[a.status] - { fail: 0, warn: 1, pass: 2 }[b.status])).map((c) =>
        '<div class="check"><div class="ico ' + c.status + '">' + (c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✕') + '</div><div><b>' + esc(c.label) + '</b><span>' + (c.status === 'pass' ? 'Looks good.' : esc(c.detail)) + '</span></div></div>').join('');
  }

  function tabTailor() {
    if (!tailored) tailored = JM.tailor(current);
    const text = aiDraft || tailored.text;
    el.tabpanel.innerHTML = '<div class="tailor"><p class="legend">A draft built only from <b>your own content</b>: your summary is rebuilt around the job, skills are reordered and re-worded to the posting\'s exact terms, and bullets are ordered by relevance. Nothing you lack is added. Fill every <b>[ADD …]</b> placeholder, edit freely, then re-score.</p>' +
      '<div class="tailor-bar"><button class="btn small primary" id="rescore">Re-score this draft</button><button class="btn small" id="copyT">Copy</button>' +
      '<button class="btn small" id="dlTxt">Download .txt</button><button class="btn small" id="dlDoc">Download .doc</button><button class="btn small" id="printT">Print / PDF</button>' +
      (aiAvailable ? '<button class="btn small ghost" id="aiTailor">Rewrite with AI ✦</button>' : '') + '<span class="grow"></span><span class="pill" id="phCount"></span></div>' +
      (tailored.notes.length && !aiDraft ? '<div class="note">' + esc(tailored.notes[0].replace('--- ', '')) + '</div>' : '') +
      '<textarea id="tailorText" spellcheck="false"></textarea><div id="printSheet"></div></div>';
    const ta = $('#tailorText'); ta.value = text;
    const ph = () => { const n = (ta.value.match(/\[ADD[^\]]*\]/g) || []).length; $('#phCount').textContent = n ? n + ' placeholder' + (n > 1 ? 's' : '') + ' to fill' : 'no placeholders left'; };
    ph(); ta.addEventListener('input', ph);
    $('#copyT').onclick = async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copied'); } catch (e) { ta.select(); document.execCommand('copy'); toast('Copied'); } };
    $('#dlTxt').onclick = () => download('tailored-resume.txt', ta.value);
    $('#dlDoc').onclick = () => download('tailored-resume.doc', '<html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial;font-size:11pt;white-space:pre-wrap">' + esc(ta.value) + '</body></html>', 'application/msword');
    $('#printT').onclick = () => { $('#printSheet').textContent = ta.value; window.print(); };
    $('#rescore').onclick = () => { el.resume.value = ta.value; run(false); setTab('plan'); toast('Draft re-scored: ' + current.score + '/100'); };
    const at = $('#aiTailor'); if (at) at.onclick = aiRewriteResume;
  }

  /* ---------------- AI (optional) ---------------- */
  async function aiCall(task, extra) {
    const matched = current.keywords.matched.concat(current.keywords.partial).map((k) => k.term);
    const missing = current.keywords.missing.map((k) => k.term);
    const res = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task, resume: currentInput.resume, jd: currentInput.jd, analysis: Object.assign({ matched, missing }, extra) }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'AI request failed');
    return data.text;
  }
  async function aiRewriteResume() {
    if (!confirm('This sends your resume and the job description to the Anthropic API to rewrite it. Continue?')) return;
    const b = $('#aiTailor'); b.disabled = true; b.textContent = 'Writing…';
    try { aiDraft = await aiCall('tailor'); setTab('tailor'); toast('AI draft ready. Review every line for accuracy.'); }
    catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Rewrite with AI ✦'; }
  }
  async function aiRewriteBullets() {
    if (!confirm('This sends the weak bullets and the job description to the Anthropic API. Continue?')) return;
    const b = $('#aiBullets'); b.disabled = true; b.textContent = 'Writing…';
    try {
      const weak = current.bullets.filter((x) => !x.xyz).slice(0, 15).map((x) => x.text);
      const out = await aiCall('bullets', { bullets: weak });
      $('#aiBulletsOut').innerHTML = '<h3 class="h2" style="margin-top:18px">AI rewrites (verify every number)</h3><div class="ai-out">' + esc(out) + '</div>';
    } catch (e) { toast(e.message); }
    b.disabled = false; b.textContent = 'Rewrite weak bullets with AI';
  }

  /* ---------------- My jobs ---------------- */
  const STATUSES = ['Saved', 'Applied', 'Interviewing', 'Offer', 'Rejected'];
  const jobs = () => store.get('jobs', []);

  function saveJob() {
    if (!current) return;
    const list = jobs();
    const title = currentInput.title || current.jd.title || 'Untitled role';
    const id = (currentInput.company + '|' + title).toLowerCase();
    const prev = list.find((j) => j.id === id);
    const rec = { id, title, company: currentInput.company, jd: currentInput.jd, score: current.score, potential: current.potentialScore, date: new Date().toISOString(), status: prev ? prev.status : 'Saved' };
    store.set('jobs', [rec].concat(list.filter((j) => j.id !== id)));
    renderJobs(); toast(prev ? 'Updated saved job' : 'Saved to My jobs');
  }

  function renderJobs() {
    const list = jobs();
    $('#jobCount').textContent = list.length;
    const box = $('#jobsList');
    if (!list.length) { box.innerHTML = '<div class="empty">No saved jobs yet. Analyze a job and click “Save to My jobs”.</div>'; return; }
    box.innerHTML = '<table class="jobs-table"><thead><tr><th>Score</th><th>Role</th><th class="hide-s">Saved</th><th>Status</th><th></th></tr></thead><tbody>' +
      list.slice().sort((a, b) => b.score - a.score).map((j) =>
        '<tr><td><span class="score-badge chip ' + tone(j.score) + '">' + j.score + '</span></td><td><b>' + esc(j.title) + '</b><br><small style="color:var(--muted)">' + esc(j.company || '') + '</small></td>' +
        '<td class="hide-s">' + new Date(j.date).toLocaleDateString() + '</td>' +
        '<td><select data-status="' + esc(j.id) + '" aria-label="Status">' + STATUSES.map((s) => '<option' + (s === j.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></td>' +
        '<td class="row"><button class="btn small" data-open="' + esc(j.id) + '">Re-analyze</button><button class="btn small ghost" data-del="' + esc(j.id) + '" aria-label="Delete">✕</button></td></tr>').join('') + '</tbody></table>';
  }

  $('#jobsList').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]'), del = e.target.closest('[data-del]');
    if (open) {
      const j = jobs().find((x) => x.id === open.dataset.open); if (!j) return;
      el.jd.value = j.jd; el.title.value = j.title === 'Untitled role' ? '' : j.title; el.company.value = j.company || '';
      showView('analyze'); updateHints(); run();
    } else if (del) { store.set('jobs', jobs().filter((x) => x.id !== del.dataset.del)); renderJobs(); }
  });
  $('#jobsList').addEventListener('change', (e) => {
    const s = e.target.closest('[data-status]'); if (!s) return;
    store.set('jobs', jobs().map((j) => (j.id === s.dataset.status ? Object.assign({}, j, { status: s.value }) : j)));
  });

  /* ---------------- view switching & wiring ---------------- */
  function showView(v) {
    $$('.view').forEach((x) => { x.hidden = x.id !== 'view-' + v; });
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    if (v === 'jobs') renderJobs();
    try { history.replaceState(null, '', '#' + v); } catch (e) { /* ignore */ }
  }
  $$('.nav-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $('#tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) setTab(t.dataset.tab); });
  $('#analyzeBtn').addEventListener('click', () => run());
  $('#saveJobBtn').addEventListener('click', saveJob);
  $('#toPlanBtn').addEventListener('click', () => { setTab('plan'); $('#tabs').scrollIntoView({ behavior: 'smooth' }); });
  $('#sampleBtn').addEventListener('click', () => {
    const s = window.JobMatcherSamples; el.resume.value = s.resume; el.jd.value = s.jd; el.title.value = ''; el.company.value = 'Example Co';
    updateHints(); persist(); run();
  });
  $('#clearBtn').addEventListener('click', () => {
    if ((el.resume.value || el.jd.value) && !confirm('Clear the resume and job description fields?')) return;
    el.resume.value = ''; el.jd.value = ''; el.title.value = ''; el.company.value = ''; el.results.hidden = true; persist(); updateHints();
  });
  [el.resume, el.jd, el.title, el.company].forEach((x) => x.addEventListener('input', () => { updateHints(); persist(); }));
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !$('#view-analyze').hidden) run(); });
  wireFile('#resumeFile', el.resume); wireFile('#jdFile', el.jd);

  // init
  el.resume.value = store.get('resume', '');
  const d = store.get('draft', null);
  if (d) { el.jd.value = d.jd || ''; el.title.value = d.title || ''; el.company.value = d.company || ''; }
  updateHints(); renderJobs();
  if (location.hash === '#jobs') showView('jobs');
  fetch('/api/status').then((r) => r.json()).then((s) => { aiAvailable = !!s.ai; }).catch(() => {});
})();
