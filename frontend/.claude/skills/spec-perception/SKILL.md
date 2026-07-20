---
name: spec-perception
description: "TripPilot 정본 문서·Figma 인지 규칙. 요구사항 확인, 설계 근거 탐색, 화면 스펙/IO 확인, Figma 디자인 참조가 필요한 모든 작업에서 사용하라. '요구사항 찾아', '정본 확인', '화면 스펙 봐', 'Figma 확인해' 요청 포함. 문서를 읽지 않고 요구사항을 추측하려는 순간이 바로 이 스킬을 쓸 시점이다."
---

# Spec Perception — 인지 규칙

## 문서 참조 맵 (무엇을 어디서)

| 주제 | 정본 위치 |
|---|---|
| 제품 요구사항 | `aidlc/aidlc-docs/inception/requirements/requirements.md` |
| 유저 스토리(119)·페르소나 | `aidlc/aidlc-docs/inception/user-stories/{stories,personas}.md` |
| 컴포넌트 C1–C17·메서드·서비스 S1–S6·의존 | `aidlc/aidlc-docs/inception/application-design/{components,component-methods,services,component-dependency,application-design}.md` |
| 유닛 분해 U0–U9·빌드 순서·스토리 맵 | `aidlc/aidlc-docs/inception/application-design/unit-of-work{,-dependency,-story-map}.md` |
| 유닛별 construction 설계(해당 유닛 작업 시 최신 정본) | `aidlc/aidlc-docs/construction/{unit}/` (예: `u0-foundation/` — functional-design·nfr-requirements 등) |
| 프론트 아키텍처(스택·구조·경계·테스트) | `frontend/README.md` |
| 화면 (레이아웃·IO·컴포넌트) | **라이브 Figma가 유일한 정본** — 밴드 맵은 [reference/figma-structure.md](reference/figma-structure.md) |
| 서버 API 계약 | `backend/docs/design/openapi.yaml` |
| AI 레이어 규칙 | `ai/README.md`(온보딩) → 상세: `ai/aidlc-docs/inception/design-artifacts/{ai-architecture, ai-implementation-design, ai-prompt-design, ai-testing-guide, ai-adr}.md` |

## 접근 규칙

- `aidlc/aidlc-docs`는 전체 읽기 참고 가능. 기획(요구사항·스토리·유닛) 충돌 시 `inception/`이 정본, 패키지 아키텍처·구현 결정은 해당 패키지 정본(`frontend/README.md` 등)이 우선한다. **`planning/`은 2026-07-17 제거됨 — 참조 금지.**
- `aidlc/` 이하 **쓰기 금지**(팀원 소유 도구 상태 포함). 읽기만 한다.
- atlassian MCP는 사용하지 않는다 — 티켓 정보는 사용자가 제공한다.
- 요구사항 인용 시 추적 코드(US-* / ADR-#### / INV-* / C1–C17 / U0–U9 / S1–S6)를 반드시 병기한다 — 코드가 문서 간 링크 그래프이며, 코드 없는 인용은 검증 불가능하다. 패키지 문서에 남은 레거시 코드(M##·D##·Δ#·N#·G### 등)는 제거된 planning 체계라 해독 불가 — 역사적 참고로만 취급한다.

## Figma (화면의 라이브 정본)

- **Figma가 화면의 유일한 정본이다.** 리포에는 화면 명세 사본을 두지 않는다 — 사본은 반드시 낡고, 낡은 사본은 라이브와 조용히 갈라진다.
- **파일 키·밴드 맵·읽는 절차는 [reference/figma-structure.md](reference/figma-structure.md)에 있다.** UI 작업 시 [인지]에서 그 파일로 대상 밴드를 정하고, 화면 상세는 라이브로 읽는다.
- **드리프트 감지**: 라이브 밴드 구성이 밴드 맵과 어긋나면 브리프에 `문서-라이브 드리프트: {요지}`를 **명시만** 한다. **[인지]는 밴드 맵을 고치지 않는다** — 하네스 파일 수정은 [기록]에서 scribe가 하고, 사이클 도중 `.claude/` 변경은 변경 집합을 오염시켜 qa-verifier의 미신고 변경 검사에 걸린다.
- **접근 실패 시 폴백 없음**: 화면 명세의 리포 사본이 없으므로 Figma MCP 실패는 곧 근거 부재다. 추측으로 메우지 말고 브리프에 "Figma 접근 실패 — 화면 근거 없음"을 명시하고 **열린 질문으로 올린다**. 와이어프레임 PNG도 리포 외부라 대체 시각 소스는 없다.

## AI 불변식 (위반 = 재설계)

- INV-1: LLM은 폐집합 후보 풀에서만 선택
- INV-2: 사용자에게 보이는 시간·순서는 솔버 검증값만
- INV-3: duration 표시 금지 — 거리만 (DTO에 duration 필드 자체가 없어야 함)
- INV-4: AI 실패 시 결정론 폴백, 침묵 실패 금지
