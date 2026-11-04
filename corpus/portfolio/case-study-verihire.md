# Case study: verihire

Source: https://septian-pamungkas.vercel.app

**role**: PM and Lead Developer
**team**: Team of 5
**time**: Korea ASEAN Digital Academy, Phase 3 Batch 3, Feb to Apr 2026 (250 hours)
**problem**: - Job seekers receive scam postings and need honest feedback on their CVs. VeriHire analyses a CV and flags likely job scams.
**myRole**:
**did**:
- Project manager and team lead of a team of 5 in KADA Phase 3 Batch 3 (250 hours). I led the planning of the project.
- My main job was the backend. I built the Node.js and Express backend on MongoDB: JWT authentication, CV parsing and ATS analysis, and the Gemini and Elice AI integration (13 commits in seppam/verihire-backend).
- I also contributed to parts of the React frontend (React 19 and React Router): 6 of the 20 commits in timurboys112/verihire-capstone.
**others**: The other four members worked on the remaining features and most of the frontend; the frontend repository lives under a teammate's account.
**approach**: - A React frontend (React Router) talks to a Node.js and Express backend with MongoDB for storage. The backend handles JWT authentication, CV parsing and ATS analysis, and calls the Gemini and Elice AI APIs.
**decisions**:
- **title**: One Node service for authentication, CV analysis and AI integration
  **text**: The backend handles JWT authentication, CV parsing, ATS analysis and the AI integration in a single Node.js and Express service on MongoDB.
**results**:
- Delivered inside the 250-hour KADA Phase 3 (Batch 3) programme, Feb to Apr 2026.
- Two public repositories: backend and frontend. No live URL; no ranking claim.
- It later became the base of my Job Personal Assistant experiment.
