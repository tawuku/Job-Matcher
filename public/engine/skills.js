/*
 * Skills taxonomy: canonical skill -> aliases, grouped by category.
 * Format per line:  "Canonical: alias, alias"
 * A leading "!" means the canonical word is too ambiguous to match on its own
 * (e.g. "Go", "R"), so only the listed aliases are matched.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JobMatcherSkills = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const RAW = {
    tech: `
JavaScript: js, ecmascript, es6
TypeScript: ts
Python
Java
C++: cpp
C#: csharp
!Go: golang
Rust
Ruby
PHP
Swift
Kotlin
Scala
Perl
MATLAB
!R: r programming, r language, rstudio
!C: c programming, c language
SQL: t-sql, pl/sql, plsql
NoSQL
GraphQL
REST APIs: rest, restful, rest api, restful api
HTML: html5
CSS: css3
Sass: scss
React: reactjs, react.js
Redux
Next.js: nextjs
Vue: vue.js, vuejs
Angular: angularjs
Svelte
Node.js: nodejs, node
Express: express.js, expressjs
Django
Flask
FastAPI
Spring Boot: springboot
Spring
.NET: dotnet, .net core, asp.net
Ruby on Rails: rails
Laravel
jQuery
Tailwind CSS: tailwind
Bootstrap
Webpack
Machine Learning: ml
Deep Learning
NLP: natural language processing
Computer Vision
TensorFlow
PyTorch
scikit-learn: sklearn
Pandas
NumPy
Spark: apache spark, pyspark
Hadoop
Kafka: apache kafka
Airflow: apache airflow
dbt
Snowflake
BigQuery
Redshift
Databricks
ETL: elt, data pipeline, data pipelines
Data Warehousing: data warehouse
Data Modeling: data modelling
Statistics: statistical analysis, statistical modeling
A/B Testing: ab testing, a/b test, split testing, experimentation
Data Analysis: data analytics
LLMs: llm, large language models, large language model
Generative AI: genai, gen ai
Prompt Engineering
RAG: retrieval augmented generation, retrieval-augmented generation
AWS: amazon web services
Azure: microsoft azure
GCP: google cloud, google cloud platform
Docker
Kubernetes: k8s
Terraform
Ansible
Jenkins
CI/CD: cicd, continuous integration, continuous delivery, continuous deployment
GitHub Actions
GitLab CI: gitlab ci/cd
Linux: unix
Bash: shell scripting
Git
GitHub
Microservices: microservice
Serverless
AWS Lambda: lambda
Prometheus
Grafana
Observability
DevOps
SRE: site reliability, site reliability engineering
Infrastructure as Code: iac
Nginx
PostgreSQL: postgres
MySQL
MongoDB: mongo
Redis
Elasticsearch: elastic search, opensearch
DynamoDB
SQL Server: mssql, microsoft sql server
SQLite
Cassandra
Cybersecurity: cyber security, information security, infosec
Penetration Testing: pentest, pen testing
SIEM
OWASP
IAM: identity and access management
SOC 2: soc2
ISO 27001
GDPR
HIPAA
iOS
Android
React Native
Flutter
SwiftUI
Unit Testing: unit tests
Jest
Cypress
Selenium
Test Automation: automated testing
TDD: test-driven development
QA: quality assurance
System Design: systems design
Distributed Systems
API Design: api development
Object-Oriented Programming: oop, object oriented
Design Patterns
Performance Optimization: performance tuning
Technical Documentation
Code Review: code reviews
Figma
UX Design: ux, user experience
UI Design: ui, user interface
User Research
Wireframing: wireframes
Prototyping
Adobe Creative Suite: photoshop, illustrator, indesign, adobe creative cloud
Tableau
Power BI: powerbi
Looker
Excel: microsoft excel, ms excel, advanced excel
VBA
Data Visualization: data viz, dashboards, dashboarding
`,
    tool: `
Jira
Confluence
Slack
Notion
Asana
Trello
Datadog
New Relic
Splunk
Postman
Salesforce: sfdc
HubSpot
Zendesk
Google Analytics: ga4
Google Ads: adwords
Mailchimp
Marketo
SAP
Oracle ERP: oracle fusion, oracle netsuite, netsuite
QuickBooks
Workday
ServiceNow
Microsoft Office: ms office, microsoft 365, office 365
PowerPoint
CRM: crm software
ERP
HRIS
EHR: electronic health records, electronic medical records, epic systems
`,
    domain: `
Agile
Scrum
Kanban
Lean
Six Sigma
Product Management
Product Strategy
Product Roadmap: roadmap, roadmapping
OKRs: okr
KPIs: kpi
Go-to-Market: gtm, go to market
Market Research
Competitive Analysis: competitor analysis
SEO: search engine optimization
SEM: search engine marketing
PPC: pay per click, paid search
Content Marketing
Email Marketing
Social Media: social media marketing
Copywriting
Brand Strategy
Marketing Automation
Demand Generation: demand gen
Lead Generation: lead gen
Account Management
Business Development
Sales Forecasting
Pipeline Management
Cold Calling
B2B
B2C
SaaS
Customer Success
Customer Service: customer support
Customer Retention: churn reduction, retention
Financial Modeling: financial models
Financial Analysis
Budgeting: budget management
Forecasting
FP&A: fpa, financial planning and analysis
Accounting
GAAP
Accounts Payable
Accounts Receivable
Reconciliation
Auditing: audit
SOX: sarbanes-oxley
Tax
Payroll
Supply Chain
Procurement: purchasing
Logistics
Inventory Management
Process Improvement: process optimization, continuous improvement
Project Management
Program Management
Risk Management
Compliance
Vendor Management
Change Management
Operations Management
Recruiting: talent acquisition
Onboarding
Employee Relations
Performance Management
Learning and Development: l&d, training and development
Patient Care
Clinical Research
Data Governance
Data Engineering
Data Science
Software Development: software engineering
Full-Stack: full stack, fullstack
Front-End: front end, frontend
Back-End: back end, backend
Cloud Computing: cloud infrastructure
Networking
Technical Support: it support, help desk
`,
    soft: `
Leadership
Communication: communication skills, written communication, verbal communication
Cross-Functional Collaboration: cross-functional, cross functional, collaboration
Problem Solving: problem-solving
Critical Thinking
Mentoring: mentorship, coaching
Team Management: people management, managing teams
Presentation Skills: public speaking, presentations
Time Management
Adaptability
Analytical Skills: analytical thinking
Attention to Detail: detail-oriented, detail oriented
Strategic Planning: strategic thinking, strategy
Stakeholder Management: stakeholder engagement, stakeholders
Negotiation
Decision Making: decision-making
Ownership: self-starter, self starter
Project Planning
`,
    cert: `
PMP: project management professional
CISSP
CPA: certified public accountant
CFA
AWS Certified: aws certification, aws solutions architect, aws certified solutions architect
Scrum Master: csm, psm, certified scrum master
Six Sigma Black Belt: black belt, green belt
CompTIA Security+: security+
ITIL
CCNA
CISM
CIPD
`
  };

  const list = [];
  const seen = new Set();
  for (const category of Object.keys(RAW)) {
    for (const line of RAW[category].split('\n')) {
      let l = line.trim();
      if (!l) continue;
      let ambiguous = false;
      if (l[0] === '!') { ambiguous = true; l = l.slice(1); }
      const idx = l.indexOf(':');
      const name = (idx === -1 ? l : l.slice(0, idx)).trim();
      const aliases = idx === -1 ? [] : l.slice(idx + 1).split(',').map((s) => s.trim()).filter(Boolean);
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const forms = (ambiguous ? [] : [name]).concat(aliases);
      list.push({ name, category, forms });
    }
  }

  // Skills that a recruiter would treat as interchangeable / adjacent.
  const RELATED = [
    ['AWS', 'Azure', 'GCP'],
    ['React', 'Vue', 'Angular', 'Svelte', 'Next.js'],
    ['PostgreSQL', 'MySQL', 'SQL Server', 'SQLite', 'SQL'],
    ['MongoDB', 'DynamoDB', 'Cassandra', 'NoSQL', 'Redis'],
    ['Python', 'R', 'MATLAB'],
    ['Java', 'C#', 'Kotlin', 'Scala', '.NET', 'Spring Boot', 'Spring'],
    ['Tableau', 'Power BI', 'Looker', 'Data Visualization'],
    ['Jira', 'Asana', 'Trello', 'Confluence'],
    ['Salesforce', 'HubSpot', 'CRM', 'Zendesk'],
    ['Jenkins', 'GitHub Actions', 'GitLab CI', 'CI/CD'],
    ['Docker', 'Kubernetes', 'Terraform', 'Ansible', 'DevOps'],
    ['TensorFlow', 'PyTorch', 'scikit-learn', 'Machine Learning', 'Deep Learning'],
    ['Agile', 'Scrum', 'Kanban'],
    ['Jest', 'Cypress', 'Selenium', 'Unit Testing', 'Test Automation'],
    ['Spark', 'Hadoop', 'Kafka', 'Airflow', 'Databricks', 'ETL'],
    ['Snowflake', 'BigQuery', 'Redshift', 'Data Warehousing'],
    ['Product Management', 'Product Strategy', 'Product Roadmap'],
    ['SEO', 'SEM', 'PPC', 'Google Ads', 'Content Marketing', 'Google Analytics'],
    ['Accounts Payable', 'Accounts Receivable', 'Reconciliation', 'Accounting', 'QuickBooks', 'SAP'],
    ['Leadership', 'Mentoring', 'Team Management', 'Stakeholder Management']
  ];

  // How to honestly close a gap, by category.
  const GAP_ADVICE = {
    tech: 'Build or extend a small project that uses it, list it under Projects with a measurable outcome, and cite it in a bullet. A short course/certificate is a fast way to show real intent.',
    tool: 'Tools are quick to learn: do a hands-on tutorial or free trial, then add one bullet that shows how you used it (what it enabled, and the result).',
    domain: 'Look for transferable work (side projects, volunteering, internal initiatives) and describe it in this domain\'s vocabulary. If it is truly new, say you are building it in the summary.',
    soft: 'Soft skills are proven with evidence, not adjectives. Write one bullet with a situation, what you did, and the measurable result.',
    cert: 'Certifications are binary for ATS filters. If you hold it, list it exactly as written; if you are studying, write "<Cert> (in progress, expected <month year>)".'
  };

  return { list, RELATED, GAP_ADVICE };
});
