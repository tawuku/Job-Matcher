/*
 * Job Matcher engine. Pure functions, no DOM, no network.
 * Works in the browser (window.JobMatcher) and in Node (require).
 *
 *   const r = JobMatcher.analyze(resumeText, jobDescriptionText, { jobTitle, now });
 *   const draft = JobMatcher.tailor(r);
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./skills.js'));
  else root.JobMatcher = factory(root.JobMatcherSkills);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Skills) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                          */
  /* ------------------------------------------------------------------ */

  const WEIGHTS = {
    keywords: 40,
    language: 15,
    title: 10,
    experience: 10,
    education: 5,
    impact: 10,
    ats: 10
  };

  const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
  const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const DATE_RANGE = new RegExp(
    '(?:' + MONTH_RE + '\\.?,?\\s+|(\\d{1,2})[/.](?=\\d{4}))?(\\d{4})\\s*(?:-|–|—|to|until)\\s*' +
      '(?:(?:' + MONTH_RE + '\\.?,?\\s+|(\\d{1,2})[/.](?=\\d{4}))?(\\d{4})|(present|current|now|ongoing|today|date))',
    'i'
  );

  const STOP = new Set(('a an the and or but if then else of at by for with without to from in on onto into over under about as is are was were be been being ' +
    'it its this that these those you your we our us they their them he she his her i me my will would can could should may might must shall do does did done have has had having ' +
    'not no nor so than too very just also any all each every both either neither other such own same more most less least some many much few ' +
    'who whom whose which what when where why how while during before after between among through per via etc eg ie vs').split(/\s+/));

  const FLUFF = new Set(('team teams work working works experience experiences ability able strong skill skills role roles company companies job jobs position candidate candidates ' +
    'looking look join joining opportunity opportunities responsibilities responsibility requirements requirement qualifications qualification preferred required years year ' +
    'including include includes etc new high good great excellent well across within using use used related plus please apply equal employer employers benefits benefit salary ' +
    'location remote hybrid office day days time full part ideal seeking passionate environment fast paced growing help helping ensure ensuring support supporting provide providing ' +
    'responsible knowledge understanding understand demonstrated proven successful success best based key various variety multiple excellent strong etc tools tool ' +
    'looking want make making needs need needed taking take get getting like love able open around highly well-being world industry leading innovative mission ' +
    'opportunity career us’ diverse inclusive inclusion diversity status gender race age veteran disability protected sexual orientation national origin religion color ' +
    'minimum maximum least bonus nice must preferred equivalent degree bachelor bachelors master masters').split(/\s+/));

  const SENIORITY = {
    intern: 0, trainee: 0, junior: 1, jr: 1, entry: 1, associate: 1, graduate: 1,
    senior: 3, sr: 3, lead: 4, staff: 4, principal: 4, head: 5, director: 5, vp: 6, chief: 6
  };
  const TITLE_NOISE = new Set(['ii', 'iii', 'iv', 'i', 'and', 'of', 'the', 'for', 'a', 'an', 'in', 'to', 'remote', 'hybrid', 'full', 'time', 'part']);
  const TITLE_SYN = {
    developer: 'engineer', programmer: 'engineer', swe: 'engineer', dev: 'engineer',
    analyst: 'analyst', analytics: 'analyst', scientist: 'scientist',
    manager: 'manager', mgr: 'manager', specialist: 'specialist', coordinator: 'coordinator',
    consultant: 'consultant', designer: 'designer', recruiter: 'recruiter'
  };

  const HEADING_VOCAB = new Set(('experience employment work history professional relevant career education academic background qualifications skills technical core key ' +
    'competencies technologies proficiencies summary profile objective about me projects project portfolio personal certifications certification licenses courses training and & ' +
    'awards honors achievements publications volunteer volunteering interests languages references activities leadership executive expertise tools selected additional other ' +
    'information extracurricular highlights accomplishments tech stack').split(/\s+/));

  const SECTION_RULES = [
    ['education', /\b(education|academic|qualifications)\b/],
    ['certs', /\b(certifications?|licenses?|courses?|training)\b/],
    ['experience', /\b(experience|employment|work|history|career)\b/],
    ['skills', /\b(skills|competencies|technologies|tech|proficiencies|expertise|tools)\b/],
    ['summary', /\b(summary|profile|objective|about|highlights|accomplishments)\b/],
    ['projects', /\b(projects?|portfolio)\b/],
    ['other', /\b(awards?|honors?|achievements?|publications?|volunteer(ing)?|interests|languages|references|activities|leadership|additional|other|information|extracurricular)\b/]
  ];

  const VERBS_BASE = ('accelerate accomplish achieve acquire adapt administer advise advocate align analyze architect assemble assess audit authored automate boost brief budget build ' +
    'calculate campaign champion clarify coach collaborate compile complete conceive conduct configure consolidate construct consult contribute convert coordinate create ' +
    'cultivate debug decrease define deliver deploy design detect develop devise diagnose direct discover document double drive earn edit eliminate enable engineer enhance ' +
    'establish estimate evaluate exceed execute expand expedite facilitate finalize forecast formulate found generate grow guide harden identify implement improve increase ' +
    'influence initiate innovate inspect install instruct integrate introduce invent investigate launch lead leverage maintain manage map market mentor migrate minimize ' +
    'model modernize monitor motivate navigate negotiate normalize onboard operate optimize orchestrate organize originate outperform overhaul oversee partner perform pilot ' +
    'pioneer plan present prioritize process produce program promote prototype provision publish rebuild recommend reconcile recruit redesign reduce refactor refine ' +
    'regulate reinforce release remediate renegotiate reorganize replace report represent research resolve restructure retain revamp review revise rewrite scale schedule ' +
    'secure select serve shape simplify sell solve source spearhead standardize steer streamline strengthen structure supervise support surpass sustain synthesize ' +
    'systematize tailor teach test track train transform translate troubleshoot unify upgrade validate visualize win write').split(/\s+/);
  const VERBS_IRREGULAR = 'led built ran grew drove wrote won sold spent taught ran cut set put made began brought chose drew found held kept led met paid rose saw sent shaped took thought understood'.split(/\s+/);
  const STRONG_VERBS = new Set(VERBS_BASE.concat(VERBS_IRREGULAR));
  VERBS_BASE.forEach((v) => {
    STRONG_VERBS.add(v + 's');
    STRONG_VERBS.add(v + 'ed');
    STRONG_VERBS.add(v + 'd');
    STRONG_VERBS.add(v + v[v.length - 1] + 'ed');
    STRONG_VERBS.add(v + 'ing');
    if (/[^aeiou]y$/.test(v)) STRONG_VERBS.add(v.slice(0, -1) + 'ied');
    if (/e$/.test(v)) STRONG_VERBS.add(v.slice(0, -1) + 'ing');
  });
  STRONG_VERBS.add('authored');
  STRONG_VERBS.add('spearheaded');

  const WEAK_START = /^\s*(responsible\s+for|duties\s+(?:included?|were)|worked\s+(?:on|with|in)|helped|assisted|participated|involved\s+in|tasked\s+with|in\s+charge\s+of|handled|did\b|was\s+(?:responsible|part\s+of)|contributed\s+to|exposure\s+to|familiar\s+with|attended|got\b|various|many)/i;

  const METRIC_HINTS = [
    [/reduc|decreas|cut\b|lower|minimi[sz]|sav(?:e|ed|ing)|eliminat/i, 'how much you cut (%, $, hours) and from what baseline'],
    [/increas|improv|grow|boost|rais|expand|accelerat|lift|doubl|tripl/i, 'the gain (% / $ / x) versus the previous baseline, and over what period'],
    [/lead|led\b|manag|supervis|mentor|coach|direct|head/i, 'team size, number of direct reports, budget owned, or number of projects'],
    [/build|built|develop|creat|design|implement|launch|deploy|architect|ship/i, 'scale of impact: users or requests served, adoption, latency, uptime, or delivery time'],
    [/sale|revenue|client|account|customer|deal|quota|pipeline/i, 'revenue ($), % of quota, number of accounts, or retention rate'],
    [/automat|streamlin|optimi[sz]|process|workflow/i, 'time saved per week, error-rate drop, or cost saved'],
    [/analy|report|research|insight|dashboard|model|forecast/i, 'decisions influenced, $ impacted, data volume, or number of stakeholders served'],
    [/train|teach|onboard|educat/i, 'number of people trained and how their results changed'],
    [/test|qa\b|quality|bug|defect/i, 'defect rate, coverage %, release frequency, or incidents prevented']
  ];

  const SUMMARY_VERB_ALTS = {
    default: ['Led', 'Delivered', 'Built', 'Improved', 'Drove'],
    reduce: ['Reduced', 'Cut', 'Eliminated', 'Streamlined', 'Consolidated'],
    grow: ['Increased', 'Grew', 'Accelerated', 'Expanded', 'Boosted'],
    manage: ['Led', 'Managed', 'Directed', 'Mentored', 'Coordinated'],
    build: ['Built', 'Designed', 'Launched', 'Architected', 'Implemented'],
    analyze: ['Analyzed', 'Modeled', 'Forecasted', 'Identified', 'Evaluated']
  };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                      */
  /* ------------------------------------------------------------------ */

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const round = (n) => Math.round(n);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const uniq = (a) => Array.from(new Set(a));
  const titleCase = (s) => s.replace(/\b([a-z])([a-z']*)/gi, (m, a, b) => (b === b.toUpperCase() && b.length > 1 ? m : a.toUpperCase() + b.toLowerCase()));

  function normalizeText(t) {
    return String(t || '')
      .replace(/\r\n?/g, '\n')
      .replace(/ /g, ' ')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/•|●|▪|◦|‣|⁃|∙||■|➢|→/g, '•')
      .replace(/[ \t]+$/gm, '');
  }

  function stem(w) {
    w = w.toLowerCase();
    if (w.length <= 4) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
    if (/ing$/.test(w) && w.length > 6) return w.slice(0, -3).replace(/(.)\1$/, '$1');
    if (/ed$/.test(w) && w.length > 5) return w.slice(0, -2).replace(/(.)\1$/, '$1');
    if (/ly$/.test(w) && w.length > 6) return w.slice(0, -2);
    if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function words(text) {
    return (String(text).toLowerCase().match(/[a-z][a-z0-9+#.\-/]*[a-z0-9+#]|[a-z]/g) || []).map((w) => w.replace(/^[.\-/]+|[.\-/]+$/g, '')).filter(Boolean);
  }

  /* ------------------------------------------------------------------ */
  /* Skill matching                                                     */
  /* ------------------------------------------------------------------ */

  function formRegex(form) {
    const parts = form.toLowerCase().split(/[\s\-]+/).map(esc);
    let body = parts.join('[\\s\\-]+');
    const plural = /^[a-z][a-z \-]{3,}$/.test(form.toLowerCase()) ? '(?:s|es)?' : '';
    return '(?<![a-z0-9+#])' + body + plural + '(?![a-z0-9+#]|\\.[a-z0-9])';
  }

  const SKILLS = Skills.list.map((s) => {
    const forms = uniq(s.forms.map((f) => f.toLowerCase()));
    return Object.assign({}, s, { forms, re: new RegExp(forms.map(formRegex).join('|'), 'gi') });
  });
  const SKILL_BY_NAME = new Map(SKILLS.map((s) => [s.name.toLowerCase(), s]));

  function countSkill(skill, text) {
    skill.re.lastIndex = 0;
    const m = text.match(skill.re);
    return m ? m.length : 0;
  }

  function surfaceForms(skill, text) {
    skill.re.lastIndex = 0;
    return text.match(skill.re) || [];
  }

  /* ------------------------------------------------------------------ */
  /* Job description parsing                                            */
  /* ------------------------------------------------------------------ */

  const JD_SECTION_RULES = [
    ['preferred', /(nice[\s-]*to[\s-]*have|preferred|bonus|a\s+plus|desirable|good\s+to\s+have|ideal(ly)?|extra\s+credit|would\s+be\s+great)/i],
    ['required', /(requirement|qualification|must[\s-]*have|what\s+you.?ll\s+need|what\s+we.?re\s+looking\s+for|you\s+have|you\s+bring|who\s+you\s+are|about\s+you|minimum|basic\s+qual|skills\s+(?:&|and)\s+experience|required)/i],
    ['responsibilities', /(responsibilit|what\s+you.?ll\s+do|duties|the\s+role|your\s+impact|day[\s-]*to[\s-]*day|in\s+this\s+role|you\s+will|key\s+activities|what\s+you.?ll\s+be\s+doing)/i],
    ['about', /(about\s+(us|the\s+company|the\s+team)|who\s+we\s+are|benefits|perks|compensation|we\s+offer|why\s+join|equal\s+opportunity|our\s+(mission|culture|values))/i]
  ];
  const JD_SECTION_WEIGHT = { required: 3, responsibilities: 2, general: 1.5, preferred: 1, about: 0.4 };

  function classifyJdHeading(line) {
    const t = line.trim().replace(/^[#*_\-•\s]+|[:*_\s]+$/g, '');
    if (!t || t.length > 70) return null;
    const looksHeading = /:\s*$/.test(line.trim()) || (t === t.toUpperCase() && /[A-Z]/.test(t)) || /^#{1,4}\s/.test(line.trim()) || (t.split(/\s+/).length <= 7 && !/[.,;]$/.test(t) && /^[A-Z]/.test(t) && !/^[•\-*]/.test(line.trim()));
    if (!looksHeading) return null;
    for (const [name, re] of JD_SECTION_RULES) if (re.test(t)) return name;
    return null;
  }

  function extractJdTitle(jd, hint) {
    if (hint && hint.trim()) return hint.trim();
    const lines = jd.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const l of lines.slice(0, 15)) {
      const m = l.match(/^(?:job\s*title|position|role|title)\s*[:\-–]\s*(.{3,80})$/i);
      if (m) return m[1].trim();
    }
    const m2 = jd.match(/(?:looking\s+for|hiring|seeking|join\s+(?:us|our\s+team)\s+as)\s+(?:an?\s+|our\s+)?([A-Z][A-Za-z/&,\-\s]{3,60}?)(?:\s+(?:to|who|with|at|for|in)\b|[.,\n])/);
    const first = lines[0] || '';
    if (first && first.split(/\s+/).length <= 12 && !/[.!?]$/.test(first)) return first.replace(/\s+[|\-–@]\s+.*$/, '').trim() || first;
    if (m2) return m2[1].trim();
    return '';
  }

  function parseJd(jd, opts) {
    const lines = jd.split('\n');
    const sectioned = [];
    let section = 'general';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const h = classifyJdHeading(line);
      if (h) { section = h; if (line.length < 60) continue; }
      let lineSection = section;
      if (/(nice[\s-]*to[\s-]*have|preferred|a\s+plus|bonus|ideally|desirable)/i.test(line) && !/^(must|required)/i.test(line)) lineSection = 'preferred';
      else if (/\b(required|must\s+have|must\s+be|minimum|mandatory|essential)\b/i.test(line)) lineSection = 'required';
      sectioned.push({ text: line, section: lineSection });
    }
    const title = extractJdTitle(jd, opts && opts.jobTitle);
    return { lines: sectioned, title };
  }

  function jdYears(jd) {
    const found = [];
    const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b[^.\n]{0,60}?(?:experience|exp\b|background|in\b|as\b|working)/gi;
    let m;
    while ((m = re.exec(jd))) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n <= 30) found.push({ years: n, text: m[0].trim() });
    }
    if (!found.length) {
      const re2 = /(?:minimum|at\s+least)\s+(?:of\s+)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi;
      while ((m = re2.exec(jd))) found.push({ years: parseInt(m[1], 10), text: m[0] });
    }
    if (!found.length) return null;
    found.sort((a, b) => b.years - a.years);
    return found[0];
  }

  const DEGREE_LEVELS = [
    [4, /\b(ph\.?d|doctorate|doctoral)\b/i, 'PhD'],
    [3, /\b(master'?s?|m\.?sc\.?|m\.?s\.?\b|mba|m\.?eng|m\.?a\.?\b|postgraduate)\b/i, "Master's"],
    [2, /\b(bachelor'?s?|b\.?sc\.?|b\.?s\.?\b|b\.?a\.?\b|b\.?eng|b\.?tech|undergraduate|\bbsc\b|degree)\b/i, "Bachelor's"],
    [1.5, /\b(associate'?s?\s+degree|a\.?a\.?s\.?|diploma|hnd|nvq)\b/i, 'Associate/Diploma'],
    [1, /\b(high\s+school|ged|secondary)\b/i, 'High school']
  ];

  function degreeLevel(text) {
    for (const [lvl, re, label] of DEGREE_LEVELS) if (re.test(text)) return { level: lvl, label };
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Resume parsing                                                     */
  /* ------------------------------------------------------------------ */

  const BULLET_RE = /^\s*(?:[•\-*–—·▪]|\d{1,2}[.)])\s+/;

  function headingType(line) {
    let t = line.trim().replace(/^#{1,6}\s*/, '').replace(/[:*_|]+$/g, '').replace(/^[*_|]+/, '').trim();
    if (!t || t.length > 45 || BULLET_RE.test(line)) return null;
    const ws = t.toLowerCase().split(/\s+/);
    if (ws.length > 5) return null;
    if (!ws.every((w) => HEADING_VOCAB.has(w.replace(/[^a-z&]/g, '')))) return null;
    const lower = t.toLowerCase();
    for (const [name, re] of SECTION_RULES) if (re.test(lower)) return name;
    return null;
  }

  function monthIndex(s) { return s ? MONTHS.indexOf(s.slice(0, 3).toLowerCase()) : -1; }

  function parseRange(line, now) {
    const m = line.match(DATE_RANGE);
    if (!m) return null;
    const sm = m[1] ? monthIndex(m[1]) : m[2] ? parseInt(m[2], 10) - 1 : 0;
    const sy = parseInt(m[3], 10);
    let ey, em;
    if (m[7]) { ey = now.getFullYear(); em = now.getMonth(); }
    else { ey = parseInt(m[6], 10); em = m[4] ? monthIndex(m[4]) : m[5] ? parseInt(m[5], 10) - 1 : 11; }
    if (sy < 1960 || sy > now.getFullYear() + 1 || ey < sy || ey > now.getFullYear() + 1) return null;
    const start = sy * 12 + clamp(sm, 0, 11);
    const end = Math.min(ey * 12 + clamp(em, 0, 11), now.getFullYear() * 12 + now.getMonth());
    if (end < start) return null;
    return { start, end, text: m[0], index: m.index, current: !!m[7] };
  }

  function unionMonths(ranges) {
    const rs = ranges.slice().sort((a, b) => a.start - b.start);
    let total = 0, curS = null, curE = null;
    for (const r of rs) {
      if (curS === null) { curS = r.start; curE = r.end; }
      else if (r.start <= curE + 1) curE = Math.max(curE, r.end);
      else { total += curE - curS + 1; curS = r.start; curE = r.end; }
    }
    if (curS !== null) total += curE - curS + 1;
    return total;
  }

  function parseResume(text, now) {
    const lines = text.split('\n');
    const sections = [{ name: 'header', heading: '', lines: [] }];
    let detected = false;
    for (const line of lines) {
      const h = headingType(line);
      if (h && line.trim()) {
        detected = true;
        sections.push({ name: h, heading: line.trim().replace(/^#{1,6}\s*/, ''), lines: [] });
      } else sections[sections.length - 1].lines.push(line);
    }
    const hasExperience = sections.some((s) => s.name === 'experience');
    if (!hasExperience) {
      // No recognisable experience heading: treat header body as experience so bullets are still analysed.
      const hdr = sections[0];
      const firstDate = hdr.lines.findIndex((l) => DATE_RANGE.test(l));
      if (firstDate > -1) {
        const start = Math.max(0, firstDate - 1);
        const exp = { name: 'experience', heading: '', lines: hdr.lines.slice(start), implicit: true };
        hdr.lines = hdr.lines.slice(0, start);
        sections.splice(1, 0, exp);
      }
    }

    // Roles + bullets (experience and projects sections)
    const roles = [];
    const bullets = [];
    const ranges = [];
    for (const sec of sections) {
      if (sec.name !== 'experience' && sec.name !== 'projects') continue;
      let role = { header: '', headerLines: [], dates: '', section: sec.name, bullets: [] };
      roles.push(role);
      let prev = '';
      for (const raw of sec.lines) {
        const line = raw.trim();
        if (!line) continue;
        const isBullet = BULLET_RE.test(raw);
        const range = !isBullet ? parseRange(line, now) : null;
        if (range && line.length < 140) {
          const rest = line.replace(range.text, ' ').replace(/[|,·•\-–—()\s]+$/g, '').replace(/^[|,·•\-–—()\s]+/g, '').trim();
          const headerLines = [];
          if (prev && !roles[roles.length - 1].bullets.length && !role.header) headerLines.push(prev);
          else if (prev && role.bullets.length === 0) headerLines.push(prev);
          if (rest) headerLines.push(rest);
          if (role.header || role.bullets.length) {
            role = { header: '', headerLines: [], dates: '', section: sec.name, bullets: [] };
            roles.push(role);
            headerLines.length = 0;
            if (prev) headerLines.push(prev);
            if (rest) headerLines.push(rest);
          }
          role.headerLines = headerLines;
          role.header = headerLines.join(' — ');
          role.dates = range.text;
          role.range = range;
          if (sec.name === 'experience') ranges.push(range);
        } else if (isBullet) {
          const b = { text: raw.replace(BULLET_RE, '').trim(), role, section: sec.name, kind: 'bullet' };
          role.bullets.push(b);
          bullets.push(b);
        } else if (line.split(/\s+/).length >= 11 && /[.;]$|,/.test(line)) {
          const b = { text: line, role, section: sec.name, kind: 'paragraph' };
          role.bullets.push(b);
          bullets.push(b);
        }
        prev = line;
      }
    }

    const monthsOfExperience = unionMonths(ranges);
    const edu = sections.filter((s) => s.name === 'education').map((s) => s.lines.join('\n')).join('\n');
    return { sections, detected, roles, bullets, ranges, years: monthsOfExperience / 12, eduText: edu };
  }

  /* ------------------------------------------------------------------ */
  /* Bullet analysis (XYZ)                                              */
  /* ------------------------------------------------------------------ */

  const YEAR_RE = /\b(19|20)\d{2}\b/g;
  const METRIC_WORDS = /\b(percent|million|billion|thousand|dozens?|hundreds?|doubled|tripled|halved|quadrupled|zero|two[- ]fold|three[- ]fold)\b/i;

  function hasMetric(text) {
    const t = text.replace(YEAR_RE, ' ');
    return /\d/.test(t) || METRIC_WORDS.test(t);
  }

  function metricHint(text) {
    for (const [re, hint] of METRIC_HINTS) if (re.test(text)) return hint;
    return 'a number: volume, %, $, time, or scale';
  }

  function verbFamily(text) {
    if (/reduc|decreas|cut\b|lower|minimi|sav|eliminat/i.test(text)) return 'reduce';
    if (/increas|improv|grow|boost|rais|expand|accelerat/i.test(text)) return 'grow';
    if (/lead|led\b|manag|supervis|mentor|coach|direct/i.test(text)) return 'manage';
    if (/build|built|develop|creat|design|implement|launch|deploy|architect/i.test(text)) return 'build';
    if (/analy|report|research|forecast|model/i.test(text)) return 'analyze';
    return 'default';
  }

  function analyzeBullet(b) {
    const text = b.text.replace(/\s+/g, ' ').trim();
    const ws = text.split(/\s+/).filter(Boolean);
    const first = (ws[0] || '').toLowerCase().replace(/[^a-z]/g, '');
    const weakStart = WEAK_START.test(text);
    const hasVerb = !weakStart && STRONG_VERBS.has(first);
    const metric = hasMetric(text);
    const method = /\b(by|using|through|via|leveraging|utilizing|utilising|with\s+the\s+help|built\s+on|powered\s+by)\b\s+\S+\s+\S+/i.test(text);
    const flags = [];
    if (weakStart) flags.push({ id: 'weak-start', text: 'Starts with a passive/duty phrase ("responsible for", "helped", "worked on"). Lead with a strong action verb.' });
    else if (!hasVerb) flags.push({ id: 'no-verb', text: 'Does not open with a strong action verb.' });
    if (!metric) flags.push({ id: 'no-metric', text: 'No measurable result (number, %, $, time, scale). This is the #1 thing recruiters scan for.' });
    if (!method) flags.push({ id: 'no-method', text: 'No "how" (by/using/through …). The method shows skill and carries keywords.' });
    if (ws.length < 7) flags.push({ id: 'short', text: 'Very short; add the outcome and the method.' });
    if (ws.length > 38) flags.push({ id: 'long', text: 'Long (' + ws.length + ' words). Aim for 15-30 words, one idea per bullet.' });
    if (/\b(i|my|me)\b/i.test(text)) flags.push({ id: 'pronoun', text: 'Uses first-person pronouns; drop them in resume bullets.' });
    if (b.kind === 'paragraph') flags.push({ id: 'paragraph', text: 'Written as a paragraph, not a bullet. Split into scannable bullets.' });
    const lengthOk = ws.length >= 8 && ws.length <= 35;
    const points = (hasVerb ? 25 : 0) + (metric ? 40 : 0) + (method ? 20 : 0) + (lengthOk ? 15 : 0);
    return {
      text, words: ws.length, hasVerb, weakStart, metric, method, flags, points,
      xyz: hasVerb && metric && method,
      quality: points >= 85 ? 'strong' : points >= 60 ? 'ok' : 'weak',
      role: b.role && b.role.header ? b.role.header : '', section: b.section
    };
  }

  function suggestBullet(a, family, related) {
    const core = a.text.replace(WEAK_START, '').replace(/^[\s,:\-–]+/, '').replace(/[.;]+$/, '');
    const verbs = (SUMMARY_VERB_ALTS[verbFamily(a.text)] || SUMMARY_VERB_ALTS.default).slice(0, 4);
    const parts = [];
    parts.push(a.hasVerb ? core : '[' + verbs[0] + ' / ' + verbs[1] + '] ' + core);
    if (!a.metric) parts.push('→ [RESULT: ' + metricHint(a.text) + ']');
    if (!a.method) parts.push('→ by [METHOD: the tool, technique, or approach you used' + (related.length ? ', e.g. ' + related.slice(0, 2).join(' / ') + ' if true' : '') + ']');
    return { template: parts.join(' '), verbs, metricHint: metricHint(a.text) };
  }

  /* ------------------------------------------------------------------ */
  /* Main analysis                                                      */
  /* ------------------------------------------------------------------ */

  function analyze(resumeIn, jdIn, opts) {
    opts = opts || {};
    const now = opts.now ? new Date(opts.now) : new Date();
    const resume = normalizeText(resumeIn);
    const jd = normalizeText(jdIn);
    const rLower = resume.toLowerCase();
    const parsedJd = parseJd(jd, opts);
    const parsedR = parseResume(resume, now);

    // Resume text split by "evidence zone"
    const zone = { experience: '', skills: '', summary: '', other: '' };
    for (const s of parsedR.sections) {
      const body = s.lines.join('\n');
      if (s.name === 'experience' || s.name === 'projects' || s.name === 'certs') zone.experience += '\n' + body;
      else if (s.name === 'skills') zone.skills += '\n' + body;
      else if (s.name === 'summary') zone.summary += '\n' + body;
      else zone.other += '\n' + body;
    }
    if (!parsedR.detected) zone.experience = resume;

    /* ---- JD skills ---- */
    const jdSkills = [];
    for (const sk of SKILLS) {
      let count = 0, best = 0, bestSection = null;
      const sections = new Set();
      const contexts = [];
      for (const ln of parsedJd.lines) {
        const c = countSkill(sk, ln.text);
        if (!c) continue;
        count += c;
        sections.add(ln.section);
        const w = JD_SECTION_WEIGHT[ln.section];
        if (w > best) { best = w; bestSection = ln.section; }
        if (contexts.length < 2) contexts.push(ln.text);
      }
      if (!count) continue;
      const inTitle = parsedJd.title && countSkill(sk, parsedJd.title) > 0;
      const importance = best + 0.4 * Math.min(count - 1, 3) + (inTitle ? 1 : 0);
      const onlyPreferred = sections.size === 1 && sections.has('preferred');
      const level = onlyPreferred ? 'preferred' : best >= 3 || inTitle ? 'required' : 'core';
      const surfaces = surfaceForms(sk, jd.toLowerCase());
      jdSkills.push({ skill: sk, count, importance, level, section: bestSection, contexts, surface: mostCommon(surfaces) });
    }

    /* ---- match JD skills against resume ---- */
    const matched = [], partial = [], missing = [];
    for (const j of jdSkills) {
      const exp = countSkill(j.skill, zone.experience);
      const sum = countSkill(j.skill, zone.summary);
      const skl = countSkill(j.skill, zone.skills);
      const oth = countSkill(j.skill, zone.other);
      const total = exp + sum + skl + oth;
      const item = {
        term: j.skill.name, category: j.skill.category, level: j.level, importance: round(j.importance * 10) / 10,
        jdCount: j.count, resumeCount: total, context: j.contexts[0] || '', jdForm: j.surface
      };
      if (!total) { item.credit = 0; item.where = null; missing.push(item); continue; }
      if (exp) { item.credit = 1; item.where = 'experience'; matched.push(item); }
      else if (sum) { item.credit = 0.9; item.where = 'summary'; matched.push(item); }
      else if (oth) { item.credit = 0.8; item.where = 'other'; matched.push(item); }
      else { item.credit = parsedR.detected ? 0.7 : 1; item.where = 'skills'; (parsedR.detected ? partial : matched).push(item); }
    }

    /* ---- other recurring JD phrases (non-taxonomy) ---- */
    const other = extractOtherTerms(parsedJd, jdSkills, resume);

    const skillTotal = jdSkills.reduce((a, j) => a + j.importance, 0);
    const skillGot = [].concat(matched, partial).reduce((a, m) => a + m.importance * m.credit, 0);
    const otherTotal = other.reduce((a, o) => a + o.importance, 0);
    const otherGot = other.reduce((a, o) => a + (o.found ? o.importance : 0), 0);
    let kwScore;
    if (skillTotal && otherTotal) kwScore = 0.8 * (skillGot / skillTotal) + 0.2 * (otherGot / otherTotal);
    else if (skillTotal) kwScore = skillGot / skillTotal;
    else if (otherTotal) kwScore = otherGot / otherTotal;
    else kwScore = 0.5;
    kwScore = round(clamp(kwScore, 0, 1) * 100);

    /* ---- language alignment (JD vocabulary coverage) ---- */
    const language = languageAlignment(parsedJd, resume);

    /* ---- title ---- */
    const titleRes = titleAlignment(parsedJd.title, parsedR, resume);

    /* ---- experience ---- */
    const reqYears = jdYears(jd);
    let expScore = 100, expDetail;
    const haveYears = parsedR.years;
    if (reqYears) {
      const ratio = haveYears / reqYears.years;
      expScore = ratio >= 1 ? 100 : round(clamp(Math.pow(ratio, 1.3), 0, 1) * 100);
      expDetail = 'Job asks for ' + reqYears.years + '+ years ("' + reqYears.text.replace(/\s+/g, ' ') + '"). Your dated roles add up to about ' + (Math.round(haveYears * 10) / 10) + ' years.';
      if (!parsedR.ranges.length) { expScore = 50; expDetail = 'Job asks for ' + reqYears.years + '+ years, but no dated roles (e.g. "Jan 2020 – Present") were found in your resume, so ATS cannot calculate your tenure.'; }
    } else expDetail = 'No minimum years stated in the job description' + (haveYears ? '; you show about ' + (Math.round(haveYears * 10) / 10) + ' years.' : '.');

    /* ---- education ---- */
    const jdDeg = degreeLevel(jd);
    const resDeg = degreeLevel(parsedR.eduText || resume);
    let eduScore = 100, eduDetail;
    const equivOk = /(or\s+equivalent|equivalent\s+(practical\s+)?experience|or\s+related\s+experience|or\s+relevant\s+experience)/i.test(jd);
    if (jdDeg) {
      if (resDeg && resDeg.level >= jdDeg.level) { eduScore = 100; eduDetail = 'Meets the ' + jdDeg.label + ' requirement (' + resDeg.label + ' found).'; }
      else if (resDeg) { eduScore = equivOk ? 85 : round(clamp(100 - 35 * (jdDeg.level - resDeg.level), 20, 100)); eduDetail = 'Job mentions ' + jdDeg.label + '; you show ' + resDeg.label + (equivOk ? ', but the posting accepts equivalent experience.' : '.'); }
      else { eduScore = equivOk ? 70 : 35; eduDetail = 'Job mentions ' + jdDeg.label + ' but no degree was detected in your resume. Add an Education section even if it is a certificate or in-progress.'; }
    } else eduDetail = 'No degree requirement detected.';

    /* ---- bullets / impact ---- */
    const analyzed = parsedR.bullets.map((b) => ({ b, a: analyzeBullet(b) }));
    const missingTop = missing.filter((m) => m.level !== 'preferred');
    const bullets = analyzed.map(({ a }) => {
      const stems = new Set(words(a.text).map(stem));
      const related = [];
      for (const m of missing) {
        const ctxStems = words(m.context).map(stem).filter((w) => !STOP.has(w) && !FLUFF.has(w));
        const overlap = ctxStems.filter((w) => stems.has(w)).length;
        if (overlap >= 2) related.push(m.term);
      }
      a.related = related.slice(0, 3);
      a.suggestion = a.quality === 'strong' && a.xyz ? null : suggestBullet(a, verbFamily(a.text), a.related);
      return a;
    });
    const n = bullets.length;
    const withMetric = bullets.filter((b) => b.metric).length;
    const withVerb = bullets.filter((b) => b.hasVerb).length;
    const withXyz = bullets.filter((b) => b.xyz).length;
    const lenOk = bullets.filter((b) => b.words >= 8 && b.words <= 35).length;
    const bulletStats = { count: n, withMetric, withVerb, withXyz, lengthOk: lenOk, metricPct: n ? withMetric / n : 0, verbPct: n ? withVerb / n : 0, xyzPct: n ? withXyz / n : 0 };
    const impactScore = n
      ? round(100 * (0.45 * Math.min(1, bulletStats.metricPct / 0.6) + 0.25 * bulletStats.verbPct + 0.15 * Math.min(1, bulletStats.xyzPct / 0.4) + 0.15 * (lenOk / n)))
      : 15;

    /* ---- ATS checks ---- */
    const ats = atsChecks(resume, parsedR, now);

    /* ---- composite ---- */
    const components = [
      { id: 'keywords', label: 'Keyword & skill match', weight: WEIGHTS.keywords, score: kwScore,
        detail: matched.length + partial.length + ' of ' + jdSkills.length + ' job skills found in your resume' + (other.length ? '; ' + other.filter((o) => o.found).length + ' of ' + other.length + ' other recurring phrases' : '') + '.' },
      { id: 'language', label: 'Role language alignment', weight: WEIGHTS.language, score: language.score, detail: language.detail },
      { id: 'title', label: 'Job title alignment', weight: WEIGHTS.title, score: titleRes.score, detail: titleRes.detail },
      { id: 'experience', label: 'Years of experience', weight: WEIGHTS.experience, score: expScore, detail: expDetail },
      { id: 'education', label: 'Education', weight: WEIGHTS.education, score: eduScore, detail: eduDetail },
      { id: 'impact', label: 'Impact & XYZ bullets', weight: WEIGHTS.impact, score: impactScore,
        detail: n ? withMetric + ' of ' + n + ' bullets have a measurable result; ' + withXyz + ' follow the full XYZ pattern.' : 'No bullet points detected in your experience.' },
      { id: 'ats', label: 'ATS readability', weight: WEIGHTS.ats, score: ats.score, detail: ats.checks.filter((c) => c.status !== 'pass').length + ' format issue(s) found.' }
    ];
    const wSum = components.reduce((a, c) => a + c.weight, 0);
    const score = round(components.reduce((a, c) => a + c.score * c.weight, 0) / wSum);

    const result = {
      score, verdict: verdict(score), components,
      jd: { title: parsedJd.title, years: reqYears, degree: jdDeg && jdDeg.label, skillCount: jdSkills.length },
      resume: { years: Math.round(haveYears * 10) / 10, degree: resDeg && resDeg.label, words: resume.split(/\s+/).filter(Boolean).length, sectionsDetected: parsedR.detected, sections: parsedR.sections.map((s) => s.name) },
      keywords: {
        matched: sortKw(matched), partial: sortKw(partial), missing: sortKw(missing), other,
        gaps: missing.map((m) => gapAdvice(m, [].concat(matched, partial)))
      },
      bullets, bulletStats, ats, language,
      _parsed: parsedR, _zone: zone
    };
    result.atsLikelihood = atsLikelihood(result);
    result.plan = buildPlan(result, missingTop);
    result.potentialScore = potential(result);
    return result;
  }

  function mostCommon(arr) {
    const m = {};
    arr.forEach((a) => { const k = a.toLowerCase(); m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).sort((a, b) => m[b] - m[a])[0] || '';
  }

  function sortKw(list) {
    const order = { required: 0, core: 1, preferred: 2 };
    return list.slice().sort((a, b) => order[a.level] - order[b.level] || b.importance - a.importance);
  }

  function verdict(score) {
    if (score >= 80) return { label: 'Strong match', tone: 'good', text: 'Apply now. Polish the items below to maximise your chances.' };
    if (score >= 65) return { label: 'Good match, fixable gaps', tone: 'ok', text: 'You are in range. Closing the top gaps should move you into the shortlist.' };
    if (score >= 50) return { label: 'Stretch', tone: 'warn', text: 'Possible, but an ATS or recruiter may filter you out as-is. Tailor heavily and be honest about the gaps.' };
    return { label: 'Weak match', tone: 'bad', text: 'Large gaps versus this posting. Consider a closer-fit role, or build the missing skills first.' };
  }

  function atsLikelihood(r) {
    const req = r.keywords.missing.filter((m) => m.level === 'required').length;
    const reqTotal = [].concat(r.keywords.matched, r.keywords.partial, r.keywords.missing).filter((m) => m.level === 'required').length;
    const reqCov = reqTotal ? 1 - req / reqTotal : 1;
    const blockers = r.ats.checks.filter((c) => c.status === 'fail').length;
    if (blockers === 0 && reqCov >= 0.8 && r.score >= 70) return { label: 'High', tone: 'good' };
    if (blockers <= 1 && reqCov >= 0.55 && r.score >= 50) return { label: 'Medium', tone: 'warn' };
    return { label: 'Low', tone: 'bad' };
  }

  /* ------------------------------------------------------------------ */
  /* Other recurring terms + language alignment                         */
  /* ------------------------------------------------------------------ */

  function maskSkills(text) {
    let t = text.toLowerCase();
    for (const sk of SKILLS) { sk.re.lastIndex = 0; t = t.replace(sk.re, ' '); }
    return t;
  }

  function extractOtherTerms(parsedJd, jdSkills, resume) {
    const uni = new Map(), bi = new Map();
    const rWords = words(resume).map(stem);
    const rSet = new Set(rWords);
    const rBigrams = new Set();
    for (let i = 0; i < rWords.length - 1; i++) rBigrams.add(rWords[i] + ' ' + rWords[i + 1]);
    const bump = (map, key, surface, w) => {
      const e = map.get(key) || { count: 0, weight: 0, surface };
      e.count++; e.weight = Math.max(e.weight, w); map.set(key, e);
    };
    for (const ln of parsedJd.lines) {
      const w = JD_SECTION_WEIGHT[ln.section];
      const toks = words(maskSkills(ln.text));
      for (let i = 0; i < toks.length; i++) {
        const a = toks[i];
        const aOk = !STOP.has(a) && !FLUFF.has(a) && a.length > 2 && !/^\d/.test(a);
        if (aOk) bump(uni, stem(a), a, w);
        const b = toks[i + 1];
        if (aOk && b && !STOP.has(b) && !FLUFF.has(b) && b.length > 2 && !/^\d/.test(b)) bump(bi, stem(a) + ' ' + stem(b), a + ' ' + b, w);
      }
    }
    const out = [];
    for (const [k, e] of bi) if (e.count >= 2) out.push({ term: e.surface, count: e.count, importance: e.weight + 0.3 * Math.min(e.count - 1, 3), found: rBigrams.has(k), kind: 'phrase', _k: k });
    const covered = new Set();
    out.forEach((o) => o._k.split(' ').forEach((w) => covered.add(w)));
    for (const [k, e] of uni) if (e.count >= 3 && !covered.has(k)) out.push({ term: e.surface, count: e.count, importance: e.weight * 0.8 + 0.3 * Math.min(e.count - 1, 3), found: rSet.has(k), kind: 'word', _k: k });
    out.sort((a, b) => b.importance - a.importance || b.count - a.count);
    return out.slice(0, 20).map((o) => { delete o._k; return o; });
  }

  function languageAlignment(parsedJd, resume) {
    const rSet = new Set(words(resume).map(stem));
    const weight = new Map();
    for (const ln of parsedJd.lines) {
      const w = JD_SECTION_WEIGHT[ln.section];
      for (const t of words(ln.text)) {
        if (STOP.has(t) || FLUFF.has(t) || t.length < 3 || /^\d/.test(t)) continue;
        const s = stem(t);
        weight.set(s, (weight.get(s) || 0) + w);
      }
    }
    let total = 0, got = 0;
    const missingWords = [];
    for (const [s, w] of weight) {
      const v = 1 + Math.log(w + 1);
      total += v;
      if (rSet.has(s)) got += v; else missingWords.push([s, v]);
    }
    if (!total) return { score: 50, coverage: 0, detail: 'Not enough job description text to compare language.', missingWords: [] };
    const cov = got / total;
    const score = round(clamp((cov - 0.05) / (0.5 - 0.05), 0, 1) * 100);
    missingWords.sort((a, b) => b[1] - a[1]);
    return { score, coverage: cov, detail: Math.round(cov * 100) + '% of the job description\'s meaningful vocabulary appears in your resume.', missingWords: missingWords.slice(0, 15).map((m) => m[0]) };
  }

  /* ------------------------------------------------------------------ */
  /* Title alignment                                                    */
  /* ------------------------------------------------------------------ */

  function titleTokens(t) {
    const toks = words(t).filter((w) => !TITLE_NOISE.has(w));
    const level = toks.map((w) => SENIORITY[w]).filter((x) => x !== undefined);
    const core = toks.filter((w) => SENIORITY[w] === undefined).map((w) => stem(TITLE_SYN[w] || w));
    return { core: uniq(core), level: level.length ? Math.max.apply(null, level) : null };
  }

  function titleAlignment(title, parsedR, resume) {
    if (!title) return { score: 70, detail: 'Could not detect a job title in the description. Paste the title in the Job title field for a precise check.' };
    const jt = titleTokens(title);
    if (!jt.core.length) return { score: 70, detail: 'Job title "' + title + '" has no comparable words.' };
    const cands = [];
    parsedR.roles.forEach((r) => r.headerLines.forEach((h) => cands.push(h)));
    resume.split('\n').filter((l) => l.trim()).slice(0, 6).forEach((l) => cands.push(l));
    const summary = parsedR.sections.find((s) => s.name === 'summary');
    if (summary && summary.lines.join(' ').trim()) cands.push(summary.lines.join(' ').split(/[.!?]/)[0]);
    let best = 0, bestLine = '', topLevel = 0;
    for (const c of cands) {
      const ct = titleTokens(c);
      if (ct.level !== null) topLevel = Math.max(topLevel, ct.level);
      const cs = new Set(ct.core);
      const cov = jt.core.filter((t) => cs.has(t)).length / jt.core.length;
      if (cov > best) { best = cov; bestLine = c.trim(); }
    }
    let score = round(best * 100);
    let detail = best >= 0.99 ? 'Your resume contains the target title words ("' + bestLine.slice(0, 70) + '").' :
      best > 0 ? 'Partial overlap with "' + title + '" (closest: "' + bestLine.slice(0, 70) + '").' : 'None of the words in "' + title + '" appear in your titles or headline.';
    if (jt.level !== null && jt.level > topLevel) {
      const gap = jt.level - topLevel;
      if (gap >= 1 && best > 0) { score = round(score * (gap >= 2 ? 0.6 : 0.8)); detail += ' The role is more senior than the titles you list.'; }
    }
    return { score: clamp(score, 0, 100), detail, target: title, closest: bestLine };
  }

  /* ------------------------------------------------------------------ */
  /* ATS checks                                                         */
  /* ------------------------------------------------------------------ */

  function atsChecks(resume, parsed, now) {
    const checks = [];
    const add = (id, label, status, detail, penalty) => checks.push({ id, label, status, detail, penalty: status === 'pass' ? 0 : penalty });
    const wc = resume.split(/\s+/).filter(Boolean).length;
    add('email', 'Email address', /[\w.+-]+@[\w-]+\.[\w.-]+/.test(resume) ? 'pass' : 'fail', 'ATS and recruiters need an email to contact you.', 15);
    add('phone', 'Phone number', /(\+?\d[\d\s().-]{8,}\d)/.test(resume) ? 'pass' : 'warn', 'Include a phone number in a plain format, e.g. +1 555 123 4567.', 6);
    add('linkedin', 'LinkedIn / portfolio link', /(linkedin\.com|github\.com|portfolio|behance|dribbble|\.dev\b|\.io\b)/i.test(resume) ? 'pass' : 'warn', 'Add a LinkedIn (or GitHub/portfolio) URL. Many recruiters verify there.', 2);
    const names = parsed.sections.map((s) => s.name);
    add('exp-heading', 'Standard "Experience" heading', names.includes('experience') && !parsed.sections.find((s) => s.name === 'experience').implicit ? 'pass' : 'fail', 'ATS maps content by headings. Use "Work Experience" or "Professional Experience".', 15);
    add('edu-heading', 'Standard "Education" heading', names.includes('education') ? 'pass' : 'warn', 'Add an "Education" section (even a certificate or in-progress degree).', 6);
    add('skills-heading', 'Dedicated "Skills" section', names.includes('skills') ? 'pass' : 'warn', 'A plain-text "Skills" section is the first place ATS looks for keywords.', 8);
    const dated = parsed.ranges.length;
    add('dates', 'Dated roles', dated >= 1 ? 'pass' : 'fail', 'Use "Mon YYYY – Mon YYYY" for every role so ATS can compute tenure.', 10);
    const cols = resume.split('\n').filter((l) => /\t{1}|\s{6,}\S/.test(l) && l.trim().length > 12).length;
    add('columns', 'Single-column layout', cols <= 3 ? 'pass' : 'fail', cols + ' lines look like multi-column / table layout (large gaps or tabs). Columns, tables and text boxes often scramble in ATS parsing.', 15);
    const odd = (resume.match(/[☑✔✓★☆➢➤❖◆◇▶►☎✉✆]/g) || []).length;
    add('glyphs', 'Standard bullet characters', odd === 0 ? 'pass' : 'warn', odd + ' decorative symbols/icons found. Use plain "•" or "-" bullets; icons can break parsing.', 5);
    const fp = (resume.match(/\b(I|my|me)\b/g) || []).length;
    add('pronouns', 'No first-person pronouns', fp <= 1 ? 'pass' : 'warn', 'Found "I/my/me" ' + fp + ' times. Resumes are written without pronouns.', 4);
    add('length', 'Length (' + wc + ' words)', wc >= 280 && wc <= 1000 ? 'pass' : 'warn', wc < 280 ? 'Looks thin; add detail on achievements (aim for 1 page early-career, 2 pages max for most).' : 'Over 1,000 words; trim to the most relevant 1-2 pages.', wc < 280 ? 8 : 6);
    const paras = parsed.bullets.filter((b) => b.kind === 'paragraph').length;
    add('bullets', 'Achievements written as bullets', paras <= 1 && parsed.bullets.length >= 3 ? 'pass' : 'warn', parsed.bullets.length < 3 ? 'Few bullet points detected. Use one bullet per achievement.' : paras + ' experience entries are written as paragraphs; use bullets.', 5);
    const longBullets = parsed.bullets.filter((b) => b.text.split(/\s+/).length > 40).length;
    if (longBullets) add('long-bullets', 'Bullet length', 'warn', longBullets + ' bullets exceed 40 words. Keep each to 1-2 lines.', 3);
    const url = (resume.match(/https?:\/\/\S+/g) || []).length;
    if (url > 6) add('links', 'Number of links', 'warn', url + ' links is a lot; keep to LinkedIn, GitHub/portfolio and 1-2 key projects.', 2);
    let score = 100;
    checks.forEach((c) => { score -= c.penalty; });
    return { score: clamp(score, 0, 100), checks };
  }

  /* ------------------------------------------------------------------ */
  /* Gap advice                                                         */
  /* ------------------------------------------------------------------ */

  function gapAdvice(m, have) {
    const sk = SKILL_BY_NAME.get(m.term.toLowerCase());
    let bridge = null;
    for (const group of Skills.RELATED) {
      if (!group.some((g) => g.toLowerCase() === m.term.toLowerCase())) continue;
      const own = have.find((h) => group.some((g) => g.toLowerCase() === h.term.toLowerCase()) && h.term.toLowerCase() !== m.term.toLowerCase());
      if (own) { bridge = own.term; break; }
    }
    const advice = Skills.GAP_ADVICE[sk ? sk.category : 'tech'];
    return {
      term: m.term, level: m.level, category: sk ? sk.category : 'tech', bridge,
      how: bridge ? 'You already show ' + bridge + ', which is closely related. If it is genuinely transferable, say so explicitly (for example "' + bridge + ' (transferable to ' + m.term + ')") and add a bullet showing the overlapping concepts. Then ' + advice.charAt(0).toLowerCase() + advice.slice(1) : advice
    };
  }

  /* ------------------------------------------------------------------ */
  /* Action plan                                                        */
  /* ------------------------------------------------------------------ */

  function listTerms(arr, n) { return arr.slice(0, n).map((x) => x.term).join(', ') + (arr.length > n ? ' +' + (arr.length - n) + ' more' : ''); }

  function buildPlan(r, missingTop) {
    const plan = [];
    const W = WEIGHTS;
    const comp = (id) => r.components.find((c) => c.id === id);

    // 1. Missing must-have keywords
    if (missingTop.length) {
      const req = missingTop.filter((m) => m.level === 'required');
      const group = req.length ? req : missingTop;
      const totalImp = [].concat(r.keywords.matched, r.keywords.partial, r.keywords.missing).reduce((a, k) => a + k.importance, 0) || 1;
      const imp = group.reduce((a, k) => a + k.importance, 0);
      plan.push({
        id: 'missing-keywords', priority: 'critical', impact: round((imp / totalImp) * W.keywords * 0.8), effort: 'Medium',
        title: 'Cover the ' + (req.length ? 'must-have' : 'core') + ' skills your resume is missing',
        why: listTerms(group, 8) + ' appear in the job description but not in your resume. ATS filters and recruiters search for these exact terms.',
        how: ['If you genuinely have a skill, add it to Skills AND prove it in a bullet (a skill with no evidence is weighted lower).',
          'Use the job posting\'s exact wording (e.g. write "' + (group[0].jdForm || group[0].term) + '", not a synonym).',
          'For skills you do not have, see the "Gaps" tab for an honest way to close or bridge each one.']
      });
    }
    // 2. Skills-only keywords
    if (r.keywords.partial.length) {
      plan.push({
        id: 'prove-skills', priority: 'high', impact: round(r.keywords.partial.reduce((a, k) => a + k.importance * 0.3, 0) / ([].concat(r.keywords.matched, r.keywords.partial, r.keywords.missing).reduce((a, k) => a + k.importance, 0) || 1) * W.keywords),
        effort: 'Low',
        title: 'Move skills out of the Skills list and into proof',
        why: listTerms(r.keywords.partial, 8) + ' only appear in your Skills section. Recruiters and ATS rank terms higher when they are used in experience bullets.',
        how: ['Work each term into the bullet where you actually used it, along with the result it produced.']
      });
    }
    // 3. Quantify bullets
    const weak = r.bullets.filter((b) => !b.metric || !b.hasVerb || !b.method);
    if (r.bulletStats.count && (r.bulletStats.metricPct < 0.6 || weak.length)) {
      plan.push({
        id: 'xyz', priority: r.bulletStats.metricPct < 0.3 ? 'critical' : 'high', impact: round(Math.max(0, 90 - comp('impact').score) * W.impact / 100),
        effort: 'Medium',
        title: 'Rewrite bullets with the XYZ formula',
        why: r.bulletStats.withMetric + ' of ' + r.bulletStats.count + ' bullets contain a measurable result. Google\'s XYZ formula: "Accomplished [X] as measured by [Y], by doing [Z]". Aim for a number in at least 60% of bullets.',
        how: ['Open the "Bullets" tab. Every weak bullet has a fill-in-the-blank rewrite.',
          'No exact figures? Estimate honestly and defensibly ("~30%", "a team of 5", "10+ clients", "weekly report to 12 stakeholders").',
          'Lead with a strong verb (Led, Built, Reduced…), end with the outcome.']
      });
    } else if (!r.bulletStats.count) {
      plan.push({ id: 'bullets-none', priority: 'critical', impact: round(W.impact * 0.7), effort: 'Medium', title: 'Add achievement bullets under each role',
        why: 'No bullet points were detected, so there is nothing for ATS or a recruiter to score impact on.',
        how: ['Under each role add 3-6 bullets in the XYZ format.'] });
    }
    // 4. Title
    const t = comp('title');
    if (t.score < 75 && r.jd.title) {
      plan.push({
        id: 'title', priority: t.score < 40 ? 'high' : 'medium', impact: round((90 - t.score) * W.title / 100), effort: 'Low',
        title: 'Mirror the target job title in your headline',
        why: t.detail,
        how: ['Add a headline under your name such as "' + titleCase(r.jd.title) + '" or "' + titleCase(r.jd.title) + ' | <your top 3 matching skills>", but only if it honestly describes your direction.',
          'If your past titles differ (internal titles often do), write the standard title with the actual one in brackets: "Software Engineer (Platform Developer II)".']
      });
    }
    // 5. Language
    if (r.language.score < 65 && r.language.missingWords.length) {
      plan.push({
        id: 'language', priority: 'medium', impact: round((80 - r.language.score) * W.language / 100 * 0.6), effort: 'Medium',
        title: 'Echo the language of the role',
        why: r.language.detail + ' Words the posting stresses that you never use: ' + r.language.missingWords.slice(0, 10).join(', ') + '.',
        how: ['Where truthful, adopt the posting\'s vocabulary in your summary and bullets (verbs and nouns, not buzzwords).',
          'Mirror their order of priorities: the first things in the posting should be the first things recruiters see.']
      });
    }
    // 6. Experience years
    const ex = comp('experience');
    if (ex.score < 90) {
      plan.push({
        id: 'years', priority: ex.score < 60 ? 'high' : 'medium', impact: round((100 - ex.score) * W.experience / 100 * 0.4), effort: 'High',
        title: 'Address the experience-length gap',
        why: ex.detail,
        how: ['Include every relevant stint: internships, freelance, contract, volunteer and substantial projects, each with dates.',
          'Lead your summary with depth ("5 years building X") rather than total tenure if relevant years are fewer.',
          'Postings are wish-lists: if you are within roughly 20-30% of the requirement and strong on skills, still apply, and cover the gap in your summary and a short cover note.']
      });
    }
    // 7. Education
    const ed = comp('education');
    if (ed.score < 85) {
      plan.push({ id: 'education', priority: 'medium', impact: round((100 - ed.score) * W.education / 100 * 0.5), effort: 'High', title: 'Handle the education requirement',
        why: ed.detail,
        how: ['List your degree/certificate exactly as ATS expects ("B.Sc. Computer Science, University, 2019").',
          'No degree? Add relevant certifications and write "equivalent experience" evidence in your summary.'] });
    }
    // 8. ATS format
    const fails = r.ats.checks.filter((c) => c.status !== 'pass');
    if (fails.length) {
      const sev = fails.some((c) => c.status === 'fail') ? 'critical' : 'medium';
      plan.push({
        id: 'ats', priority: sev, impact: round((100 - r.ats.score) * W.ats / 100), effort: 'Low',
        title: 'Fix ATS formatting issues',
        why: fails.length + ' issue(s) could stop your resume from being parsed correctly.',
        how: fails.sort((a, b) => b.penalty - a.penalty).map((c) => c.label + ': ' + c.detail)
      });
    }
    // 9. Finish
    plan.push({
      id: 'finish', priority: 'low', impact: 0, effort: 'Low',
      title: 'Before you submit',
      why: 'Small details that decide close calls.',
      how: ['Use the "Tailored resume" tab as your starting draft, fill every [ADD ...] placeholder, then re-run the analysis until you are happy.',
        'Submit as a text-based PDF or .docx (not an image), named "Firstname-Lastname-' + (r.jd.title ? r.jd.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'Role') + '".',
        'Find a referral or the hiring manager on LinkedIn: a referral usually beats any resume tweak.']
    });
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    plan.sort((a, b) => rank[a.priority] - rank[b.priority] || b.impact - a.impact);
    return plan;
  }

  function potential(r) {
    // Score if the fixable items were addressed honestly (keywords you actually have, bullets, ATS, headline).
    const get = (id) => r.components.find((c) => c.id === id).score;
    const kwMiss = r.keywords.missing.filter((m) => m.level !== 'preferred');
    const imp = (arr) => arr.reduce((a, k) => a + k.importance, 0);
    const total = imp([].concat(r.keywords.matched, r.keywords.partial, r.keywords.missing)) || 1;
    const kwPot = clamp(get('keywords') + 100 * (imp(r.keywords.partial) * 0.3 + imp(kwMiss) * 0.6) / total, 0, 96);
    const parts = {
      keywords: Math.max(get('keywords'), kwPot), language: Math.max(get('language'), Math.min(88, get('language') + 20)),
      title: Math.max(get('title'), 85), experience: get('experience'), education: get('education'),
      impact: Math.max(get('impact'), 88), ats: Math.max(get('ats'), 96)
    };
    const wSum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    const pot = Object.keys(WEIGHTS).reduce((a, k) => a + parts[k] * WEIGHTS[k], 0) / wSum;
    return Math.max(r.score, Math.min(96, round(pot)));
  }

  /* ------------------------------------------------------------------ */
  /* Tailored resume (deterministic draft)                              */
  /* ------------------------------------------------------------------ */

  const AMBIGUOUS_REPLACE = new Set(['go', 'r', 'c', 'node', 'rest', 'rails', 'express', 'spring', 'lambda', 'strategy', 'audit', 'tax', 'networking', 'ml', 'ts', 'js', 'ux', 'ui', 'iam', 'qa']);

  function normalizeToJdWording(text, r) {
    // Swap synonyms to the job posting's exact wording (ATS often matches literally).
    const targets = [].concat(r.keywords.matched, r.keywords.partial);
    let out = text;
    for (const k of targets) {
      const sk = SKILL_BY_NAME.get(k.term.toLowerCase());
      if (!sk || !k.jdForm) continue;
      const jdForm = k.jdForm.toLowerCase();
      for (const form of sk.forms) {
        if (form === jdForm || form.length < 3 || AMBIGUOUS_REPLACE.has(form)) continue;
        const re = new RegExp(formRegex(form), 'gi');
        out = out.replace(re, (m) => {
          if (m.toLowerCase().replace(/[\s-]+/g, '') === jdForm.replace(/[\s-]+/g, '')) return m;
          return matchCase(k.jdForm, m);
        });
      }
    }
    return out;
  }

  function matchCase(target, sample) {
    if (sample === sample.toUpperCase() && sample.length > 1) return target.toUpperCase();
    // keep canonical casing of known skills for display
    const sk = SKILL_BY_NAME.get(target.toLowerCase());
    if (sk) return sk.name;
    const byForm = SKILLS.find((s) => s.forms.includes(target.toLowerCase()));
    if (byForm) return byForm.name;
    return target;
  }

  function relevance(text, r) {
    const bulletStems = new Set(words(text).map(stem));
    let score = 0;
    for (const m of [].concat(r.keywords.matched, r.keywords.partial)) {
      const sk = SKILL_BY_NAME.get(m.term.toLowerCase());
      if (sk && countSkill(sk, text)) score += m.importance;
    }
    for (const o of r.keywords.other) if (o.found && o.term.split(' ').every((w) => bulletStems.has(stem(w)))) score += o.importance * 0.5;
    return score;
  }

  function tailor(r, opts) {
    opts = opts || {};
    const parsed = r._parsed;
    const out = [];
    const top = r.keywords.matched.concat(r.keywords.partial).filter((m) => m.category !== 'soft').slice(0, 5);
    const topTerms = top.map((m) => m.jdForm ? matchCase(m.jdForm, m.jdForm) : m.term);
    const titleStr = r.jd.title ? titleCase(r.jd.title) : '';
    const yrs = Math.floor(r.resume.years);

    // header
    const header = parsed.sections[0].lines.filter((l) => l.trim());
    if (header.length) {
      out.push(header.slice(0, 4).join('\n'));
      if (titleStr) out.push('\n' + titleStr);
    }
    // summary
    out.push('\nPROFESSIONAL SUMMARY');
    const lead = (titleStr ? titleStr : 'Professional') + (yrs >= 1 ? ' with ' + yrs + '+ years of experience' : ' ready to contribute') + (topTerms.length ? ' in ' + topTerms.slice(0, 4).join(', ') + (topTerms.length > 4 ? ' and ' + topTerms[4] : '') : '') + '.';
    out.push(lead + ' [ADD YOUR STRONGEST QUANTIFIED WIN, e.g. "Cut X by 30% by doing Y" that matches this role].');

    // skills
    const have = r.keywords.matched.concat(r.keywords.partial);
    const byCat = {};
    have.forEach((h) => { (byCat[h.category] = byCat[h.category] || []).push(h); });
    const catLabel = { tech: 'Technical', tool: 'Tools', domain: 'Domain', soft: 'Professional', cert: 'Certifications' };
    out.push('\nSKILLS');
    for (const c of ['tech', 'tool', 'domain', 'cert', 'soft']) {
      if (!byCat[c]) continue;
      byCat[c].sort((a, b) => b.importance - a.importance);
      out.push(catLabel[c] + ': ' + byCat[c].map((x) => (x.jdForm ? matchCase(x.jdForm, x.jdForm) : x.term)).join(', '));
    }
    const origOnly = [];
    const alreadyListed = new Set(have.map((h) => h.term.toLowerCase()));
    for (const s of SKILLS) {
      if (alreadyListed.has(s.name.toLowerCase())) continue;
      if (countSkill(s, r._zone.skills + '\n' + r._zone.experience + '\n' + r._zone.summary)) origOnly.push(s.name);
    }
    if (origOnly.length) out.push('Also: ' + origOnly.join(', '));

    // sections
    for (const sec of parsed.sections) {
      if (sec.name === 'header' || sec.name === 'summary' || sec.name === 'skills') continue;
      const body = sec.lines.join('\n').trim();
      if (!body) continue;
      out.push('\n' + (sec.heading ? sec.heading.toUpperCase() : sec.name.toUpperCase()));
      if (sec.name === 'experience' || sec.name === 'projects') out.push(renderExperience(sec, r));
      else out.push(normalizeToJdWording(body, r));
    }

    const missing = r.keywords.missing.filter((m) => m.level !== 'preferred');
    const notes = [];
    if (missing.length) {
      notes.push('--- ONLY IF TRUE (do not copy blindly): the job asks for ' + missing.slice(0, 10).map((m) => m.term).join(', ') + '. Add them to Skills and to a proving bullet if you have genuinely used them.');
    }
    return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), notes, placeholders: (out.join('\n').match(/\[ADD[^\]]*\]/g) || []).length };
  }

  function renderExperience(sec, r) {
    // Preserve the author's role structure; reorder bullets inside each role by relevance to this job.
    const parsedRoles = r._parsed.roles.filter((ro) => ro.section === sec.name);
    const rendered = [];
    const analysisByText = new Map(r.bullets.map((b) => [b.text, b]));
    const lines = sec.lines;
    const nonBullet = [];
    let i = 0;
    const result = [];
    // Walk original lines; whenever a run of bullets appears, replace the run with its reordered version.
    while (i < lines.length) {
      const raw = lines[i];
      if (BULLET_RE.test(raw)) {
        const run = [];
        while (i < lines.length && (BULLET_RE.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && run.length))) {
          if (BULLET_RE.test(lines[i])) run.push(lines[i].replace(BULLET_RE, '').trim());
          else run[run.length - 1] += ' ' + lines[i].trim();
          i++;
        }
        const scored = run.map((t, idx) => ({ t, idx, s: relevance(t, r) }));
        scored.sort((a, b) => b.s - a.s || a.idx - b.idx);
        scored.forEach((x) => {
          const a = analysisByText.get(x.t.replace(/\s+/g, ' ').trim());
          let text = normalizeToJdWording(x.t, r);
          if (a && !a.metric) text = text.replace(/[.;]+$/, '') + ' [ADD METRIC: ' + a.suggestion.metricHint + ']';
          result.push('• ' + text);
        });
      } else { result.push(normalizeToJdWording(raw, r)); i++; }
    }
    return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ------------------------------------------------------------------ */

  return { analyze, tailor, WEIGHTS, _internals: { parseResume, parseJd, analyzeBullet, hasMetric, stem, jdYears, parseRange, unionMonths, normalizeText, SKILLS } };
});
