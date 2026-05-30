# AI-CODING-PLAYBOOK.md

A repeatable framework for structuring any codebase so AI tools (Claude Code, Codex, Cursor) work safely and consistently. Based on the Travel Wiz POC.

---

## The Framework at a Glance

```
Layer 1 — Governance     CLAUDE.md · AGENTS.md · docs/AI-LEARN.md
Layer 2 — Policy         guardrails/policy.json · domain_policy.json · model_routing_policy.json
Layer 3 — Automation     .claude/settings.json · scripts/hook-check-secrets.sh · scripts/hook-check-guardrails.sh
Layer 4 — Ownership      HANDOFF.md (cross-boundary contract between AI agents or teams)
Layer 5 — Infra          fixtures/ · evals/ · mock adapter · deterministic fallbacks
Layer 6 — Verification   guardrails command (one command, one exit code, full regression)
```

---

## Layer 1 — Governance Files

Every project gets three documents that all AI tools read before touching code.

| File | Audience | Purpose |
|---|---|---|
| `CLAUDE.md` | Claude Code | Commands, architecture map, hard rules, scope boundaries |
| `AGENTS.md` | All agents (Claude Code, Codex, Cursor) | Shared working rules, non-negotiable constraints |
| `docs/AI-LEARN.md` | Any agent modifying core logic | The architectural *why* — the principle that governs design decisions |

`CLAUDE.md` answers "how do I work here". `AGENTS.md` answers "what are the rules". `AI-LEARN.md` answers "why is it built this way". An agent that reads all three can't easily make a structural mistake.

### What goes in CLAUDE.md

- **What This Repo Is** — 2-3 sentences on what it does, what it doesn't do, where the runnable code lives
- **Key Reference Docs** — any architecture/teaching docs worth reading before modifying core files
- **Commands** — every common command: install, run (all adapter/mode variants), test (suite and single file), serve, eval, guardrails. Copy-pasteable. Actual binary paths.
- **Architecture** — orchestration flow as ASCII art or table. Parallel branches, conditional off-ramps, key modules table (file → one-line role)
- **Core Design Principle** — the single architectural decision that governs all others
- **Data Contracts** — typed envelopes or shapes that must be preserved for compatibility
- **Fixture / Test Data** — what fixture files exist, what each covers, how to override at runtime
- **Environment Variables** — every env var, grouped by service, noting which are optional
- **Guardrail Suite** — what the validation command checks, category by category
- **Observability** — what trace events are emitted, where they go
- **Ownership Boundaries** — which files Claude Code must not touch, who owns them, what the handoff mechanism is
- **Automated Hooks** — what hooks run on Edit/Write, what they check, what a block means
- **Working Rules** — 4-6 non-negotiable rules, numbered, each naming the specific file or function it applies to
- **Hard Boundaries** — what the system will never do, and where that's enforced in code

### What goes in AGENTS.md

- One paragraph: what this repo is and where the runnable code lives
- Instruction to read CLAUDE.md and AI-LEARN.md before changing anything
- Required Working Rules (numbered, 5-8):
  1. Write tests alongside every new function
  2. Every LLM call needs a deterministic fallback
  3. All tool functions return the project's typed result envelope
  4. Credentials stay out of source — load from env file via config module
  5. Preserve the capability boundary
  6. After changing orchestration or scoring files, run the guardrail suite
  7. Run relevant verification before handing work back
  8. Do not edit files owned by another agent or team
- Scope Discipline: don't modify CLAUDE.md unless asked, don't commit runtime artifacts

### What goes in AI-LEARN.md

- The one governing principle, stated as a rule with concrete implications
- For each major architectural pattern: why this over the obvious alternative, where in the code to see it
- A step-by-step walkthrough of a single representative request through the full system
- A "what would break" section: for each core invariant, what happens when violated

---

## Layer 2 — Policy Files

A `guardrails/` directory holds JSON files that both the runtime and the validation suite read. Boundaries are JSON, not comments — a comment can be skipped, a policy file is enforced by the validation suite on every run.

### policy.json

```json
{
  "policy_version": "1.0.0",
  "default_adapter": "mock",
  "capability_boundary": {
    "read_only": true,
    "allow_booking": false,
    "allow_writes": false
  },
  "required_files": ["README.md", "pyproject.toml", "fixtures/evals/main.json"],
  "required_gitignore_entries": [".env", ".env.local", ".venv/", "runs/"],
  "latency_policy": {
    "max_tool_call_ms": 500,
    "max_full_run_ms": 30000
  },
  "eval_policy": {
    "file": "fixtures/evals/main.json",
    "minimum_scenario_count": 10,
    "required_scenario_ids": []
  }
}
```

### domain_policy.json

