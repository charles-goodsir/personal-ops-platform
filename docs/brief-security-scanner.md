# Project 2: Security MCP Server

> **Build order:** This is project 2 of 2. It comes AFTER `01-personal-ops-platform.md`. Do not start until project 1 is complete. Reuse its MCP server scaffolding, auth, config, logging, and CI setup instead of rebuilding them.

## Prerequisites (check before starting)

1. Project 1 (Personal Ops Platform) is complete and running on the mini PC.
2. My deliberately vulnerable app (`appsec-homelab` repo: ASP.NET Core 8 API + React frontend) is containerised and running on the mini PC via Docker Compose.

If either is missing, stop and tell me.

## Goal

An MCP server that lets Claude run security tools against my homelab and reason over the results, hardened so it can't be abused through the MCP layer. The threat model and hardening are the main portfolio value, not the tool wrappers.

## Scope

**In scope:** my homelab app, my own repos, my own container images.
**Out of scope:** anything else. The server must make scanning other targets impossible, not just discouraged.

## Architecture

- Separate package (or repo) reusing project 1's MCP scaffolding
- Each scanner runs in its own container, invoked by the server with fixed arguments
- Results normalised (SARIF/JSON) into a findings store in Postgres
- Runs on the mini PC, reachable only over LAN or Tailscale

## MCP tools

| Tool | Purpose | Gate |
|---|---|---|
| `run_zap_scan(target, mode)` | ZAP baseline (passive) or full (active) scan | Active mode needs my confirmation |
| `run_semgrep(repo)` | SAST on an allowlisted repo | None |
| `run_trivy(image)` | Container image and dependency scan | None |
| `run_nuclei(target, templates?)` | Template-based vuln checks | Needs my confirmation |
| `get_findings(filters)` | Query stored findings | None |
| `diff_scans(scan_a, scan_b)` | New, fixed, and unchanged findings | None |
| `get_scan_status(scan_id)` | Long-running scan progress | None |

Scans are async: start a scan, return a `scan_id`, poll for status.

## Hardening requirements

1. **Target allowlist:** targets, repos, and images come from a config file. Validate every parameter against it. Reject IP tricks (decimal/octal IPs, DNS rebinding, redirects to non-allowlisted hosts).
2. **No shell:** no tool accepts free-form commands or arbitrary flags. Parameters are validated enums or allowlisted values.
3. **Untrusted output:** all scanner output (especially ZAP, which crawls page content) is data, never instructions. Wrap it clearly when returned to Claude and strip or flag anything that looks like an instruction.
4. **Confirmation gates:** active scans require explicit out-of-band approval (for example a Telegram approve/deny button via project 1's bot).
5. **Least privilege:** scanner containers run as non-root, read-only filesystem where possible, no Docker socket access, resource limits, network restricted to the allowlisted targets.
6. **Auth:** token auth on HTTP transport, tokens rotatable, no unauthenticated endpoints.
7. **Rate limits:** cap concurrent and per-hour scans.
8. **Audit log:** every tool call recorded with timestamp, caller, parameters, result status. Append-only.

## Phases

### Phase 1: Threat model first (3 to 4 days)
- Write `docs/threat-model.md` before any code: assets, trust boundaries, attacker goals, STRIDE pass over the MCP layer, planned mitigations.
- **Done when:** I've reviewed and approved it.

### Phase 2: Core tools (1 to 2 weeks)
- Semgrep and Trivy tools first (simplest), then ZAP baseline
- Findings store, normalisation, `get_findings`, `diff_scans`
- Allowlist, input validation, audit log from day one
- **Done when:** Claude can scan the homelab app and repo and summarise findings.

### Phase 3: Active scanning and gates (1 week)
- ZAP full scan and Nuclei behind confirmation gates
- Rate limits, container lockdown
- **Done when:** active scans only run after I approve them.

### Phase 4: Adversarial testing (1 week)
- Plant prompt injection payloads in the vulnerable app's pages and check they don't change Claude's behaviour through ZAP output
- Try to break the allowlist (encoded IPs, redirects, DNS tricks)
- Try to get arbitrary command execution through tool parameters
- Document every test, result, and fix in `docs/security-testing.md`
- **Done when:** all tests documented, any bypasses fixed and retested.

### Phase 5: Write-up and polish (3 to 5 days)
- README with architecture diagram, threat model summary, and the most interesting test results
- Blog-style write-up suitable for my portfolio site
- **Done when:** someone in an AppSec interview could read it and understand what I built, what could go wrong, and how I stopped it.

## Working style

- Same as project 1: one phase at a time, confirm plans before coding, small commits, surface trade-offs.
- Security decisions get a short ADR in `/docs`.
- Write copy without em dashes.
