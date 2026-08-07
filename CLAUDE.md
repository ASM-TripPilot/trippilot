# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **위치·경로 기준**: 이 파일은 **모노레포 루트**에 있고, 본문 경로 표기도 루트 기준 그대로다. Claude Code는 `frontend/`에서 실행하는 것이 팀 표준 — 그 경우 이 파일은 상위 디렉토리 CLAUDE.md로 자동 로드된다. frontend 개발 하네스(개발 사이클) 규칙은 `frontend/CLAUDE.md`에 따로 있다.

## What this is

TripPilot is a B2C travel super-app ("여행자 슈퍼앱"): users explore/save stays and POIs, then the app owns everything *after booking* — AI itinerary generation, in-trip Plan-B replanning, and post-trip archive/reflection. Booking/payment itself is delegated to external OTA affiliate links.

**Implementation in progress.** Backend has a real Gradle multi-module skeleton with Flyway migrations (V1.0–V2.4 + repeatable `R__` seeds) and docker-compose/GHCR CI (TRIP-145~147, merged to main). Frontend is scaffolded and under active feature work — architecture canon is `frontend/README.md` (TRIP-160), FSD 층 구조에 TS/TSX 소스와 Jest 테스트가 실재한다. `ai/` 는 설계 문서 + 초기 스캐폴딩(`main.py`·`Dockerfile`) 단계다. Most design content is Korean documents — do not invent build/test/lint results for packages that have no code yet.

## Repository layout (important)

This is a **monorepo** (`ASM-TripPilot/trippilot`). Everything lives in one git repo, organized by package:

| Directory | Role |
|---|---|
| `docs/` | Team process docs — `docs/conventions/` (branch·commit·PR) and `docs/guides/` (Jira/Slack). |
| `backend/` | Backend (Spring Boot + Kotlin modular monolith). **Gradle skeleton + Flyway migrations exist.** Design docs in `backend/docs/design/`. |
| `frontend/` | Frontend (React Native + Expo). **Architecture canon = `frontend/README.md`**; `frontend/docs/` 에는 개발로그(`devlog/`)와 구조 지도(`structure.md`). 스캐폴딩 완료, 기능 개발 중. |
| `ai/` | AI-layer design (itinerary/Plan-B/reflection AI architecture, prompts, solver, testing). 설계 문서 + 초기 스캐폴딩(`main.py`·`Dockerfile`). |
| `aidlc/` | **AWS AI-DLC (Amazon Q) workspace.** 기획 참조 canon = `aidlc-docs/inception/` (requirements · user-stories · application-design · unit-of-work U0–U9). Construction-stage design docs go under `aidlc-docs/construction/`. Tool-state (`aidlc-state.md`, `audit.md`, `docs/SCOPE.md`) is updated only through the AI-DLC rules (append-only audit) — coordinate with the team. |

`aidlc/aidlc-docs/planning/` **was removed on 2026-07-17 (team decision) — never reference it**; use `aidlc-docs/inception/` instead (git history retains the old files).

Figma is the **single source of truth for screens** — the repo keeps no copy of screen specs (the per-screen IO catalog was retired 2026-07-20; a stale copy silently diverges from live). Wireframe PNG exports are kept outside the repo. Band map and file key: `frontend/.claude/skills/spec-perception/reference/figma-structure.md` (bands a–m, no `f`; `b`/`k`/`m` are outside first-cut).

**When docs conflict**: product requirements/stories/units → `aidlc/aidlc-docs/inception/` (it supersedes the upstream `aidlc/docs/PRD/`); package architecture & implementation decisions → the owning package's canon (`frontend/README.md`, `backend/docs/design/`, `ai/`).

## Where the authority lives

Read the canonical doc before changing behavior it owns:

