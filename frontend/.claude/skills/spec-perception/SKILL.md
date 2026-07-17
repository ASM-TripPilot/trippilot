---
name: spec-perception
description: "TripPilot 정본 문서·Figma 인지 규칙. 요구사항 확인, 설계 근거 탐색, 화면 스펙/IO 확인, Figma 디자인 참조가 필요한 모든 작업에서 사용하라. '요구사항 찾아', '정본 확인', '화면 스펙 봐', 'Figma 확인해' 요청 포함. 문서를 읽지 않고 요구사항을 추측하려는 순간이 바로 이 스킬을 쓸 시점이다."
---

# Spec Perception — 인지 규칙

## 문서 참조 맵 (무엇을 어디서)

| 주제 | 정본 위치 |
|---|---|
| 제품/범위/페르소나/시나리오 | `aidlc/aidlc-docs/planning/{overview,scope,personas,scenarios,epics,user-stories}.md` |
| 아키텍처·모듈 경계·의존 매트릭스 | `aidlc/aidlc-docs/planning/architecture.md` |
| 도메인 모델·상태 머신 | `aidlc/aidlc-docs/planning/domain.md` |
| 결정(ADR-####/D##/AD-#) | `aidlc/aidlc-docs/planning/decisions.md` |
| NFR·PBT 게이트 | `aidlc/aidlc-docs/planning/nfr.md` |
| 유닛 분해 U1~U11·빌드 순서 | `aidlc/aidlc-docs/planning/units.md` + `units/` |
| 용어·추적 코드 해독 | `aidlc/aidlc-docs/planning/glossary.md` |
| 화면 IO 카탈로그 | `frontend/docs/와이어프레임-화면-IO정리.md` |
| 서버 API 계약 | `backend/docs/design/openapi.yaml` |
| AI 레이어 규칙 | `ai/README.md`(온보딩) → 상세: `ai/aidlc-docs/inception/design-artifacts/{ai-architecture, ai-implementation-design, ai-prompt-design, ai-testing-guide, ai-adr}.md` |

## 접근 규칙

- `aidlc/aidlc-docs`는 전체 읽기 참고 가능. 문서 충돌 시 `planning/`이 정본이다.
- `aidlc/` 이하 **쓰기 금지**(팀원 소유 도구 상태 포함). 읽기만 한다.
- atlassian MCP는 사용하지 않는다 — 티켓 정보는 사용자가 제공한다.
- 요구사항 인용 시 추적 코드(BR/US/G/ADR/INV/M/C/D/Δ/N/P/E/U/S)를 반드시 병기한다 — 코드가 문서 간 링크 그래프이며, 코드 없는 인용은 검증 불가능하다.

## Figma

- UI 작업 시 `mcp__figma__get_design_context` / `get_screenshot`으로 대상 화면을 확인한다.
- 접근 실패 시 IO 카탈로그로 폴백하고 폴백 사실을 산출물에 명시한다.
- 와이어프레임 PNG는 리포 외부에 있다 — Figma가 유일한 시각 소스다.

## AI 불변식 (위반 = 재설계)

- INV-1: LLM은 폐집합 후보 풀에서만 선택
- INV-2: 사용자에게 보이는 시간·순서는 솔버 검증값만
- INV-3: duration 표시 금지 — 거리만 (DTO에 duration 필드 자체가 없어야 함)
- INV-4: AI 실패 시 결정론 폴백, 침묵 실패 금지