```json
{
  "policy_version": "1.0.0",
  "domain_topics": ["keyword1", "keyword2"],
  "unsupported_phrases": ["book me", "transfer my", "apply now"],
  "off_topic_response": "This assistant is focused on X. I cannot help with that request here."
}
```

### model_routing_policy.json

```json
{
  "policy_version": "1.0.0",
  "task_routes": {
    "ingest_request": {
      "adapter": "anthropic",
      "fallback": "mock",
      "note": "Why this model for this task."
    },
    "synthesize_response": {
      "adapter": "anthropic",
      "fallback": "mock",
      "note": "Why this model for this task."
    }
  },
  "default_route": {
    "adapter": "anthropic",
    "fallback": "mock",
    "note": "Catch-all."
  }
}
```

---

## Layer 3 — Automated Hooks

Two hooks wire into the edit/write loop via `.claude/settings.json`. Safety checks run at the moment the AI writes a file — not at commit time, not in CI.

### .claude/settings.json

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "sh /absolute/path/to/scripts/hook-check-secrets.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "sh /absolute/path/to/scripts/hook-check-guardrails.sh" }]
      }
    ]
  }
}
```

### scripts/hook-check-secrets.sh

Reads tool input JSON from stdin. Extracts the written content. Scans for API key patterns, bearer tokens, inline credential assignments. Exits 2 (blocks the write) if a match is found.

```sh
#!/bin/sh
set -eu

input=$(cat)

printf '%s' "$input" | python3 -c "
import sys, json, re

data = json.load(sys.stdin)
tool_input = data.get('tool_input', {})
text = tool_input.get('new_string', '') or tool_input.get('content', '')

patterns = [
    (r'sk-[A-Za-z0-9]{20,}',                'API key (sk-)'),
    (r'(?i)bearer\s+[A-Za-z0-9._\-]{20,}',  'Bearer token'),
    (r'(?i)api[_-]?key\s*=\s*[\"\']\S{8,}', 'api_key assignment'),
    (r'(?i)password\s*=\s*[\"\']\S{4,}',    'password assignment'),
    (r'(?i)secret\s*=\s*[\"\']\S{8,}',      'secret assignment'),
]

found = [label for pattern, label in patterns if re.search(pattern, text)]
if found:
    print('BLOCKED: potential secret — ' + ', '.join(found), file=sys.stderr)
    print('Move credentials to .env.local and load via config module.', file=sys.stderr)
    sys.exit(2)
" 2>&1 || exit 2
```

**Adapt:** add project-specific key prefixes (e.g. `pk-lf-`, `sk-lf-` for Langfuse) to the patterns list.

### scripts/hook-check-guardrails.sh

Reads the file path from tool input. If the changed file is in the critical list, runs the full guardrail suite.

```sh
#!/bin/sh
set -eu

input=$(cat)

file_path=$(printf '%s' "$input" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('tool_input', {}).get('file_path', ''))
" 2>/dev/null || echo "")

case "$file_path" in
    */graph.py|*/scoring.py|*/core.py)
        echo "Critical file changed — running guardrail suite..." >&2
        cd "$(git rev-parse --show-toplevel)/<runnable-dir>"
        .venv/bin/python -m <project> guardrails
        ;;
