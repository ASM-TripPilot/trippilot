# 실행 범위 (SCOPE) — 이번 AIDLC 실행의 경계

> **최종 결정: 2026-07-11** · 이 문서는 이번 TripPilot AIDLC 실행의 범위 정본이다. 워크플로우는 매 실행/재개 시 이 문서를 먼저 읽고 경계를 준수한다.

## ✅ 이번 범위 — INCEPTION 단계까지만

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

## ⛔ 이번 범위 제외 — CONSTRUCTION 이후

다음 단계에는 **자동으로 진입하지 않는다**. 진입하려면 사용자의 명시적 별도 지시가 필요하다.

- CONSTRUCTION 전체 (유닛별 Functional Design · NFR Requirements · NFR Design · Infrastructure Design · Code Generation)
- Build and Test
- OPERATIONS

## 처리 규칙

1. Inception 마지막 단계(Units Generation) 승인 후, **다음 단계로 넘어가지 말고 멈춰** 사용자 지시를 기다린다.
2. "추가 인셉션을 더 할지 여부"는 **추후 결정 사항**이다 — 임의로 심화/재작성하지 말고 사용자에게 물어본다.
3. 이 범위를 변경하려면 사용자가 이 파일을 직접 수정하거나 명시적으로 범위 변경을 지시해야 한다.

## 입력 정본 (참고)

| 입력 | 역할 |
|---|---|
| `docs/PRD/` (16개 문서) | 기능 정본 — 동작·수용 기준·규칙 |
| `docs/design/wireframes.md` | UI/UX 정본 — Figma 와이어프레임 매니페스트 (fileKey `1MTF3dtptIrbg8gld5IdO2`) |

요구사항 분석 깊이: **Comprehensive**.