- Product requirements & stories: `aidlc/aidlc-docs/inception/requirements/requirements.md`, `inception/user-stories/{stories,personas}.md` (123 stories)
- Components, methods, services, dependencies: `aidlc/aidlc-docs/inception/application-design/` (components C1–C17 · component-methods · services S1–S6 · component-dependency)
- Unit breakdown & build order U0–U9: `aidlc/aidlc-docs/inception/application-design/unit-of-work{,-dependency,-story-map}.md`
- Frontend architecture (stack·structure·boundaries·testing): `frontend/README.md`
- Backend build order: `backend/docs/design/TripPilot-백엔드-우선순위-로드맵.md`; DB/API/schema under `backend/docs/design/` (`openapi.yaml`, `sql/V1.*.sql`, `*-스키마-설계.md`)
- AI architecture & rules: `ai/README.md` (3-minute onboarding) → `ai-architecture.md` (WHY) → `ai-implementation-design.md` (HOW) → `ai-prompt-design.md`, `ai-testing-guide.md`, `ai-adr.md`

Construction-stage per-unit design docs are produced under `aidlc/aidlc-docs/construction/` (design documents only — code is developed by the team directly in each package directory).

## Architecture in one screen

**Backend — modular monolith**, single deployable, Spring Boot + Kotlin, PostgreSQL (versions per `backend/` Gradle version catalog). Feature modules (auth, profile, accommodation-search/saved-accommodation/affiliate-link, trip, place-data, itinerary-generation, planb-detection/recalculation, weather-context, archive, reflection, notification) + cross-cutting LLM Gateway / Solver / Moderation — component inventory C1–C17 in inception `components.md`. Layering per module is `api / application / domain / infra`; **other modules may depend only on a module's `api`** (facade interfaces, DTOs, events). Cross-module communication is synchronous public facades OR async domain events via a transactional outbox (at-least-once, idempotent subscribers). No cyclic sync dependencies. External APIs (Kakao, Kakao Mobility, KMA weather, TourAPI, LLM, FCM) are isolated behind `{Capability}Port` interfaces with `{Vendor}Adapter` implementations — "one external API = one owning module = one adapter port." Architecture rules are enforced by Konsist/ArchUnit + Gradle dependency constraints (violations fail the build).

**AI layer — hybrid multi-agent + solver.** Natural-language input goes through an INTENT router → specialized workers (SCHEDULE / PLAN_B / REFLECT / EDIT). The LLM Gateway handles interpretation/preference-scoring/explanation (judgment). The Solver Engine (Python; OPTW/TOPTW optimization) owns feasibility — times, order, travel estimates, hard constraints — with deterministic fallback.

**Four AI invariants (violating any = redesign, per `ai/README.md`):**
- **INV-1** LLM selects only from the closed-set candidate pool (web-sourced POIs must pass the collection gate and be registered into the place-data module first — never candidate raw web results).
- **INV-2** User-visible times/order come only from solver-verified values (routers/workers only *propose*).
- **INV-3** Duration is never displayed — distance only. (No `duration` field in DTOs.)
- **INV-4** On AI failure, fall back deterministically. Silent failure is forbidden.

**Client:** React Native + Expo (TypeScript strict). Consumes only server public REST APIs; business-rule authority always lives on the server (client validation is a UX-only copy).

## Build & test

- **Backend (`backend/`):** Gradle (Kotlin DSL, multi-module) — **already scaffolded** (`backend/gradlew`). App assembly lives only in the `app` module; migrations are Flyway **SQL-first, forward-only** (`backend/app/src/main/resources/db/migration/V*.sql` = schema canon; `R__*.sql` 은 재실행 가능한 시드). Tests: Kotest + **kotest-property** (property-based testing is a *blocking* gate), MockK, Testcontainers, ArchUnit/Konsist. Commands: `./gradlew build`, `./gradlew test`, single test via `./gradlew test --tests "<FQCN>"` or `--tests "<Class.method>"`.
- **Frontend (`frontend/`):** 스캐폴딩 완료. Stack/testing canon = `frontend/README.md` (pnpm · Expo development build + prebuild · Expo Router · TanStack Query + Zustand · NativeWind · orval · Jest + fast-check). 실제 스크립트(`frontend/package.json`): `pnpm lint` · `pnpm tsc` · `pnpm test` · `pnpm test:integration` · `pnpm test:node` · `pnpm codegen` · `pnpm format` · `pnpm start`/`ios`/`android`. 실행 순서의 정본은 `verify-gates` 스킬.
- **AI/Solver (`ai/`):** Python service (LLM gateway + solver) — 초기 스캐폴딩(`ai/main.py`·`Dockerfile`), 서비스 로직은 미구현.
- **CI:** `.github/workflows/{backend-ci, frontend-ci, ai-ci}.yml` (path-filtered). Gates before merge: solver hard-constraint PBT at 100%, closed-set gate PBT at 100%, and **all external APIs (LLM, distance/maps) faked in CI — zero real API calls**.

