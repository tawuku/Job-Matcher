/* Fictional sample data so people can try the tool in one click. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JobMatcherSamples = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const resume = `Alex Morgan
Austin, TX | alex.morgan@example.com | (555) 010-4477 | linkedin.com/in/alexmorgan-example

SUMMARY
Software developer who enjoys building web applications and working with teams.

SKILLS
JS, React, Node, HTML, CSS, SQL, Git, Postgres, Docker, Jira

EXPERIENCE
Web Developer, BrightPath Software — Austin, TX
Mar 2020 – Present
• Responsible for building new features for the customer dashboard
• Worked on fixing bugs and helping the QA team
• Built a reporting module using React and Node that cut report generation time from 40s to 6s
• Helped migrate the app to Docker containers

Junior Developer, Lumen Digital — Remote
Jun 2018 – Feb 2020
• Developed landing pages for 15+ clients using HTML, CSS and JavaScript
• Assisted with database queries and maintenance
• Participated in daily standups and code reviews

EDUCATION
B.S. Computer Science, University of Texas at Austin, 2018
`;

  const jd = `Senior Full-Stack Engineer

About Us
We are a fast-growing SaaS company building tools for logistics teams. Join our mission-driven team!

What You'll Do
- Design, build and ship customer-facing features across our React and Node.js stack
- Own services end to end: design APIs, write TypeScript, deploy to AWS
- Improve performance and reliability of our PostgreSQL-backed microservices
- Mentor junior engineers and lead code reviews
- Collaborate cross-functionally with product and design to deliver on our roadmap

Requirements
- 5+ years of professional experience in software engineering
- Strong proficiency in TypeScript, React and Node.js
- Experience designing REST APIs and working with PostgreSQL
- Hands-on experience with AWS (EC2, S3, Lambda) and CI/CD pipelines
- Experience with Docker and Kubernetes
- Bachelor's degree in Computer Science or equivalent experience
- Excellent communication skills

Nice to Have
- Experience with GraphQL
- Terraform or infrastructure as code
- Familiarity with Agile and Scrum
`;

  return { resume, jd };
});
