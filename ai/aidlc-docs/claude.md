# aidlc-docs — AI-DLC Workflow Artifacts

> Korean version: ./claude.ko.md

This directory holds **all document artifacts** of the AI-DLC (AI-Driven Development Life Cycle) process.
Never put application code in this folder.

## Structure

- `aidlc-state.md` — current workflow progress state (read this first when resuming a session)
- `audit.md` — audit log of all interactions
- `inception/` — INCEPTION Phase artifacts (design · requirements · plans)
- `construction/` — CONSTRUCTION Phase artifacts (per-unit detailed design · code summaries)
- `operations/` — OPERATIONS Phase (placeholder)

## Rules

- Before creating a new file, check the current stage in `aidlc-state.md`
- Record every change in `audit.md` with a timestamp
- Do not proceed to the next stage without per-stage approval
