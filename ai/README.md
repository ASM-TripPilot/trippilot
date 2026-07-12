# TripPilot — AI 설계 저장소

TripPilot의 **AI 담당 설계 저장소**다. 일정 생성·Plan-B·회고 기능의 AI 아키텍처, 구현 설계, 프롬프트, 테스트 전략을 소유한다.

> 제품 기획 정본은 `../TripPilot/docs/planning/`에 있다. 본 저장소는 그 중 AI 관련 결정을 **AI 개발 관점으로 재구성**하며, 정본을 중복 정의하지 않는다.

---

## 문서 지도

| 문서 | 성격 | 읽어야 할 때 |
|---|---|---|
| [ai-architecture.md](./ai-architecture.md) | 전략·아키텍처 (WHAT/WHY) | AI가 왜 이렇게 설계됐는지 이해할 때 |
| [ai-implementation-design.md](./ai-implementation-design.md) | 구현 설계 (HOW) | 실제 코드 구조·인터페이스·알고리즘 설계할 때 |
| [ai-data-design.md](./ai-data-design.md) | 데이터 설계 (M7) | POI 스키마·closed-set 후보 풀·소싱·캐싱 설계할 때 |
| [ai-prompt-design.md](./ai-prompt-design.md) | 프롬프트 설계 | feature별 프롬프트·OutputSchema·검증 규칙 작성할 때 |
| [ai-testing-guide.md](./ai-testing-guide.md) | 테스트 가이드 | PBT 속성 구현·CI 설정·oracle 테스트 작성할 때 |
| [ai-adr.md](./ai-adr.md) | 결정 기록 (ADR) | 아키텍처 결정 근거·이력(AI-D01~03 등)을 볼 때 |

---

## 핵심 요약 (3분 온보딩)

### TripPilot AI = 멀티 에이전트 + 솔버 하이브리드

```
자연어 입력                    버튼 직행
      |                           |
      v                           |
+------------------+              |
|  INTENT 라우터   |              |
|  (의도 분류)     |              |
+------------------+              |
      |                           |
      | 의도별 워커 디스패치       |
      v                           |
+----------+  +--------+  +-------+-------+
| SCHEDULE |  | PLAN_B |  | REFLECT| EDIT |
|  워커    |  |  워커  |  |  워커  | 워커 |
+----------+  +--------+  +--------+------+
      |              |          |       |
      | LLM 선호 점수 |          |       |
      v              v          v       v
+----------------------------------------------------------+
|              C1 LLM Gateway  (판단·해석)                 |
|         closed-set 후보 풀 안에서만 선택                 |
+----------------------------------------------------------+
      |                                    ^
      | LLM 선호 점수 (소프트 신호)          | M7 후보 풀
      v                                    |
+----------------------------------------------------------+
|              C2 Solver Engine                            |
|  +--------------------+  +---------------------------+  |
|  | ML 선호 점수 (LTR)  |  | ML 체류시간 예측 (회귀) |  |
|  | 폴백: 규칙 점수    |  | 폴백: 정적 테이블  |  |
|  +--------------------+  +---------------------------+  |
|              |                        |                  |
|              v                        v                  |
|  +--------------------------------------------------+   |
|  |   OPTW/TOPTW 최적화 + HC1~HC4 하드 제약 검증   |   |
|  +--------------------------------------------------+   |
+----------------------------------------------------------+
      |                                    ^
      | 검증된 시각·순서·거리              | 후보 부족 시 백그라운드 보강
      v                                    |
사용자에게 보이는 일정        +------------------------+
                              |  M7 Place Data         |
                              |  Places API            |
                              |  -> 자유 웹 워커       |
                              |  -> 수집 게이트        |
                              |  -> M7 등록(BG)        |
                              +------------------------+
```

**C1 LLM Gateway** — 취향 해석·선호 점수·설명 생성. 판단 담당. 자연어 진입(AI 도우미)에선 **의도 라우터(INTENT) + 특화 워커** 2단 구조로 동작(AI-D02). 후속에 Python 서비스로 분리 가능(D11).

**C2 Solver Engine** — OPTW/TOPTW 최적화·하드 제약 검증·이동 추정. 사실 담당. **Python** (C1과 함께 독립 AI 서비스). ※ D11 원안은 C2=Kotlin, AI 전면 Python 결정으로 분기(ai-adr.md AI-D01).

**M7 후보 소싱** — DB 부족 시 Places API 우선→자유 웹 워커로 보강, 수집 게이트(강한 검증) 통과 후 M7 등록(백그라운드). 웹 원본 직접 후보화 금지(AI-D03).

### 4대 불변식 (어기면 재설계)

