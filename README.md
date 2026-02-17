# jihn monorepo

Monorepo with two local interfaces for the same Jihn agent runtime:

- `apps/cli`: Ink terminal UI agent
- `apps/web`: Next.js App Router dashboard

## Requirements

- Node.js 22+
- pnpm 10+

## Setup

```bash
pnpm install
```

## Run locally

```bash
pnpm dev:web   # Next.js dashboard at http://localhost:3000
pnpm dev:cli   # Ink terminal UI
```

Or run dashboard as default:

```bash
pnpm dev
```

## Workspace commands

```bash
pnpm build
pnpm lint
pnpm test
```

## Notes

- Dashboard API route is at `apps/web/app/api/agent/route.ts` and reuses shared runtime from `packages/agent-core`.
- CLI-specific docs remain in `apps/cli/README.md`.
- System prompt assembly is file-driven via `packages/agent-core/src/config/prompt-composer.ts`.
- Workspace-level prompt files: `AGENTS.md`, `SOUL.md`, `TOOLS.md`.
- Optional per-agent prompt files: `agents/<agentId>/AGENTS.md`, `agents/<agentId>/SOUL.md`, `agents/<agentId>/TOOLS.md`.
