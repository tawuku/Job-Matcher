const test = require('node:test');
const assert = require('node:assert/strict');
const JM = require('../public/engine/engine.js');
const { resume, jd } = require('../public/engine/samples.js');

const NOW = '2026-01-15';
const run = (r = resume, j = jd, o = {}) => JM.analyze(r, j, Object.assign({ now: NOW }, o));

test('detects the job title, years and degree from the JD', () => {
  const r = run();
  assert.equal(r.jd.title, 'Senior Full-Stack Engineer');
  assert.equal(r.jd.years.years, 5);
  assert.equal(r.jd.degree, "Bachelor's");
});

test('computes resume tenure from date ranges without double counting', () => {
  const r = run();
  // Jun 2018 – Feb 2020 (21 mo) + Mar 2020 – Jan 2026 (71 mo) = 92 mo ≈ 7.7y
  assert.ok(r.resume.years > 7.4 && r.resume.years < 8, 'years=' + r.resume.years);
  const overlap = 'EXPERIENCE\nDev, A\nJan 2020 – Dec 2022\n• Built x\nDev, B\nJan 2021 – Dec 2022\n• Built y\n';
  const p = JM._internals.parseResume(overlap, new Date(NOW));
  assert.equal(Math.round(p.years), 3);
});

test('matches aliases (JS->JavaScript, Postgres->PostgreSQL, Node->Node.js)', () => {
  const r = run();
  const matched = r.keywords.matched.concat(r.keywords.partial).map((k) => k.term);
  assert.ok(matched.includes('JavaScript') || r.keywords.missing.every((m) => m.term !== 'JavaScript'));
  assert.ok(matched.includes('PostgreSQL'));
  assert.ok(matched.includes('Node.js'));
  assert.ok(matched.includes('React'));
});

test('flags genuinely missing required skills and classifies levels', () => {
  const r = run();
  const miss = Object.fromEntries(r.keywords.missing.map((m) => [m.term, m]));
  assert.ok(miss['TypeScript'], 'TypeScript should be missing');
  assert.equal(miss['TypeScript'].level, 'required');
  assert.ok(miss['AWS'] && miss['Kubernetes']);
  assert.equal(miss['GraphQL'].level, 'preferred');
});

test('skills-only keywords get partial credit (skills list vs proven in bullets)', () => {
  const r = run();
  const partial = r.keywords.partial.map((k) => k.term);
  assert.ok(partial.includes('PostgreSQL'), 'Postgres only in Skills list');
  assert.ok(r.keywords.matched.some((k) => k.term === 'React' && k.where === 'experience'));
});

test('bullet analysis: XYZ, metrics, weak starts', () => {
  const a = JM._internals.analyzeBullet;
  const good = a({ text: 'Cut report generation time from 40s to 6s by rewriting the query layer using Redis caching', kind: 'bullet' });
  assert.ok(good.hasVerb && good.metric && good.method && good.xyz);
  const weak = a({ text: 'Responsible for building new features for the customer dashboard', kind: 'bullet' });
  assert.ok(weak.weakStart && !weak.metric && !weak.xyz);
  assert.ok(!JM._internals.hasMetric('Joined in 2019 and worked in 2021'), 'bare years are not metrics');
  assert.ok(JM._internals.hasMetric('Grew revenue 25%'));
});

test('score is in range, ordered sensibly, and potential >= score', () => {
  const r = run();
  assert.ok(r.score > 25 && r.score < 75, 'score=' + r.score);
  assert.ok(r.potentialScore >= r.score);
  assert.equal(r.components.length, 7);
  const strong = run(resume + '\nTypeScript AWS Kubernetes GraphQL REST APIs CI/CD Terraform', jd);
  assert.ok(strong.score > r.score);
});

test('an unrelated resume scores lower than a matching one', () => {
  const chef = `Pat Lee\npat@example.com\n\nEXPERIENCE\nHead Chef, Bistro\nJan 2015 – Present\n• Managed a kitchen team of 12 and reduced food waste by 18%\n• Created seasonal menus\n\nEDUCATION\nCulinary Diploma, 2014\n`;
  assert.ok(run(chef).score < run().score);
});

test('ATS checks catch missing email and column-like layouts', () => {
  const bad = 'Name\n\nExperience\nDev      Acme      2020\n\t\tSkills      Python\n';
  const r = run(bad);
  const ids = r.ats.checks.filter((c) => c.status !== 'pass').map((c) => c.id);
  assert.ok(ids.includes('email'));
  assert.ok(r.ats.score < 80);
});

test('action plan is prioritised and includes keyword + XYZ items', () => {
  const r = run();
  const ids = r.plan.map((p) => p.id);
  assert.ok(ids.includes('missing-keywords') && ids.includes('xyz'));
  assert.equal(r.plan[r.plan.length - 1].id, 'finish');
  assert.equal(r.plan[0].priority, 'critical');
});

test('tailor() keeps content, flags metrics, and never invents missing skills', () => {
  const r = run();
  const t = JM.tailor(r);
  assert.ok(/PROFESSIONAL SUMMARY/.test(t.text));
  assert.ok(/\[ADD METRIC/.test(t.text));
  assert.ok(!/Kubernetes/.test(t.text.split('--- ONLY')[0]), 'must not add skills the candidate lacks');
  assert.ok(/JavaScript/.test(t.text) || /JS/.test(t.text));
  assert.ok(t.notes.length === 1 && /Kubernetes|TypeScript|AWS/.test(t.notes[0]));
});

test('handles empty / tiny input without throwing', () => {
  assert.doesNotThrow(() => JM.analyze('', '', { now: NOW }));
  assert.doesNotThrow(() => JM.analyze('hello', 'world', { now: NOW }));
  assert.doesNotThrow(() => JM.tailor(JM.analyze('hello', 'We need a python developer. Python required.', { now: NOW })));
});

test('coverLetter uses real achievements, never claims missing skills, marks placeholders', () => {
  const r = run();
  const c = JM.coverLetter(r, { company: 'Example Co', hiringManager: 'Sam Lee' });
  assert.ok(/^Dear Sam Lee,/.test(c.text));
  assert.ok(/Senior Full-Stack Engineer role at Example Co/.test(c.text));
  assert.ok(/cut report generation time from 40s to 6s/i.test(c.text), 'quotes a real metric bullet');
  assert.ok(/Alex Morgan$/.test(c.text.trim()));
  assert.ok(/\[ONLY IF TRUE/.test(c.text) && c.placeholders >= 2);
  assert.ok(!/I (have|am) (experienced|proficient)[^.]*(Kubernetes|TypeScript)/i.test(c.text));
  assert.doesNotThrow(() => JM.coverLetter(JM.analyze('hi', 'python dev', { now: NOW })));
});
