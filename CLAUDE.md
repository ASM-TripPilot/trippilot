# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TripPilot is a B2C travel super-app ("여행자 슈퍼앱"): users explore/save stays and POIs, then the app owns everything *after booking* — AI itinerary generation, in-trip Plan-B replanning, and post-trip archive/reflection. Booking/payment itself is delegated to external OTA affiliate links.

**This is design-stage. There is effectively no implementation code yet — the roadmaps say "코드는 아직 0줄" (0 lines of code).** The repo currently holds canonical design documents (mostly in Korean). Expect to be *writing* the first code against these specs, not reading an existing codebase. Do not invent build/test/lint results that cannot exist yet.

## Repository layout (important)

This is a **monorepo** (`ASM-TripPilot/trippilot`). Everything lives in one git repo, organized by package:

| Directory | Role |
|---|---|
| `docs/` | **Canonical planning docs** in `docs/planning/` — the single source of truth ("정본") for product, architecture, domain, and units. Team conventions in `docs/conventions/`. |
| `backend/` | Backend (Spring Boot + Kotlin modular monolith). Design docs in `backend/docs/design/`; code not yet scaffolded. |
| `frontend/` | Frontend (React Native + Expo). Design/IO docs in `frontend/docs/`; code not yet scaffolded. |
| `ai/` | AI-layer design (itinerary/Plan-B/reflection AI architecture, prompts, solver, testing). Docs only. |
| `aidlc/` | **Teammate-owned AWS AI-DLC (Amazon Q) workspace.** A parallel document-generation flow; `aidlc/docs/PRD/` is the upstream inception artifact that `docs/planning/` was refined from. Don't edit this without coordinating — it's another dev's active run. |

The Figma wireframe exports (164 PNGs, 89 screens across bands a–h) are **kept outside the repo**. The per-screen UI Input/Output catalog for those screens is tracked at `frontend/docs/와이어프레임-화면-IO정리.md`.

**When docs conflict, `docs/planning/` wins** — it is the refined superset of `aidlc/docs/PRD/` (adds M18, cross-cutting C1–C3, ADR-0018–0021, and the D/Δ/N traceability registers).

## Where the authority lives

Design docs explicitly mark one file as "정본" (canonical) for each topic. Read the canonical doc before changing behavior it owns:

- Product/scope/personas/scenarios: `docs/planning/{overview,scope,personas,scenarios,epics,user-stories}.md`
- Architecture, module boundaries, dependency matrix: `docs/planning/architecture.md`
- Domain model & state machines: `docs/planning/domain.md` (Trip / Itinerary / Visit state machines)
- Decisions/ADRs (referenced everywhere as `ADR-####`, `D##`, `AD-#`): `docs/planning/decisions.md`
- Non-functional requirements (perf, security, PBT gates): `docs/planning/nfr.md`
- Unit breakdown & build order U1–U11: `docs/planning/units.md` + `docs/planning/units/`
- Glossary (domain terms + traceability code prefixes M/C/D/Δ/N/P/BR/G/US/E/U/S): `docs/planning/glossary.md`
- Backend build order: `backend/docs/design/TripPilot-백엔드-우선순위-로드맵.md`; DB/API/schema under `backend/docs/design/` (`openapi.yaml`, `sql/V1.*.sql`, `*-스키마-설계.md`)
- AI architecture & rules: `ai/README.md` (3-minute onboarding) → `ai-architecture.md` (WHY) → `ai-implementation-design.md` (HOW) → `ai-prompt-design.md`, `ai-testing-guide.md`, `ai-adr.md`

Per-unit design docs (`docs/planning/units/u1..u8`, backend `U1-*`) own the detailed business rules and REST specs; the architecture doc only owns boundaries. Follow the pointer chain rather than guessing.

## Architecture in one screen

