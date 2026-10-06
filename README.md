# Job Matcher

Upload a job description and your resume. Job Matcher tells you **how well you fit**, **exactly what is missing**, and **what to change to get the interview**, using the same signals ATS software and recruiters screen on.

- Runs entirely in your browser. Your resume is never uploaded anywhere (the optional AI button is the only exception, and it asks first).
- Zero dependencies. Needs only Node 18+.
- Day / night theme (glass-and-glow violet UI), switchable with the sun/moon toggle; follows your system setting by default and remembers your choice.

## Run it

```bash
cd "job matcher"
npm start            # http://localhost:3000
npm test             # engine tests
```

Optional AI rewrite (resume, XYZ bullet and cover letter rewrite), off by default:

```bash
ANTHROPIC_API_KEY=sk-... npm start     # model defaults to claude-sonnet-5-5; override with JOBMATCHER_MODEL
```

## What you get

| Tab | What it does |
|---|---|
| **Match score** | 0-100 score with a 7-part breakdown, a verdict, an ATS pass likelihood, and a "potential score" after honest fixes. |
| **Action plan** | Prioritised to-do list (critical → low) with estimated point gain and effort for each item. |
| **Keywords** | Required / core / preferred job skills split into matched, *skills-list only* (weaker), and missing. Also finds repeated phrases outside the skills taxonomy. |
| **Gaps** | For every missing skill, an honest way to close it, or to bridge it from a related skill you already have (e.g. Azure → AWS). |
| **Bullets (XYZ)** | Scores every bullet on action verb, measurable result, and method (Google's XYZ formula: *Accomplished [X] as measured by [Y], by doing [Z]*), with a fill-in-the-blank rewrite for each weak one. |
| **ATS check** | Contact info, standard headings, dates, columns/tables, odd glyphs, pronouns, length, bullets. |
| **Tailored resume** | A draft built only from your own content: summary rebuilt around the role, skills re-worded to the posting's exact terms, bullets ordered by relevance, `[ADD METRIC]` placeholders where numbers are missing. Edit, then **Re-score** in one click. Export as .txt / .doc / print to PDF. |
| **Cover letter** | Generates a letter from your real quantified wins and matched skills. Gaps are bridged from related experience or left as `[ONLY IF TRUE]` lines, never claimed. Optional AI rewrite. |
| **My jobs** | Save each posting with its score and an application status (Saved → Applied → Interviewing → Offer / Rejected). Stored in your browser. |

## How the score works

| Component | Weight | Based on |
|---|---|---|
| Keyword & skill match | 40 | ~330-skill taxonomy with aliases (JS = JavaScript, K8s = Kubernetes…), weighted by where the posting mentions it (requirements > responsibilities > nice-to-have), title mentions and frequency. Skills proven in experience bullets get full credit; skills only in a skills list get 70%. |
| Role language alignment | 15 | Coverage of the posting's meaningful vocabulary in your resume |
| Job title alignment | 10 | Target title vs. your titles/headline, with a seniority check |
| Years of experience | 10 | "5+ years" in the posting vs. dated roles in your resume (overlaps merged) |
| Education | 5 | Degree level required vs. found; "or equivalent experience" respected |
| Impact & XYZ bullets | 10 | Share of bullets with a strong verb, a metric, and a method |
| ATS readability | 10 | Format checks above |

The score is an estimate of how screening software and recruiters will react, not a guarantee. Real ATS products differ.

## Honesty by design

The tailoring never adds skills you do not have. Missing skills are listed separately as "only if true". Metrics are placeholders for *you* to fill, never invented. The optional AI step is instructed the same way.

## Project layout

```
server.js               static server + optional /api/ai (Anthropic)
public/index.html       UI
public/app.js           UI logic, file import (PDF/DOCX via CDN), saved jobs
public/engine/          pure analysis code (also runs in Node)
  skills.js             skill taxonomy, related-skill groups, gap advice
  engine.js             parsing, scoring, XYZ analysis, ATS checks, plan, tailoring
  samples.js            fictional sample data
test/engine.test.js     node:test suite
```

PDF/DOCX import loads `pdf.js` and `mammoth` from cdnjs the first time you upload one. Pasting text works fully offline.

## Ideas for later

Per-skill years ("3+ years of Kubernetes"), multi-resume versions, browser extension to grab a posting from a job site, and a larger skills taxonomy per industry (edit `public/engine/skills.js`).