Security/resilience baselines (`SECURITY-01..15`, `RESILIENCY-*`) and PBT are described as blocking across all phases — treat them as scaffolding to install in "Phase 0 walking skeleton," not afterthoughts. Legal/consent-log and location-legal-log tables are **append-only** (enforced at the DB permission level; the app role has no DELETE).

## Working conventions

- **Language:** the team works in Korean. Design docs, commit history, and PR discussion are Korean; match that register in docs/comments unless the surrounding code is English.
- **Traceability:** requirements, decisions, and modules are referenced by stable codes (`ADR-####`, `US-*`, `C1`–`C17`, `U0`–`U9`, `S1`–`S6`) across `docs/PRD/`, inception artifacts, and backend design docs. Preserve these codes when editing docs that use them. (Legacy planning-only code systems — `M##`, `D##`, `Δ#`, `N#`, `G###` — may linger in package docs; they decode against removed planning files, so treat them as historical.)
- **AI-DLC workflow:** `aidlc/CLAUDE.md` defines an AWS AI-DLC staged workflow (Inception → Construction → Operations) with mandatory approval gates and an append-only `audit.md`. **Current scope (2026-07-17, `aidlc/docs/SCOPE.md`): CONSTRUCTION design-document stages only** — Code Generation/Build&Test are excluded; code is developed by the team in each package directory. Follow the AI-DLC rules (approval gates, append-only audit) when producing those design docs; don't run the ceremony for ordinary code edits.
- **MVP scope narrowing:** the current MVP is social login only (Google/Kakao/Naver/Apple); email signup/verification/password login is deferred. Follow-up modules M15 (Community), M16 (Assistant), M17 (Collab) are out of first-cut code generation.
- **Coding behavior baseline** (all packages; the frontend dev-cycle harness enforces stricter structural rules on top): state assumptions and present competing interpretations instead of silently picking one; write the minimum code that solves the problem; touch only what the request requires — no drive-by refactors or comment/formatting "improvements"; clean up only orphans your own change created.
- **실패 학습(안티패턴 로그):** `docs/conventions/anti-patterns.md` 는 재현·검증된 실패에서 뽑은 "이렇게 하면 안 된다" 규칙의 누적 로그다. **작업 착수 전 관련 영역을 읽고**, 테스트/구현/설계 실패가 새로 발생하면 근본 원인을 파악해 **한 줄 규칙(하지 말 것 → 대신 할 것 + 근거)을 추가 제안**한다. 가설이 아니라 실제 발생·검증된 것만 기록한다.
- **개발 8단계 워크플로우:** `docs/conventions/workflow-8steps.md`. 정의→정의서→테스트시나리오→구현→구현리포트→테스트수행→테스트리포트→사용매뉴얼. **규모별 보정**(스토리·모듈=전체 / 버그픽스·chore=구현·테스트·리포트만, 나머지는 `N/A` 명시). 대부분 단계는 기존 산출물(설계문서·PR 절·openapi)로 매핑되며 PR 템플릿 체크리스트가 빠진 칸을 보이게 한다. 의식(儀式) 금지 — 목적 없는 단계는 밟지 않는다.
