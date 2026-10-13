# Task 16 Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the repository for Amplify Hosting deploys from `main` at `https://round-about.chreisel.net`, protect `main`, and hand the owner a short launch checklist for after the quota approval.

**Architecture:** `amplify.yml` runs checks, deploys the branch backend and builds the frontend with generated outputs. Origins come from a small tested function that switches on `AWS_BRANCH`. Branch protection is set through the GitHub API. Amplify app creation, rewrite rule and domain wait for the quota and the owner's console step.

**Tech Stack:** Amplify Gen 2 (`ampx pipeline-deploy`, `generate outputs`), AWS CDK, GitHub API via `gh`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-13-task-16-production-design.md`

## Global Constraints

- Work on branch `task-16-production`; one feature commit and one docs commit; a pull request to `main`; merge only after the owner's OK.
- Production origins: `https://round-about.chreisel.net` and `https://${AWS_BRANCH}.${AWS_APP_ID}.amplifyapp.com`; sandbox keeps `http://localhost:5173`, `http://127.0.0.1:5173`.
- Log retention `"2 weeks"` for every function.
- Branch protection: required check `check`, PRs required, 0 approvals, enforce admins, no force push, no deletion.
- No GitHub token passes through the assistant; the owner connects GitHub in the Amplify console.

## Review Focus

1. A production build must not allow localhost origins. Pinned in Task 1 (`allowedOrigins` with `AWS_BRANCH` set excludes localhost).
2. A sandbox deploy (no `AWS_BRANCH`) must keep working with localhost. Pinned in Task 1 and by redeploying the sandbox plus `smoke:dev`.
3. `AWS_BRANCH` set but `AWS_APP_ID` missing must not produce an origin like `https://main.undefined.amplifyapp.com`. Pinned in Task 1.
4. The production frontend must find its endpoints (`/amplify_outputs.json` in `dist`). Pinned in Task 2 (`amplify.yml` copies it; checked on the first production build in the launch checklist).
5. A direct push to `main` must be rejected. Pinned in Task 3 (protection read back via the API).

---

### Task 1: Origins and log retention

**Files:** Create `amplify/origins.ts`, `amplify/origins.test.ts`; modify `amplify/backend.ts`, every `amplify/functions/*/resource.ts`, `package.json` (test list)

**Interfaces:** `allowedOrigins(env: { AWS_BRANCH?: string; AWS_APP_ID?: string }): string[]`.

- [ ] **Step 1: Write failing tests**: `sandbox keeps localhost` (`{}` → `["http://localhost:5173","http://127.0.0.1:5173"]`); `production allows the domain and Amplify address only` (`{AWS_BRANCH:"main", AWS_APP_ID:"d123"}` → `["https://round-about.chreisel.net","https://main.d123.amplifyapp.com"]`, no localhost); `missing app id leaves out the Amplify address` (`{AWS_BRANCH:"main"}` → `["https://round-about.chreisel.net"]`).
- [ ] **Step 2: Run** `node --import tsx --test amplify/origins.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; `backend.ts` uses `allowedOrigins(process.env)`; add `logging: { retention: "2 weeks" }` to each `defineFunction`.
- [ ] **Step 4: Run** `npm run check`; redeploy the sandbox; `AWS_PROFILE=chreisel npm run smoke:dev`. Expected: all pass; log groups show 14-day retention.

### Task 2: Build specification and docs

**Files:** Create `amplify.yml`; modify `AGENTS.md`, `DEVELOPMENT_HANDOFF.md`, `INFRASTRUCTURE.md`, `docs/SMOKE.md`, `TASKS.md`

- [ ] **Step 1: Write** `amplify.yml` per the spec (backend: `npm ci`, `npm run check`, `npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID`; frontend: `npx ampx generate outputs --branch $AWS_BRANCH --app-id $AWS_APP_ID`, `npm run build`, `cp amplify_outputs.json dist/`; artifacts `dist`, `**/*`; cache `node_modules/**/*`).
- [ ] **Step 2: Update docs**: pull-request workflow in `AGENTS.md` and the handoff; `INFRASTRUCTURE.md` status; `docs/SMOKE.md` production endpoints via `ampx generate outputs` for app `round-about`; `TASKS.md` Task 16 status "repository ready, launch pending quota"; a "Launch checklist" section in the handoff (owner's console steps, then the assistant's CLI steps, then the smoke).
- [ ] **Step 3: Run** `npm run check`. Expected: PASS.

### Task 3: Pull request and branch protection

- [ ] **Step 1: Commit** (feature, then docs), **push** the branch, **open** the pull request with the launch checklist in its description.
- [ ] **Step 2: Set branch protection** via `gh api -X PUT repos/chrseidel/round-about-game/branches/main/protection` with the spec's settings; **read it back**. Expected: `required_status_checks.contexts` contains `check`, `enforce_admins.enabled` true, `required_pull_request_reviews.required_approving_review_count` 0, `allow_force_pushes` false, `allow_deletions` false.
- [ ] **Step 3: Watch** the pull request's `check` run. Expected: success. Do not merge: the owner merges (or asks for the merge) after the quota is approved.
