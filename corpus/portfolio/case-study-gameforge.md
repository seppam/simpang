# Case study: gameforge

Source: https://septian-pamungkas.vercel.app

**role**: Backend and multi-agent AI orchestration
**team**: Team of 4, remote
**time**: MAXY Academy Project Sprint for KADA alumni, 7 to 18 Sep 2026
**problem**: - People who are not programmers cannot turn a game idea into something playable. GameForge AI takes a plain-English description and produces a 2D browser game.
**myRole**:
**did**:
- Backend and multi-agent AI orchestration; 25 of 61 commits in a teammate's repository.
- Areas I worked on: the spec, asset-mapper, coder and debug agents, the multi-provider LLM fallback, the Kenney asset pipeline, the Supabase schema and generation stability.
**others**: My three teammates worked on the rest of the product. The code lives in a teammate's repository (devinfebrian/GameForge), so I link it as the team repo, not mine.
**approach**:
- A prompt goes to /api/generate, which streams progress over SSE while a pipeline runs: the spec agent writes a game requirements document, the asset mapper matches entities and sounds to curated CC0 Kenney assets or procedural sound presets, and the coder agent writes a short Phaser 4 scene.
- Results are stored in Supabase, previewed in an isolated sandbox and published at a play URL. A debug agent can repair runtime errors. The highlighted boxes in the diagram are the orchestration I worked on.
**decisions**:
- **title**: Provider fallback across all agents
  **text**: The admin panel can route all four agents through Claude, OpenAI, Gemini or Groq, with automatic failover, so one failing model does not stop a generation.
- **title**: Four agents with narrow jobs
  **text**: Spec, asset mapping, coding and debugging are separate agents. The coder agent writes short Phaser 4 scene code (typically under 200 lines, per the repo README) on top of a pre-injected engine layer instead of writing physics from scratch.
- **title**: What I would change, and what is still in progress
  **text**: GameForge AI still needs improvement. It works end to end and I am happy with what a team of four delivered in two weeks, but I do not consider it finished. The agent orchestration is the part I would keep improving first. I have not listed specific fixes here because I have not scoped them yet and do not want to guess.
**results**:
- Live app: game-forge-rho.vercel.app (sign-up required to generate).
- The team repository reports 430+ automated tests for the whole project.
- Delivered in a 2-week remote sprint with a team of 4.
- The screens below come from a local build of the team app; the short clip is silent and plays only when you press play.
**learned**: - Working in a teammate's repository on a two-week clock meant agreeing on interfaces first and keeping my changes small and reviewable.
