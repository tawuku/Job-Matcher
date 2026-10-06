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

  const el = { resume: $('#resume'), jd: $('#jd'), title: $('#jobTitle'), company: $('#company'), msg: $('#inputMsg'), content: $('#content') };
  let current = null;       // last analysis
  let currentInput = null;  // { resume, jd, title, company }
  let page = 'analyze';
  let kwFilter = 'all';
  let bulletFilter = store.get('bulletFilter', 'weak');
  let aiAvailable = false;
  let tailored = null, aiDraft = null, aiCover = null;
  let coverOpts = { hiringManager: '', name: '' };

  /* ---------------- icons & nav ---------------- */
  const I = {
    analyze: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2"/>',
    overview: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    keywords: '<path d="M3 12V4h8l9 9-8 8-9-9z"/><circle cx="7.5" cy="8.5" r="1"/>',
    bullets: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9"/><circle cx="4.5" cy="12" r=".9"/><circle cx="4.5" cy="18" r=".9"/>',
    ats: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    resume: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    letter: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    jobs: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'
  };
  const svg = (k) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[k] + '</svg>';
  const PILLS = [
    { id: 'analyze', label: 'Analyze' }, { id: 'overview', label: 'Overview', r: 1 }, { id: 'keywords', label: 'Keywords', r: 1 },
    { id: 'bullets', label: 'Bullets', r: 1 }, { id: 'ats', label: 'ATS check', r: 1 }, { id: 'resume', label: 'Resume', r: 1 },
    { id: 'letter', label: 'Cover letter', r: 1 }, { id: 'jobs', label: 'My jobs' }
  ];

  /* ---------------- helpers ---------------- */
  const tone = (n) => (n >= 80 ? 'good' : n >= 65 ? 'ok' : n >= 50 ? 'warn' : 'bad');
  const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
  const candidateName = () => {
    if (!current) return '';
    const l = current._parsed.sections[0].lines.map((x) => x.trim()).find(Boolean) || '';
    return l && l.split(/\s+/).length <= 4 && !/[@\d]/.test(l) ? l : '';
  };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2400);
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
  function setMsg(t, isErr) { el.msg.textContent = t; el.msg.style.color = isErr ? 'var(--bad)' : 'var(--muted)'; }
  function persist() { store.set('resume', el.resume.value); store.set('draft', { jd: el.jd.value, title: el.title.value, company: el.company.value }); }

  /* ---------------- file import (PDF, Word, text) ---------------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ($('script[src="' + src + '"]')) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = () => rej(new Error('Could not load the file reader (check your internet connection). You can still paste the text instead.'));
      document.head.appendChild(s);
    });
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out = [];
    const clean = (n) => n.textContent.replace(/\s+/g, ' ').trim();
    const walk = (node) => {
      for (const c of node.children) {
        const tag = c.tagName.toLowerCase();
        if (tag === 'li') { const t = clean(c); if (t) out.push('• ' + t); }
        else if (tag === 'table') c.querySelectorAll('tr').forEach((tr) => { const r = Array.from(tr.children).map(clean).filter(Boolean).join(' | '); if (r) out.push(r); });
        else if (tag === 'p' || /^h[1-6]$/.test(tag)) { const t = clean(c); if (t) out.push(t); }
        else walk(c);
      }
    };
    walk(doc.body);
    return out.join('\n');
  }

  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (/\.(txt|md|text)$/.test(name) || file.type.startsWith('text/')) return file.text();
    if (name.endsWith('.doc')) throw new Error('Old .doc files cannot be read in the browser. In Word choose File → Save As → .docx (or PDF), then upload that.');
    if (name.endsWith('.docx')) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
      const out = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      const text = htmlToText(out.value);
      if (words(text) < 15) throw new Error('No readable text found in this Word file.');
      return text;
    }
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
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
      text = text.replace(/[ \t]+\n/g, '\n').replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ').replace(/\n{3,}/g, '\n\n');
      if (words(text) < 15) throw new Error('No readable text found. This PDF may be a scanned image, which ATS software cannot read either. Export a text-based PDF from Word or Google Docs.');
      return text;
    }
    throw new Error('Unsupported file type. Use PDF, Word (.docx) or a text file.');
  }
  window.JMImport = { readFile, htmlToText };

  async function importInto(file, target, chip) {
    if (!file) return;
    setMsg('Reading ' + file.name + '…', false);
    try {
      target.value = await readFile(file);
      setMsg('', false); persist(); updateHints();
      chip.innerHTML = '<span>' + esc(file.name) + '</span><button type="button" aria-label="Remove file" title="Remove">×</button>';
      chip.hidden = false;
      chip.querySelector('button').onclick = () => { target.value = ''; chip.hidden = true; persist(); updateHints(); };
      toast('Imported ' + file.name);
    } catch (err) { setMsg(err.message, true); }
  }

  function wireImport(tileId, inputId, target, chipId) {
    const tile = $(tileId), chip = $(chipId);
    $(inputId).addEventListener('change', async (e) => { await importInto(e.target.files[0], target, chip); e.target.value = ''; });
    let depth = 0;
    tile.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; tile.classList.add('over'); });
    tile.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    tile.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) tile.classList.remove('over'); });
    tile.addEventListener('drop', async (e) => {
      e.preventDefault(); depth = 0; tile.classList.remove('over');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) await importInto(f, target, chip);
      else { const t = e.dataTransfer.getData('text/plain'); if (t) { target.value = t; persist(); updateHints(); } }
    });
  }
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault())); // never navigate away on a stray drop

  /* ---------------- navigation ---------------- */
  function renderPills() {
    $('#pills').innerHTML = PILLS.map((p) => {
      const dis = p.r && !current;
      const cnt = p.id === 'jobs' && jobs().length ? ' <span class="cnt">' + jobs().length + '</span>' : '';
      return '<button class="pill' + (p.id === page ? ' on' : '') + '" data-go="' + p.id + '"' + (dis ? ' disabled' : '') + (p.id === page ? ' aria-current="page"' : '') + '>' + svg(p.id) + p.label + cnt + '</button>';
    }).join('');
  }

  function go(name) {
    if (PILLS.find((p) => p.id === name && p.r) && !current) return;
    page = name;
    const view = name === 'analyze' ? 'analyze' : name === 'jobs' ? 'jobs' : 'results';
    ['analyze', 'results', 'jobs'].forEach((v) => { $('#view-' + v).hidden = v !== view; });
    $('#pageTitle').textContent = view === 'results' ? (current.jd.title ? current.jd.title : 'Match results') : name === 'jobs' ? 'My jobs' : 'Job Matcher';
    renderPills();
    if (view === 'jobs') renderJobs();
    if (view === 'results') renderTab();
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
  }

  /* ---------------- analyze ---------------- */
  function run() {
    const resume = el.resume.value, jd = el.jd.value;
    if (words(resume) < 25) return setMsg('Add your resume first: paste it or upload a PDF / Word file.', true);
    if (words(jd) < 25) return setMsg('Add the full job description: paste it or upload a PDF / Word file.', true);
    setMsg('', false);
    currentInput = { resume, jd, title: el.title.value.trim(), company: el.company.value.trim() };
    current = JM.analyze(resume, jd, { jobTitle: currentInput.title });
    tailored = null; aiDraft = null; aiCover = null; kwFilter = 'all';
    persist();
    renderHero();
    go('overview');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderHero() {
    const r = current;
    const name = candidateName();
    $('#profName').textContent = name || 'Your resume';
    $('#profSub').textContent = currentInput.company ? 'Applying to ' + currentInput.company : 'Candidate';
    $('#avatarTxt').textContent = name ? name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : 'CV';
    const av = $('#avatar'); av.style.setProperty('--p', 0); requestAnimationFrame(() => requestAnimationFrame(() => av.style.setProperty('--p', r.score)));
    const reqAll = [].concat(r.keywords.matched, r.keywords.partial, r.keywords.missing).filter((k) => k.level === 'required');
    const reqHave = reqAll.filter((k) => k.credit > 0).length;
    const items = [
      '<div class="stat-i"><small>Verdict</small><div class="v t-' + r.verdict.tone + '" style="font-size:24px;font-weight:500;padding-top:6px">' + esc(r.verdict.label) + '</div></div>',
      '<div class="stat-i"><small>Match score</small><div class="v">' + r.score + '<em>/100</em></div><div class="d t-good">▲ up to ' + r.potentialScore + ' possible</div></div>',
      reqAll.length ? '<div class="stat-i"><small>Must-have skills</small><div class="v">' + reqHave + '<em>/ ' + reqAll.length + '</em></div></div>' : '',
      '<div class="stat-i"><small>ATS pass likelihood</small><div class="v t-' + r.atsLikelihood.tone + '">' + r.atsLikelihood.label + '</div></div>',
      '<div class="stat-i"><small>Experience</small><div class="v">' + r.resume.years + '<em>yrs</em></div>' + (r.jd.years ? '<div class="d" style="color:var(--muted)">role asks ' + r.jd.years.years + '+</div>' : '') + '</div>',
      '<div class="stat-i"><small>Quantified bullets</small><div class="v">' + r.bulletStats.withMetric + '<em>/ ' + r.bulletStats.count + '</em></div></div>'
    ];
    $('#statrow').innerHTML = items.join('');
  }

  /* ---------------- results tabs ---------------- */
  function setChips(list, active, onPick) {
    const bar = $('#chipbar');
    bar.innerHTML = list.map((c) => '<button class="chip' + (c.id === active ? ' on' : '') + (c.static ? ' static' : '') + '" data-chip="' + c.id + '"' + (c.static ? ' tabindex="-1"' : '') + '>' + esc(c.label) + '</button>').join('');
    bar.onclick = (e) => { const b = e.target.closest('[data-chip]'); if (b && !b.classList.contains('static')) onPick(b.dataset.chip); };
  }

  function renderTab() {
    const fn = { overview: tabOverview, keywords: tabKeywords, bullets: tabBullets, ats: tabAts, resume: tabTailor, letter: tabCover }[page];
    if (!fn) return;
    el.content.innerHTML = ''; setChips([], '', () => {}); fn();
  }

  const LANES = {
    critical: { t: 'Fix first', s: 'Critical', icon: 'alert' }, high: { t: 'Fix next', s: 'High impact', icon: 'bolt' },
    medium: { t: 'Then', s: 'Worth doing', icon: 'list' }, low: { t: 'Before you submit', s: 'Final checks', icon: 'flag' }
  };

  function tabOverview() {
    const r = current;
    setChips([{ id: 'v', label: r.verdict.text, static: true }], 'v', () => {});
    const cards = r.components.map((c) => {
      const pos = Math.min(88, Math.max(12, c.score));
      return '<div class="mcard tone-' + tone(c.score) + '"><div class="mcard-h"><div><h3>' + esc(c.label) + '</h3><small>' + c.weight + '% of score</small></div><div class="wbadge" title="Weight">' + c.weight + '%</div></div>' +
        '<div class="track"><div class="fill" data-w="' + c.score + '"></div><div class="thumb" data-l="' + pos + '" style="left:0">' + c.score + ' / 100</div></div><p>' + esc(c.detail) + '</p></div>';
    }).join('');
    const lanes = ['critical', 'high', 'medium', 'low'].map((pr) => {
      const items = r.plan.filter((p) => p.priority === pr);
      if (!items.length) return '';
      const L = LANES[pr];
      return '<div class="lane"><div class="node">' + svg(L.icon) + '</div><div class="lane-t"><b>' + L.t + '</b><small>' + L.s + ' · ' + items.length + ' step' + (items.length > 1 ? 's' : '') + '</small></div>' +
        items.map((p) => '<div class="pcard"><div class="pcard-top"><h3>' + esc(p.title) + '</h3>' + (p.impact ? '<span class="gain">+' + p.impact + ' pts</span>' : '') + '</div>' +
          '<p class="why">' + esc(p.why) + '</p><div class="row" style="justify-content:space-between"><details' + (pr === 'critical' ? ' open' : '') + '><summary>How to do it</summary><ul>' + p.how.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul></details><span class="eff">' + esc(p.effort) + ' effort</span></div></div>').join('') + '</div>';
    }).join('');
    el.content.innerHTML = '<h2 class="sec-h">Score breakdown</h2><div class="mgrid">' + cards + '</div><h2 class="sec-h">Your path to the interview</h2><div class="board">' + lanes + '</div>';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('.fill').forEach((f) => { f.style.width = f.dataset.w + '%'; });
      $$('.thumb').forEach((t) => { t.style.left = t.dataset.l + '%'; });
    }));
  }

  function kwChip(k, cls) {
    const w = k.where ? ' <small>' + (k.where === 'skills' ? 'skills list only' : k.where) + '</small>' : '';
    return '<span class="kw ' + cls + (k.level === 'preferred' ? ' preferred' : '') + '" title="' + esc(k.level + ' · appears ' + k.jdCount + '× in the job post') + '"><span>' + esc(k.term) + '</span>' + w + '</span>';
  }

  function gapsHtml() {
    const all = current.keywords.gaps;
    const gaps = all.filter((g) => g.level !== 'preferred').concat(all.filter((g) => g.level === 'preferred'));
    if (!gaps.length) return '<div class="empty">No skill gaps found against this posting.</div>';
    const missing = Object.fromEntries(current.keywords.missing.map((m) => [m.term, m]));
    return '<p class="legend">Be honest: only add a skill to your resume if you can discuss it in an interview. For each gap, here is the fastest legitimate way to close or bridge it.</p>' +
      gaps.map((g) => '<div class="gap"><h3>' + esc(g.term) + ' <span class="tag ' + (g.level === 'required' ? 'critical' : g.level === 'core' ? 'high' : '') + '">' + g.level + '</span>' +
        (g.bridge ? '<span class="tag gain">you have ' + esc(g.bridge) + '</span>' : '') + '</h3><p>' + esc(g.how) + '</p>' +
        (missing[g.term] && missing[g.term].context ? '<div class="ctx">From the posting: “' + esc(missing[g.term].context.slice(0, 220)) + '”</div>' : '') + '</div>').join('');
  }

  function tabKeywords() {
    const k = current.keywords;
    const pick = (f) => { kwFilter = f; tabKeywords(); };
    setChips([{ id: 'all', label: 'All' }, { id: 'missing', label: 'Missing · ' + k.missing.length }, { id: 'partial', label: 'Skills list only · ' + k.partial.length },
      { id: 'matched', label: 'Matched · ' + k.matched.length }, { id: 'gaps', label: 'How to close gaps' }], kwFilter, pick);
    if (kwFilter === 'gaps') { el.content.innerHTML = gapsHtml(); return; }
    const group = (title, items, cls, empty) => '<div class="kw-group"><h3>' + title + ' <span class="cnt">' + items.length + '</span></h3>' +
      (items.length ? '<div class="kw-list">' + items.map((i) => kwChip(i, cls)).join('') + '</div>' : '<p class="legend">' + empty + '</p>') + '</div>';
    const show = (id) => kwFilter === 'all' || kwFilter === id;
    el.content.innerHTML = '<p class="legend">Hover a keyword to see how often the posting uses it. <b>Required</b> comes from the requirements section or the job title; <b>preferred</b> (grey) is nice-to-have. ATS ranks terms used inside experience bullets above terms that only sit in a skills list.</p><div class="kw-grid">' +
      (show('missing') ? group('Missing', k.missing, 'x', 'Nothing missing. Nice.') : '') +
      (show('partial') ? group('Only in your Skills list (add proof in bullets)', k.partial, 'p', 'None.') : '') +
      (show('matched') ? group('Matched', k.matched, 'm', 'No matches yet.') : '') +
      (kwFilter === 'all' && k.other.length ? '<div class="kw-group"><h3>Other phrases the job keeps repeating <span class="cnt">' + k.other.length + '</span></h3><div class="kw-list">' +
        k.other.map((o) => '<span class="kw ' + (o.found ? 'm' : 'x') + '" title="appears ' + o.count + '×"><span>' + esc(o.term) + '</span></span>').join('') + '</div></div>' : '') + '</div>';
  }

  function tabBullets() {
    const r = current, s = r.bulletStats;
    const pct = (x) => Math.round(x * 100) + '%';
    setChips([{ id: 'weak', label: 'Needs work' }, { id: 'all', label: 'All bullets' }], bulletFilter, (f) => { bulletFilter = f; store.set('bulletFilter', f); tabBullets(); });
    const list = r.bullets.filter((b) => bulletFilter === 'all' || b.quality !== 'strong' || !b.xyz);
    el.content.innerHTML = '<div class="xyz-box"><b>The XYZ formula:</b> <code>Accomplished [X] as measured by [Y], by doing [Z]</code>. Example: <i>“Cut report generation time from 40s to 6s (Y) by rewriting the query layer with Redis caching (Z), speeding up the customer dashboard (X).”</i> A number and a method make a bullet credible and keyword-rich.</div>' +
      '<div class="stats"><div class="bstat"><b>' + pct(s.metricPct) + '</b><span>with a measurable result (aim 60%+)</span></div>' +
      '<div class="bstat"><b>' + pct(s.verbPct) + '</b><span>open with a strong action verb</span></div>' +
      '<div class="bstat"><b>' + pct(s.xyzPct) + '</b><span>full XYZ pattern (aim 40%+)</span></div>' +
      '<div class="bstat"><b>' + s.count + '</b><span>bullets analysed</span></div></div>' +
      (s.count ? (aiAvailable ? '<div class="row" style="margin-bottom:12px"><button class="btn small lime" id="aiBullets">Rewrite weak bullets with AI ✦</button></div>' : '') +
        (list.length ? list.map((b) =>
          '<div class="bullet ' + b.quality + '"><div class="bullet-role">' + esc(b.role || 'Experience') + ' · ' + b.points + '/100</div><div class="bullet-t">' + esc(b.text) + '</div>' +
          (b.flags.length ? '<ul class="flags">' + b.flags.map((f) => '<li>' + esc(f.text) + '</li>').join('') + '</ul>' : '<p class="legend" style="margin:6px 0 0">Strong: verb + result + method.</p>') +
          (b.suggestion ? '<div class="sugg"><b>XYZ rewrite template</b>' + esc(b.suggestion.template) + (b.related.length ? '<br><small>If true, weave in a missing job keyword: ' + esc(b.related.join(', ')) + '</small>' : '') +
            '<br><small>Stronger verbs: ' + esc(b.suggestion.verbs.join(', ')) + '</small></div>' : '') + '</div>').join('') : '<div class="empty">All bullets look strong.</div>') + '<div id="aiBulletsOut"></div>'
        : '<div class="empty">No bullet points detected. Put each achievement on its own line starting with “•” or “-”, under a heading like “Experience”.</div>');
    const ab = $('#aiBullets'); if (ab) ab.addEventListener('click', aiRewriteBullets);
  }

  function tabAts() {
    const r = current.ats;
    setChips([{ id: 's', label: 'ATS readability · ' + r.score + '/100', static: true }], 's', () => {});
    el.content.innerHTML = '<p class="legend">These checks run on the text of your resume. Also confirm manually: no photos or logos, no text in headers/footers or text boxes, standard fonts, and a text-based file (not a scan).</p><div class="tile">' +
      r.checks.slice().sort((a, b) => ({ fail: 0, warn: 1, pass: 2 }[a.status] - { fail: 0, warn: 1, pass: 2 }[b.status])).map((c) =>
        '<div class="check"><div class="ico ' + c.status + '">' + (c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✕') + '</div><div><b>' + esc(c.label) + '</b><span>' + (c.status === 'pass' ? 'Looks good.' : esc(c.detail)) + '</span></div></div>').join('') + '</div>';
  }

  function copyText(ta) { return async () => { try { await navigator.clipboard.writeText(ta.value); toast('Copied'); } catch (e) { ta.select(); document.execCommand('copy'); toast('Copied'); } }; }
  const docHtml = (t) => '<html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial;font-size:11pt;white-space:pre-wrap">' + esc(t) + '</body></html>';
  const countPh = (ta, out) => () => { const n = (ta.value.match(/\[[A-Z][^\]]*\]/g) || []).length; out.textContent = n ? n + ' placeholder' + (n > 1 ? 's' : '') + ' to fill' : 'no placeholders left'; };

  function tabTailor() {
    if (!tailored) tailored = JM.tailor(current);
    setChips([{ id: 's', label: 'Built only from your own content', static: true }], 's', () => {});
    el.content.innerHTML = '<div class="tailor"><p class="legend">Your summary is rebuilt around the job, skills are reordered and re-worded to the posting\'s exact terms, and bullets are ordered by relevance. Nothing you lack is added. Fill every <b>[ADD …]</b> placeholder, edit freely, then re-score.</p>' +
      '<div class="tailor-bar"><button class="btn small primary" id="rescore">Re-score this draft</button><button class="btn small" id="copyT">Copy</button>' +
      '<button class="btn small" id="dlTxt">Download .txt</button><button class="btn small" id="dlDoc">Download .doc</button><button class="btn small" id="printT">Print / PDF</button>' +
      (aiAvailable ? '<button class="btn small lime" id="aiTailor">Rewrite with AI ✦</button>' : '') + '<span class="grow"></span><span class="pillnote" id="phCount"></span></div>' +
      (tailored.notes.length && !aiDraft ? '<div class="note">' + esc(tailored.notes[0].replace('--- ', '')) + '</div>' : '') +
      '<textarea id="tailorText" spellcheck="false"></textarea></div>';
    const ta = $('#tailorText'); ta.value = aiDraft || tailored.text;
    const ph = countPh(ta, $('#phCount')); ph(); ta.addEventListener('input', ph);
    $('#copyT').onclick = copyText(ta);
    $('#dlTxt').onclick = () => download('tailored-resume.txt', ta.value);
    $('#dlDoc').onclick = () => download('tailored-resume.doc', docHtml(ta.value), 'application/msword');
    $('#printT').onclick = () => { $('#printSheet').textContent = ta.value; window.print(); };
    $('#rescore').onclick = () => { el.resume.value = ta.value; const was = current.score; run(); toast('Draft re-scored: ' + current.score + '/100 (was ' + was + ')'); };
    const at = $('#aiTailor'); if (at) at.onclick = aiRewriteResume;
  }

  function tabCover() {
    const gen = () => aiCover || JM.coverLetter(current, { company: currentInput.company, hiringManager: coverOpts.hiringManager, name: coverOpts.name }).text;
    setChips([{ id: 's', label: 'Never claims skills you lack', static: true }], 's', () => {});
    el.content.innerHTML = '<div class="tailor"><p class="legend">Built from your real, quantified achievements and the skills you actually match. Gaps are bridged from related experience or left as <b>[ONLY IF TRUE]</b> lines. Fill every bracketed placeholder, and add one sentence on why you want this company.</p>' +
      '<div class="two"><input id="clMgr" type="text" placeholder="Hiring manager name (optional)" value="' + esc(coverOpts.hiringManager) + '" aria-label="Hiring manager"><input id="clName" type="text" placeholder="Your name (auto-detected)" value="' + esc(coverOpts.name) + '" aria-label="Your name"></div>' +
      '<div class="tailor-bar"><button class="btn small primary" id="clGen">Regenerate</button><button class="btn small" id="clCopy">Copy</button><button class="btn small" id="clTxt">Download .txt</button><button class="btn small" id="clDoc">Download .doc</button><button class="btn small" id="clPrint">Print / PDF</button>' +
      (aiAvailable ? '<button class="btn small lime" id="clAi">Write with AI ✦</button>' : '') + '<span class="grow"></span><span class="pillnote" id="clCount"></span></div><textarea id="clText" spellcheck="false" style="min-height:420px;font-family:var(--font)"></textarea></div>';
    const ta = $('#clText'); ta.value = gen();
    const count = countPh(ta, $('#clCount')); count(); ta.addEventListener('input', count);
    $('#clGen').onclick = () => { coverOpts = { hiringManager: $('#clMgr').value, name: $('#clName').value }; aiCover = null; ta.value = gen(); count(); };
    $('#clCopy').onclick = copyText(ta);
    $('#clTxt').onclick = () => download('cover-letter.txt', ta.value);
    $('#clDoc').onclick = () => download('cover-letter.doc', docHtml(ta.value), 'application/msword');
    $('#clPrint').onclick = () => { $('#printSheet').textContent = ta.value; window.print(); };
    const ai = $('#clAi');
    if (ai) ai.onclick = async () => {
      if (!confirm('This sends your resume and the job description to the Anthropic API to write the letter. Continue?')) return;
      ai.disabled = true; ai.textContent = 'Writing…';
      try { aiCover = await aiCall('cover'); ta.value = aiCover; count(); toast('AI letter ready. Check every claim.'); } catch (e) { toast(e.message); }
      ai.disabled = false; ai.textContent = 'Write with AI ✦';
    };
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
    try { aiDraft = await aiCall('tailor'); renderTab(); toast('AI draft ready. Review every line for accuracy.'); }
    catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Rewrite with AI ✦'; }
  }
  async function aiRewriteBullets() {
    if (!confirm('This sends the weak bullets and the job description to the Anthropic API. Continue?')) return;
    const b = $('#aiBullets'); b.disabled = true; b.textContent = 'Writing…';
    try {
      const weak = current.bullets.filter((x) => !x.xyz).slice(0, 15).map((x) => x.text);
      const out = await aiCall('bullets', { bullets: weak });
      $('#aiBulletsOut').innerHTML = '<h3 class="sec-h" style="margin-top:18px">AI rewrites (verify every number)</h3><div class="ai-out">' + esc(out) + '</div>';
    } catch (e) { toast(e.message); }
    b.disabled = false; b.textContent = 'Rewrite weak bullets with AI ✦';
  }

  /* ---------------- My jobs + dock ---------------- */
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
    renderDock(); renderPills(); toast(prev ? 'Updated saved job' : 'Saved to My jobs');
  }

  function openJob(id) {
    const j = jobs().find((x) => x.id === id); if (!j) return;
    el.jd.value = j.jd; el.title.value = j.title === 'Untitled role' ? '' : j.title; el.company.value = j.company || '';
    $('#jdChip').hidden = true; updateHints(); run();
  }

  function renderJobs() {
    const list = jobs();
    const box = $('#jobsList');
    if (!list.length) { box.innerHTML = '<div class="empty">No saved jobs yet. Analyze a job and click “Save to My jobs”.</div>'; return; }
    const cls = (n) => (n >= 65 ? '' : n >= 50 ? 'mid' : 'low');
    box.innerHTML = '<table class="jobs-table"><thead><tr><th>Score</th><th>Role</th><th class="hide-s">Saved</th><th>Status</th><th></th></tr></thead><tbody>' +
      list.slice().sort((a, b) => b.score - a.score).map((j) =>
        '<tr><td><span class="score-badge ' + cls(j.score) + '">' + j.score + '</span></td><td><b>' + esc(j.title) + '</b><br><small style="color:var(--muted)">' + esc(j.company || '') + '</small></td>' +
        '<td class="hide-s">' + new Date(j.date).toLocaleDateString() + '</td>' +
        '<td><select data-status="' + esc(j.id) + '" aria-label="Status">' + STATUSES.map((s) => '<option' + (s === j.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></td>' +
        '<td><div class="row"><button class="btn small" data-open="' + esc(j.id) + '">Re-analyze</button><button class="btn small ghost" data-del="' + esc(j.id) + '" aria-label="Delete">✕</button></div></td></tr>').join('') + '</tbody></table>';
  }

  function renderDock() {
    const list = jobs().slice(0, 12);
    $('#dock').innerHTML = '<button class="dock-ico" data-go="jobs" aria-label="Open My jobs" title="My jobs">' + svg('jobs') + '</button>' +
      '<div class="dock-label"><b>Saved jobs</b>' + jobs().length + ' tracked</div>' +
      (list.length ? list.map((j) => '<button class="dock-job" data-open="' + esc(j.id) + '" title="' + esc(j.title + (j.company ? ' · ' + j.company : '')) + '"><span class="t">' + esc(j.title) + '</span><span class="sc">' + j.score + '</span></button>').join('')
        : '<span class="dock-empty">Saved jobs appear here after you click “Save to My jobs”.</span>');
  }

  $('#jobsList').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]'), del = e.target.closest('[data-del]');
    if (open) openJob(open.dataset.open);
    else if (del) { store.set('jobs', jobs().filter((x) => x.id !== del.dataset.del)); renderJobs(); renderDock(); renderPills(); }
  });
  $('#jobsList').addEventListener('change', (e) => {
    const s = e.target.closest('[data-status]'); if (!s) return;
    store.set('jobs', jobs().map((j) => (j.id === s.dataset.status ? Object.assign({}, j, { status: s.value }) : j)));
  });
  $('#dock').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]'), g = e.target.closest('[data-go]');
    if (open) openJob(open.dataset.open); else if (g) go(g.dataset.go);
  });

  /* ---------------- wiring ---------------- */
  $('#pills').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b && !b.disabled) go(b.dataset.go); });
  $('#homeBtn').addEventListener('click', () => go('analyze'));
  $('#analyzeBtn').addEventListener('click', run);
  $('#saveJobBtn').addEventListener('click', saveJob);
  $('#sampleBtn').addEventListener('click', () => {
    const s = window.JobMatcherSamples; el.resume.value = s.resume; el.jd.value = s.jd; el.title.value = ''; el.company.value = 'Example Co';
    $('#resumeChip').hidden = true; $('#jdChip').hidden = true; updateHints(); persist(); run();
  });
  $('#clearBtn').addEventListener('click', () => {
    if ((el.resume.value || el.jd.value) && !confirm('Clear the resume and job description fields?')) return;
    el.resume.value = ''; el.jd.value = ''; el.title.value = ''; el.company.value = ''; $('#resumeChip').hidden = true; $('#jdChip').hidden = true; persist(); updateHints(); setMsg('', false);
  });
  [el.resume, el.jd, el.title, el.company].forEach((x) => x.addEventListener('input', () => { updateHints(); persist(); }));
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && page === 'analyze') run(); });
  wireImport('#drop-resume', '#resumeFile', el.resume, '#resumeChip');
  wireImport('#drop-jd', '#jdFile', el.jd, '#jdChip');
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('jm:theme', next); } catch (e) { /* ignore */ }
  });

  const markAccent = () => { const a = document.documentElement.getAttribute('data-accent'); $$('.sw').forEach((b) => b.classList.toggle('on', b.dataset.a === a)); };
  $('#swatches').addEventListener('click', (e) => {
    const b = e.target.closest('.sw'); if (!b) return;
    document.documentElement.setAttribute('data-accent', b.dataset.a);
    try { localStorage.setItem('jm:accent', b.dataset.a); } catch (err) { /* ignore */ }
    markAccent();
  });
  markAccent();

  // init
  el.resume.value = store.get('resume', '');
  const d = store.get('draft', null);
  if (d) { el.jd.value = d.jd || ''; el.title.value = d.title || ''; el.company.value = d.company || ''; }
  updateHints(); renderPills(); renderDock();
  if (location.hash === '#jobs') go('jobs');
  fetch('/api/status').then((r) => r.json()).then((s) => { aiAvailable = !!s.ai; }).catch(() => {});
})();
