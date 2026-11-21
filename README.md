# Rabbit Hole

*Follow the clues. Explore the unknown. Find your way back.* CutieHack 2026.

An evidence-grounded AI research explorer: describe a dream, goal or hard question, and Rabbit Hole turns it into an interactive graph of verified findings, gaps and connections, then a cited, actionable report.

- Full plan: [docs/BLUEPRINT.md](docs/BLUEPRINT.md)
- Team rules and file ownership: [CLAUDE.md](CLAUDE.md) (same as `.cursor/rules/project.mdc`)
- Shared types: [src/lib/types.ts](src/lib/types.ts) · API contracts: [src/lib/contracts.ts](src/lib/contracts.ts)

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in the keys (never commit .env.local)
npm run dev                  # http://localhost:3000
```

## Checks

```bash
npm run typecheck
npm run lint
npx tsx scripts/validate-fixture.ts   # fixture matches the contracts
npx tsx scripts/smoke-api.ts          # all four routes return contract-valid JSON (dev server running)
```
