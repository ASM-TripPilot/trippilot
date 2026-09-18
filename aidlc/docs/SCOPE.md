# 실행 범위 (SCOPE) — 이번 AIDLC 실행의 경계

> **최초 결정: 2026-07-11 · 범위 개정: 2026-07-17(사용자 명시 지시)** · 이 문서는 이번 TripPilot AIDLC 실행의 범위 정본이다. 워크플로우는 매 실행/재개 시 이 문서를 먼저 읽고 경계를 준수한다.

## ✅ 현행 범위 — CONSTRUCTION **설계 문서 단계만** (2026-07-17 개정)

사용자 명시 지시로 CONSTRUCTION에 진입하되, **유닛별 설계 문서 작성까지만** 수행한다:

- 수행: 유닛별 **Functional Design → NFR Requirements → NFR Design → Infrastructure Design** (승인 게이트 포함)
- **제외: Code Generation · Build and Test** — 코드 구현은 AI-DLC 밖에서 팀이 각 패키지 디렉토리(모노레포 루트 `backend/`·`frontend/`·`ai/`)에서 직접 수행한다. AI-DLC 산출물은 설계 문서로 종료.
- 첫 대상 유닛: **U0 Foundation**(워킹 스켈레톤·인증·온보딩·보안/PBT 스캐폴딩). 이후 유닛은 유닛 완료 시점에 사용자가 지시.
- 기획 참조: `aidlc-docs/inception/` 산출물 기준. (`aidlc-docs/planning/`은 2026-07-17 사용자 지시로 저장소에서 제거 — 참조 금지)

## ✅ 완료 범위 — INCEPTION (2026-07-13 종료)

이번 실행은 **INCEPTION 단계 완료까지**가 목표다. 그린필드(신규) 프로젝트이므로 아래 순서로 진행한다:

```
Workspace Detection
  → Requirements Analysis (Comprehensive)
  → User Stories
  → Workflow Planning
  → Application Design
  → Units Generation
  ────────────────────────  ✋ 여기까지 = INCEPTION 종료. STOP.
```

Units Generation 승인 완료 시점에 **전체 Inception 산출물 요약**을 제시하고 멈춘다.

## ⛔ 범위 제외 (현행)

다음에는 **자동으로 진입하지 않는다**. 진입하려면 사용자의 명시적 별도 지시가 필요하다.

- **Code Generation · Build and Test** (전 유닛 공통 — 코드는 팀이 각 패키지 디렉토리에서 직접 개발)
- OPERATIONS
- U0 이외 유닛의 설계 문서 착수 (유닛별로 사용자 지시 필요)

## 처리 규칙

1. 각 설계 단계는 승인 게이트에서 **멈추고** 사용자 확인을 기다린다(워크플로 규칙 그대로).
2. 유닛의 Infrastructure Design 승인 후 **Code Generation으로 넘어가지 말고 STOP** — 설계 문서 요약을 제시하고 팀 개발로 핸드오프한다.
3. 이 범위를 변경하려면 사용자가 이 파일을 직접 수정하거나 명시적으로 범위 변경을 지시해야 한다.

## 입력 정본 (참고)

| 입력 | 역할 |
|---|---|
| `docs/PRD/` (16개 문서) | 기능 정본 — 동작·수용 기준·규칙 |
| `docs/design/wireframes.md` | UI/UX 정본 — Figma 와이어프레임 매니페스트 (fileKey `1MTF3dtptIrbg8gld5IdO2`) |

요구사항 분석 깊이: **Comprehensive**.