**Backend — modular monolith**, single deployable, Spring Boot 3.4 / Kotlin 2.1 / JDK 21, PostgreSQL 16. Feature modules `M1`–`M18` + cross-cutting `C1` (LLM Gateway), `C2` (Solver), `C3` (Moderation), plus `M7` (Place Data). Layering per module is `api / application / domain / infra`; **other modules may depend only on a module's `api`** (facade interfaces, DTOs, events). Cross-module communication is synchronous public facades OR async domain events via a transactional outbox (at-least-once, idempotent subscribers). No cyclic sync dependencies. External APIs (Kakao, Kakao Mobility, KMA weather, TourAPI, LLM, FCM) are isolated behind `{Capability}Port` interfaces with `{Vendor}Adapter` implementations — "one external API = one owning module = one adapter port." Architecture rules are enforced by Konsist/ArchUnit + Gradle dependency constraints (violations fail the build).

**AI layer — hybrid multi-agent + solver.** Natural-language input goes through an INTENT router → specialized workers (SCHEDULE / PLAN_B / REFLECT / EDIT). `C1 LLM Gateway` handles interpretation/preference-scoring/explanation (judgment). `C2 Solver Engine` (Python; OPTW/TOPTW optimization) owns feasibility — times, order, travel estimates, hard constraints — with deterministic fallback.

**Four AI invariants (violating any = redesign, per `ai/README.md`):**
- **INV-1** LLM selects only from the closed-set candidate pool (web-sourced POIs must pass the collection gate and be registered into M7 first — never candidate raw web results).
- **INV-2** User-visible times/order come only from solver-verified values (routers/workers only *propose*).
- **INV-3** Duration is never displayed — distance only. (No `duration` field in DTOs.)
- **INV-4** On AI failure, fall back deterministically. Silent failure is forbidden.

**Client:** React Native + Expo (TypeScript strict). Consumes only server public REST APIs; business-rule authority always lives on the server (client validation is a UX-only copy).

## Build & test (intended stack — not yet wired)

No `build.gradle`, `package.json`, or wrappers exist yet. When scaffolding, target what the docs mandate:

- **Backend (`backend/`):** Gradle 8.x (Kotlin DSL, multi-module). App assembly lives only in the `app` module; migrations are Flyway **SQL-first, forward-only** (schema canon = U1 Flyway migrations). Tests: Kotest + **kotest-property** (property-based testing is a *blocking* gate — `PBT-01..10`), MockK, Testcontainers, ArchUnit/Konsist. Expected commands once scaffolded: `./gradlew build`, `./gradlew test`, single test via `./gradlew test --tests "<FQCN>"` or `--tests "<Class.method>"`.
- **Frontend (`frontend/`):** Expo (development build + prebuild).
- **AI/Solver (`ai/`):** Python service (C1 + C2).
- **CI gates that must pass before merge (`ai/` checklist):** C2 hard-constraint PBT at 100%, closed-set gate PBT at 100%, and **all external APIs (LLM, distance/maps) faked in CI — zero real API calls** (D37).

Security/resilience baselines (`SECURITY-01..15`, `RESILIENCY-*`) and PBT are described as blocking across all phases — treat them as scaffolding to install in "Phase 0 walking skeleton," not afterthoughts. Legal/consent-log and location-legal-log tables are **append-only** (enforced at the DB permission level; the app role has no DELETE).

## Working conventions

- **Language:** the team works in Korean. Design docs, commit history, and PR discussion are Korean; match that register in docs/comments unless the surrounding code is English.
- **Traceability:** requirements, decisions, and modules are referenced by stable codes (`M8`, `C2`, `ADR-0008`, `D11`, `AD-2`, `US-E5-11`, `BR-U1-01`, `G182`). Preserve these codes when editing docs; they are the cross-document link graph. The glossary decodes the prefixes.
- **AI-DLC workflow:** `aidlc/CLAUDE.md` defines an AWS AI-DLC staged workflow (Inception → Construction → Operations) with mandatory approval gates and an append-only `audit.md`. It claims to override built-in dev workflows. This governs the *AWS Amazon Q / AI-DLC document-generation process* (teammate-owned), not ordinary code edits — be aware it exists, but don't run its ceremony for routine coding unless the user is explicitly driving the AI-DLC flow.
- **MVP scope narrowing:** the current MVP is social login only (Google/Kakao/Naver/Apple); email signup/verification/password login is deferred. Follow-up modules M15 (Community), M16 (Assistant), M17 (Collab) are out of first-cut code generation.
