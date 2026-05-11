# VILCAMI Skill Registry

## Project Conventions

- **CLAUDE.md** — Master instructions: IoT industrial, Cloudflare Workers stack, TDD inverso, seguridad agency-grade, 200-line file limit, ultra-descriptive naming, Zod validation mandatory
- **DEVELOPMENT_STATE.md** — Live project state tracker (fase actual, proximos pasos, errores conocidos)

## Project-Level Skills (.agents/skills/)

| Skill | Trigger | Description |
|-------|---------|-------------|
| find-skills | "how do I do X", "find a skill for X" | Discover and install agent skills |
| vercel-react-best-practices | React/Next.js code, components, perf | Vercel Engineering React perf guidelines |
| skill-creator | Create/edit/optimize skills | Skill creation, evals, benchmarking |
| frontend-design | Build web UI, dashboards, pages | Production-grade frontend with high design quality |
| scoutqa-test | "test this website", exploratory testing | AI-powered exploratory testing via ScoutQA CLI |
| planning-with-files | Plan multi-step tasks (5+ tool calls) | Manus-style file-based planning (task_plan, findings, progress) |
| seo-audit | "SEO audit", "SEO issues", ranking problems | SEO issue identification and recommendations |
| agent-browser | Browser automation, screenshots, scraping | Browser automation CLI for AI agents |
| tdd | TDD, red-green-refactor, test-first | Test-driven development with red-green-refactor loop |
| firecrawl | Web search, scrape, crawl docs | Firecrawl CLI for web search and scraping |
| typescript-advanced-types | Type-safe libs, generics, conditional types | Advanced TypeScript type system mastery |

## Global Skills (Superpowers)

| Skill | Trigger | Description |
|-------|---------|-------------|
| superpowers:brainstorming | Any creative work, new features | Brainstorming before implementation |
| superpowers:writing-plans | Multi-step tasks with specs | Structured implementation plans |
| superpowers:executing-plans | Written plan ready to execute | Plan execution in separate session |
| superpowers:test-driven-development | Features, bugfixes | TDD before implementation code |
| superpowers:systematic-debugging | Bugs, test failures, unexpected behavior | Systematic debugging before fixes |
| superpowers:verification-before-completion | About to claim work is done | Verify before committing or creating PR |
| superpowers:requesting-code-review | Completing tasks, major features | Code review before merge |
| superpowers:receiving-code-review | Code review feedback received | Handle review feedback properly |
| superpowers:finishing-a-development-branch | Implementation complete, tests pass | Branch integration decisions |
| superpowers:dispatching-parallel-agents | 2+ independent tasks | Parallel subagent execution |
| superpowers:using-git-worktrees | Feature work needing isolation | Git worktree isolation |
| sdd-init | Initialize SDD context | Spec-Driven Development initialization |
| sdd-explore | Explore before committing to change | Investigation and exploration |
| sdd-propose | Create change proposal | Intent, scope, approach for a change |
| sdd-spec | Write specifications | Requirements and scenarios |
| sdd-design | Technical design document | Architecture decisions and approach |
| sdd-tasks | Break down change into tasks | Implementation task checklist |
| sdd-apply | Implement from specs | Write code following specs and design |
| sdd-verify | Validate implementation matches specs | Verification against specs |
| sdd-archive | Sync and archive completed change | Archive finished changes |
| engram:memory | Always active | Persistent memory protocol |
| frontend-design:frontend-design | Build web UI, dashboards | Production-grade frontend interfaces |
| init | Initialize CLAUDE.md | Codebase documentation bootstrap |
| review | Review a pull request | PR review |
| security-review | Security review pending changes | Security audit of branch changes |

## Priority Rules

- **CLAUDE.md instructions** override skills when conflicting
- **Project-level skills** win over global skills with same name
- **Process skills** (brainstorming, debugging) before implementation skills
- **TDD skill** mandatory per CLAUDE.md ciclo TDD Inverso
- **Security rules** in CLAUDE.md are absolute — no skill overrides them