esac
```

**Adapt:** replace the `case` patterns with your project's critical files. Replace `<runnable-dir>` and `<project>` with your paths.

---

## Layer 4 — Ownership Boundaries

When multiple AI tools or human teams own different parts of the codebase, hard boundaries prevent collisions.

- `CLAUDE.md` declares which directories Claude Code must not touch
- `AGENTS.md` repeats the same rule in tool-agnostic language
- `HANDOFF.md` is the contract across the boundary — one team writes it, the other reads it before making any change

### What goes in HANDOFF.md

- Who it's for, who writes it, when it was last updated
- Stack and how to run both sides
- API contract: every endpoint, request shape, response shape, error codes
- Shared data types: field names, types, example values
- Fixture/test data available for frontend development
- Constraints the consumer must respect: CORS, auth, rate limits, read-only rules

**The rule:** Claude Code updates HANDOFF.md when API shapes change. The other agent reads it before touching any owned file.

---

## Layer 5 — Deterministic Infrastructure

Build the system so it runs completely offline with no API keys.

- **Fixture files** replace every live external call — one JSON file per API/tool
- **Mock adapter** is the default — runs all LLM tasks with deterministic functions
- **Every LLM call has a deterministic fallback** in a dedicated module (e.g. `control_plane.py`)
- **Typed result envelopes** wrap every tool call — never return a raw dict from a tool function
- **Evals** are phrase-level or structure-level assertions against fixture runs, not golden-output matching

The governing principle: **Deterministic core, LLM as quality layer.**

Every LLM call has three things:
1. A deterministic equivalent that works without any model
2. A JSON schema the LLM must conform to (structured output)
3. A fallback path that fires if the LLM fails or returns unparseable output

This means tests always pass in CI without credentials, bugs are reproducible, and you can swap providers without breaking the regression suite.

---

## Layer 6 — The Guardrail Loop

One command validates the entire system:

```bash
python -m <project> guardrails
```

Standard check categories (adapt per project):

| Category | What it checks |
|---|---|
| File checks | Required source files are present |
| Gitignore checks | Secrets and runtime artifacts are properly ignored |
| Eval fixture checks | All required scenario IDs are present in the eval file |
| Eval runtime | All scenarios pass phrase/structure assertions |
| Capability boundary | Write-intent prompts return the correct refusal |
| Latency | Mock run under threshold, each tool call under threshold |
| HTTP layer | API endpoint returns expected shape |
| Unit tests | All tests pass |

The PostToolUse hook runs this automatically when critical files change, so regressions surface during editing — not at review time.

---

## The Working Workflow

1. **Bootstrap a new project:** run `/init` in Claude Code to get a draft `CLAUDE.md`, then run the bootstrap prompt below to generate all remaining files
2. **Edit `CLAUDE.md`:** add hard rules, scope boundaries, hook triggers, owned files
3. **Create `AGENTS.md`:** working rules in non-Claude-specific language so Codex and Cursor also follow them
4. **Create policy files:** define capability boundary, domain topics, and model routing in JSON
5. **Wire hooks:** secret check + critical-file guardrail trigger
6. **Build fixtures and evals:** at minimum, one fixture per external call, one eval scenario per key behavior
7. **Write `AI-LEARN.md`:** explain the governing principle and the why before you forget it
8. **Create `HANDOFF.md`** if there's a cross-boundary split: define who reads it and who writes it

---

## Bootstrap Prompt

Feed this to Claude Code in any new project. It will generate all the files above.

```
You are bootstrapping an AI-assisted development framework for this codebase.
Read the entire project first — all source files, existing docs, scripts, tests, and config.
Then generate the following files. Do not skip any. Do not hallucinate capabilities that aren't in the code.

---

## 1. CLAUDE.md (repo root)

Structure:
- Header: "# CLAUDE.md\n\nThis file provides guidance to Claude Code (claude.ai/code) when working with this repository."
- What This Repo Is: 2-3 sentences. What it does, what it doesn't do, where the runnable code lives.
- Key Reference Docs: list architecture/teaching docs worth reading before modifying core files.
- Commands: every common command — install, run (all adapter/mode variants), test (full suite and single
  file), serve, eval, guardrails. Use the actual binary path. Include flags and example values.
- Architecture: the orchestration flow as ASCII art or table. Parallel branches, conditional off-ramps.
  Then a key-modules table: file → one-line role description.
- Core Design Principle: the single architectural decision that governs all others. Explain concretely.
- Data Contracts: any typed envelope or shape that must be preserved for future compatibility. Show the JSON.
- Fixture / Test Data: what fixture files exist, what each covers, how to override at runtime.
- Environment Variables: every env var, grouped by service. Note which are optional.
- Guardrail Suite: what the validation command checks, listed by category.
- Observability: trace events emitted, where they go.
- Ownership Boundaries: which files Claude Code must not touch. Who owns them. Handoff mechanism.
- Automated Hooks: what runs on Edit/Write, what each checks, how to interpret a block.
- Working Rules: 4-6 non-negotiable rules, numbered. Each names the specific file or function it applies
  to. Phrase them as enforcement, not suggestions.
- Hard Boundaries: what the system will never do, and where that boundary is enforced in code.

Rules: every command must be copy-pasteable and correct. Every file reference must use its actual path.
No generic best practices. No documenting things inferable from reading the code. Omit sections with
no content for this project.

---

## 2. AGENTS.md (repo root)

- One paragraph: what this repo is and where the runnable code lives.
- Instruction to read CLAUDE.md and AI-LEARN.md before changing anything.
- Required Working Rules (numbered, 5-8 rules):
  1. Write tests alongside every new function. Name the test directory and naming convention.
  2. Every LLM call needs a deterministic fallback. Name the fallback file.
  3. All tool functions must return the project's typed result envelope. Name the type and file.
  4. Credentials stay out of source. Name the env file and config loader module.
  5. Preserve the capability boundary. State what the system is and is not allowed to do.
  6. After changing orchestration or scoring files, run the guardrail suite. Show the exact command.
  7. Run relevant verification before handing work back. Show the exact command.
  8. Do not edit files owned by another agent or team. Name the directories and the rule.
