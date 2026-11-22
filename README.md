# Rabbit Hole

*Follow the clues. Explore the unknown. Find your way back.*

**Rabbit Hole** is an evidence-grounded AI research explorer, built for CutieHack 2026. Describe a dream, goal, or hard question. Rabbit Hole plans research paths, searches the live web, verifies quotes against real page text, and turns the results into an interactive map—then a cited, actionable report.

## Why it exists

Search engines return links. Chatbots return fluent answers. Neither shows you **what is known, what is uncertain, and what to do next**—with evidence you can check.

Rabbit Hole does that in one place:

1. **Plan** — Break the question into research doors (paths).
2. **Research** — Search the web, read pages, extract atomic findings with verbatim quotes.
3. **Verify** — Check each quote against the page text so citations are not invented.
4. **Analyze** — Surface gaps, conflicts, outdated sources, and cross-path connections.
5. **Report** — Unlock a Golden Key: a cited plan you can act on.

## Features

- **Wonderland skill-tree map** — A central “Start here” node, colored research regions, winding trails, and golden links between related findings
- **Zoom into any node** — Open doors, findings, and gaps as focused pages; zoom out to return to the map
- **Evidence you can trust** — Verified quotes, evidence labels (corroborated, conflicting, outdated, and more), and source links
- **Cheshire Cat gaps** — Missing answers, conflicts, and stale rules called out with why they matter
- **Mad Hatter connections** — Cross-branch links you can accept or dismiss
- **Golden Key report** — A cited, downloadable research brief when the investigation is ready
- **Saved demo** — Try a full UCR club cultural-night investigation without burning API credits

## Tech stack

| Layer | Tools |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind CSS v4, shadcn/ui, React Flow |
| State | Zustand + localStorage (stateless server) |
| Validation | Zod (requests, responses, and model output) |
| AI | OpenAI-compatible LLM API |
| Search | Keenable search + page retrieval |
| Fallback | Solari cloud browser when a page cannot be read normally |

## Getting started

### Requirements

- Node.js 20+
- An OpenAI-compatible API key (OpenAI, OpenRouter, Groq, etc.)
- Optional: [Keenable](https://keenable.ai) and [Solari](https://console.getsolari.com) keys for higher limits and browser fallback

### Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` (never commit this file):

| Variable | Required | Purpose |
| --- | --- | --- |
| `LLM_BASE_URL` | Yes | OpenAI-compatible base URL (e.g. `https://api.openai.com/v1`) |
| `LLM_API_KEY` | Yes | Your API key |
| `LLM_MODEL_FAST` | Yes | Model for planning and claim extraction |
| `LLM_MODEL_STRONG` | Yes | Model for analysis and the final report |
| `KEENABLE_API_KEY` | No | Higher search rate limits |
| `SOLARI_API_KEY` | No | Cloud-browser fallback for hard-to-read pages |

Then start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Try the demo

On the entrance screen, load the **saved example**. It is a full investigation of:

> How can my student club at UC Riverside get funding for a cultural night event with food?

No live API calls are needed for that path.

## How to use

1. Enter a dream or question on the entrance screen (or pick an example).
2. Review the White Rabbit’s plan—edit or drop doors if you want.
3. Open the doors and watch the skill tree grow as research finishes.
4. Click nodes to inspect findings, sources, gaps, and connections.
5. When research is done, open the **Golden Key** for the cited report.

## Project structure

```
src/
  app/           # Pages and API routes
  components/    # UI, skill-tree graph, panels
  lib/
    ai/          # LLM prompts and clients
    research/    # Search, retrieval, verification
    skilltree/   # Pure layout for the investigation map
    client/      # Browser API helpers
    stores/      # Zustand investigation store
  fixtures/      # Demo and mock investigations
docs/            # Design blueprint
```

API routes (all `POST`, stateless):

| Route | Role |
| --- | --- |
| `/api/plan` | Decompose the question into research doors |
| `/api/research` | Search, retrieve, extract, and verify one branch |
| `/api/analyze` | Gaps, connections, and evidence labels |
| `/api/report` | Golden Key report |

## Scripts

```bash
npm run dev          # Local development
npm run build        # Production build
npm run typecheck    # TypeScript
npm run lint         # ESLint

npx tsx scripts/validate-fixture.ts   # Check fixtures against contracts
npx tsx scripts/smoke-api.ts          # Hit all four routes (dev server must be running)
```

## Team

Built in ~12 hours at CutieHack 2026 by a two-person team.

## License

Built as a CutieHack 2026 project. If you reuse ideas or code, please credit the authors.