| # | 불변식 | 위반 예시 |
|---|---|---|
| INV-1 | LLM은 closed-set 후보 안에서만 선택 (웹 소싱도 게이트 경유 M7 등록 후) | LLM이 후보 밖 POI ID 반환 / 웹 원본 직접 후보화 |
| INV-2 | 사용자가 보는 시각·순서는 솔버 검증값만 (라우터·워커는 제안만) | 라우터가 시각을 직접 확정 |
| INV-3 | 소요시간 미표시 — 거리만 | DTO에 `duration` 필드 추가 |
| INV-4 | AI 실패 시 결정론 폴백 (라우터·워커 실패 포함) | LLM 타임아웃 시 빈 응답 반환 |

### 1차 범위

| 기능 | 유닛 | 모듈 | 상태 |
|---|---|---|---|
| 일정 생성 | U5 | M8 | 1차 출시 |
| Plan-B 재계획 | U6 | M9·M10·M11 | 1차 출시 |
| 회고·스타일 분석 | U7 | M13 | 1차 출시 |
| AI 도우미(자연어 라우터+워커) | — | M16 | 1차 출시 (AI-D02) |

---

## 파일 간 관계

```
ai-architecture.md          <- 전략 정본. 여기서 WHY를 결정
        |
        | 구현 방향 제공
        v
ai-implementation-design.md <- HOW 정의. 인터페이스·알고리즘·폴백 계단
        |
        +--------> ai-prompt-design.md   <- C1 feature별 프롬프트·스키마
        |
        +--------> ai-testing-guide.md   <- PBT 속성 구현·CI 설정
```

---

## 개발 시작 전 확인사항

### 착수 시 확정 필요한 항목

| # | 항목 | 담당 문서 |
|---|---|---|
| 1 | LLM 벤더·모델 (경량/상위 실체) | ai-implementation-design.md §3.1 |
| 2 | 솔버 알고리즘 라이브러리 선정 | ai-implementation-design.md §4.3 |
| 3 | ItineraryProblem/Solution 내부 스키마 | ai-implementation-design.md §4.1 |
| 4 | feature별 프롬프트·OutputSchema 실체 | ai-prompt-design.md §2 |
| 5 | 이동·트리거 파라미터 초기값 캘리브레이션 | ai-architecture.md §5.3 |
| 6 | 라우터 의도·편집 op 목록 + 파괴적 편집 분류 기준 | ai-implementation-design.md §3.4 |
| 7 | Places API 벤더 + 자유 웹 추출 검증 규칙 | ai-implementation-design.md §2.1 |
| 8 | 엔티티 해소 fuzzy match 임계(자동확정·확인 컷) | ai-implementation-design.md §3.4 |
| 9 | ML 학습 데이터 로깅 스키마(선호 피드백·실제 체류) | ai-adr.md AI-D05 |

### PR 머지 전 필수 통과

- [ ] C2 하드 제약 4종 PBT 100% (G114)
- [ ] closed-set 게이트 PBT 100%
- [ ] LLM·거리 API fake 사용 확인 (실 API 호출 0)
- 전체 체크리스트 → [ai-testing-guide.md §7](./ai-testing-guide.md)

---

## 정본 참조 (TripPilot 기획)

| 문서 | AI 관련 내용 |
|---|---|
| `decisions.md` | ADR-0008·0009·0011·0015, D11·D25·D27·D31·D37·D38 근거 전문 |
| `architecture.md` | 모듈 경계·의존 매트릭스·포트 격리 |
| `nfr.md` | 성능(§1.1)·LLM 경계(§3.5)·PBT(§7) 기준 |

---

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-07-07 | 초기 작성 (ai-architecture.md, ai-implementation-design.md) |
| 2026-07-07 | G106 이동 지연 트리거 오류 정정 (15분→30분, 6개 문서) |
| 2026-07-08 | ai-prompt-design.md, ai-testing-guide.md 추가. ai-implementation-design.md §4.1·§4.3 구체화. ai-architecture.md §10 M16 설계 여지 추가. README 재편 |
| 2026-07-07 | **멀티 에이전트 오케스트레이션 도입(AI-D02)** — 자연어 진입 라우터(INTENT)+특화 워커, AI 도우미(M16) 1차 승격, 하이브리드 반영(경미=자동/파괴적=확인). INV-2·INV-4 강화. 6개 문서 반영 |
| 2026-07-08 | **웹서치 후보 소싱(AI-D03)** — 계층형(Places API→자유 웹 워커 PlaceExtraction)+수집 게이트(강한 검증)+백그라운드 보강. INV-1에 소싱 게이트 명문화. 7개 문서 반영 |
| 2026-07-08 | **입력 정규화·엔티티 해소(AI-D04)** — 별도 교정 agent 없이 라우터 LLM이 오타 흡수 + 지역·POI명 결정론 fuzzy match(애매하면 확인, 미해소는 웹 소싱). 7개 문서 반영 |
| 2026-07-08 | **ML 도입 전략(AI-D05)** — soft 신호만 ML(하드 제약은 솔버 결정론). 후보 ①선호점수(추천/LTR) ②체류시간(회귀). 규칙 폴백 유지(INV-4), 1차는 로깅 부트스트랩. 5개 문서 반영 |