- Scope Discipline: don't modify CLAUDE.md unless asked, don't commit runtime artifacts.

---

## 3. guardrails/policy.json

Keys:
- policy_version: "1.0.0"
- default_adapter: the default run mode
- capability_boundary: boolean flags for what the system is and isn't allowed to do (derive from the
  codebase — what write actions does it refuse?)
- required_files: files that must always exist (structural source files, not generated)
- required_gitignore_entries: secrets files, runtime artifact dirs, virtualenv dirs
- latency_policy: max_tool_call_ms and max_full_run_ms (default: 500 / 30000)
- eval_policy: path to eval fixture, minimum_scenario_count, required_scenario_ids (derive from fixtures)

---

## 4. guardrails/domain_policy.json

Keys:
- policy_version: "1.0.0"
- domain_topics: lowercase keywords defining what the system answers (derive from the domain)
- unsupported_phrases: literal phrases that should be blocked (derive from any existing phrase lists)
- off_topic_response: short plain-English refusal message for this product

---

## 5. guardrails/model_routing_policy.json

Keys:
- policy_version: "1.0.0"
- task_routes: object keyed by task name (derive from the codebase — what distinct LLM tasks exist?)
  Each route: adapter, fallback, note (why this model — latency? reliability? cost?)
- default_route: catch-all with adapter, fallback, note

---

## 6. .claude/settings.json

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "sh <absolute_repo_root>/scripts/hook-check-secrets.sh" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "sh <absolute_repo_root>/scripts/hook-check-guardrails.sh" }]
      }
    ]
  }
}
```
Replace <absolute_repo_root> with the real absolute path.

---

## 7. scripts/hook-check-secrets.sh

A PreToolUse hook that:
- Reads JSON from stdin (Claude Code passes tool input as JSON)
- Extracts new_string (Edit tool) or content (Write tool) from tool_input
- Checks for: API key prefixes used by this project, bearer tokens, inline credential assignments
- On match: prints a blocked message to stderr naming the pattern, exits 2
- No match: exits 0 silently
Requirements: pure sh (not bash), set -eu, python3 for JSON/regex work.

---

## 8. scripts/hook-check-guardrails.sh

A PostToolUse hook that:
- Reads JSON from stdin
- Extracts file_path from tool_input
- Compares against the critical files for this project (orchestration, scoring, or equivalent core files)
- If critical file changed: prints message to stderr, cds to the runnable directory, runs the guardrail command
- If not critical: exits 0 silently
Requirements: pure sh, set -eu.

---

## 9. docs/AI-LEARN.md

Structure:
- Header: audience (developer skill level) and goal (explain WHY, not WHAT)
- The One Governing Principle: the architectural decision everything flows from. State it as a rule,
  explain concretely what it means, show where in the code to see it.
- For each major architectural pattern: why this pattern over the obvious alternative, where in the
  code it's implemented.
- Step-by-step walkthrough of a single representative request through the full system, showing what
  state looks like at each step.
- "What would break" section: for each core invariant, what goes wrong if a developer violates it.

---

## 10. HANDOFF.md (only if the project has a frontend/backend split or multi-agent ownership)

If the project has UI files owned by a different team or agent:
- Header: who this is for, who writes it, when last updated
- Stack and how to run both sides
- API contract: every endpoint, request shape, response shape, error codes
- Data types: every shared type with field names and example values
- Fixture data: test fixtures available and what personas/scenarios they cover
- Constraints the consumer must respect: CORS, auth, rate limits, read-only rules

---

## Execution instructions

1. Read the full codebase before generating any file.
2. Generate all files above (skip HANDOFF.md if no cross-boundary split exists).
3. Every command, path, and type name must be accurate — verify against source.
4. Do not pad with generic advice. Omit any section that has no content for this project.
5. After generating, run the guardrail suite if it exists. If not, note that the guardrail runner
   needs to be implemented.
6. Report what was generated and flag any section where you had to make assumptions.
```

---

## Quick Reference — File Checklist

```
repo/
├── CLAUDE.md                              ← AI guidance for Claude Code
├── AGENTS.md                              ← Working rules for all AI agents
├── HANDOFF.md                             ← Cross-boundary contract (if needed)
├── docs/
│   └── AI-LEARN.md                        ← Architecture teaching guide
├── guardrails/
│   ├── policy.json                        ← Latency, file, eval policy
│   ├── domain_policy.json                 ← Topic whitelist, capability boundary
│   └── model_routing_policy.json          ← Per-task LLM routing
├── .claude/
│   └── settings.json                      ← Hook wiring
└── scripts/
    ├── hook-check-secrets.sh              ← Pre-write secret scanner
    └── hook-check-guardrails.sh           ← Post-write critical-file trigger
```