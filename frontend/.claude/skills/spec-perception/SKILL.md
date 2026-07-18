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
| 화면 IO 카탈로그 | `frontend/docs/와이어프레임-화면-IO정리.md` |
| 서버 API 계약 | `backend/docs/design/openapi.yaml` |
| AI 레이어 규칙 | `ai/README.md`(온보딩) → 상세: `ai/aidlc-docs/inception/design-artifacts/{ai-architecture, ai-implementation-design, ai-prompt-design, ai-testing-guide, ai-adr}.md` |

## 접근 규칙

- `aidlc/aidlc-docs`는 전체 읽기 참고 가능. 기획(요구사항·스토리·유닛) 충돌 시 `inception/`이 정본, 패키지 아키텍처·구현 결정은 해당 패키지 정본(`frontend/README.md` 등)이 우선한다. **`planning/`은 2026-07-17 제거됨 — 참조 금지.**
- `aidlc/` 이하 **쓰기 금지**(팀원 소유 도구 상태 포함). 읽기만 한다.
- atlassian MCP는 사용하지 않는다 — 티켓 정보는 사용자가 제공한다.
- 요구사항 인용 시 추적 코드(US-* / ADR-#### / INV-* / C1–C17 / U0–U9 / S1–S6)를 반드시 병기한다 — 코드가 문서 간 링크 그래프이며, 코드 없는 인용은 검증 불가능하다. 패키지 문서에 남은 레거시 코드(M##·D##·Δ#·N#·G### 등)는 제거된 planning 체계라 해독 불가 — 역사적 참고로만 취급한다.

## Figma (화면의 라이브 정본)

- **Figma가 화면의 살아있는 정본이다.** IO 카탈로그(`frontend/docs/와이어프레임-화면-IO정리.md`)·CLAUDE.md의 화면 수는 **특정 시점 스냅샷**일 뿐 — 낡을 수 있으니 신뢰 기준은 항상 라이브다.
- 파일 키: **`1MTF3dtptIrbg8gld5IdO2`** (단일 페이지 "화면" = 노드 `1228:1045`). URL 없이 이 키로 바로 읽는다 — 사용자에게 URL을 매번 묻지 않는다.
- UI 작업 시 [인지]에서 **대상 밴드·화면을 라이브로 읽는다**: `get_metadata(fileKey[, nodeId])`로 밴드/프레임 목록 → `get_design_context`/`get_screenshot`으로 대상 화면 디자인·스크린샷. 화면은 밴드 코드로 명명 — **a**홈 **b**AI어시스턴트 **c**온보딩·인증(U0) **d**탐색 **e**숙소 **g**여행생성 **h**일정생성 **i**여행중·PlanB **j**기록 **k**커뮤니티(M15) **l**알림·마이·설정 **m**공동편집(M17). **k·m은 first-cut 범위 밖.**
- **드리프트 감지**: 라이브 화면 수·밴드가 문서(카탈로그·CLAUDE.md)와 어긋나면 브리프에 "문서-라이브 드리프트: {요지}"를 명시한다. (2026-07-18 기준 라이브 115 코드/169 변형·a–m — CLAUDE.md "89화면"은 낡음.)
- **카탈로그 밴드 글자 ≠ 라이브 글자 (재배치됨)**: 카탈로그는 구 라벨(A온보딩·B숙소·C여행생성·D일정·E여행중·F기록·G설정·H홈), 라이브는 위 a–m. **글자로 Figma를 찾지 말고 도메인으로 매칭**하라(오도 방지). b(어시스턴트)·k(커뮤니티)·m(공동편집)은 카탈로그에 없음. (매핑표는 카탈로그 상단 헤더에 있음.)
- **점진 최신화**: 어떤 밴드를 작업하면 그 도메인 화면을 라이브로 읽어 IO를 새로 뽑고, [기록]에서 카탈로그의 **해당 도메인 절만** 그 최신 IO로 갱신한다(작업한 밴드만 — 전면 재작성 금지, 헤더 스냅샷 갱신일도 함께). 카탈로그는 그렇게 점진적으로 라이브에 수렴한다.
- get_metadata로 페이지 전체를 뜨면 토큰 초과(1MB)할 수 있다 — 대상 노드로 좁히거나 목록은 최상위 프레임(2칸 들여쓰기)만 추출한다.
- 접근 실패 시 IO 카탈로그로 폴백하고 폴백 사실을 산출물에 명시한다. 와이어프레임 PNG는 리포 외부 — Figma가 유일한 시각 소스다.

## AI 불변식 (위반 = 재설계)

- INV-1: LLM은 폐집합 후보 풀에서만 선택
- INV-2: 사용자에게 보이는 시간·순서는 솔버 검증값만
- INV-3: duration 표시 금지 — 거리만 (DTO에 duration 필드 자체가 없어야 함)
- INV-4: AI 실패 시 결정론 폴백, 침묵 실패 금지
