# 유닛 U5 상세 설계 — AI 일정 생성·확정

> 출처: aidlc-docs/construction/u5-itinerary/functional-design/{domain-entities,business-rules,business-logic-model,frontend-components}.md · nfr-requirements/{nfr-requirements,tech-stack-decisions}.md · nfr-design/nfr-design-patterns.md · infrastructure-design/infrastructure-design.md · construction/plans/u5-itinerary-{functional-design,nfr-design}-plan.md · inception/application-design/unit-of-work.md(U5 총괄) · aidlc-docs에서 2026-07-05 추출 · 이후 본 문서가 정본이다.

U5는 TripPilot의 **심장**이다 — LLM 점수화(C1)와 솔버 배치(C2)를 결합한 하이브리드 AI 일정 생성부터 편집·재검증·확정까지를 소유한다. 알고리즘 복잡도가 1차 유닛 중 최대이고, C1·C2는 U6(재계획)·U7(회고)·U9(어시스턴트)·U11(재검증)이 재사용하는 공통 자산이므로 이 유닛에서 프로덕션 품질로 완성한다. 이 문서 하나로 U5의 도메인 모델·비즈니스 규칙·처리 흐름·화면·NFR·인프라를 완전히 이해할 수 있도록 원본 설계 내용을 빠짐없이 재구성했다.

관련 크로스커팅 문서: [아키텍처](../architecture.md) · [도메인 모델](../domain.md) · [주요 흐름](../flows.md) · [핵심 결정/ADR](../decisions.md) · [NFR 기준](../nfr.md) · [인프라](../infrastructure.md) · [개발 순서](../units.md) · [용어집](../glossary.md) · [에픽](../epics.md) · [유저스토리](../user-stories.md). 인접 유닛: [U4 여행 컨텍스트](./u4-trip.md)(입력 공급) · [U6 실행 허브](./u6-execution.md)(출력 소비) · [U3 장소·숙소](./u3-place-stay.md)(후보 풀·지도 재사용).

---

## 1. 개요

### 1.1 범위와 목적

**목적**: "생성 3방식 → 점진 노출(첫 1일 5초 / 전체 20초) → 편집·재검증 → 확정(plan 동결)"의 전 여정을 완성한다. 사용자가 등록한 숙소·필수 방문지·취향을 입력으로, AI가 실행 가능한(현장에서 지각 없는) 일정을 만들고 사용자가 다듬어 잠그는 것이 U5의 가치다.

| 항목 | 내용 |
|---|---|
| 에픽·스토리 | Epic 5 — US-E5-01~12 (12개) |
| 서버 모듈 | **M8 Itinerary Generation**(오케스트레이션·일정 상태 머신·plan/current), **C1 LLM Gateway**(취향 점수·설명 관문), **C2 Solver Engine**(하드 제약 검증·최적화 순수 연산) |
| 서버 산출 모듈 경로 | `modules/itinerary`, `common/llm-gateway`, `common/solver` |
| 클라이언트 features | `features/itinerary`(생성·편집·확정), `shared/validation`(경량 제약 검증기, D28) |
| 외부 연동 | LLM 벤더 API(C1), 카카오모빌리티 도로 거리(C2 이동시간 추정 입력, D08) |
| DB 마이그레이션 | 약 6개 테이블(일정 plan/current·상태, 일자, 슬롯, 생성 세션·초안, 추천 이유 메타, LLM 호출 로그) |
| 스케줄러 잡 | 없음 — 백그라운드 생성은 요청 단위 비동기 워커 스레드 |

**명시적 제외**:
- 여행 중 실행 허브·재계획(U6) — U5는 확정본·current 기준선(CP3)을 **공급**하는 데까지.
- 예산의 솔버 하드 제약화 — 예산은 LLM 소프트 가중치 + 숙소 필터 상한(G37/G47)으로만 반영.
- 실 LLM 회귀 평가의 PR CI 편입 — 릴리스 파이프라인 전용(D37).

### 1.2 선행·후행 유닛 (계약 포인트)

U5는 **CP2(U4→U5)의 소비자**이자 **CP3(U5→U6)의 공급자**다.

| 계약 | 방향 | 내용 |
|---|---|---|
| **CP2** | U4 → U5 소비 | 여행 컨텍스트(TripContext = Trip + TripDateWindow[] + BaseAssignment[] + MustVisit[] + 여행 속성)를 SolverProblem 입력으로 소비. 1차 유닛 체인에서 정밀도 최고 계약 — U5가 성패를 좌우받음(§8) |
| **CP3** | U5 → U6 공급 | 일정 기준선(plan/current·고정 블록·확정 상태·slotId 식별 체계)을 U6·U7·U8·U10·U11 5개 유닛이 공유하는 척추로 공급(§9) |
| **CP5** | U5 → 소비자 | `ItineraryConfirmed`·`ItineraryChanged` 이벤트 스키마(U8 리마인드·재계산의 소스) 일부 공급 |

**선결 과제(비개발)**:

| 과제 | 시점 | 차단 대상 / 비차단 대응 |
|---|---|---|
| **P6 LLM 벤더 계약·비용 산정 + 국외 이전 고지 문안**(D11·G181) | U5 착수 전(벤더·티어 확정이 C1 설계 입력) | 비용 상한이 후보 풀 크기·호출 전략을 결정. 설계 산출물은 **벤더 중립**으로 `LlmPort` 추상화·티어 라우팅·전 일자 1회 호출·rate-limit·비용 계측 구조를 확정(비차단). 벤더/모델/단가는 P6 후 remote config·시크릿 주입 |
| P2 지도 API 약관(카카오모빌리티 도로 거리) | U5 착수 전(U3에서 기완료 전제) | C2 `RoadDistancePort` 격리 — 실패 시 직선거리×우회계수(G106) 폴백 |

### 1.3 완료 기준(DoD) 요지

- **기능**: E5 12개 스토리 수용 기준 충족. 성능 목표(D38) — 첫 1일 5초·전체 20초(초과 시 결정론 폴백 고지)·편집 재검증 인라인 즉시.
- **하드 제약(D37) — 본 유닛이 4계열의 본체**: ① 숙소 기준점(모든 일자 동선이 해당 구간 거점 기준), ② 충돌 무배치(시간 중복·영업시간 밖·이동 부등식 위반 배치 0), ③ POI 그라운딩(출력 POI ⊆ 후보 풀 — closed-set), ④ 계정 무결성(타 계정 데이터 미혼입 D31). **테스트 100%가 머지 차단 조건.**
- **PBT 1급 대상(§6.6)**: 임의 후보 풀·시간창·고정 블록 입력에 대해 (a) 영업시간 내 배치, (b) 인접 슬롯 이동시간 부등식, (c) 고정 블록 불변(warm-start 전후 동일), (d) 폴백 모드 결정성(동일 입력→동일 출력), (e) 일정 상태 머신 전이 불변식, (f) plan/current 직렬화 왕복.
- **확장 규칙**: SECURITY-11(LLM 경계)·RESILIENCY-10(LLM 타임아웃·서킷·규칙 점수 폴백)·RESILIENCY-01(LLM 경로 Medium — 폴백으로 지속) 정합 증빙.
- **계약 포인트**: CP2 소비자 측 + CP3 공급자 측 + CP5 공급자 일부 계약 테스트. E2E(숙소 저장→등록→일정 생성)를 U5 완료 시점에 CI 편입.

### 1.4 핵심 리스크와 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| **솔버 실행 불가** — 제약 과잉(시간창 협소·필수 방문지 과다·영업시간 충돌)·후보 부족 지역에서 해 없음 | 핵심 가치 미제공 | (1) 해 없음 감지 → 위반 제약 완화 제안(구조화 응답), (2) 부분해 초안 저장 + 이어서 생성(G161), (3) 결정론 폴백은 "덜 최적이어도 유효한 해" 보장 — 전 경로 침묵 실패 금지 |
| LLM 지연·비용 폭증 | 5초/20초 예산 초과·운영비 | 티어 분리(D11)·후보 풀 상한 프루닝(지역당 5천)·배치 호출, 20초 하드 타임아웃 후 규칙 점수+솔버 폴백, 사용자별 rate-limit, 비용 계측 대시보드 |
| 이동시간 추정 파라미터(G106) 부정확 | 현장 실행 불가 일정·U6 트리거 소음 | 안전계수·버퍼를 remote config로 운영 보정, U6 실측(체류·지연) 데이터를 보정 루프 입력으로 |
| 클라/서버 검증 규칙 불일치(D28) | 편집 통과→저장 거부 UX | 규칙 명세를 단일 소스에서 양쪽 코드 생성/파생, 이중 실행 계약 테스트 |
| closed-set 우회(프롬프트 인젝션) | 그라운딩 오염 | 출력 스키마 검증 + ID 화이트리스트 교차 검증을 C1 출구에서 구조적 강제(G115) — LLM 신뢰 불요 |

### 1.5 설계 결정 목록 (Functional Design 확정분, FD-U5-xx)

| # | 결정 | 요지 | 근거 |
|---|---|---|---|
| FD-U5-01 | plan/current 이원 모델 정본 | Itinerary는 PlanSnapshot(불변 동결본)과 CurrentItinerary(가변본)를 분리 소유 — 확정 시 plan 동결, 여행 중 편집·Plan-B는 current에만 반영. 회고 대조(U7)·공개 스냅샷(U10)이 의존(CP3 척추) | D14, ADR-0013, CP3 |
| FD-U5-02 | 일정 상태 머신 4상태 | `DRAFT → EDITING → CONFIRMED → INTRIP` — 확정↔해제 왕복(D20), CONFIRMED→INTRIP은 여행 ACTIVE 전이(M18) 수용. 표 밖 전이 구조적 불가 | D14, D20, components §3.2 |
| FD-U5-03 | 하드 제약 4종 = C2 단일 소유 | 영업시간·이동 부등식(G106)·고정 블록 불변·시간창(D29)을 C2가 단일 검증, 사용자에게 보이는 모든 시각·순서는 C2 검증값만 — LLM 임의 시각 구조적 미노출 | ADR-0008, D28, D29 |
| FD-U5-04 | POI 그라운딩 closed-set 구조 보장 | LLM은 후보 풀 canonical POI ID에서만 선택 — 출력 스키마 검증+ID 화이트리스트 교차 검증으로 환각 0을 LLM 신뢰 불요로 달성 | G115, D37, SECURITY-11 |
| FD-U5-05 | 예산 소프트 가중치(하드 아님) | 예산은 C1 점수화의 소프트 가중치로만 반영, 예산 초과 배치가 하드 차단되지 않음(단조성만 보장) | G37/G47, INV-BUDGET2(U4) |
| FD-U5-06 | 점진 노출 2단 게이트 | 첫 1일 일자별 독립 TX로 저장·5초 내 우선 반환, 나머지 백그라운드. 세션 상태(COLLECTING→DAY1_READY→GENERATED)가 진행 정본. 20초 초과 시 결정론 단독 | D38, S1.2~S1.4, G161 |
| FD-U5-07 | 폴백 계단 6단 | LLM 실패→규칙 점수 / 설명만 실패→일정 정상+설명 생략 / 외부 API→캐시·직선거리 / 20초→결정론 단독 / 전 경로 실패→최소 일정 / 저장 오류→로컬 임시. 전 경로 침묵 실패 금지 | ADR-0011, RESILIENCY-01/10 |
| FD-U5-08 | 편집 검증 이중화(규칙 단일 정본) | C2가 버전 있는 ConstraintSpec 발행 → 클라 경량 검증기 즉시 검사(사본)·서버 C2 확정 검증(정본). 버전 불일치 시 로컬 검사 보수적 비활성화 | D28, G163 |
| FD-U5-09 | warm-start 고정 블록 보존 | 재생성 시 LOCK·체류 고정·수동 추가·시각 고정 필수 방문지·거점 블록을 고정 블록으로 보존, 나머지만 재배치. 활성 일정 1개·멱등 | G46/G136, CP3 |
| FD-U5-10 | 소요시간 내부전용 캡슐화 | `TravelEstimate.internalDuration`은 솔버 내부 계산 전용 — 어떤 표시 DTO에도 매핑 금지, 표시엔 `distance`만 | D25/Δ1, ADR-0009 |
| FD-U5-11 | 생성 3방식 단일 파이프라인 수렴 | 완전 AI·같이 고르기(G48)·직접 만들기를 단일 파이프라인 변주로 수렴, 도중 전환 시 확정 슬롯 보존. 세 방식 모두 최종 시각·순서는 C2 검증값 | G48, D25, S1.1 |
| FD-U5-12 | C1/C2 계약 인터페이스 수준 정의 | C1·C2는 재사용 자산이므로 계약(입출력 타입·불변식·실패 타입)까지만 정의, 벤더·티어·최적화 알고리즘·remote config 수치는 NFR/Infra 소유. C2는 상태 비보유 순수 계산 엔진 | D11, D37, unit-of-work U5 |

---

## 2. 도메인 엔티티

소유 모듈: M8(일정 상태 머신·plan/current), C1(계약 수준), C2(계약 수준). 표기 규약 — `필수`=NULL 불가, `선택`=NULL 허용, `유니크`=제약 범위 내 유일, `불변`=생성 후 변경 불가, `파생`=저장 안 함(조회 시점 계산).

### 2.0 엔티티 지도

```text
[M8 Itinerary Generation — 일정 상태 머신·plan/current 이원 정본]
Trip 1 ──── 1 Itinerary                 (여행당 활성 일정 ≤1, G46/G136 — DRAFT→EDITING→CONFIRMED→INTRIP)
Itinerary 1 ──── 0..1 PlanSnapshot      (확정 시점 동결 불변본, D14 — CONFIRMED 이후 존재)
Itinerary 1 ──── 1 CurrentItinerary     (가변 현재본 — 편집·Plan-B 반영 대상, D14)
CurrentItinerary 1 ──── * DaySchedule   (일자별 일정 — 적용 거점·시간창 스냅샷)
DaySchedule 1 ──── * ItinerarySlot      (슬롯 — POI·시각·체류·LOCK·sourceType·violations)
DaySchedule 1 ──── * FixedBlock         (고정 블록 — 숙소 체크인/아웃·시각 고정형 필수 방문지, 불가침)
Itinerary 1 ──── * GenerationSession    (생성 세션 — COLLECTING→DAY1_READY→GENERATED→FAILED)
(독립) StayZoneRecommendation           (숙소 나중 등록 온램프 — 동선 무게중심, US-E5-11)

[C2 Solver Engine — 상태 비보유 순수 계산 엔진(계약 수준)]
SolverProblem ──(solve)──▶ SolverSolution   (하드 제약 4종 만족 해·위반 배치 구조적 배제)
TravelEstimate                          (거리 기반 이동 추정 — internalDuration 내부전용 D25)
ConstraintSpec                          (버전 있는 검증 규칙 명세 — 클라 경량 검증기 공유 D28)

[C1 LLM Gateway — 상태 비보유 관문(계약 수준)]
PoiScore                                (LLM 선호 점수 — closed-set 후보 ID에만 부여 G115)

[CP2 입력 — U4 소유] TripContext = Trip + TripDateWindow[] + BaseAssignment[] + MustVisit[] + 여행 속성
[CP3 출력 — U6 소비] Itinerary(plan/current·상태) + DaySchedule[] + ItinerarySlot[](slotId·LOCK·고정 블록·DistanceRange)
```

### 2.1 Itinerary — 일정 (M8, 상태 머신·plan/current 이원 정본)

여행 1건에 대한 AI 일정의 정본 컨테이너이자 상태 머신·plan/current 이원 구조(D14)의 정본 소유자. 여행당 활성 일정은 항상 1개(G46/G136).

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| itineraryId | 식별자 | 필수·유니크·불변 | 일정 정본 키 — DaySchedule·GenerationSession이 참조. U6 실행 허브·U7 기록의 단일 참조 키 |
| tripId | 식별자(Trip 참조) | 필수·유니크 | 귀속 여행(정본 U4 M6). 여행당 활성 일정 ≤1(INV-ITIN1) [G46/G136] |
| mode | 열거 {FULL_AUTO, TOGETHER, MANUAL} | 필수 | 생성 방식(§2.1.5). 도중 전환 시 최종 mode 기록(진행분 보존) [G48] |
| status | 열거 {DRAFT, EDITING, CONFIRMED, INTRIP} | 필수·기본 DRAFT | 생애 상태. 전이 트리거는 사용자 액션·타 유닛 이벤트(INTRIP=M18 여행 ACTIVE) |
| version | 정수(단조 증가) | 필수·기본 1 | 재생성·확정 왕복 버전. 이전 상태는 changelog(M12) 추적. 낙관적 동시성·U11 항목 잠금(D30) 확장 여지 |
| currentRef | 식별자(CurrentItinerary) | 필수 | 가변 현재본 참조 — 항상 존재(생성 시점부터) |
| planRef | 식별자(PlanSnapshot) | 선택 | 확정 시점 동결본. NULL=미확정 → CONFIRMED 전이 시 생성(INV-ITIN2) [D14] |
| confirmedAt | 시각(UTC) | 선택 | 최초/재확정 시각. NULL=미확정. 해제 후 재확정 시 갱신 [D20] |
| createdAt | 시각(UTC) | 필수·불변 | 생성 일시 |

**파생 표시값(저장 안 함)**: `isConfirmed`(=status ∈ {CONFIRMED, INTRIP} ∧ planRef≠NULL — 확정본 열람·공개 게이트, U10 소비), `planCurrentDiverged`(=status=INTRIP ∧ plan≠current — 회고 대조 표시 신호, ADR-0013), `activeViolationCount`(=current 전 슬롯 violations 합 — '그대로 저장' 위반 지속 가시화, BR-U5-27).

**일정 상태 머신 (정본 — components.md §3.2 상세화)**

```text
        [generateItinerary — 3방식 공통]
              │
              ▼
          DRAFT ──(userStartsEdit)──▶ EDITING
            │  ▲                         │
            │  └──(unlockForEdit, D20)───┤ (여행 시작 전)
            │        ◀── CONFIRMED ──────┘
            │                 ▲
            │ (confirmItinerary — C2 확정 검증 통과)
            └─────────────────┤
                              │
                    CONFIRMED ──(여행 ACTIVE·M18 tripBecomesActive)──▶ INTRIP
                                                                        │
                                                      (여행 ENDED·M18)▼
                                                                    (종결)
```

| 전이 | 트리거 | 가드 조건 | 효과 |
|---|---|---|---|
| (없음) → DRAFT | generateItinerary(3방식 공통) | 등록 숙소 존재 ∨ 나중 등록 온램프(NO_BASE 예외) · 체크인/아웃 정합·거점 좌표 확정(INV-ITIN3) | 생성 세션 개설. 취소 시 부분 일정 초안 보존 + '이어서 생성'(G161) |
| DRAFT → EDITING | 편집 진입(추가·삭제·재정렬·시간 조정) | — | 매 수정마다 클라 경량 검증(D28) + 위반 배지(차단 아님) |
| DRAFT/EDITING → CONFIRMED | '일정 확정' | 서버 확정 검증(C2 validate) 통과 · 위반 잔존 시 'AI 자동 보정/그대로 저장' 선택 완료 | PlanSnapshot 동결(D14) · ItineraryConfirmed → 여행 CONFIRMED 전이·리마인드 재계산(CP5) |
| CONFIRMED → EDITING | unlockForEdit(D20) | 여행 시작 전(status≠INTRIP) | '편집 중' 표시 · 저장 후 재확정 필요 · 기존 공개본 유지, 재확정 전 신규 공개 불가 |
| CONFIRMED → INTRIP | 여행 ACTIVE(M18 tripBecomesActive) | — | 이후 편집·Plan-B는 current에만 반영(D14) · plan은 회고 대조용 불변 |
| any → DRAFT(재생성) | '다시 생성'(regenerate) | LOCK·체류 고정·수동 추가·시각 고정 필수 방문지는 고정 블록으로 보존(warm-start, G46/G136) | 활성 일정 1개, 이전 상태 changelog 추적, version++ |
| INTRIP → (종결) | 여행 ENDED(M18 tripEnded) | — | 편집 종료 — 이후 기록·회고는 U7 소유 |

**불변식**

- **INV-ITIN1 (활성 일정 ≤1)**: 한 tripId에 활성 Itinerary는 정확히 1개 — 재생성은 새 일정이 아니라 version++·current 교체 [G46/G136].
- **INV-ITIN2 (plan 존재 게이트)**: `planRef≠NULL ⇔ 한 번이라도 CONFIRMED 도달`. CONFIRMED 전이 시 PlanSnapshot 생성·동결, 해제(EDITING 복귀)해도 기존 plan은 파기되지 않음(재확정 전 신규 공개만 차단) [D14, D20].
- **INV-ITIN3 (생성 전제 무결성 — 하드 제약 입력)**: DRAFT 진입은 (등록 숙소 존재 ∨ 나중 등록 온램프) ∧ 각 거점 좌표 확정(coordConfirmed=true) ∧ 체크인/아웃 정합을 전제 — U3 INV-STAY2·U4 CP2 무결성의 소비 측 이중 방어 [PRD 06-1 예외, CP2 시나리오 3].
- **INV-ITIN4 (상태 전이 가드)**: status는 전이표의 (트리거·가드) 조합으로만 변경 — 표 밖 전이(INTRIP→CONFIRMED 역행, DRAFT→INTRIP 직행) 구조적 불가. 여행 중(INTRIP)에는 unlockForEdit 전이 불가 [D14, D20, PBT U5-P9].
- **INV-ITIN5 (활성 일정 단일성과 mode)**: mode 도중 전환에도 진행분(확정 슬롯)을 고정 블록으로 보존 — 전환이 기존 확정 슬롯을 파기하지 않음 [G48].

**생성 방식(mode) 요약**

| mode | 화면 라벨 | 파이프라인(정본 S1.1) |
|---|---|---|
| FULL_AUTO | '완전 AI 자동' | 전체 일자 일괄 배치 — 초안 슬롯 LOCK·교체 가능 |
| TOGETHER | '같이 고르기' | 슬롯 단위 루프 — 기준점=직전 확정 슬롯(첫 슬롯=등록 숙소 G48), 반경 후보·거리 트레이드오프 |
| MANUAL | '직접 만들기' | 빈 일정에서 검색·추가 — 추가 시점마다 편집 재검증부(validateEdit)만 사용 |

### 2.2 PlanSnapshot — 확정 시점 동결본 (M8, 불변)

'일정 확정' 시점의 전체 일정 동결 사본(day·slot·시각·이유 포함). D14의 불변 축 — 확정 후 여행 중 편집·Plan-B는 current에만 반영되고 plan은 회고 대조(U7)·공개 스냅샷(U10)의 기준으로 불변 유지된다.

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| planSnapshotId | 식별자 | 필수·유니크·불변 | — |
| itineraryId | 식별자(Itinerary) | 필수 | 귀속 일정 |
| frozenDays | 목록<DaySchedule 사본> | 필수·불변 | 확정 시점 전체 일정 동결본 — 깊은 사본(current와 물리적 독립) [D14] |
| confirmedAt | 시각(UTC) | 필수·불변 | 확정(동결) 시각 |
| confirmVersion | 정수 | 필수·불변 | 동결 당시 Itinerary.version — 재확정 시 새 스냅샷 생성(공개 스냅샷 유지/교체는 D16) |

**불변식** — **INV-PLAN1(불변·하드 제약 계열)**: PlanSnapshot은 생성 후 어떤 경로로도 수정되지 않음 — 확정 후 임의 편집·재계획·재확정이 기존 frozenDays를 **바이트 동일**하게 유지(회고 대조 전제). 재확정은 새 스냅샷 생성 [D14, PBT U5-P7]. **INV-PLAN2(current 역류 차단)**: current 변경은 plan에 절대 역류하지 않음 — plan↔current는 참조 공유 금지 물리적 분리 사본 [D14, PBT U5-P8]. **INV-PLAN3(POI 스냅샷 동반)**: 확정 시 배치 POI는 `M7.snapshotUserConfirmed`(purpose=확정 일정)로 영구 저장 — plan의 POI 참조가 원본 소실(LOST)에도 잔존 [D13, S1.2 9단계].

### 2.3 CurrentItinerary — 가변 현재본 (M8)

편집·Plan-B가 반영되는 가변 현재본. DRAFT/EDITING에서는 유일한 일정 표현이며, INTRIP 진입 후 plan과 분리되어 여행 중 변경을 흡수한다(D14). 변경은 changelog(M12) 경유 추적.

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| currentItineraryId | 식별자 | 필수·유니크 | — |
| itineraryId | 식별자(Itinerary) | 필수·유니크 | 귀속 일정(1:1) |
| days | 목록<DaySchedule> | 필수 | 일자별 일정 — 편집·재계산 반영 대상 |
| lastEditedAt | 시각(UTC) | 필수 | 최종 변경 시각 |
| pendingSyncFlag | 불리언(파생) | 필수·기본 false | 저장 네트워크 오류 시 로컬 임시 보관 상태 — "저장 대기 중" 표기 [PRD 06-8] |

**불변식** — **INV-CUR1**: Itinerary 생성 시점부터 존재(1:1). **INV-CUR2(INTRIP 격리)**: INTRIP에서 current 변경은 plan을 건드리지 않음 — current만 갱신 + changelog 기록 [D14, ADR-0013]. **INV-CUR3(직렬화 왕복)**: 직렬화→역직렬화 왕복에서 day·slot·시각·고정 블록·violations 동등 보존(무손실) [D14, PBT U5-P10].

### 2.4 DaySchedule — 일자 일정 (M8)

일정의 한 날짜 단위. 적용 거점·해당 일자 시간창 스냅샷을 보유하며 슬롯·고정 블록을 담는다. 자정 초과 활동은 시작한 날짜에 논리적으로 귀속(논리적 하루, D29).

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| dayScheduleId | 식별자 | 필수·유니크 | — |
| date | 날짜 | 필수·유니크(일정 내) | 대상 일자 — 여행 기간 내(체크인~체크아웃 각 1개) |
| appliedBaseRef | 참조(BaseAssignment/거점) | 선택 | 그날 적용 거점(출발·복귀 기준점). NULL=숙소 미등록일(당일치기·이동일 — 동선만 유지) [G50, G41] |
| timeWindow | 구조체 {availStart, availEnd} | 필수 | 시간창 스냅샷(U4 사본 — 기본 09:00~21:00, 첫날 도착·마지막날 출발 반영) [D29, G119] |
| transitionDayFlag | 불리언 | 필수·기본 false | 숙소 전환일(출발=A숙소·복귀=B숙소 편도 동선) 여부 [G50] |
| baseModeMessage | 문자열 | 선택 | 폴백·가정 표기(예: "현재 위치 대신 등록 숙소 기준으로 추천"). NULL=표준 생성 [PRD 06-1·9] |

**불변식** — **INV-DAY1(시간창 정합)**: 모든 슬롯·고정 블록 시각은 `[availStart, availEnd]` 내(자정 초과는 시작일 귀속) — C2 하드 제약 HC4 [D29, PBT U5-P1]. **INV-DAY2(일자 커버리지)**: 여행 기간 각 날짜에 정확히 1개 DaySchedule, 미배정 0(U4 커버리지 완전성 소비) [CP2]. **INV-DAY3(전환일 편도)**: transitionDayFlag=true 일자는 출발점≠복귀점 편도 동선(왕복 강제 금지) [G50].

### 2.5 ItinerarySlot — 슬롯 (M8)

일정의 최소 항목 단위 — 한 POI의 방문 블록(시각·체류·순서). **slotId는 항목 단위 식별 키**(U11 항목 잠금 D30의 확장 키)이며, 사용자에게 보이는 모든 시각은 C2 검증값만 담는다(LLM 임의 시각 미노출).

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| slotId | 식별자 | 필수·유니크·불변 | 항목 단위 식별 키 — LOCK·교체·편집·U11 항목 잠금(D30) 참조 키 [CP3] |
| dayScheduleId | 식별자(FK) | 필수 | 귀속 일자 |
| poiSnapshotRef | 식별자(PoiSnapshot) | 필수 | 배치 POI(확정 시점 사본). closed-set 후보 풀 canonical POI에서만 유래(INV-SLOT1) [G115, D13] |
| canonicalPoiId | 식별자(Poi) | 필수 | 원본 참조(대조·소실 판정용) — 그라운딩 무결성 키 [G115] |
| startAt | 시각(당일) | 필수 | C2 검증 시작 시각 — 솔버 소유·검증값만(INV-SLOT2) [ADR-0008] |
| endAt | 시각(당일) | 필수 | C2 검증 종료 시각 = startAt + 배치 체류 [ADR-0008] |
| assignedStay | 정수(분) | 필수 | 배치 체류(권장→최소 범위에서 솔버 선택 또는 사용자 고정값) [G51] |
| stayCompressedFlag | 불리언 | 필수·기본 false | 권장→최소 압축 배치 여부 — true면 "권장 90분→최소 50분으로 줄여 배치" 표시(모르게 깎임 방지) |
| stayFixedFlag | 불리언 | 필수·기본 false | 사용자 체류 직접 고정 여부 — true면 고정 제약(재생성 warm-start 보존) [G46] |
| locked | 불리언 | 필수·기본 false | 슬롯 LOCK(사후 고정) — 재생성 warm-start 보존(INV-SLOT4) [G46] |
| sourceType | 열거 {AI_RECOMMEND, USER_ADDED, MUST_VISIT, BASE} | 필수 | 슬롯 출처. USER_ADDED·MUST_VISIT은 재생성 보존 [G46] |
| orderNo | 정수 | 필수 | 일자 내 방문 순서(지도형 순서 번호 핀) [US-E5-06] |
| violations | 목록<Violation{kind, detail}> | 필수·기본 [] | 편집 위반 배지 — kind ∈ {TRAVEL_TIME, OPENING_HOURS, FIXED_CONFLICT}. '그대로 저장' 시 지속 가시화(INV-SLOT3) [D28] |
| llmReason | 문자열 | 선택 | LLM 추천 이유(취향 근거·표시 전용). NULL="추천 이유를 불러오지 못했어요" [ADR-0011] |
| solverReason | 문자열 | 선택 | 솔버 배치 이유(제약 근거·"영업시간 오전만→오전 배치"). NULL=표준 배치 |

**이동 구간 표시(슬롯 간)**: 연속 두 슬롯(A→B) 사이 표시 데이터는 값 객체 `DistanceRange{distance, transportMode, estimatedFlag}` — **거리·이동 수단·추정 표기만**(소요시간 필드 부재, D25/Δ1). 소요시간은 TravelEstimate.internalDuration(§2.8)에서 솔버 내부 계산 전용으로만 존재.

**불변식**

- **INV-SLOT1 (POI 그라운딩 — 하드 제약)**: 모든 canonicalPoiId는 생성 시점 후보 풀(closed-set)에 속함 — 출력 POI ⊆ 후보 풀(환각 0). C1 출구 ID 화이트리스트 교차 검증으로 구조적 보장 [G115, D37, PBT U5-P5].
- **INV-SLOT2 (시각은 C2 검증값 — 하드 제약 계열)**: startAt·endAt·orderNo는 C2 솔버 소유·검증값 — LLM 생성 임의 시각은 저장·노출 안 함. 설명과 실제 시각 불일치 시 검증 시각이 정본 [ADR-0008, PBT U5-P1].
- **INV-SLOT3 (위반 보존 비파괴)**: '그대로 저장'(SaveAsIs) 시 violations는 자동 변경 없이 보존되고 저장 후 화면에서도 지속 가시화 — 위반이 있어도 저장 차단 안 함 [ADR-0011].
- **INV-SLOT4 (LOCK·출처 재생성 보존)**: `locked=true ∨ stayFixedFlag=true ∨ sourceType ∈ {USER_ADDED, MUST_VISIT}`인 슬롯은 재생성 전후로 POI·시각·체류 보존, 나머지만 재배치. 멱등 [G46/G136, PBT U5-P2].
- **INV-SLOT5 (이동 표시 소요시간 부재)**: DistanceRange에는 소요시간 필드가 구조적으로 없음 — internalDuration은 표시 DTO 매핑 금지 [D25/Δ1, ADR-0009].

### 2.6 FixedBlock — 고정 블록 (M8, 불가침)

변경 불가 고정 블록 — 등록 숙소의 체크인/아웃 시각과 시각 고정형(FIXED) 필수 방문지. 솔버가 이 블록을 불가침으로 놓고 나머지 추천 POI를 충돌 없이 배치하며, 공간적 앵커 역할을 겸한다. 재생성 warm-start의 1급 보존 대상.

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| fixedBlockId | 식별자 | 필수·유니크 | — |
| dayScheduleId | 식별자(FK) | 필수 | 귀속 일자 |
| kind | 열거 {STAY_CHECKIN, STAY_CHECKOUT, MUST_VISIT_FIXED} | 필수 | 고정 블록 종류 [PRD 06-4] |
| refId | 식별자 | 필수 | 원천 참조(SavedStay 또는 MustVisit — U3/U4 소유) |
| poiSnapshotRef | 식별자(PoiSnapshot) | 선택 | 방문지 사본(MUST_VISIT_FIXED 시). NULL=숙소 체크인/아웃(장소는 거점) |
| fixedStart | 시각(당일) | 필수 | 고정 시작 시각(불가침) |
| fixedEnd | 시각(당일) | 선택 | 고정 종료 시각. NULL=체류 기본값으로 파생(카테고리 StayTimeTable) [G51] |
| fixedDate | 날짜 | 필수 | 고정 날짜 |

**불변식** — **INV-FIX1(불가침·하드 제약)**: fixedStart·fixedEnd·refId는 생성·재생성·편집 전후로 불변 — 솔버는 고정 블록 시각 변경 불가, 충돌 추천 POI 자동 배제 [PRD 06-4, PBT U5-P1·P2]. **INV-FIX2(충돌 시 자동 변경 금지)**: 두 고정 블록이 시간 겹침/이동 불가면 자동 변경하지 않고 충돌 항목 강조 반환 — 어느 쪽 옮길지 사용자 질의(빈 일정·임의 변경 금지) [PRD 06-4 예외]. **INV-FIX3(배치 불가 구조화 응답)**: 시각 고정형 필수 방문지를 어떤 시간대에도 못 넣으면 빈 일정 대신 불가 사유 + 3안(다른 날짜/시각 고정 해제→ANYTIME/인접 조정) 제안 [CP2 시나리오 2]. **INV-FIX4(앵커 역할)**: 포함 고정형(ANYTIME) 필수 방문지는 고정 블록이 아니라 필수 노드지만 주변 추천 POI의 공간적 앵커로 활용(§2.7 mustInclude) — 포함만 보장·시각/순서는 솔버 위임.

### 2.7 SolverProblem / SolverSolution — 솔버 문제·해 (C2, 계약 수준)

C2 Solver Engine의 입출력 계약(상태 비보유 순수 계산). C2는 하드 제약 검증·최적화의 단일 소유자이며, 사용자에게 보이는 모든 시각·순서는 이 엔진이 소유·검증한 값이어야 한다(ADR-0008). 최적화 알고리즘(OPTW/TOPTW) 구현체는 NFR/Infra 소유.

**SolverProblem (입력 계약)**

| 요소 | 타입 | 의미·근거 |
|---|---|---|
| days | 목록<DayContext{window, base}> | 일자별 시간창 + 거점(open-ended 전환일 G50) [D29, G119, G50] |
| candidates | CandidatePool | closed-set 후보 풀(canonical POI·영업시간·좌표) + LLM 선호 점수 보상값(PoiScore) [G115] |
| fixedBlocks | 목록<FixedBlock> | 숙소 체크인/아웃·시각 고정 방문지·LOCK 슬롯·완료 방문지(불가침) [G46] |
| mustInclude | 목록<canonicalPoiId> | 포함 고정형(ANYTIME) 필수 방문지 — 목적함수상 필수 노드 [PRD 06-4] |
| stayDurations | Map<POI, {min, rec, max}> | 체류 범위(권장→최소 유연 변수, 사용자 고정 시 고정 제약) [G51] |
| prefs | {pace, transportModes} | 페이스(여유형/빡빡형)·이동 수단 [G134] |
| budgetWeight | 소프트 가중치 | 예산 소프트 가중치(하드 제약 아님 — 카테고리 무료/저/중/고) [G37/G47] |
| deterministicFlag | 불리언 | 결정론 폴백 모드(LLM 점수 없이 규칙 점수만) [PRD 06-9] |

**하드 제약 4종 (C2 검증 정본)**

| # | 하드 제약 | 정의 | 근거 |
|---|---|---|---|
| HC1 | 영업시간 내 배치 | 어떤 POI도 영업시간 밖(종료 후·휴무일 포함)에 배치되지 않음 | PRD 06-3, ADR-0008 |
| HC2 | 이동시간 부등식 | `직전 슬롯 endAt + 이동시간(안전 마진 G106) ≤ 다음 슬롯 startAt` — 위반 배치 구조적 배제 | G106, ADR-0009 |
| HC3 | 고정 블록 불가침 | 고정 블록 시각 불변, 충돌 추천 POI 자동 배제 | PRD 06-4, INV-FIX1 |
| HC4 | 시간창 귀속 | 슬롯은 일자 시간창 내(자정 초과=시작일 논리 귀속) | D29, G119 |

**목적함수**: LLM 선호 점수를 보상값으로, 필수 방문지를 필수 노드로, 체류 범위를 유연 변수로 하는 OPTW/TOPTW 최적화(보상 최대화 + 하드 제약 만족). 예산은 소프트 가중치로만 반영(하드 제약 승격 금지).

**SolverSolution (출력 계약)**: `placedSlots`(하드 제약 4종 만족 배치), `unplaced`(배치 불가 + 사유·이월 목록), `infeasibility`(해 없음 시 지배 제약 + 완화 제안·빈 결과 금지), `compressedStays`(권장→최소 압축 슬롯 목록).

**불변식** — **INV-SOLVE1(하드 제약 만족·본체)**: placedSlots의 모든 배치가 HC1~HC4 만족, 위반 배치는 solution에 존재 불가. 무차별 대입(oracle) 대조 검증 [ADR-0008, PBT U5-P1]. **INV-SOLVE2(결정론 폴백 결정성)**: deterministicFlag=true(또는 LLM 점수 부재)일 때 동일 입력→동일 출력, 시드 고정. "덜 최적이어도 유효한 해" 항상 보장 [PBT U5-P3]. **INV-SOLVE3(예산 비하드화)**: budgetWeight는 목적함수 보상에만 영향, 하드 제약 미승격 — 예산 초과 배치가 HC로 차단 안 됨, 예산대 낮을수록 저비용 POI 보상 단조 증가 [G37/G47, PBT U5-P6]. **INV-SOLVE4(해 없음 구조화)**: 배치 불가 시 빈 결과 대신 infeasibility 반환 — 침묵 실패·빈 화면 금지 [ADR-0011]. **INV-SOLVE5(warm-start 보존)**: fixedBlocks·LOCK·완료 방문지 입력분은 solution에서 전후 동일, 나머지만 재배치 [G46, PBT U5-P2].

**ConstraintSpec(C2 서브 계약, D28)**: `{version, rules[HC1~HC4]}` — 클라이언트 경량 검증기(shared/validation)가 소비하는 **버전 있는 규칙 명세**. 편집 중 즉시 검사=클라, 저장 확정 검증=서버(C2). 버전 불일치 시 클라 검사 보수적 비활성화(오판 방지). 클라↔서버 규칙 동치는 이중 실행 계약 테스트로 보장(PBT U5-P12).

### 2.8 TravelEstimate — 이동 추정 (C2, 거리 기반·소요시간 내부전용)

거리 기반 이동 추정 값 객체. `internalDuration`(소요시간)은 솔버 이동 부등식(HC2)·트리거 판정 내부 계산 전용이며 어떤 표시용 DTO에도 매핑되지 않는다(D25/Δ1).

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| distance | DistanceRange{value, transportMode, estimatedFlag} | 필수 | 표시 허용값 — 거리·이동 수단·추정 표기(예: "약 850m·도보, 추정") [D25/Δ1] |
| internalDuration | Duration | 필수·**표시 금지** | 소요시간 — HC2 이동 부등식·M9 트리거 내부 계산 전용. 표시 DTO 매핑 구조적 금지(INV-TRAVEL1) [D25/Δ1, ADR-0009] |
| estimationBasis | 열거 {ROAD_KAKAO, ROAD_NAVER, STRAIGHT_LINE} | 필수 | 추정 근거 — 카카오모빌리티 도로 거리(1차)·네이버(2차)·직선거리×우회계수(최종 폴백) [D08] |

**불변식** — **INV-TRAVEL1(소요시간 표시 금지·D25 정본)**: internalDuration은 표시 응답 DTO에 미포함, 표시 계약은 DistanceRange까지 [D25/Δ1, PBT U5-P4]. **INV-TRAVEL2(결정성)**: 동일 (from, to, mode, 파라미터)에 estimateTravel은 결정적, clock·외부 데이터 주입 가능. 라우팅 실패 시 직선거리 폴백+estimatedFlag=true [G106, G116, PBT U5-P4]. **INV-TRAVEL3(추정 플래그 전파)**: estimationBasis=STRAIGHT_LINE(폴백)이면 estimatedFlag=true 전파 → UI '추정' 표기 근거(허위 정확성 금지).

### 2.9 PoiScore — LLM 선호 점수 (C1, 계약 수준)

C1 LLM Gateway가 산출하는 후보 POI별 선호 점수 값 객체. 사용자 자유 입력(취향 문장 포함)을 해석해 각 후보에 점수를 매기며, 이 점수가 SolverProblem 목적함수의 보상값이 된다. closed-set(후보 ID 목록)에서만 부여 — 후보 밖 POI에는 점수 존재 불가(G115).

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| canonicalPoiId | 식별자(Poi) | 필수 | 점수 대상 — 후보 풀 canonical POI에만(closed-set, INV-SCORE1) [G115] |
| score | 수치 | 필수 | 선호 점수(목적함수 보상값) — 취향 축·자유 입력 해석 반영 [PRD 06-2] |
| preferenceBasis | 목록<문자열> | 선택 | 반영된 선호 근거(예: "한식 선호", "도보 이동") — llmReason 원천. NULL=규칙 점수 폴백 |
| tier | 열거 {LIGHT, PREMIUM} | 필수 | 호출 티어 — 취향 해석=경량(LIGHT). 회고·요약은 상위(PREMIUM, U7) [D11] |
| isFallback | 불리언 | 필수·기본 false | 규칙 점수 폴백 여부 — LLM 실패 시 true("기본 모드" 고지) [ADR-0011] |

**불변식** — **INV-SCORE1(closed-set·하드 제약 계열)**: 후보 풀 canonicalPoiId에만 부여 — LLM이 후보 밖 ID 반환 시 C1 출구에서 구조적 드롭·계측(환각 0). 출력 스키마 검증 + ID 화이트리스트 교차 검증 [G115, SECURITY-11, PBT U5-P5]. **INV-SCORE2(전 일자 공용 1회)**: 취향 점수는 전 일자 공용 1회 산출(일자별 재호출 없음) — 백그라운드 잔여 일자 solve는 동일 점수 재사용 [S1.2 4단계]. **INV-SCORE3(무실패 보장)**: LLM 실패·타임아웃(2.5초) 시 규칙 점수(카테고리-취향 매핑 + 인기 집계 가중)로 폴백해 isFallback=true — 취향 없음·LLM 실패가 생성 실패가 되지 않음 [RESILIENCY-01]. **INV-SCORE4(내부 지표 미주입·계정 무결성)**: C1 입력은 리소스 ID 참조만, 게이트웨이가 요청자 권한으로 재조회 주입(D31) — 타 사용자 비공개 데이터·내부 지표(제휴 수수료)는 구조적으로 LLM 입력 미포함(프롬프트 주입 우회 불가) [SECURITY-11, D31].

### 2.10 GenerationSession — 생성 세션 (M8)

일정 생성의 진행 상태·부분 결과·취소를 소유하는 세션. 일자별 독립 TX로 부분 노출을 허용하며, 세션 상태가 진행 정본이다. 첫 1일 5초 우선 노출·전체 20초 한계·취소 시 초안 보존(G161)을 관리한다.

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| sessionId | 식별자 | 필수·유니크 | — |
| itineraryId | 식별자(Itinerary) | 필수 | 귀속 일정 |
| mode | 열거 {FULL_AUTO, TOGETHER, MANUAL} | 필수 | 생성 방식 — 도중 전환 반영 [G48] |
| status | 열거 {COLLECTING, DAY1_READY, GENERATED, FAILED} | 필수·기본 COLLECTING | 세션 생애 상태(상태 머신) |
| progress | 구조체 {stepText, ratio, elapsed} | 필수 | 진행 스트림 — 단계 텍스트("장소 고르는 중→동선 맞추는 중→시간표 확정 중")·진행률·경과 [D38] |
| firstDayEta | Duration | 선택 | 첫 1일 예상 시간(5초 게이트) [D38] |
| partialDraft | 참조(부분 DaySchedule[]) | 선택 | 취소·부분 완료 시 초안 보존분. NULL=미보존 [G161] |
| cancelState | 열거 {NONE, CANCELLED_KEPT, BACKGROUND} | 필수·기본 NONE | 취소→초안 보존 / '백그라운드로 계속' [G161] |
| fallbackFlags | 집합<열거> | 필수·기본 ∅ | 폴백 표기 — LLM_FALLBACK·EXPLANATION_MISSING·DETERMINISTIC_ONLY·MINIMAL_ONLY [PRD 06-9] |

**세션 상태 머신**

```text
   [generateItinerary]
        │
        ▼
    COLLECTING ──(컨텍스트 로드·후보 풀·LLM 점수 실패)──▶ FAILED
        │                                                  ▲
        │ (day1 solve 완료·5초 게이트)                       │ (M6·M4 로드 실패 등 치명)
        ▼                                                  │
    DAY1_READY ──(백그라운드 잔여 일자 완료)──▶ GENERATED     │
        │  │                                               │
        │  └──(사용자 취소 keepDraft)──▶ 부분 초안 보존 ──────┘
        │        (Itinerary DRAFT 유지·'이어서 생성' G161)
        ▼
    (20초 초과 → 잔여 일자 결정론 단독 모드로 GENERATED + DETERMINISTIC_ONLY 플래그)
```

**불변식** — **INV-SESS1(진행 정본)**: 세션 status가 진행 정본 — 부분 일정(day1만 저장)은 세션 상태로 '생성 중' 식별. ItineraryGenerated는 전체 완료 TX에서만 발행 [S1.3]. **INV-SESS2(일자별 독립 TX)**: 일자별 저장은 독립 TX — 부분 노출 허용. LLM·솔버 호출은 TX 밖. **INV-SESS3(취소 초안 보존)**: 취소(keepDraft=true) 시 부분 일정이 초안 보존되고 '이어서 생성' 진입점 유지 — 폐기는 keepDraft=false 명시 시에만 [G161]. **INV-SESS4(최소 일정 최후 폴백)**: 전 생성 경로 실패 시 빈 화면 대신 숙소+시각 고정형 필수 방문지만 배치한 최소 일정 + "추천을 다시 시도"(MINIMAL_ONLY) [PRD 06-9 예외].

### 2.11 StayZoneRecommendation — 숙소 권역 추천 (M8, US-E5-11 온램프)

숙소 나중 등록 경로 — 완성 일정의 동선 무게중심 기반 숙소 권역 추천. 방문지 분포·평균 이동 거리를 입력으로 '이 동선에 묵으면 이동이 최단'인 권역을 지도로 추천. 소요시간 미표시(before/after는 '추정 이동 거리'만, D25).

| 속성 | 타입 | 제약 | 의미·근거 |
|---|---|---|---|
| tripId | 식별자(Trip) | 필수 | 대상 여행 |
| centroid | 구조체 {lat, lng} | 필수 | 동선 무게중심(방문지 분포 기반) [US-E5-11] |
| candidates | 목록<{stayZone, avgDistanceBefore, avgDistanceAfter}> | 필수 | 추천 권역 후보 — 평균 이동 거리 순, before/after 추정 이동 거리(소요시간 없음) |
| approximationNote | 문자열 | 필수 | "무게중심 기반 추정 — 개별 동선의 전역 최적을 보장하지 않음" 표기 |

**불변식** — **INV-ZONE1(동선 부족 게이트)**: 방문지 2개 미만 등 동선 부족 시 권역 추천 미제공·일반 탐색 유도 — 빈 추천 금지. **INV-ZONE2(추정 표기 강제)**: before/after 개선치는 '추정 이동 거리'로만 표시하고 전역 최적 비보장 명기(소요시간 표시 0) [D25]. **INV-ZONE3(등록 온램프 연계)**: 추천 숙소 등록 시 그 숙소를 출발·복귀 기준점으로 US-E5-01 생성·재정렬(warm-start) — 미등록일은 숙소 없이 동선만 유지(appliedBaseRef=NULL).

### 2.12 CP2 소비 참조 계약 (U4 → U5 입력) — TripContext

U5는 U4가 공급하는 여행 컨텍스트(TripContext)를 SolverProblem 입력으로 소비한다(스키마 정본은 U4). U5는 이를 신뢰하되 D21·D15·G40을 방어적으로 재검증한다(하드 제약 입력 무결성 이중 방어).

| 입력 객체(U4 소유) | U5 소비 용도 | 소비 시 방어 검증 |
|---|---|---|
| Trip(destination·start/end·party·budget·attributes) | 일수별 DaySchedule 생성·예산 소프트 가중치·C1 점수화 가중치 | 국내 범위(G120)·오늘 이후·≤30일(G42)·겹침 없음(D21) 재검증 |
| TripDateWindow[](일자별 availStart/End) | DaySchedule.timeWindow(솔버 시간 예산 HC4) | 전 일자 총함수(공백 0)·availStart<availEnd 재검증 [D29, G119] |
| BaseAssignment[](구간·숙소·전환일) | DaySchedule.appliedBaseRef·전환일 편도 모델링(G50)·숙소 기준점 하드 제약 | coordConfirmed=true 전제·비중첩(D15)·커버리지 완전성 재검증 [INV-ITIN3] |
| MustVisit[](사본·시각 고정·한도) | FixedBlock(FIXED)·mustInclude(ANYTIME 앵커)·한도(G40) | 사본 독립(G129)·한도 ≤3×days(G40)·소실 제외(G8)·권역 밖 경고(G158) 재검증 |
| 여행 속성(동행·이동·예산대) | C1 점수화 가중치·prefs(페이스·이동 수단) | 계정 취향 기본 오버라이드(G134) |

**계약 변경 통제**: 시간창·거점 구간 표현 변경은 C2 제약 모델 재작성을 유발 — U5 착수 후에는 필드 **추가만** 허용(파괴적 변경 금지). 시각 고정 필수 방문지가 시간창과 충돌하는 입력(예: 21시 이후 고정)은 침묵 실패 없이 완화 제안(INV-SOLVE4·INV-FIX3)을 구조화 응답으로 반환.

### 2.13 CP3 공급 계약 (U5 → U6 출력) — 일정 기준선

U5 산출(plan/current·고정 블록·확정 상태)이 U6 실행 허브·재계획의 입력 기준선이며, 5개 유닛(U6·U7·U8·U10·U11)이 공유하는 척추다. plan/current 이중 구조·slotId 식별 체계 변경은 ADR급.

| 공급 객체 | 필드(개요) | 경계 무결성 보장 |
|---|---|---|
| Itinerary | itineraryId·tripId·상태(D20)·plan 불변 스냅샷·current 가변본(D14)·확정 일시·mode | INV-ITIN2·4·INV-PLAN1·2 |
| DaySchedule | 일자·적용 거점 참조·시간창 스냅샷·전환일 | INV-DAY1·2·3 |
| ItinerarySlot | slotId(U11 항목 잠금 D30 키)·canonicalPoiId(closed-set G115)·start/end(C2 검증값)·LOCK·고정 블록 플래그(warm-start G46)·추천/배치 이유·DistanceRange(거리·수단만, 소요시간 없음 D25) | INV-SLOT1·2·4·5 |
| 이벤트(CP5 일부) | ItineraryConfirmed(확정·리마인드 소스)·ItineraryChanged(변경·재계산 D32) | CP5 envelope(common/core) |

**통합 테스트 시나리오(CP3)**: (1) 기준선 로드 불변성 — 확정 일정을 U6가 로드하면 current가 실행 기준선, 재계획·현장 편집 후에도 plan 스냅샷 바이트 동일 유지(INV-PLAN1, PBT U5-P7). (2) warm-start 고정 블록 보존 — LOCK·시각 고정·거점 블록 포함 일정에 재계획 시 고정 블록 전후 동일·나머지만 재배치·하드 제약 4계열 통과(PBT U5-P2). (3) 확정 해제 경합 — 확정 해제·편집 중 전환 일정에 대해 U6 트리거·재계획 진입이 상태 머신 규칙(D20)에 따라 차단/안내(PBT U5-P9).

### 2.14 엔티티-스토리 추적 요약

| 엔티티 | 주 근거 스토리 | 주 결정 |
|---|---|---|
| Itinerary | US-E5-01·10·12 | D14, D20, G46/G136, components §3.2 |
| PlanSnapshot / CurrentItinerary | US-E5-12, US-E5-08 | D14, ADR-0013, D16 |
| DaySchedule | US-E5-01·03 | D29, G119, G50, G41 |
| ItinerarySlot | US-E5-03·05·06·07·10 | G115, D25/Δ1, G46, G51, D28 |
| FixedBlock | US-E5-04 | PRD 06-4, G46, D29 |
| SolverProblem / SolverSolution | US-E5-02·03·04·09 | ADR-0008, D28, D29, G47, G50, G106, G115 |
| TravelEstimate | US-E5-06 | D25/Δ1, ADR-0009, D08, G106 |
| PoiScore | US-E5-02·05 | D11, D31, G115, SECURITY-11 |
| GenerationSession | US-E5-09·10 | D38, G161, G136 |
| StayZoneRecommendation | US-E5-11 | D25 |

---

## 3. 비즈니스 규칙

규칙 ID `BR-U5-xx`(본 유닛 전역 유일 — 코드·테스트·리뷰 추적 키). 각 규칙은 **조건**(언제 평가) / **동작**(무엇을 함) / **위반 시 처리**(사용자·시스템 관점) / **근거**(US·D·Δ·G·ADR ID)로 구성한다. **하드 제약 4계열**(D37 — 본 유닛이 본체): 숙소 기준점 / 충돌 무배치(영업시간·이동 부등식·시간창) / POI 그라운딩(closed-set) / 계정 무결성(D31) — 해당 규칙에 `[하드 제약]` 표기.

### 규칙 색인

| 그룹 | 규칙 |
|---|---|
| A. 생성 진입·전제 | BR-U5-01 ~ 05 |
| B. 후보 풀·POI 그라운딩 | BR-U5-06 ~ 08 |
| C. LLM 점수화·취향·예산 | BR-U5-09 ~ 12 |
| D. 하드 제약(솔버 4종) | BR-U5-13 ~ 16 |
| E. 체류 시간 범위 | BR-U5-17 ~ 18 |
| F. 점진 노출·폴백 계단 | BR-U5-19 ~ 24 |
| G. 편집 재검증 | BR-U5-25 ~ 28 |
| H. LOCK·재생성 보존 | BR-U5-29 ~ 30 |
| I. 확정·해제 상태 머신 | BR-U5-31 ~ 33 |
| J. 3방식 생성 | BR-U5-34 ~ 37 |
| K. 표시(2보기·이동·이유) | BR-U5-38 ~ 41 |
| L. 숙소 전환일·권역 추천 | BR-U5-42 ~ 44 |

### 3.A 생성 진입·전제

- **BR-U5-01 숙소 기준점 일정 생성 — 날짜별 기준점 자동 전환 `[하드 제약]`**
  - 조건: 일정 생성(`generateItinerary`) 시.
  - 동작: 등록 숙소의 위경도와 체크인/아웃 날짜를 생성의 **고정 입력값(출발점)**으로 쓰고, 체크인 당일~체크아웃 당일 각 날짜에 일자 일정을 1개씩 생성한다. 같은 기간에 위치가 다른 숙소가 여럿이면 각 숙소 체크인/아웃에 맞춰 **날짜별 기준점을 자동 전환**한다(INV-DAY2). 모든 일자 동선이 해당 구간 거점 기준임이 하드 제약(숙소 기준점 계열).
  - 위반 시 처리: 거점 기준을 벗어난 동선 배치는 하드 결함 — 숙소 기준점 하드 제약, **머지 차단 테스트**.
  - 근거: US-E5-01, PRD 06-1, ADR-0002, D28.
- **BR-U5-02 등록 숙소 부재 게이트 — NO_BASE + 장소 우선(나중 등록) 1급 경로**
  - 조건: 생성 진입 전제 판정 시.
  - 동작: **숙소 우선** 생성은 등록 숙소 0개면 버튼을 비활성화하고 "숙소를 먼저 등록하면 일정을 만들 수 있어요"를 안내(`PreconditionFailed(NO_BASE)`). **단 '숙소 나중 등록'(장소 우선 — 동선 기반 추천) 온램프는 1급 경로**로, 숙소 미정 상태에서 여행지 중심을 임시 앵커로 한 장소 기준 무숙소 생성을 허용(BR-U5-44).
  - 위반 시 처리: 숙소·장소 우선 온램프 둘 다 없는 생성 진입은 게이트 차단. 장소 우선(나중 등록) 경로를 막는 것은 결함(1급 경로 보장).
  - 근거: US-E5-01, US-E5-11, PRD 06-1.
- **BR-U5-03 체크인/아웃 날짜 검증 — 누락·역전 시 생성 안 함**
  - 조건: 생성 전제 날짜 정합 판정 시.
  - 동작: 체크인/아웃 날짜가 누락·역전되면 일정을 생성하지 않고 **날짜 수정 화면으로 이동**(U3 INV-STAY1·U4 무결성 소비 측 이중 방어, INV-ITIN3).
  - 위반 시 처리: 역전·누락 날짜로 생성 진입은 결함 — CP2 경계 방어 재검증(D21·D15) [CP2 시나리오 3].
  - 근거: US-E5-01 예외, PRD 06-1 예외, INV-ITIN3.
- **BR-U5-04 거점 지오코딩 미확정 — 생성 보류 `[하드 제약]`**
  - 조건: 거점 좌표 확정(coordConfirmed) 판정 시.
  - 동작: 등록 숙소 위경도가 없으면(지오코딩 실패) **지도에서 위치 직접 지정을 요청**하고 지정 전까지 해당 숙소 기준 생성을 보류(U3 INV-STAY2 소비 측 이중 방어). 첫날 거점 공백은 여행지 중심 좌표를 기본 거점으로(G41).
  - 위반 시 처리: 미확정 좌표 거점을 생성에 투입하는 것은 결함(계정 무결성·숙소 기준점 전제 훼손) [CP2 시나리오 3].
  - 근거: US-E5-01 예외, PRD 06-1 예외, G41, INV-ITIN3.
- **BR-U5-05 위치 권한 거부 폴백 — 등록 숙소 위치 대체·가정 표기**
  - 조건: 현재 위치가 필요한 기능(첫 일정 추천·'내 주변 추가')에서 위치 권한 거부 시.
  - 동작: 위치 권한이 거부돼도 **등록 숙소 위치를 출발점으로 생성**하고, 현재 위치 필요 기능은 등록 숙소 위치로 대체하며 그 가정을 화면에 표기("현재 위치 대신 등록 숙소 기준으로 추천했어요", DaySchedule.baseModeMessage).
  - 위반 시 처리: 위치 권한 거부만으로 생성 중단은 결함(폴백 좌표로 계속).
  - 근거: US-E5-01 예외, PRD 06-1 예외, ADR-0010, G182.

### 3.B 후보 풀·POI 그라운딩

- **BR-U5-06 closed-set 후보 풀 그라운딩 — 환각 0 `[하드 제약]`**
  - 조건: 후보 풀 구성(`M7.getCandidatePool`)·LLM 선택·솔버 배치 전반.
  - 동작: LLM은 **그라운딩된 후보 POI ID 목록(closed-set)에서만 선택**해 실재 장소만 노출하고, 후보 밖 POI는 **구조적으로 일정에 포함될 수 없다**(INV-SLOT1·INV-SCORE1). C1 출구에서 출력 스키마 검증 + ID 화이트리스트 교차 검증으로 LLM 신뢰 없이 환각 0을 달성. U3 canonical ID 무결성(INV-POI1)이 전제.
  - 위반 시 처리: closed-set 밖 ID 반환은 구조적 불가하나 방어적으로 드롭·계측 — 출력 POI ⊄ 후보 풀은 POI 그라운딩 하드 제약 위반, **머지 차단 테스트** [PBT U5-P5].
  - 근거: US-E5-02, PRD 06-2, G115, D37, SECURITY-11.
- **BR-U5-07 소실·미검증 POI 후보 분리**
  - 조건: 후보 풀에 소실(LOST)·영업시간 미확인(UNVERIFIED) POI가 포함될 때.
  - 동작: 소실(LOST) POI는 후보 풀·시드 투입에서 제외(U3 G8 소비). 영업시간 데이터 없는 POI는 "영업시간 미확인"으로 표시하고 **확정 시간대 배치 대신 사용자 확인이 필요한 후보로 분리**(자동 확정 배치 금지).
  - 위반 시 처리: 소실 POI를 후보 풀에 투입(그라운딩 오염)하거나 미확인 POI를 확정 시간대에 배치하는 것은 결함.
  - 근거: US-E5-03 예외, PRD 06-3 예외, G8, G192.
- **BR-U5-08 후보 0건·조건 과협소 진단**
  - 조건: 후보 풀 구성 결과 0건 또는 선호 조건 과협소 시.
  - 동작: 조건이 너무 좁아 후보 0건이면 **결과를 0으로 만든 조건을 표시**하고(예: "비건 + 24시간 + 도보 10분") 완화를 제안(빈 일정 금지). 예산으로 채울 POI가 없으면 "예산을 높이거나 활동 수를 줄여보세요" + **무료/저비용 대안 POI 우선 제시**.
  - 위반 시 처리: 0건을 빈 화면으로 방치하는 것은 결함(진단·완화 제안 강제).
  - 근거: US-E5-02 예외, PRD 06-2 예외, ADR-0011.

### 3.C LLM 점수화·취향·예산

- **BR-U5-09 LLM 취향 해석·선호 점수 — 목적함수 보상값**
  - 조건: LLM 점수화(`C1.call(PreferenceScoring)`) 시.
  - 동작: LLM이 사용자 자유 입력(취향 문장 포함)을 해석해 각 후보에 **선호 점수**를 매기고 그 점수를 OPTW/TOPTW 최적화의 **목적함수 보상값**으로 쓴다(PoiScore). 경량 티어(D11), **전 일자 공용 1회 호출**(일자별 재호출 없음, INV-SCORE2), 서버 재조회 컨텍스트 주입(D31). 역할 분리: LLM=취향 해석·점수·설명 / 솔버=선택·순서·시간 보장.
  - 위반 시 처리: 일자별 LLM 재호출·클라이언트 직접 LLM 호출은 결함(C1 단일 관문·비용). LLM 시각 노출은 INV-SLOT2 위반.
  - 근거: US-E5-02, PRD 06-2, D11, D31, ADR-0008.
- **BR-U5-10 취향 중립 기본값 — 무실패 보장**
  - 조건: 취향 미설정·부분 설정 상태에서 생성 시.
  - 동작: 취향 미설정 축은 **중립 기본값으로 전량 대체**(취향 없음이 생성 실패가 되지 않게 — 무실패 보장). M2 로드 실패도 중립 기본값 대체(FAILED 아님).
  - 위반 시 처리: 취향 미설정으로 생성 실패시키는 것은 결함(무실패 보장 위반).
  - 근거: US-E1-14, US-E5-02, PRD 03-14 예외, S1.2 2단계, INV-SCORE3.
- **BR-U5-11 예산 소프트 가중치 — 하드 제약 아님·단조성**
  - 조건: 예산 반영 판정 시.
  - 동작: 예산은 **솔버 하드 제약이 아니라 LLM 추천의 소프트 가중치**로 반영 — 카테고리별 무료/저/중/고 비용 추정으로 예산대에 맞는 POI를 우선 추천(예산대가 낮을수록 저비용 POI 보상 단조 증가, INV-SOLVE3). 예산 초과 배치가 하드 차단되지 않는다.
  - 위반 시 처리: 예산을 하드 제약으로 승격시켜 배치를 차단하는 것은 결함(예산 비하드화 원칙) [PBT U5-P6].
  - 근거: US-E5-02, PRD 06-2, G37/G47, ADR-0008, INV-BUDGET2(U4).
- **BR-U5-12 이동 방식별 이동시간 반영**
  - 조건: 이동 방식(도보/자차 등) 기반 추천·배치 시.
  - 동작: 이동 방식에 따라 장소 간 거리 기반 이동시간을 다르게 계산해(수단별 안전계수 G106) 추천·배치에 반영 — 내부 계산은 TravelEstimate.internalDuration(표시 금지 D25).
  - 위반 시 처리: 이동 수단 무시 배치는 현장 실행 불가 일정 유발 결함.
  - 근거: US-E5-02, PRD 06-2, G106, ADR-0009.

### 3.D 하드 제약 (솔버 4종)

- **BR-U5-13 영업시간 내 배치 (HC1) `[하드 제약]`**
  - 조건: 솔버 배치(`C2.solve`)·검증(`C2.validate`) 시.
  - 동작: 어떤 POI도 **영업시간 밖(영업 종료 후·휴무일·정기휴무 포함)에 배치하지 않는다**(시간창=영업시간, HC1). 위반 배치는 결과에서 구조적으로 제외(INV-SOLVE1).
  - 위반 시 처리: 영업시간 밖 배치가 solution에 존재하는 것은 충돌 무배치 하드 제약 위반, **머지 차단 테스트** [PBT U5-P1].
  - 근거: US-E5-03, PRD 06-3, ADR-0008.
- **BR-U5-14 이동시간 부등식 (HC2) `[하드 제약]`**
  - 조건: 솔버 배치·검증 시.
  - 동작: **직전 일정 종료 시각 + 장소 간 이동시간(안전 마진 포함 G106) ≤ 다음 일정 시작 시각**을 항상 만족(HC2). 이동시간 추정이 부정확하므로 시간창을 보수적으로 잡아 현장 지각을 줄인다. 위반 배치는 결과에서 제외.
  - 위반 시 처리: 이동 부등식 위반 배치가 solution에 존재하는 것은 충돌 무배치 하드 제약 위반, **머지 차단 테스트** [PBT U5-P1].
  - 근거: US-E5-03, PRD 06-3, G106, ADR-0009.
- **BR-U5-15 고정 블록 불가침·충돌 자동 변경 금지 (HC3) `[하드 제약]`**
  - 조건: 고정 블록(숙소 체크인/아웃·시각 고정형 필수 방문지) 포함 배치 시.
  - 동작: 등록 숙소 체크인/아웃 시각과 시각 고정형 필수 방문지를 **변경 불가 고정 블록**으로 놓고 나머지 추천 POI를 충돌 없이 배치(HC3, INV-FIX1). 고정 일정과 시간이 겹치거나 이동시간이 부족한 추천 POI는 자동 배제. **두 고정 블록이 서로 충돌하면 자동 변경하지 않고 충돌 항목을 강조**한 뒤 어느 쪽을 옮길지 사용자에게 묻는다(INV-FIX2). 포함 고정형(ANYTIME)은 필수 노드로 반드시 포함하되 시각·순서는 솔버 위임 + 공간적 앵커로 활용.
  - 위반 시 처리: 고정 블록 시각을 솔버가 임의 변경하거나 충돌을 자동 해소하는 것은 결함 [PBT U5-P1].
  - 근거: US-E5-04, PRD 06-4, G46.
- **BR-U5-16 시간창 귀속·자정 초과 (HC4) — 하루 1개 이하 안내**
  - 조건: 시간창 배치·자정 초과 활동 처리 시.
  - 동작: 하루 시간창은 기본 09:00~21:00 + 여행별 조정(HC4), 점심·저녁은 취향 기반 솔버 자동 배치, **자정을 넘는 활동은 시작한 날짜에 귀속**(논리적 하루, INV-DAY1). 이동시간 제약상 하루에 채울 수 있는 일정이 1개 이하이면 **억지로 늘리지 않고** "이동 거리가 멀어 하루에 한 곳만 추천돼요"를 안내(INV-SOLVE4).
  - 위반 시 처리: 시간창 밖 배치·억지 채움은 결함(구조화 안내 강제).
  - 근거: US-E5-03, PRD 06-3 예외, D29, G119.

### 3.E 체류 시간 범위

- **BR-U5-17 체류 범위(최소·권장·최대) — 압축 배치 고지**
  - 조건: 체류 시간 배치 시.
  - 동작: 체류 기본값은 운영 정의 정적 테이블(카테고리 20~30종 G51)에서 시작해 일정 밀도(여유형/빡빡형)·여행 스타일을 반영해 채운다. 체류는 **최소·권장·최대 범위**로 관리해 솔버가 권장→최소 범위에서 조정하며, **권장보다 줄여 배치한 경우 그 사실을 해당 POI에 표시**(stayCompressedFlag — "권장 90분→최소 50분으로 줄여 배치", 모르게 깎임 방지).
  - 위반 시 처리: 압축 배치를 고지 없이 하는 것은 결함(모르게 체류 삭감 금지).
  - 근거: US-E5-03, PRD 06-3, G51.
- **BR-U5-18 사용자 체류 고정 — 고정 제약 전환**
  - 조건: 사용자가 특정 POI 체류 시간을 직접 고정할 때.
  - 동작: 사용자가 체류를 직접 고정하면 솔버는 그 값을 범위 대신 **고정 제약**으로 사용(stayFixedFlag=true). 고정 체류는 재생성 warm-start 보존 대상(INV-SLOT4).
  - 위반 시 처리: 사용자 고정 체류를 솔버가 범위로 재조정하는 것은 결함.
  - 근거: US-E5-03, PRD 06-3, G46.

### 3.F 점진 노출·폴백 계단

- **BR-U5-19 결정론 솔버 폴백 — LLM 실패에도 유효 해 보장**
  - 조건: LLM(취향 해석)·외부 POI/영업시간/이동시간/지도 API 실패 시.
  - 동작: 외부 API가 실패해도 **내장 결정론적 솔버(규칙 점수 + TOPTW + 제약 검증)로 시간 제약을 만족하는 일정을 생성**하고 "일부 추천이 기본 모드로 생성되었어요"를 표시(fallbackFlags=LLM_FALLBACK). 결정론 폴백은 동일 입력→동일 출력(INV-SOLVE2) — "덜 최적이어도 유효한 해" 항상 보장.
  - 위반 시 처리: LLM 실패 시 빈 일정·생성 실패는 결함(폴백으로 지속) — 폴백 결정성 위반은 [PBT U5-P3].
  - 근거: US-E5-09, PRD 06-9, ADR-0011, RESILIENCY-01, RESILIENCY-10.
- **BR-U5-20 LLM 설명만 실패 — 일정 정상·설명 생략**
  - 조건: LLM 설명(getExplanations) 단계만 실패 시.
  - 동작: LLM 취향 해석/설명 단계가 실패하면 **일정 자체는 결정론적 솔버 결과로 제공**하고 설명 문구만 생략하거나 "추천 이유를 불러오지 못했어요"로 표시(llmReason=NULL, fallbackFlags=EXPLANATION_MISSING). 일정 시각·배치는 영향 없음.
  - 위반 시 처리: 설명 실패로 일정 자체를 실패시키는 것은 결함.
  - 근거: US-E5-09, PRD 06-9, D11, ADR-0011.
- **BR-U5-21 첫 1일 5초 우선 노출·백그라운드 잔여**
  - 조건: 생성 진행 시.
  - 동작: 완료된 **첫 1일 일정을 수 초 내(5초 게이트) 먼저 노출**하고 나머지 날짜를 백그라운드로 이어 채운다(일자별 독립 TX, INV-SESS2). 세션 상태 COLLECTING→DAY1_READY→GENERATED. 20초는 전체 완료 한계로만 사용.
  - 위반 시 처리: 첫 1일을 전체 완료까지 노출 지연하는 것은 성능 목표 위반(D38).
  - 근거: US-E5-09, PRD 06-9, D38.
- **BR-U5-22 생성 진행 스트림 — 단계·진행률·경과**
  - 조건: 생성 중 진행 표시 시.
  - 동작: 생성 중 **단계 텍스트("장소 고르는 중→동선 맞추는 중→시간표 확정 중")·진행률·경과 시간을 표시**(`streamGenerationProgress`, GenerationSession.progress).
  - 위반 시 처리: 진행 표시 없는 무한 로딩은 결함(빈 화면 금지).
  - 근거: US-E5-09, PRD 06-9, D38.
- **BR-U5-23 20초 초과 — 결정론 단독 모드 전환**
  - 조건: 전체 생성 20초 한계 도달 시.
  - 동작: 전체 20초 한계 도달 시 잔여 일자를 **결정론 솔버 단독 모드로 완성** + 폴백 고지(fallbackFlags=DETERMINISTIC_ONLY).
  - 위반 시 처리: 20초 초과를 무한 대기로 방치하는 것은 결함(하드 타임아웃 후 폴백 강제).
  - 근거: US-E5-09, PRD 06-9, D38.
- **BR-U5-24 생성 취소·백그라운드·최소 일정 최후 폴백**
  - 조건: 생성 중 사용자 취소·전 경로 실패 시.
  - 동작: 사용자는 생성 중 **'취소' 또는 '백그라운드로 계속'**을 선택. **취소 시 이미 만들어진 부분 일정을 초안으로 저장**하고 '이어서 생성'(`resumeGeneration`) 진입점 제공(cancelState=CANCELLED_KEPT, INV-SESS3). **모든 생성 경로가 실패하면** 빈 화면 대신 **등록 숙소 + 시각 고정형 필수 방문지만 배치된 최소 일정**을 제공하고 "추천을 다시 시도"를 노출(MINIMAL_ONLY, INV-SESS4).
  - 위반 시 처리: 취소 시 부분 일정 무단 폐기·전 경로 실패 시 빈 화면은 결함.
  - 근거: US-E5-09, PRD 06-9 예외, G161, D38.

### 3.G 편집 재검증

- **BR-U5-25 편집 즉시 재검증 — 클라 경량 + 서버 확정 (D28)**
  - 조건: POI 추가/삭제/재정렬/시간 변경 시(`validateEdit`).
  - 동작: 편집 시 **클라이언트 경량 검증기가 영업시간·이동시간·고정 일정 충돌을 즉시 재검증**(UX용)하고, **저장 시 서버가 확정 검증**(정본, C2 `validate`). 규칙 명세(ConstraintSpec)는 단일 소스에서 양쪽 공유(버전 불일치 시 클라 검사 보수적 비활성화, 오판 방지).
  - 위반 시 처리: 클라 검증만으로 저장 확정하거나 규칙 불일치로 통과→거부 UX 발생은 결함 — 클라↔서버 규칙 동치는 [PBT U5-P12].
  - 근거: US-E5-07, PRD 06-7, D28.
- **BR-U5-26 위반 비차단·경고 배지·삽입 가능 시간대**
  - 조건: 편집 결과가 제약을 위반할 때.
  - 동작: 수정 결과가 제약을 위반해도 **변경을 차단하지 않되**, 위반 항목에 경고 배지("이동시간 부족"/"영업시간 외")와 사유를 표시(violations). POI 추가 시 현재 동선 기준 **삽입 가능한 시간대만 후보로 제시**(`getInsertableSlots`).
  - 위반 시 처리: 위반을 이유로 편집을 하드 차단하는 것은 결함(비차단 원칙). 삽입 불가 시간대 노출은 결함.
  - 근거: US-E5-07, PRD 06-7, D28.
- **BR-U5-27 저장 시 위반 분기 — 'AI 자동 보정 / 그대로 저장'**
  - 조건: 위반이 있는 채로 저장(`applyEdit`) 시.
  - 동작: 위반이 있는 채로 저장하려 하면 **"이대로 두면 ○곳에서 시간이 안 맞아요"를 요약**하고 **'AI로 자동 보정' 또는 '그대로 저장'**을 선택하게 한다. '그대로 저장'(SaveAsIs) 시 위반 상태를 자동 변경 없이 보존하고 저장 후 활성 일정 화면에서도 위반 블록을 지속 가시화(INV-SLOT3).
  - 위반 시 처리: 위반 저장을 침묵 처리하거나 임의 자동 변경하는 것은 결함(사용자 선택 강제·위반 지속 가시화).
  - 근거: US-E5-07, PRD 06-7 예외, ADR-0011.
- **BR-U5-28 AI 자동 보정 — 최소 변경(시각·순서만, G49)**
  - 조건: '자동 보정'(`C2.repair`, onViolation=AutoFix) 선택 시.
  - 동작: 'AI로 자동 보정'은 **위반 구간의 시각·순서만 조정하며 POI를 추가·삭제하지 않는다**(최소 변경, G49). 보정 불가 시 `RepairInfeasible` — '그대로 저장' 또는 수동 수정 유도.
  - 위반 시 처리: 자동 보정이 POI를 추가/삭제하거나 위반 외 구간을 바꾸는 것은 결함(최소 변경 원칙).
  - 근거: US-E5-07, PRD 06-7, G49.

### 3.H LOCK·재생성 보존

- **BR-U5-29 슬롯 LOCK·교체 — 사후 고정**
  - 조건: 완전 AI 초안의 슬롯 고정(`lockSlot`)·교체(`replaceSlot`) 시.
  - 동작: 초안의 개별 슬롯을 **고정(LOCK)하거나 교체**할 수 있다. 교체 후보는 솔버 검증 통과분만 제시. LOCK 슬롯은 재생성 warm-start 보존 대상(INV-SLOT4).
  - 위반 시 처리: 솔버 미검증 교체 후보 제시는 결함(검증값만 노출).
  - 근거: US-E5-10, PRD 06-10, G46, D28.
- **BR-U5-30 재생성 warm-start 보존 — 멱등·활성 1개 `[하드 제약 계열]`**
  - 조건: 재생성(`regenerate`) 시.
  - 동작: 재생성 시 **LOCK 슬롯·체류 시간 고정값·수동 추가 POI·시각 고정형 필수 방문지·거점 블록을 모두 고정 블록으로 보존(warm-start)하고 나머지만 재생성**(INV-SLOT4·INV-SOLVE5). 여행당 **활성 일정은 1개로 유지**하고 이전 상태는 changelog로 추적(version++). 보존은 멱등(반복 재생성에도 고정분 불변).
  - 위반 시 처리: 재생성이 고정 블록·LOCK·수동 추가분을 변경하거나 활성 일정을 복수 생성하는 것은 결함 [PBT U5-P2].
  - 근거: US-E5-10, US-E4-09, PRD 06-10, G46/G136.

### 3.I 확정·해제 상태 머신

- **BR-U5-31 일정 확정 — plan 스냅샷 동결 (D14) `[하드 제약 계열]`**
  - 조건: '일정 확정'(`confirmItinerary`) 시.
  - 동작: 확정 전 **서버 확정 검증(C2 `validate`) 통과**를 요구(위반 잔존 시 'AI 자동 보정/그대로 저장' 선택 완료 후). 확정 시 **plan 스냅샷을 동결(불변)**하고 이후 편집·Plan-B 변경은 current에만 반영(INV-PLAN1·2). 확정 POI는 `M7.snapshotUserConfirmed`로 영구 스냅샷(D13). `ItineraryConfirmed` 발행 → 여행 CONFIRMED 전이·리마인드 스케줄(CP5).
  - 위반 시 처리: 확정 후 plan이 변경되는 것은 **하드 결함(회고 대조 무결성)** — 확정 후 임의 편집·재계획이 plan을 바꾸면 [PBT U5-P7].
  - 근거: US-E5-12, PRD 06-12, D14, D13.
- **BR-U5-32 확정 화면·확정 의미 설명**
  - 조건: 확정 직후·확정 직전.
  - 동작: 확정 후 **확정 일정 화면(시간표/지도 토글·읽기 전용)으로 진입**시키고 D-day·출발일 등 여행 시작 맥락을 표시. **확정의 의미와 이점**(여행 시작 전 최종본 잠금, 공개·복제 시 동선 신뢰성)을 확정 화면 또는 확정 직전에 한 줄로 설명.
  - 위반 시 처리: 확정의 의미 설명 없이 단순 비활성화로 처리하는 것은 결함(사용자 이해 보장).
  - 근거: US-E5-12, PRD 06-12.
- **BR-U5-33 확정 해제 → 재확정 (D20)**
  - 조건: 확정 후 '일정 수정' 진입(`unlockForEdit`) 시.
  - 동작: 확정 후 편집에 진입하면 **'편집 중' 상태로 전환**되고 저장 후 **재확정해야 확정 상태로 복귀**(CONFIRMED→EDITING, INV-ITIN4). 기존 공개본(D16 스냅샷)은 유지하되 **재확정 전 신규 공개 불가**. 여행 중(INTRIP)에는 이 해제 전이가 불가(여행 중 편집은 current에만).
  - 위반 시 처리: 해제 없이 확정 일정 직접 편집·재확정 전 신규 공개·여행 중 해제 전이는 결함(상태 머신 가드 위반) [PBT U5-P9].
  - 근거: US-E5-12, PRD 06-12, D20, D14.

### 3.J 3방식 생성

- **BR-U5-34 3방식 분기·결과 예고**
  - 조건: 생성 방식 선택 화면 구성 시.
  - 동작: 생성 방식을 **완전 AI 자동 / 같이 고르기 / 직접 만들기** 중 선택하게 하고, 분기 선택 화면의 각 방식 카드에 **한 줄 결과 예고와 예상 소요·인터랙션 양**을 표시(고르기 전에 무엇을·얼마나 해야 하는지 인지). 세 방식 모두 최종 시각·순서는 솔버 검증값이며 이동 소요시간은 표시하지 않는다(D25).
  - 위반 시 처리: 결과 예고 없는 방식 선택·방식별 최종 시각의 솔버 미검증은 결함.
  - 근거: US-E5-10, PRD 06-10, D25.
- **BR-U5-35 같이 고르기 — 반경 기준점·회색 처리 (G48)**
  - 조건: 같이 고르기(`getSlotCandidates`) 슬롯 진행 시.
  - 동작: 슬롯마다 사용자가 고른 컨셉/테마와 **반경 안의 후보**를 제시하고 선택하면 다음 슬롯으로 진행. **반경 기준점은 직전 확정 슬롯 위치이며 첫 슬롯은 등록 숙소**(G48). 반경을 넓히면 더 먼 후보가 예상 이동 거리 표기와 함께 포함되고, **반경 밖 후보는 비활성·회색 처리**(disabled). 반경 내 후보 0건이면 반경 확대 또는 컨셉 변경 제안.
  - 위반 시 처리: 기준점 오류(직전 확정 슬롯 아님)·반경 밖 후보 활성 노출·0건 빈 화면은 결함 [PBT U5-P11].
  - 근거: US-E5-10, PRD 06-10 예외, G48, D25.
- **BR-U5-36 직접 만들기 — 추가 시마다 재검증**
  - 조건: 직접 만들기(MANUAL) 장소 추가 시.
  - 동작: 빈 일정에서 장소를 검색·추가해 구성하되, **추가 시점마다 BR-U5-25와 동일하게 제약을 재검증**한다.
  - 위반 시 처리: 직접 만들기에서 재검증을 생략하는 것은 결함(편집 재검증 일관).
  - 근거: US-E5-10, PRD 06-10, D28.
- **BR-U5-37 방식 도중 전환 — 진행분 보존**
  - 조건: 생성 도중 방식 전환(`switchGenerationMode`) 시.
  - 동작: 분기 도중 방식 전환이 가능하며(예: 같이 고르기→나머지 완전 AI), **이미 고른 슬롯을 고정 블록으로 보존한 채 남은 일정만 생성**(진행분 손실 없음, INV-ITIN5).
  - 위반 시 처리: 방식 전환이 확정 슬롯을 파기하는 것은 결함.
  - 근거: US-E5-10, PRD 06-10, G48.

### 3.K 표시 (2보기·이동·이유)

- **BR-U5-38 시간표/지도 2보기 — 즉시 반영**
  - 조건: 일정 조회(`getItinerary`) 시.
  - 동작: 동일 일정 데이터를 **시간표형(시간순 타임라인·시각/체류 블록)과 지도형(순서 번호 핀+이동 동선)으로 보여주고 상단 세그먼트로 전환**하며, 한 보기의 수정이 다른 보기에 즉시 반영(단일 데이터 소스). 지도 타일/경로 API 실패 시 지도형 대신 시간표형 폴백("지도를 불러오지 못했어요") + 일정 데이터 정상 제공.
  - 위반 시 처리: 두 보기 데이터 불일치·지도 실패 시 일정 데이터 미제공은 결함.
  - 근거: US-E5-06, PRD 06-6, D24/Δ6.
- **BR-U5-39 이동 구간 표시 — 거리·수단만 (D25/Δ1) `[하드 규칙]`**
  - 조건: 슬롯 간 이동 구간 표시 데이터 구성 시.
  - 동작: 연속 두 일정(A→B) 사이 각 이동 구간에 **이동 수단과 거리 요약만** 범위·추정으로 표시(예: "약 850m · 도보, 추정", DistanceRange). **차량/도보 예상 소요시간은 어떤 화면에도 표시하지 않는다**(internalDuration은 표시 DTO 매핑 금지, INV-TRAVEL1). '길찾기' 동작으로 외부 지도앱에 출발·도착 좌표를 전달해 실제 길안내 위임(자체 턴바이턴·실시간 경로 안내 미제공).
  - 위반 시 처리: 소요시간 표기·표시 DTO에 internalDuration 매핑은 **D25 위반 결함** [PBT U5-P4].
  - 근거: US-E5-06, PRD 06-6, D25/Δ1, ADR-0009, ADR-0012.
- **BR-U5-40 추천·배치 이유 — 표시 전용·검증값 우선**
  - 조건: 추천·배치 이유(`getExplanations`) 표시 시.
  - 동작: 장소별로 어떤 선호(예: "한식 선호", "도보 이동")가 반영됐는지 **LLM 설명 문구**(llmReason)로, 배치 이유(예: "영업시간이 오전만→오전 배치")를 **솔버 실제 제약 근거**(solverReason)로 표시. **설명 문구는 표시용이며 시간표를 바꾸지 않는다** — 설명과 실제 배치 시각이 불일치하면 **검증된 시각을 기준으로 표시**(INV-SLOT2).
  - 위반 시 처리: LLM 설명 시각을 검증값보다 우선 표시하는 것은 결함(검증값 정본).
  - 근거: US-E5-05, PRD 06-5, ADR-0008.
- **BR-U5-41 저장·실행 연계 — 시각·순서·고정 블록 보존**
  - 조건: 편집 일정 저장(`applyEdit`) 시.
  - 동작: 저장 시 **일정의 모든 시각·순서·고정 블록을 보존**. 저장된 일정은 여행 중 실행·Plan-B 재계획의 입력 기준선(CP3). 저장 중 네트워크 오류 시 **로컬 임시 보관 + 재연결 자동 동기화**("저장 대기 중", pendingSyncFlag).
  - 위반 시 처리: 저장 시 시각·순서 손실·저장 실패 침묵은 결함.
  - 근거: US-E5-08, PRD 06-8, D25.

### 3.L 숙소 전환일·권역 추천

- **BR-U5-42 숙소 전환일 편도 동선 (G50)**
  - 조건: 숙소 전환일(A숙소 체크아웃일=B숙소 체크인일) 배치 시.
  - 동작: 숙소 전환일은 **출발=A숙소·복귀=B숙소인 편도(open-ended) 동선으로 모델링**(transitionDayFlag, INV-DAY3) — 왕복 강제 금지.
  - 위반 시 처리: 전환일을 단일 숙소 왕복으로 모델링하는 것은 결함(편도 원칙).
  - 근거: US-E5-01, PRD 06-1, G50.
- **BR-U5-43 숙소 미등록일 — 동선만 유지**
  - 조건: 숙소를 끝까지 등록하지 않은 날(당일치기·이동일) 처리 시.
  - 동작: 숙소 미등록일은 **숙소 없이 동선만으로 일정을 유지**(DaySchedule.appliedBaseRef=NULL).
  - 위반 시 처리: 미등록일에 억지 거점을 강제하거나 일정을 비우는 것은 결함.
  - 근거: US-E5-11 예외, PRD 06-11 예외.
- **BR-U5-44 숙소 나중 등록 — 동선 무게중심 권역 추천 (US-E5-11)**
  - 조건: 숙소 나중 등록 온램프(`recommendStayZone`) 시.
  - 동작: 완성된 일정의 **방문지 분포(동선 무게중심)와 평균 이동 거리 기준으로 '이 동선에 묵으면 이동이 최단'인 숙소 권역을 지도로 추천**(StayZoneRecommendation). 후보를 평균 이동 거리 순으로 제시하고 특정 숙소 기준 재정렬 시 **before/after '추정 이동 거리'**로 표시(소요시간 없음 D25). **무게중심 기반은 추정이며 전역 최적 비보장**을 표기(INV-ZONE2). 추천 숙소 등록 시 그 숙소를 기준점으로 US-E5-01 생성·재정렬(warm-start). 방문지 2개 미만 등 동선 부족 시 추천 미제공·일반 탐색 유도(INV-ZONE1).
  - 위반 시 처리: 소요시간 표시·전역 최적 보장 표기·동선 부족 시 빈 추천은 결함.
  - 근거: US-E5-11, PRD 06-11, D25, S3.

---

## 4. 비즈니스 로직 / 플로우 + 테스트 속성(PBT)

핵심 프로세스 플로우 5종(+ 같이 고르기 서브플로우)과 속성 기반 테스트(PBT-01) 식별표를 담는다. 플로우 ID `FLOW-x`, 단계 `Sx`, 분기 `Bx`, 예외 `Ex`. 메서드 계약은 component-methods M8·C1·C2, 서비스 정본은 services S1을 참조한다.

### 4.1 FLOW-1 일정 생성 (컨텍스트 로드 → 후보 풀 → LLM 점수 → 솔버 배치 → 첫날 5초 → 백그라운드)

진입: 생성 방식 선택 → `M8.generateItinerary(tripId, mode)`(정본 서비스 S1). 관련: US-E5-01~05·09·10 · BR-U5-01~24 · D11·D13·D14·D25·D28·D29·D38·G40·G41·G46·G48·G50·G51·G106·G115·G119·G129·G161.

```text
S1 세션 개설 [BR-U5-21·22]
   M8.generateItinerary → GenerationSession(status=COLLECTING), 진행 스트림 채널(단계·진행률·경과)
   가드: 등록 숙소 존재 ∨ 나중 등록 온램프(NO_BASE 예외) [BR-U5-02]
   ├─ E1 날짜 누락·역전 → 생성 안 함, 날짜 수정 화면 [BR-U5-03, INV-ITIN3]
   └─ E2 거점 좌표 미확정(지오코딩 실패) → 지도 핀 지정 요청, 생성 보류 [BR-U5-04]
S2 컨텍스트 병렬 로드 (CP2 소비) [BR-U5-05·10]
   M6.getTrip(날짜·속성 G134·시간창 D29/G119·필수 방문지 G40)、M2.getPreferences(중립 기본값 채움)、M4.listBaseAssignments(거점·체크인/아웃)
   방어 재검증: D21(겹침)·D15(비중첩)·G40(한도)·G120(국내 범위) [CP2 시나리오 3]
   ├─ E3 M6·M4 로드 실패 → 세션 FAILED, 재시도 노출
   ├─ E4 M2 실패 → 중립 기본값 전량 대체(FAILED 아님 — 무실패 보장) [BR-U5-10, INV-SCORE3]
   └─ B1 첫날 거점 공백 → 여행지 중심 좌표 기본 거점(G41) / 위치 거부 → 등록 숙소 기준+가정 표기 [BR-U5-05]
S3 후보 풀 구성 — M7.getCandidatePool(closed-set G115) [BR-U5-06·07·08]
   canonical POI + 영업시간 + 체류 기본값 min/rec/max(G51) + 국내 좌표(G120). 저장 POI 투입분 사본(G129)
   ├─ E5 외부 소스 실패 → 정본 캐시로 축소 풀 + 기본 모드 플래그 / 정본도 불가 → 저장 POI+필수 방문지 최소 풀
   ├─ E6 소실(LOST)·미확인(UNVERIFIED) → 시드 제외 / '영업시간 미확인' 후보 분리 [BR-U5-07]
   └─ E7 조건 과협소 후보 0건 → 0 만든 조건 표시+완화 제안 / 예산 미충족 → 저비용 대안 우선 [BR-U5-08]
S4 LLM 선호 점수 — C1.call(PreferenceScoring, candidateIds, prefs) [BR-U5-09·11]
   경량 티어(D11), 전 일자 공용 1회 호출(INV-SCORE2), 서버 재조회 컨텍스트 주입(D31 — 내부 지표 미주입 SECURITY-11)
   closed-set 검증: 출력 스키마 + ID 화이트리스트 교차(환각 0, INV-SCORE1). 예산=소프트 가중치(하드 아님 G47)
   └─ E8 타임아웃(2.5초)·스키마 위반 → 규칙 점수 폴백(isFallback=true)+"기본 모드" 고지 [BR-U5-19]
S5 솔버 day1 배치 — C2.solve(day1) [BR-U5-13~18]
   하드 제약 4종: HC1 영업시간·HC2 이동 부등식(G106)·HC3 고정 블록 불가침·HC4 시간창(D29). 위반 배치 구조적 배제(INV-SOLVE1)
   포함 고정형=필수 노드+공간 앵커, 체류 압축 시 표시 사유(stayCompressedFlag), 전환일 편도(G50)
   ├─ E9 고정 블록 상호 충돌 → 자동 변경 없이 강조+사용자 질의 [BR-U5-15, INV-FIX2]
   ├─ E10 필수 방문지 배치 불가 → 사유+3안(다른 날짜/고정 해제/인접 조정) [INV-FIX3]
   └─ E11 하루 1개 이하만 가능 → "이동 거리가 멀어 하루 한 곳만" [BR-U5-16, INV-SOLVE4]
S6 TX1: day1 초안 저장(독립 TX) → 세션 DAY1_READY → 첫 1일 응답 반환 (5초 게이트) [BR-U5-21, INV-SESS2]
S7 백그라운드 잔여 일자 루프 — C2.solve(dayN), S4 점수 재사용(LLM 재호출 없음), 일자별 독립 TX [BR-U5-21]
   ├─ E12 20초 한계 → 잔여 결정론 단독 모드 완성 + DETERMINISTIC_ONLY 고지 [BR-U5-23]
   ├─ B2 사용자 '취소' → 부분 일정 초안 저장(CANCELLED_KEPT)+'이어서 생성'(resumeGeneration) [BR-U5-24, INV-SESS3]
   └─ B3 '백그라운드로 계속' → 완료 시 화면 복귀 시 반영
S8 TX-final: 세션 GENERATED + outbox ItineraryGenerated(전체 완료 TX에서만) [INV-SESS1]
   └─ E13 전 경로 실패 → 숙소+시각 고정 필수만 최소 일정 + "다시 시도"(MINIMAL_ONLY) [BR-U5-24, INV-SESS4]
```

**사후 조건**: 출력 POI ⊆ 후보 풀(환각 0, INV-SLOT1). 사용자 노출 시각·순서는 전부 C2 검증값(INV-SLOT2). 소요시간 표기 0(D25). 폴백 계단은 침묵 실패 없이 최소 일정까지 도달(INV-SESS4).

### 4.2 FLOW-1b 같이 고르기 서브플로우 (mode=TOGETHER)

진입: mode=TOGETHER 선택 → S1~S4는 FLOW-1 공통, S5부터 슬롯 단위 루프. 관련: US-E5-10 · BR-U5-35·37 · G48·D25.

```text
T1 슬롯 컨텍스트 — 기준점 산출 [BR-U5-35]
   기준점 = 직전 확정 슬롯 위치(첫 슬롯 = 등록 숙소) [G48]
T2 후보 제시 — M8.getSlotCandidates(slotCursor, concept, radius)
   반경 내 후보(+반경 확대 시 예상 이동 거리 표기), 반경 밖 후보 disabled(회색) [BR-U5-35]
   └─ E1 반경 내 0건 → 반경 확대(다음 이동 수단)/컨셉 변경 제안
T3 사용자 선택 → M8.chooseSlotCandidate → C2 검증(하드 제약)+다음 슬롯 컨텍스트 반환 [BR-U5-13~16]
T4 루프 T1~T3 반복(하루 동선 완성)
T5 (선택) 방식 전환 — switchGenerationMode(→FullAuto) → 확정 슬롯 고정 블록 보존, 남은 일정만 완전 AI [BR-U5-37, INV-ITIN5]
```

**사후 조건**: 최종 시각·순서·이동 거리는 솔버 검증값(D25 소요시간 미표시). 도중 전환 시 진행분 손실 0(INV-ITIN5).

### 4.3 FLOW-2 편집 재검증 (클라 경량 + 서버 확정)

진입: 일정 편집(추가·삭제·재정렬·시간 변경) → `M8.validateEdit` → `M8.applyEdit`. 관련: US-E5-07·08 · BR-U5-25~28·36·41 · D28·G49·D20.

```text
S1 편집 조작 — 클라이언트 경량 검증기 즉시 재검증 [BR-U5-25]
   ConstraintSpec(C2 발행·버전 있음) 소비 — 영업시간·이동시간·고정 충돌 즉시 검사(UX용 사본)
   └─ E1 명세 버전 불일치 → 로컬 검사 보수적 비활성화(오판 방지 D28)
S2 위반 표시 — 비차단 경고 배지+사유(violations) [BR-U5-26]
   POI 추가 시 getInsertableSlots(현재 동선 기준 삽입 가능 시간대만)
S3 서버 확정 검증 — M8.validateEdit → C2.validate(정본) [BR-U5-25]
   가드: 확정 상태 일정이면 unlockForEdit 선행 필요(D20) [BR-U5-33]
S4 저장 — M8.applyEdit(onViolation) [BR-U5-27·28]
   ├─ B1 위반 있음 → "○곳에서 시간이 안 맞아요" 요약 + 'AI 자동 보정 / 그대로 저장'
   │   ├─ AutoFix → C2.repair(시각·순서만·POI 불변 G49) [BR-U5-28]
   │   │     └─ E2 RepairInfeasible → '그대로 저장'/수동 수정 유도
   │   └─ SaveAsIs → 위반 보존+지속 가시화(INV-SLOT3) [BR-U5-27]
   └─ B2 위반 없음 → 저장(시각·순서·고정 블록 보존) [BR-U5-41]
S5 저장 결과 — changelog 기록, 실행 기준선 갱신(CP3) [BR-U5-41]
   └─ E3 네트워크 오류 → 로컬 임시 보관("저장 대기 중" pendingSyncFlag)+재연결 자동 동기화
```

**사후 조건**: 클라 검증과 서버 확정 검증이 동일 규칙 명세(ConstraintSpec)로 동치(PBT U5-P12). 위반 저장 시에도 차단 없이 지속 가시화(INV-SLOT3).

### 4.4 FLOW-3 확정 / 해제 (plan 동결 ↔ 재확정)

진입: '일정 확정' → `M8.confirmItinerary` / '일정 수정' → `M8.unlockForEdit`. 관련: US-E5-12 · BR-U5-31~33 · D14·D20·D13.

```text
S1 확정 요청 — 서버 확정 검증 C2.validate 통과 게이트 [BR-U5-31]
   └─ E1 위반 잔존 → 'AI 자동 보정/그대로 저장' 선택 완료 후 진행(PRD 06-7 예외)
S2 TX 확정 — plan 스냅샷 동결(불변, INV-PLAN1) [BR-U5-31, D14]
   + M7.snapshotUserConfirmed(확정 POI 영구 스냅샷 D13) + status DRAFT/EDITING→CONFIRMED [INV-ITIN2]
   + outbox ItineraryConfirmed → M6 여행 CONFIRMED 전이·M14 리마인드 스케줄(CP5)
S3 확정 화면 — 시간표/지도 토글·읽기 전용·D-day/출발일·확정 의미 한 줄 설명 [BR-U5-32]
S4 (사후) 확정 해제 — M8.unlockForEdit [BR-U5-33]
   가드: 여행 시작 전(status≠INTRIP) — 여행 중은 해제 전이 불가(current만 편집) [INV-ITIN4]
   CONFIRMED→EDITING, '편집 중' 표시, 기존 공개본 유지·재확정 전 신규 공개 불가(D20)
   └─ 저장 후 재확정(FLOW-3 S1 재진입) → 새 PlanSnapshot 생성(기존 plan 불변)
S5 여행 ACTIVE 전이(M18) → CONFIRMED→INTRIP, plan/current 분리 작동(INV-CUR2) [D14]
```

**사후 조건**: 확정 후 임의 편집·재계획·재확정이 기존 plan을 바이트 동일하게 유지(INV-PLAN1, PBT U5-P7). 상태 전이는 전이표 밖 불가(INV-ITIN4, PBT U5-P9).

### 4.5 FLOW-4 재생성 보존 (warm-start)

진입: '다시 생성' → `M8.regenerate(itineraryId, scope)`. 관련: US-E5-10·US-E4-09 · BR-U5-29·30 · G46/G136.

```text
S1 고정 블록 수집 — warm-start 보존 대상 식별 [BR-U5-30]
   LOCK 슬롯(locked=true) ∪ 체류 고정(stayFixedFlag) ∪ 수동 추가(sourceType=USER_ADDED)
   ∪ 시각 고정 필수 방문지(MUST_VISIT_FIXED) ∪ 거점 블록(BASE) [INV-SLOT4]
S2 재배치 — C2.solve(fixedBlocks 보존, 나머지만) [BR-U5-30]
   고정 블록 전후 동일(INV-FIX1·INV-SOLVE5), 나머지 슬롯만 재최적화
S3 활성 일정 유지 — 여행당 1개(INV-ITIN1), version++, 이전 상태 changelog 추적(G136)
S4 멱등 — 동일 입력 반복 재생성에도 고정분 불변(멱등) [BR-U5-30, PBT U5-P2]
```

**사후 조건**: 재생성 전후 고정 블록·LOCK·수동 추가·시각 고정분 POI·시각·체류 동일(INV-SLOT4). 나머지만 재배치되며 하드 제약 4종 통과(C2 재사용, CP3 시나리오 2).

### 4.6 FLOW-5 숙소 권역 추천 (숙소 나중 등록 온램프)

진입: 숙소 미정 상태에서 일정 구성 완료 → `M8.recommendStayZone(tripId)`. 관련: US-E5-11 · BR-U5-43·44 · D25.

```text
S1 동선 부족 게이트 [INV-ZONE1]
   └─ E1 방문지 2개 미만 등 동선 부족 → 권역 추천 미제공, 일반 탐색 유도(S3.146)
S2 무게중심 산출 — 방문지 분포 centroid + 방문지 간 평균 이동 거리 [BR-U5-44]
S3 권역 후보 산출 — '이 동선에 묵으면 이동 최단' 권역, 평균 이동 거리 순 [BR-U5-44]
   before/after '추정 이동 거리'(소요시간 없음 D25), 전역 최적 비보장 표기(INV-ZONE2)
S4 추천 숙소 등록 → M4.registerStay(추천 숙소) → 기준점 삼아 FLOW-1 재정렬(warm-start) [INV-ZONE3]
   └─ B1 미등록일(당일치기·이동일) → 숙소 없이 동선만 유지(appliedBaseRef=NULL) [BR-U5-43]
```

**사후 조건**: before/after는 '추정 이동 거리'만(소요시간 0, D25). 추천 숙소 등록 시 US-E5-01 생성·재정렬 정상 수행(INV-ZONE3).

### 4.7 Testable Properties (PBT-01 — 속성 식별 정본)

PBT 전체 강제(D05~07 확장 구성, D37 계층 분리). 프레임워크: 서버=Kotest Property Testing, 클라이언트=fast-check. 시드 로깅·수축(shrinking) 필수(PBT-08). **C2·C1 하드 제약 검증은 PR CI에서 실코드 테스트(모킹 금지, D37)** — 외부 LLM·거리 API만 어댑터 fake. 아래 속성은 U5 Code Generation의 DoD 항목이며, **U5 DoD 6속성**((a)영업시간 내 배치·(b)이동 부등식·(c)고정 블록 불변·(d)폴백 결정성·(e)상태 머신 전이·(f)plan/current 직렬화 왕복)을 전부 포함·확장한다. **속성 합계 12개**(C2: 5 · C1: 2 · M8: 5).

**C2 Solver Engine (서버 — Kotest · oracle 테스트 대상)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U5-P1 | 하드 제약 불변식 (본체·**oracle**) | 솔버 하드 제약: 임의 후보 풀·시간창·고정 블록·이동 파라미터 입력에 대해 solve 출력의 모든 배치가 (a) 영업시간 내(HC1), (b) 인접 슬롯 이동 부등식 `직전 endAt+이동 ≤ 다음 startAt`(HC2), (c) 고정 블록 시각 불변(HC3), (d) 시간창 귀속·자정 초과=시작일(HC4)을 만족하고 **위반 배치는 solution에 부재**(INV-SOLVE1). **작은 인스턴스는 무차별 대입(oracle)으로 대조** — 유효 배치 부당 배제·위반 배치 통과를 이중 확인 | 후보 풀 생성기(좌표·영업시간·휴무 분포) + 시간창·고정 블록·이동 파라미터 조합 + 소규모 인스턴스(oracle 전수 대조용) |
| U5-P2 | warm-start 보존·멱등 | 고정 블록 보존: LOCK·체류 고정·수동 추가·시각 고정 필수 방문지·거점 블록을 포함한 임의 일정에 regenerate/warm-start solve를 적용하면 (a) 고정분 POI·시각·체류 전후 동일(INV-SLOT4·INV-SOLVE5), (b) 나머지만 재배치, (c) 반복 재생성에 고정분 불변(멱등) | 일정 생성기(고정/비고정 슬롯 혼합·LOCK 주입) + 재생성 반복 횟수 |
| U5-P3 | 결정론 폴백 결정성 | 폴백 모드 결정성: deterministicFlag=true(또는 LLM 점수 부재)일 때 동일 입력이 동일 출력(무작위성 제거·시드 고정, INV-SOLVE2). 유효 해 항상 산출(빈 결과 0, 제약 만족) | 문제 인스턴스 생성기 + 실행 순서·병렬성 셔플(결정성 확인) |
| U5-P4 | 이동 추정 결정성·표시 게이트 | 이동 추정: estimateTravel이 (a) 동일 (from,to,mode,파라미터)에 동일 출력(결정적·clock 주입, INV-TRAVEL2), (b) 라우팅 실패 시 직선거리 폴백+estimatedFlag=true(INV-TRAVEL3), (c) **어떤 표시용 DTO에도 internalDuration 미포함**(거리만 전파, INV-TRAVEL1) — 표시 DTO 스키마에 소요시간 필드 부재 정적 보장 | 좌표 쌍·이동 수단 생성기 + 라우팅 성공/실패 주입 + DTO 매핑 정적 검사 |
| U5-P6 | 예산 소프트 단조성 | 예산 가중치 단조성: 예산대가 낮아질수록 저비용 카테고리 POI의 목적함수 보상이 단조 증가(비감소)하고 **예산 초과 배치가 하드 차단되지 않음**(INV-SOLVE3 — 예산 비하드화) | 예산대 시퀀스(단조 감소) + POI 비용 카테고리 분포 |

**C1 LLM Gateway (서버 — Kotest · closed-set 실코드 검증)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U5-P5 | closed-set 그라운딩 (하드 제약) | POI 그라운딩: 임의의 (후보 풀, LLM 응답) 쌍에 대해 (a) 출력 슬롯의 canonicalPoiId ⊆ 후보 풀(환각 0, INV-SLOT1·INV-SCORE1), (b) 후보 밖 ID 반환은 C1 출구에서 드롭·계측(통과 0), (c) 점수는 후보 ID에만 부여 — LLM 응답을 적대적으로 오염(후보 밖 ID·중복·형식 위반)시켜도 최종 출력 POI ⊄ 후보 풀 = 0 | 후보 풀 + 적대적 LLM 응답 생성기(후보 밖 ID·인젝션 페이로드·스키마 위반) |
| U5-P12 | 검증 규칙 동치 (D28) | 클라↔서버 규칙 동치: 임의 편집 결과에 대해 클라이언트 경량 검증기(ConstraintSpec 소비)와 서버 C2.validate가 **동일 위반 집합**을 산출(동일 버전 명세). 버전 불일치 시 클라 검사는 보수적 비활성화(통과→거부 UX 0) | 편집 결과 생성기(경계 위반·정상 혼합) + 명세 버전 일치/불일치 주입 |

**M8 Itinerary Generation (서버 — Kotest)**

| ID | 카테고리 | 속성 서술 | 제너레이터 요구 |
|---|---|---|---|
| U5-P7 | plan 불변성 (하드 제약 계열) | plan 스냅샷 불변: 확정된 일정에 임의의 편집·재계획·재확정 연산 시퀀스를 적용해도 기존 PlanSnapshot.frozenDays가 **바이트 동일**하게 유지(확정 후 plan 변경 0, INV-PLAN1). 재확정은 새 스냅샷 생성이며 기존 것을 변형하지 않음 | 확정 일정 + 편집/재계획/재확정 연산 시퀀스 생성기 |
| U5-P8 | current↔plan 분리 | plan/current 분리: status=INTRIP에서 current의 임의 변경(편집·Plan-B)이 plan에 역류하지 않음(INV-PLAN2·INV-CUR2) — plan↔current 참조 비공유(물리적 독립), current 변경 후 plan 동일 | INTRIP 일정 + current 변경 연산 생성기 |
| U5-P9 | 상태 전이 가드 | 일정 상태 머신: 임의 (상태·트리거) 시퀀스에 대해 (a) 전이표의 조합만 성공, (b) 표 밖 전이(INTRIP→CONFIRMED 역행·DRAFT→INTRIP 직행·여행 중 unlockForEdit) 전부 거부(INV-ITIN4), (c) CONFIRMED→EDITING은 여행 시작 전만, (d) 활성 일정 ≤1 불변(INV-ITIN1) | 상태·트리거 시퀀스 생성기(유효/무효 전이 혼합) + 여행 상태(시작 전/중) 주입 |
| U5-P10 | 직렬화 왕복 | plan/current 직렬화 왕복: 임의 일정(plan·current·day·slot·고정 블록·violations)을 직렬화→역직렬화한 결과가 원본과 동등(무손실 왕복, INV-CUR3) | 일정 구조 생성기(고정 블록·위반·다일자·다거점 포함) |
| U5-P11 | 반경 게이트 (같이 고르기) | 같이 고르기 반경: 임의 슬롯 진행에서 (a) 기준점=직전 확정 슬롯(첫 슬롯=등록 숙소, G48), (b) 반경 내 후보만 활성·반경 밖 disabled, (c) 반경 확대 시 추가 후보에 예상 이동 거리 표기, (d) 반경 내 0건 → 확대/컨셉 변경 제안(빈 결과 0) | 슬롯 시퀀스 생성기(좌표 분포·반경 변화) + 확정 슬롯 위치 |

**속성 없는 컴포넌트 (No PBT properties identified)**

| 컴포넌트 | 판정 | 사유 |
|---|---|---|
| M8 생성 오케스트레이션(generateItinerary 시퀀스) | No PBT | 외부 모듈 조립·TX 경계·진행 스트림 — 보편 양화 도메인 로직은 하위 C1(U5-P5)·C2(U5-P1~3)·상태 머신(U5-P9)으로 분해. 폴백 계단·점진 노출·세션 상태 전이는 예시 기반 통합 테스트+어댑터 fake(RESILIENCY-10·S1 실패 분기) |
| M8 추천·배치 이유(getExplanations) | No PBT | 표시 전용 문구 조립(검증값 우선은 U5-P1이 시각 정본을 보장) — 설명-시각 불일치 시 검증값 표시는 예시 기반 테스트 |
| M8 숙소 권역 추천(recommendStayZone) | No PBT (U5 시점) | 무게중심 기하 계산·추정 표기 — 도메인 불변식보다 산출 정확성. 동선 부족 게이트(INV-ZONE1)·소요시간 미표시(D25)는 예시 기반 테스트 |
| C1 티어 라우팅·rate-limit | No PBT | 라우팅·상한 정책(수치는 NFR) — closed-set(U5-P5)·컨텍스트 권한(SECURITY-08 계약 테스트)과 달리 정책 테이블. 예시 기반+계약 테스트 |

**커버리지 대조 (U5 DoD → 속성)**

| U5 DoD 명시 속성 | 대응 |
|---|---|
| (a) 영업시간 내 배치 | U5-P1(HC1) |
| (b) 인접 슬롯 이동시간 부등식 | U5-P1(HC2) |
| (c) 고정 블록 불변(warm-start 전후 동일) | U5-P1(HC3) · U5-P2 |
| (d) 폴백 모드 결정성(동일 입력→동일 출력) | U5-P3 |
| (e) 일정 상태 머신(초안→편집중→확정→해제) 전이 불변식 | U5-P9 |
| (f) plan/current 직렬화 왕복 | U5-P10 |
| (설계 확장) 이동 추정 결정성·소요시간 표시 게이트 | U5-P4 |
| (설계 확장) POI 그라운딩 closed-set(환각 0) | U5-P5 |
| (설계 확장) 예산 소프트 가중치 단조성 | U5-P6 |
| (설계 확장) plan 스냅샷 불변성 / current↔plan 분리 | U5-P7 / U5-P8 |
| (설계 확장) 같이 고르기 반경 게이트 / 클라↔서버 규칙 동치 | U5-P11 / U5-P12 |

**하드 제약(D37 — 본 유닛이 4계열 본체) 대조**

| 하드 제약(U5 소관) | 방어 속성·불변식 |
|---|---|
| **숙소 기준점**(모든 일자 동선이 해당 구간 거점 기준) | U5-P1(고정 블록·거점 base) · INV-DAY1·3 · BR-U5-01·04 |
| **충돌 무배치**(시간 중복·영업시간 밖·이동 부등식 위반 배치 0) | U5-P1(HC1·HC2·HC4 · oracle 대조) · INV-SOLVE1 |
| **POI 그라운딩**(출력 POI ⊆ 후보 풀 — closed-set) | U5-P5 · INV-SLOT1·INV-SCORE1 |
| **계정 무결성**(타 계정 데이터 미혼입 D31) | U5(C1 resolveContext 권한 검증 · SECURITY-08 계약 테스트) · INV-SCORE4 |

**C2 oracle 테스트 명시**: C2 Solver Engine은 소규모 문제 인스턴스에 대해 **무차별 대입(brute-force 전수 열거) 대조**를 oracle로 사용한다 — 솔버 해가 하드 제약을 만족하는지(부당 통과 0)와 유효 배치를 부당 배제하지 않는지(부당 배제 0)를 이중 확인한다(U5-P1). 대규모 인스턴스는 불변식 속성(HC1~HC4 만족)만 검증한다(oracle 비용 한계).

---

## 5. 프런트엔드 컴포넌트

클라이언트 feature: `features/itinerary`(생성 방식·진행·2보기·편집·같이 고르기·확정·권역 추천) + `shared/validation`(경량 제약 검증기, D28). **지도 렌더링은 U3 `shared/map`(카카오 지도 SDK 브리지) 재사용** — U5는 새 지도 브리지를 만들지 않고 U3 브리지 인터페이스를 소비한다. data-testid 규약: `itinerary-{screen}-{role}`(E2E·컴포넌트 테스트 앵커).

### 5.1 일정 화면 플로우 (정본)

```text
[탐색 랜딩 '여행자 일정' 진입(U2) 또는 여행 상세 [AI 일정 생성하기] 온램프(U4)]
        │
        ▼
┌─ GenerationModeSelectScreen (3방식 카드 — 결과 예고·예상 소요·인터랙션 양) ──────┐
│   완전 AI 자동 / 같이 고르기 / 직접 만들기 · 방식별 한 줄 결과 예고(BR-U5-34)      │
│   가드: 등록 숙소 0개 → NO_BASE 안내(단 숙소 나중 등록 온램프 예외 BR-U5-02)      │
└──────────────────────────────────────────────────────────────────────────┘
   │ FULL_AUTO / MANUAL          │ TOGETHER                    │ 나중 등록
   ▼                            ▼                             ▼
GenerationProgressScreen    TogetherPickFlow            StayZoneRecommendScreen
(스트림·1일 우선·취소/백그라운드) (슬롯 루프·반경·회색)         (동선 무게중심·before/after 추정 거리)
   │ 첫 1일 5초 노출·전체 완료                                    │ 추천 숙소 등록 → U4 registerStay → 재정렬
   ▼
┌─ ItineraryViewScreen (시간표/지도 2보기 토글 — 이동 구간 거리·수단만 D25) ────────┐
│   TimelineView / MapView(U3 shared/map 재사용) · 슬롯 탭 → SlotDetailSheet         │
└──────────────────────────────────────────────────────────────────────────┘
   │ 편집                        │ 슬롯 LOCK/교체            │ 확정
   ▼                            ▼                          ▼
ItineraryEditScreen          SlotDetailSheet           ConfirmScreen
(경량 검증 배지·자동보정/그대로)  (추천/배치 이유·LOCK·교체)    (읽기 전용·확정 의미·D-day)
   │ 저장(위반 분기)                                         │ 확정 해제 → '편집 중' 재진입(D20)
   ▼                                                        ▼
(current 갱신 → 실행 기준선 CP3)                        (plan 동결 → U6 실행 허브 진입)
```

**전역 규칙**
- 일정 화면군은 5탭 셸(U2) 내 '일정' 탭 스택에 쌓인다(탭 규칙 G6·G7은 U2 shared/ui 소유). 여행 중은 실행 허브(U6)로 수렴.
- **사용자에게 보이는 모든 시각·순서·이동 거리는 서버 C2 검증값만** 렌더(LLM 임의 시각 미노출, INV-SLOT2) — 클라이언트는 값을 생성하지 않는다.
- **소요시간 필드는 어떤 화면에도 없다** — 이동 구간은 `DistanceRange`(거리·수단·추정)까지만(D25/Δ1, INV-TRAVEL1).
- 모든 서버 오류는 표준 오류 타입으로 정규화되어 침묵 실패 없이 표면화(shared/api), 폴백 고지는 화면에 명시(기본 모드·추정 표기) [ADR-0011].
- 지도 렌더는 U3 `shared/map` 브리지 재사용 — 지도 타일/경로 실패 시 시간표형 폴백("지도를 불러오지 못했어요")+일정 데이터 정상 제공(BR-U5-38).

### 5.2 컴포넌트 계층

```text
features/itinerary
├─ ItineraryNavigator                     — 일정 스택 컨테이너('일정' 탭 하위)
│  ├─ GenerationModeSelectScreen
│  │  ├─ ModeCard × 3                      — 완전 AI/같이 고르기/직접 — 결과 예고·예상 소요·인터랙션 양
│  │  └─ NoBaseGuide                       — 숙소 0개 안내(나중 등록 온램프 CTA 예외)
│  ├─ GenerationProgressScreen
│  │  ├─ ProgressStepIndicator            — 단계 텍스트("장소 고르는 중→동선 맞추는 중→시간표 확정 중")·진행률·경과
│  │  ├─ FirstDayPreview                   — 첫 1일 5초 우선 노출 블록
│  │  ├─ GenerationControlBar             — '취소'(부분 초안 저장)·'백그라운드로 계속'
│  │  └─ FallbackNoticeBanner             — "일부 추천이 기본 모드로 생성"·"최소 일정"·최소 일정 재시도
│  ├─ ItineraryViewScreen
│  │  ├─ ViewToggleSegment                — 시간표/지도 세그먼트 전환(단일 데이터 소스)
│  │  ├─ TimelineView                     — 시간순 타임라인·시각/체류 블록·위반 배지
│  │  │  └─ SlotBlock                     — 슬롯(POI·시각·체류·LOCK 아이콘·압축 표시·위반)
│  │  ├─ MapView (shared/map 재사용)       — 순서 번호 핀+이동 동선(U3 KakaoMapBridge)
│  │  ├─ TransitSegmentLabel              — 이동 구간 "약 850m · 도보, 추정"(거리·수단만 — 소요시간 없음)
│  │  └─ DirectionsHandoffButton          — '길찾기' → 외부 지도앱 좌표 위임
│  ├─ SlotDetailSheet
│  │  ├─ RecommendReason                  — LLM 추천 이유(취향 근거·표시 전용)
│  │  ├─ PlacementReason                  — 솔버 배치 이유("영업시간 오전만→오전 배치")
│  │  ├─ StayDurationControl              — 체류 조정(고정 시 고정 제약)·압축 배치 고지
│  │  ├─ LockToggle                       — 슬롯 LOCK/해제(warm-start 보존)
│  │  └─ ReplaceSlotButton                — 슬롯 교체 후보(솔버 검증 통과분만)
│  ├─ ItineraryEditScreen
│  │  ├─ EditableSlotList                 — 추가·삭제·재정렬·시간 조정
│  │  ├─ LightValidationBadge             — 경량 검증 즉시 배지("이동시간 부족"/"영업시간 외")
│  │  ├─ InsertableSlotPicker             — POI 추가 시 삽입 가능 시간대만 후보
│  │  └─ SaveViolationDialog              — "○곳에서 시간이 안 맞아요" → 'AI 자동 보정 / 그대로 저장'
│  ├─ TogetherPickFlow
│  │  ├─ ConceptPicker                    — 슬롯별 컨셉/테마 선택
│  │  ├─ RadiusControl                    — 반경 조정(도보 15분/차량 15분 — 넓히면 이동 거리 표기)
│  │  ├─ SlotCandidateList                — 반경 내 후보(반경 밖 disabled·회색)
│  │  ├─ ZeroCandidateGuide               — 반경 0건 → 반경 확대/컨셉 변경 제안
│  │  └─ ModeSwitchButton                 — 도중 방식 전환(→완전 AI, 진행분 보존)
│  ├─ ConfirmScreen
│  │  ├─ ReadonlyItineraryView            — 확정 일정(시간표/지도 토글·읽기 전용)
│  │  ├─ ConfirmMeaningNote               — 확정 의미·이점 한 줄 설명
│  │  ├─ DDayContext                      — D-day·출발일 여행 시작 맥락
│  │  └─ UnlockForEditButton              — '일정 수정' → '편집 중' 전환(재확정 필요 D20)
│  └─ StayZoneRecommendScreen
│     ├─ CentroidMapView (shared/map 재사용) — 동선 무게중심·권역 지도
│     ├─ StayZoneCandidateList            — 평균 이동 거리 순·before/after '추정 이동 거리'
│     ├─ ApproximationNote                — 추정·전역 최적 비보장 표기
│     └─ RegisterRecommendedStayButton    — 추천 숙소 등록(U4 registerStay 연계)
└─ shared/validation                       — 경량 제약 검증기(D28 — C2 ConstraintSpec 소비)
   ├─ ConstraintSpecClient                — 서버 발행 규칙 명세(버전) 소비·캐시
   ├─ LightValidator                      — 영업시간·이동시간·고정 충돌 즉시 검사(UX용 사본)
   └─ SpecVersionGuard                    — 명세 버전 불일치 시 로컬 검사 보수적 비활성화(오판 방지)
```

### 5.3 생성 화면군

**GenerationModeSelectScreen**
- props: `tripId` · state: 선택 방식, 등록 숙소 존재 여부.
- 폼 검증(서버 규칙 대응): 각 방식 카드에 결과 예고·예상 소요·인터랙션 양 표시(BR-U5-34). 등록 숙소 0개면 `NoBaseGuide`("숙소를 먼저 등록하면…") — 단 '숙소 나중 등록' 온램프 CTA는 예외 노출(BR-U5-02).
- 상호작용: 방식 선택 → `M8.generateItinerary(tripId, mode)`(FULL_AUTO/MANUAL→진행 화면, TOGETHER→같이 고르기) · 나중 등록 → `StayZoneRecommendScreen`.
- data-testid: `itinerary-modeselect-card`, `itinerary-modeselect-nobase`, `itinerary-modeselect-onramp`.
- 사용 서버 능력: `M8.generateItinerary`.

**GenerationProgressScreen**
- props: `sessionId` · state: 진행 스트림(단계·진행률·경과), 첫 1일 노출 상태, 취소/백그라운드 상태, 폴백 플래그.
- 폼 검증: 첫 1일 5초 우선 노출(BR-U5-21), 진행 스트림 표시(BR-U5-22). '취소' 시 부분 초안 저장+'이어서 생성'(BR-U5-24). 폴백 고지 배너("일부 추천이 기본 모드로 생성"·최소 일정 재시도).
- 상호작용: `M8.streamGenerationProgress`(스트림) · '취소' → `M8.cancelGeneration(keepDraft=true)` · 완료 → `ItineraryViewScreen`.
- data-testid: `itinerary-progress-step`, `itinerary-progress-firstday`, `itinerary-progress-cancel`, `itinerary-progress-background`, `itinerary-progress-fallback`.
- 사용 서버 능력: `M8.streamGenerationProgress`, `M8.cancelGeneration`, `M8.resumeGeneration`.

**TogetherPickFlow (같이 고르기 — mode=TOGETHER)**
- props: `sessionId` · state: 현재 슬롯 커서, 컨셉, 반경, 기준점(직전 확정 슬롯).
- 폼 검증: 기준점=직전 확정 슬롯(첫 슬롯=등록 숙소, BR-U5-35). 반경 밖 후보 disabled·회색. 반경 확대 시 예상 이동 거리 표기(소요시간 없음). 0건 → 반경 확대/컨셉 변경 제안(`ZeroCandidateGuide`). 도중 방식 전환 시 진행분 보존(BR-U5-37).
- 상호작용: `M8.getSlotCandidates(slotCursor, concept, radius)` → `M8.chooseSlotCandidate` → 다음 슬롯 · `M8.switchGenerationMode`.
- data-testid: `itinerary-together-concept`, `itinerary-together-radius`, `itinerary-together-candidate`, `itinerary-together-disabled`, `itinerary-together-zeroguide`, `itinerary-together-modeswitch`.
- 사용 서버 능력: `M8.getSlotCandidates`, `M8.chooseSlotCandidate`, `M8.switchGenerationMode`.

### 5.4 조회·상세 화면군

**ItineraryViewScreen (시간표/지도 2보기)**
- props: `itineraryId` · state: 활성 보기(시간표/지도), 일정 데이터(단일 소스).
- 폼 검증: 한 보기 수정이 다른 보기에 즉시 반영(단일 데이터 소스, BR-U5-38). 이동 구간은 `TransitSegmentLabel`이 **거리·수단만**("약 850m · 도보, 추정") — 소요시간 필드 없음(BR-U5-39, INV-TRAVEL1). 지도 실패 시 시간표형 폴백. '길찾기'는 외부 지도앱 좌표 위임(`DirectionsHandoffButton`).
- 상호작용: `M8.getItinerary`(2보기 공용 데이터) · `MapView`는 U3 `shared/map` 재사용 · `DirectionsHandoffButton` → `M18.buildExternalMapHandoff`(길찾기 위임, 거리만) · 슬롯 탭 → `SlotDetailSheet`.
- data-testid: `itinerary-view-toggle`, `itinerary-view-timeline`, `itinerary-view-map`, `itinerary-view-transit`, `itinerary-view-directions`.
- 사용 서버 능력: `M8.getItinerary`, `M18.buildExternalMapHandoff`, (U3)`shared/map` 브리지.

**SlotDetailSheet**
- props: `itineraryId`, `slotId` · state: 추천/배치 이유 로드, LOCK 상태, 체류 값.
- 폼 검증: `RecommendReason`(LLM 취향 근거)·`PlacementReason`(솔버 제약 근거) 병기 — **표시 전용, 검증값 우선**(설명-시각 불일치 시 검증 시각 표시, BR-U5-40). LLM 설명 실패 시 "추천 이유를 불러오지 못했어요"(일정 영향 없음). 체류 압축 시 고지("권장 90분→최소 50분"). LOCK·교체는 솔버 검증 통과분만.
- 상호작용: `M8.getExplanations` · `M8.lockSlot`/`M8.unlockSlotLock`(LOCK) · `M8.replaceSlot`(교체 후보).
- data-testid: `itinerary-slot-recommendreason`, `itinerary-slot-placementreason`, `itinerary-slot-lock`, `itinerary-slot-replace`, `itinerary-slot-staycompressed`.
- 사용 서버 능력: `M8.getExplanations`, `M8.lockSlot`, `M8.unlockSlotLock`, `M8.replaceSlot`.

### 5.5 편집 화면

**ItineraryEditScreen**
- props: `itineraryId` · state: 편집 조작 목록, 클라 경량 검증 결과(위반), 저장 위반 분기.
- 폼 검증:
  - 편집 시 `shared/validation` 경량 검증기가 영업시간·이동시간·고정 충돌 **즉시 재검증**(UX용 사본 — 정본은 서버 C2, BR-U5-25). 명세 버전 불일치 시 로컬 검사 보수적 비활성화(`SpecVersionGuard`).
  - 위반은 **비차단** — `LightValidationBadge`("이동시간 부족"/"영업시간 외")+사유(BR-U5-26). POI 추가 시 `InsertableSlotPicker`(삽입 가능 시간대만).
  - 저장 시 위반 있으면 `SaveViolationDialog` → 'AI 자동 보정'(시각·순서만 G49) / '그대로 저장'(위반 보존·지속 가시화, BR-U5-27·28).
  - 확정 상태 일정 편집 진입은 `unlockForEdit` 선행(D20, BR-U5-33).
- 상호작용: `M8.validateEdit`(서버 확정 검증) · `M8.getInsertableSlots` · `M8.applyEdit(onViolation)` · `C2.repair`(자동 보정 경유는 M8) · 저장 네트워크 오류 → 로컬 임시("저장 대기 중").
- data-testid: `itinerary-edit-slotlist`, `itinerary-edit-validationbadge`, `itinerary-edit-insertpicker`, `itinerary-edit-violationdialog`, `itinerary-edit-autofix`, `itinerary-edit-saveasis`.
- 사용 서버 능력: `M8.validateEdit`, `M8.getInsertableSlots`, `M8.applyEdit`.

### 5.6 확정·권역 추천 화면군

**ConfirmScreen (일정 확정·확정본 열람)**
- props: `itineraryId` · state: 확정 검증 결과, 읽기 전용 보기, 확정/해제 상태.
- 폼 검증: 확정 전 서버 확정 검증(C2 `validate`) 통과 게이트 — 위반 잔존 시 'AI 자동 보정/그대로 저장' 선택 완료 후(BR-U5-31). 확정 후 읽기 전용(`ReadonlyItineraryView` — 시간표/지도 토글)+D-day/출발일(`DDayContext`)+확정 의미 한 줄(`ConfirmMeaningNote`, BR-U5-32). '일정 수정' → `unlockForEdit`('편집 중' 전환, 재확정 필요·재확정 전 신규 공개 불가 D20, BR-U5-33).
- 상호작용: `M8.confirmItinerary`(plan 동결 D14) · `M8.unlockForEdit` · `M8.getItinerary`(확정본 열람).
- data-testid: `itinerary-confirm-readonly`, `itinerary-confirm-meaning`, `itinerary-confirm-dday`, `itinerary-confirm-unlock`.
- 사용 서버 능력: `M8.confirmItinerary`, `M8.unlockForEdit`, `M8.getItinerary`.

**StayZoneRecommendScreen (숙소 나중 등록 온램프)**
- props: `tripId` · state: 무게중심·권역 후보, before/after 추정 거리.
- 폼 검증: 방문지 2개 미만 등 동선 부족 시 추천 미제공·일반 탐색 유도(INV-ZONE1). 후보는 평균 이동 거리 순, before/after **'추정 이동 거리'만**(소요시간 없음 D25). 추정·전역 최적 비보장 표기(`ApproximationNote`, BR-U5-44).
- 상호작용: `M8.recommendStayZone` · `CentroidMapView`는 U3 `shared/map` 재사용 · 추천 숙소 등록 → `M4.registerStay`(U3/U4 연계) → 기준점 삼아 재정렬(FLOW-1 warm-start).
- data-testid: `itinerary-stayzone-map`, `itinerary-stayzone-candidate`, `itinerary-stayzone-approxnote`, `itinerary-stayzone-register`.
- 사용 서버 능력: `M8.recommendStayZone`, (U3/U4)`M4.registerStay`, (U3)`shared/map` 브리지.

### 5.7 shared/validation — 경량 제약 검증기 (U5 신규, D28)

- 책임: 편집 중 즉시 제약 검사(영업시간·이동시간·고정 블록 충돌)를 클라이언트에서 수행하는 **UX용 사본** — **판정 정본은 항상 서버 C2**(저장 시 확정 검증). 규칙 명세(ConstraintSpec)는 C2가 버전 있는 계약으로 발행하고 본 계층이 소비한다(단일 규칙 정본화). 검증 로직 코드 생성/파생 방식은 NFR/Code Generation 소유.
- props: `ConstraintSpecClient{ version, rules[HC1~HC4] }` · state: 명세 버전, 로컬 검사 활성 여부.
- 상호작용·폴백:
  - `LightValidator`: 편집 조작마다 영업시간·이동 부등식·고정 충돌 즉시 검사 → `LightValidationBadge` 렌더(비차단, BR-U5-26).
  - `SpecVersionGuard`: 서버 명세 버전과 로컬 버전 불일치 시 **로컬 검사 보수적 비활성화**(통과→저장 거부 UX 방지, 서버 검증 위임 — D28 오판 방지).
  - 클라↔서버 규칙 동치는 동일 케이스 이중 실행 계약 테스트로 보장(PBT U5-P12).
- data-testid: `itinerary-validation-badge`, `itinerary-validation-specguard`.
- 사용 서버 능력: `C2.exportClientValidationSpec`(규칙 명세 발행), `M8.validateEdit`(서버 확정 검증 위임).

### 5.8 shared/ 재사용·U5 완성분 (요약)

| 계층 | U5 범위 | 근거 |
|---|---|---|
| shared/map (U3 소유) | **재사용** — 일정 지도형 뷰·권역 추천 지도·순서 핀·이동 동선(카카오 브리지). U5는 신규 지도 브리지 미생성 | components §6.1, U3 shared/map |
| shared/validation | **신규** — 경량 제약 검증기(C2 명세 소비·즉시 검사·버전 가드) | D28, G163 |
| shared/api | 생성 진행 스트림 소비·라이브 폴백 고지·저장 네트워크 오류 로컬 임시("저장 대기 중") | ADR-0011, PRD 06-8 |
| shared/ui | 위반 배지·폴백 고지 배너·'추정' 표기·시간표/지도 세그먼트 컴포넌트 | D25, PRD 06-9 |

### 5.9 화면-스토리-서버 능력 추적 매트릭스

| 컴포넌트 | 스토리 | 서버 능력(M8·C2) |
|---|---|---|
| GenerationModeSelectScreen | US-E5-01, US-E5-10 | M8.generateItinerary |
| GenerationProgressScreen | US-E5-09 | M8.streamGenerationProgress · cancelGeneration · resumeGeneration |
| TogetherPickFlow | US-E5-10 | M8.getSlotCandidates · chooseSlotCandidate · switchGenerationMode |
| ItineraryViewScreen | US-E5-06, US-E5-08 | M8.getItinerary · M18.buildExternalMapHandoff · (U3)shared/map |
| SlotDetailSheet | US-E5-05, US-E5-10 | M8.getExplanations · lockSlot · unlockSlotLock · replaceSlot |
| ItineraryEditScreen | US-E5-07, US-E5-08 | M8.validateEdit · getInsertableSlots · applyEdit |
| ConfirmScreen | US-E5-12 | M8.confirmItinerary · unlockForEdit · getItinerary |
| StayZoneRecommendScreen | US-E5-11 | M8.recommendStayZone · (U3/U4)M4.registerStay · (U3)shared/map |
| shared/validation | US-E5-07 | C2.exportClientValidationSpec · M8.validateEdit |

---

## 6. NFR (요구·설계 패턴·기술 스택)

U5의 NFR 본질은 **비결정적·고비용 LLM과 CPU 집약 솔버 위에서 5초/20초 응답 예산·무실패 보장·운영비 통제를 동시에 지키는 것**이다. 세 축(성능·복원력·비용)이 핵심이고 서로 긴장한다. 보안·무상태·관측성·배포의 서버 규약은 U1 전역 정본을 상속하고, U5는 LLM 경계(D31)·closed-set 그라운딩(G115)·솔버 결정성 증분만 소유한다. 시스템 전역 NFR 정본은 requirements.md §6, 성능 예산 정본은 services.md §S1.4다.

### 6.1 워크로드 중요도 (requirements.md §6.3)

| 컴포넌트 | 중요도 | 불가용 시 영향·U5 대응 |
|---|---|---|
| 일정 저장·조회(M8 저장부·DB) | **Critical** | 여행 중 일정 접근 불가 — RDS Multi-AZ·Auth 상속(폴백 없음, 오류·재시도) |
| AI 일정 생성 LLM 경로(C1) | **Medium** | 결정론 솔버 폴백으로 지속(품질 저하 고지) — LLM에 생성이 인질 잡히지 않음 |
| 솔버 배치(C2) | 기반 — 인프로세스 결정론 | 외부 무의존 순수 연산. 실패 모드는 '해 없음/시간 초과'만 → 최소 일정 폴백 |
| 후보 풀(M7 소비) | 기반(Medium) | 외부 소스 실패 시 정본 캐시 축소 풀(U3 소유 — U5는 소비자) |

핵심 원칙: 외부·비결정 의존(LLM·카카오모빌리티·POI)은 전부 Medium 이하 경로이며, 어떤 경로도 U5의 가용성 바닥이 되어서는 안 된다 — 마지막 폴백은 항상 **결정론 솔버가 만든 유효한 최소 일정**.

### 6.2 성능 (핵심 · D38 · services.md §S1.4)

목표는 **AI 일정 생성: 첫 1일 5초 내 노출 · 전체 20초 한계(초과 시 결정론적 솔버 폴백 고지)**다. services.md §S1.4가 이 예산을 단계별로 배분한 정본이며, 아래는 그 배분을 타임아웃·폴백 전환 시간과 함께 NFR로 승격한다. **경계 명시**: requirements.md §6.1의 "Plan-B 대안 제시 10초"는 M9·M10 소유로 **U6 범위**다 — U5는 생성(S1)만 소유한다.

**첫 1일 5초 게이트 — 단계 예산**

| 단계 | 예산 | 타임아웃·폴백(타임아웃<예산 원칙) | 추적 |
|---|---|---|---|
| 1~2. 세션 생성 + 컨텍스트 병렬 로드(M6·M2·M4) | **0.3초** | 단일 DB 왕복 병렬화. M2 실패→중립 기본값 전량 대체(무실패) | S1.2, US-E5-01 |
| 3. 후보 풀 조회(M7 closed-set) | **1.0초** | 정본 캐시 히트 0.2초·외부 보강 상한 1.0초. 외부 실패→정본 캐시 축소 풀 + 기본 모드 플래그 | G115, US-E5-02 |
| 4. **LLM 취향 점수(C1 — 경량 티어)** | **2.5초** | **타임아웃 2.5초 — 초과 즉시 규칙 점수 폴백(+0.1초)**. 전 일자 공용 1회 호출 | D11, US-E5-02·09 |
| 5. 1일차 solve(C2) | **0.8초** | 후보 상한(지역당 5천, G142) 기준. 해 없음→완화 제안/충돌 강조 | US-E5-03·04 |
| 6. 저장 + 직렬화 + 응답 | **0.4초** | TX1 day1 초안 저장(세션 `DAY1_READY`) | S1.2·1.3 |
| **첫 1일 합계** | **5.0초** | — | **D38** |

- **NFR-U5-PERF-01 (첫 1일 5초 게이트)**: TX1로 1일차 초안을 저장한 직후 첫 1일을 5초 내 반환. 이후 단계는 백그라운드. 5초는 하드 게이트가 아니라 체감 목표이며 초과 시에도 폴백으로 유효 결과 반환(빈 화면 금지).
- **NFR-U5-PERF-02 (LLM 타임아웃 2.5초 < 예산)**: LLM 점수 단계는 타임아웃 2.5초로 5초 예산 안에 규칙 점수 폴백(+0.1초)·잔여 단계까지 완주할 여유를 남긴다. 타임아웃은 예산이 아니라 **폴백 전환 트리거**다.
- **NFR-U5-PERF-03 (솔버 시간 예산)**: 1일차 solve 0.8초, 잔여 일자 solve 일자당 0.5초 목표. 후보 풀은 지역당 5천 상한 프루닝(G142)으로 문제 크기 억제.

**전체 20초 한계 — 잔여 일자 백그라운드**

| 단계 | 예산 | 폴백 | 추적 |
|---|---|---|---|
| 7. 잔여 일자 루프(최대 29일, G42) | **15초 내** | 일자당 solve 0.5초 목표 · 4단계 LLM 점수 재사용(재호출 없음) | §6.4 |
| **전체 한계** | **20초** | 초과 시 잔여 일자를 **결정론 솔버 단독 모드**로 완성 + 폴백 고지 | D38, US-E5-09 |

- **NFR-U5-PERF-04 (점진 노출)**: 완료된 첫 1일을 먼저 노출하고 나머지를 백그라운드로 이어 채우며 생성 중 단계 텍스트·진행률·경과 시간 표시. 진행 채널은 점진 응답 스트리밍(SSE 권고).
- **NFR-U5-PERF-05 (20초 하드 타임아웃 후 결정론 단독)**: 전체 20초 도달 시 잔여 일자는 규칙 점수 + 결정론 솔버 단독 모드로 완성("일부 추천이 기본 모드로 생성되었어요"). 20초는 비용·UX 상한이며 무한 대기를 차단.
- **NFR-U5-PERF-06 (취소·이어서 생성)**: 생성 중 '취소' 시 부분 일정 초안 저장 + '이어서 생성' 진입점(G161). '백그라운드로 계속'은 완료 시 화면 복귀 시 반영.
- **NFR-U5-PERF-07 (편집 재검증 즉시)**: 편집 시 클라이언트 경량 검증기(shared/validation)가 즉시 재검증하고 저장 시 서버 확정 검증(D28). 클라 검증은 무네트워크 로컬 연산(체감 즉시), 서버 `validateEdit`는 무상태.
- 클라이언트 성능: 일반 화면 전환 300ms(§6.1) 상속 — 시간표/지도 2보기 전환은 로컬 상태 전환. 지도 렌더는 U3 `shared/map` 상속(지연 로드·실패 시 시간표 폴백).

### 6.3 복원력 (핵심 · RESILIENCY-10 · ADR-0011)

정본은 services.md §0.1 실패 처리 표 + component-dependency §2.2·2.3(M8→C1·C2 장애 전파) + U1 PAT-RES-01 4요소 계약이다. **핵심: 생성은 절대 LLM에 인질 잡히지 않는다.**

**폴백 체인 (침묵 실패 금지)**

| 의존 단계 | 실패 시 폴백 | 사용자 고지 | 추적 |
|---|---|---|---|
| **LLM 점수/설명(C1)** | 규칙 점수 결정론 경로 — 카테고리-취향 축 매핑 + 인기 집계 가중, 설명 문구 생략 | "일부 추천이 기본 모드로 생성되었어요" / "추천 이유를 불러오지 못했어요" | RESILIENCY-10, US-E5-09 |
| **외부 POI/영업시간(M7 어댑터)** | 정본 캐시(J7 동기화분) 축소 풀 → 사용자 저장 POI + 필수 방문지만 최소 풀 | '기본 모드' 플래그·'미확인' 배지 | US-E5-02·03 |
| **이동시간(C2 카카오모빌리티 어댑터)** | 직선거리 × 우회계수(G106) 추정 → 최후 수동 입력 모드 | 추정치·수동 입력임을 화면 표기 | D25, US-E5-06 |
| **솔버 전 경로 실패(C2 포함)** | 숙소 + 시각 고정형 필수 방문지만 배치한 최소 일정 | "추천을 다시 시도" 동작 노출 | RESILIENCY-10, US-E5-09 |

- **NFR-U5-RES-01 (LLM 폴백 = 결정론 솔버 · Medium 경로)**: LLM 벤더 다운·타임아웃(2.5초)·출력 스키마 검증 실패(1회 재시도 후) → C1 서킷 오픈 → M8은 규칙 점수(취향 가중 휴리스틱) + 결정론 솔버로 지속. LLM 경로는 Medium이며 기본 모드 고지 동반(침묵 실패 금지).
- **NFR-U5-RES-02 (솔버 전 경로 실패 = 최소 일정)**: 솔버 실행 불가(제약 과잉·후보 부족)·시간 예산 초과 등 전 생성 경로 실패 시 빈 화면 대신 숙소 + 시각 고정형 필수 방문지만 배치한 최소 일정 반환. "결정론 폴백은 덜 최적이어도 유효한 해를 보장".
- **NFR-U5-RES-03 (해 없음 = 완화 제안, 자동 변경 없음)**: 제약 과잉으로 해 없음 → 위반 제약 완화 제안(필수 방문지 축소·시각 고정 해제·다른 날짜·시간창 확대)을 구조화 응답으로 반환. 고정 블록 상호 충돌 → 자동 변경 없이 충돌 강조 + 사용자 질의. 부분해는 초안 저장 + '이어서 생성'(G161).
- **NFR-U5-RES-04 (결정론 폴백 모드 = 완전 결정성)**: 규칙 점수 + 결정론 솔버 단독 모드는 동일 입력→동일 출력(폴백 결정성 — PBT 1급 대상 (d)). LLM·외부 데이터 없이도 하드 제약(영업시간·이동 부등식·고정 블록)을 만족하는 유효 일정 생성.
- **NFR-U5-RES-05 (외부 POI 캐시 축소 — 가용성 아님)**: 후보 풀 조회의 외부 실패는 정본 캐시 잔존분으로 축소 풀 구성(U3 소유 캐시 — U5는 소비자). 캐시는 지연 최적화가 아니라 이 경로에서 폴백 데이터 소스로 기능.

**어댑터 4요소 계약 (RESILIENCY-10 — component-dependency §6 상속)**

| 의존 (Port · 소유) | 타임아웃 | 재시도 | 서킷 | 폴백 |
|---|---|---|---|---|
| **LLM 벤더** (`LlmPort` · C1) | 점수 2.5초 / 설명·회고 상위 티어 별도 | 스키마 위반 1회 | 벤더 독립 서킷 | 규칙 점수 결정론 폴백(NFR-U5-RES-01) |
| **카카오모빌리티 도로 거리** (`RoadDistancePort` · C2) | 어댑터 타임아웃 | 없음 | 독립 서킷 | 직선거리×우회계수 1.3+안전계수(G106) → 네이버 2차(D08) |

- **NFR-U5-RES-06 (서킷·계측 의무)**: C1·C2 외부 어댑터는 명시적 타임아웃 + 독립 서킷(벌크헤드) + 폴백을 가진다. 서킷 open/half-open·LLM 오류·솔버 검증 실패는 전부 계측(SI §8.2 A12). 카카오모빌리티은 C2 소유(U3는 미호출).

### 6.4 비용 (핵심 · LLM 운영비 통제 · P6·G181)

LLM 호출은 곧 운영비이며 비용 상한이 후보 풀 크기·호출 전략을 결정한다. 호출량을 **구조적으로 억제**한다.

- **NFR-U5-COST-01 (전 일자 공용 1회 호출 — 재호출 없음)**: LLM 취향 점수는 생성 세션당 전 일자 공용 1회 호출. 잔여 일자 solve는 동일 점수를 재사용하고 LLM을 재호출하지 않는다 — 20일 여행에서 LLM 호출을 20회가 아닌 **1회**로 억제하는 1차 비용 방벽.
- **NFR-U5-COST-02 (기능별 티어 라우팅 D11)**: LLM 모델은 기능별로 티어 분리 — 취향 점수·재질의 = 경량 티어, 회고·배치 설명 = 상위 티어(D11·G194). 경량 작업이 상위 모델 단가를 소모하지 않게 한다. 티어 라우팅은 C1 내부.
- **NFR-U5-COST-03 (사용자별 rate-limit — SECURITY-11)**: LLM 호출은 사용자별 상한 rate-limit 적용(U1 PAT-SEC-03 레이트리미터 재사용 — LC-3 전역 컴포넌트). 반복 생성·어뷰징이 비용 폭증으로 이어지지 않게 하고 동시 생성 10(G142)과 정합.
- **NFR-U5-COST-04 (후보 풀 상한 프루닝)**: LLM 점수 입력 후보는 지역당 5천 상한 내 프루닝(G142). 토큰·단가는 후보 수에 비례하므로 후보 폭발 차단. closed-set 후보 ID만 전송(전체 POI 미전송).
- **NFR-U5-COST-05 (LLM 비용 계측)**: 호출별 티어·토큰·추정 비용을 LLM 호출 로그에 기록하고 CloudWatch 커스텀 메트릭으로 발행 → SI §8.2 대시보드 LLM 비용 위젯(U5 확장 슬롯)·A11 LLM 쿼터 80% 알람·A15 월 비용 예산 알람. U5가 LLM 비용 계측의 첫 소비자다.
- **NFR-U5-COST-06 (국외 이전 고지 · 필드 최소화 — G181)**: LLM 벤더가 국외인 경우 개인정보처리방침에 국외 이전·처리위탁 고지(P7 반영)를 하고 LLM 전송 필드를 목적 최소화 — closed-set 후보 ID·취향 축·중립 기본값만 전송하고 타 사용자 데이터·내부 지표(제휴 수수료)는 구조적으로 미포함(D31·SECURITY-11). 벤더 국내/국외 판별·단가는 P6 확정 후 remote config·시크릿 주입(비차단).

### 6.5 확장성 (§6.8 G142 — DAU 1천 · 동시 일정 생성 10)

- **NFR-U5-SC-01 (동시 생성 10 — 과설계 금지)**: 규모 가정은 동시 일정 생성 10건이며 이는 CPU 집약 솔버 연산 10개 동시를 의미한다. 별도 솔버 워커 서비스·큐·오토스케일 상향은 과설계 — 기존 ECS 태스크 2개(1 vCPU/2GB, SI §1.2) 내에서 흡수 가능한지를 태스크 CPU 사이징으로 판단. 전환 트리거: 동시 생성 실측이 태스크 CPU를 상시 포화시키면 솔버 워커 분리·태스크 vCPU 상향 재평가.
- **NFR-U5-SC-02 (백그라운드 잔여 일자 = 요청 단위 비동기)**: 잔여 일자 생성은 요청 단위 비동기 작업(워커 스레드, 모듈 경계 유지). ShedLock 스케줄 잡·EventBridge·큐 신규 없음 — 생성 요청 수명 내 앱 프로세스 내부 실행(가상 스레드/Executor). 백그라운드는 5초 게이트 이후 잔여 일자를 채우고 20초 내 완료 또는 결정론 단독 완성.
- **NFR-U5-SC-03 (솔버 CPU 벌크헤드)**: 솔버(CPU 집약)와 편집 재검증·조회(I/O)의 스레드 풀 분리(U1 PAT-PERF-02 벌크헤드 상속) — 무거운 solve가 경량 편집 재검증·CRUD 지연을 유발하지 않게 한다. 동시 생성 10 상한을 세마포어/rate-limit으로 보호(NFR-U5-COST-03과 통합).
- **NFR-U5-SC-04 (일정 데이터 볼륨)**: U5 신규 테이블 ~6개(일정 plan/current·일자·슬롯·생성 세션·추천 이유 메타·LLM 호출 로그). DAU 1천·여행당 일정 1개(활성 ≤1) 기준 소량 — 단일 PostgreSQL로 충분(샤딩 불요). LLM 호출 로그는 비용 계측·감사용 append 성격.

### 6.6 보안 (Security Baseline 상속 — §6.4 · LLM 경계 증분)

전역 보안 설정(deny-by-default·헤더·에러 핸들러·구조화 로깅·시크릿)은 U1 스캐폴드 소유·U5 상속. U5 증분은 LLM 경계·closed-set 그라운딩·소유권 세 지점이다.

- **NFR-U5-SEC-01 (LLM 컨텍스트 서버 재조회 경계 — D31 · SECURITY-11)**: LLM 컨텍스트 주입은 서버 재조회 방식 — 클라이언트는 ID만 전달하고 서버가 요청자 권한으로 재조회해 주입(D31·ADR-0015). 타 사용자 비공개 데이터·내부 지표(제휴 수수료 등)가 구조적으로 LLM 입력에 미포함. U5는 이 경계의 소비자이며, C1의 컨텍스트 재조회는 호출자가 전달한 조회 콜백/참조 해석기로 수행해 C1→기능 모듈 역의존 방지.
- **NFR-U5-SEC-02 (closed-set 그라운딩 구조 보안 — G115)**: LLM은 그라운딩된 후보 POI ID 목록에서만 선택(closed-set)하며 후보 목록 밖 POI는 구조적으로 일정에 포함될 수 없다. 출력 스키마 검증 + ID 화이트리스트 교차 검증을 C1 출구에서 강제 — closed-set 밖 ID 반환은 구조적 불가하나 방어적으로 드롭·계측. 프롬프트 인젝션으로 그라운딩을 우회할 수 없는 설계(LLM 신뢰 불요). POI 그라운딩은 하드 제약 4계열의 하나(D37 머지 차단).
- **NFR-U5-SEC-03 (LLM 호출 rate-limit — SECURITY-11)**: 사용자별 LLM 호출 상한(NFR-U5-COST-03과 동일 메커니즘) — 보안(어뷰징 차단)·비용 통제 이중 목적.
- **NFR-U5-SEC-04 (계정 무결성 — 하드 제약 D37)**: 생성 입력·출력에 타 계정 데이터 미혼입(D31 서버 재조회 경계) — 계정 무결성은 하드 제약 4계열의 하나(D37 머지 차단). 일정·세션·슬롯 접근은 토큰 주체(accountId) 스코핑(IDOR 차단, NFR-U1-SEC-18 상속·SECURITY-08).
- **NFR-U5-SEC-05 (LLM API 키 = 시크릿)**: LLM 벤더 API 키·카카오모빌리티 키는 소스·이미지·설정 파일에 미포함 — Secrets Manager 주입(`external/llm`·`external/kakao-mobility`). 어댑터별 키 격리, 시크릿 스캔 CI 게이트(SECURITY-10).
- **NFR-U5-SEC-06 (편집 입력 검증)**: 편집·생성 요청은 스키마 검증(SECURITY-05) — 슬롯·시각·POI ID·시간창 범위 검증, 클라 경량 검증기와 서버 확정 검증의 규칙 명세 단일 원천 공유(D28 — 통과→거부 UX 불일치 차단).

### 6.7 하드 제약·PBT 요건 (D37 · §6.6 — U5가 4계열의 본체)

- **NFR-U5-QUAL-01 (하드 제약 4계열 100% — D37 머지 차단)**: ① 숙소 기준점(모든 일자 동선이 해당 구간 거점 기준), ② 충돌 무배치(시간 중복·영업시간 밖·이동 부등식 위반 배치 0), ③ POI 그라운딩(출력 POI ⊆ 후보 풀 — closed-set), ④ 계정 무결성(타 계정 미혼입) — 100% 통과가 머지 차단 조건. LLM·외부 API는 어댑터 fake 모킹, 솔버·제약 검증은 실코드(D37·§6.6).
- **NFR-U5-QUAL-02 (PBT 1급 대상 — §6.6)**: 임의 후보 풀·시간창·고정 블록 입력에 대해 (a) 영업시간 내 배치, (b) 인접 슬롯 이동시간 부등식, (c) 고정 블록 불변(warm-start 전후 동일, G46), (d) 폴백 모드 결정성(동일 입력→동일 출력), (e) 일정 상태 머신(초안→편집중→확정→해제, D20) 전이 불변식, (f) plan/current 직렬화 왕복. Kotest(서버)·fast-check(클라)·시드 로깅·수축(PBT-08). 속성 식별은 §4.7(PBT-01).

### 6.8 NFR 설계 패턴 카탈로그 (PAT-U5-01~06 + 전역 상속)

패턴 형식: 문제 → 적용(설계) → U5 적용 지점 → 검증 기준(관련 규칙 ID). U5는 연산 무거운 유닛이므로 신규 패턴은 6종(성능·복원력·비용 중심)이며 보안 기본·관측성의 전역 패턴은 상속 표로 갈음한다.

| ID | 패턴 | 분류 | 핵심 근거 |
|---|---|---|---|
| PAT-U5-01 | 점진 생성·첫 1일 우선 반환(5초 게이트·백그라운드 잔여) | 성능 | D38, services.md §S1.4 |
| PAT-U5-02 | LLM 게이트웨이 폴백 체인(타임아웃→규칙 점수→결정론 솔버) | 복원력 | RESILIENCY-10, D11, services.md §0.1 |
| PAT-U5-03 | 솔버 warm-start·오라클 검증(고정 블록 불변·확정 재검증) | 복원력·정확성 | G46·G56, D37, PBT |
| PAT-U5-04 | 트랜잭셔널 처리(일자별 독립 TX·확정 스냅샷 원자성) | 데이터 일관성 | D14, services.md §0.2·1.3 |
| PAT-U5-05 | LLM rate-limit·기능별 티어 라우팅·비용 계측 | 비용·보안 | D11·G194·G181, SECURITY-11 |
| PAT-U5-06 | closed-set 그라운딩 구조(출력 스키마·ID 화이트리스트 교차 검증) | 보안·품질 | G115, D37, SECURITY-11 |

**PAT-U5-01 점진 생성·첫 1일 우선 반환 — 5초 게이트·백그라운드 잔여**
- 문제: 전체 여행 일정(최대 29일)을 다 만든 뒤 반환하면 수십 초 빈 화면. 단일 응답 모델로는 첫 1일 5초·전체 20초 체감을 만들 수 없다. 예산 초과 예상 단계를 예산 그대로 잡으면 폴백 전환 시간이 없어진다.
- 적용: services.md §S1.4 단계 예산을 2구간(첫 1일 동기 / 잔여 백그라운드)으로 분리, 예산 초과 예상 단계는 타임아웃 < 예산.

```text
[생성 요청] → GenerationSession(COLLECTING) + SSE 진행 채널 개설
  1~2. 컨텍스트 병렬 로드(M6·M2·M4)          0.3초
  3.   후보 풀(M7 closed-set)                1.0초
  4.   LLM 취향 점수(경량, 전 일자 1회)       2.5초 ← 타임아웃 2.5초(초과→규칙 점수 +0.1초)
  5.   1일차 solve(C2)                        0.8초
  6.   TX1 day1 저장 + 응답                    0.4초  ══> 첫 1일 5초 게이트 반환(DAY1_READY)
  ─────────────────────────────────────────────  (여기까지 5.0초)
  7.   백그라운드: 잔여 일자 루프              ≤15초  ← LLM 점수 재사용(재호출 없음), 일자당 solve 0.5초
       │  진행 스트림(단계·진행률·경과·일자 완료) SSE 갱신
       └ 전체 20초 도달 → 잔여 결정론 솔버 단독 모드 + 폴백 고지
  TX-final: 세션 GENERATED + outbox ItineraryGenerated(전체 완료 TX만)
```

- 설계 원칙: (a) 첫 1일 동기 반환·잔여 요청 단위 비동기 워커(큐 없음), (b) 진행 채널 SSE(ALB 스티키니스 불요·유휴 60초 > 20초 예산), (c) LLM 전 일자 공용 1회·잔여 점수 재사용(비용·시간 이중 절감), (d) 20초 하드 타임아웃 후 결정론 단독, (e) 취소→부분 초안 저장 + '이어서 생성'(G161), (f) 부분 일정은 GenerationSession 상태가 진행 정본.
- 검증 기준: D38 첫 1일 5초·전체 20초 예산 준수(단계 계측), 20초 초과 시 결정론 단독 전환 테스트. LLM 타임아웃 2.5초 < 예산·점수 재사용(잔여 일자 LLM 재호출 0) 테스트. G161 취소 시 부분 초안 저장·'이어서 생성' 진입.

**PAT-U5-02 LLM 게이트웨이 폴백 체인 — 타임아웃→규칙 점수→결정론 솔버**
- 문제: LLM(C1)은 제어 불가한 지연·오류·스키마 위반을 가진다(Medium). LLM에 생성이 인질 잡히면 벤더 장애가 곧 제품 마비다. 침묵 실패(빈 화면) 금지. 솔버(C2)조차 제약 과잉으로 해가 없을 수 있다.
- 적용: U1 PAT-RES-01 4요소 계약을 C1·C2에 의무화하고 services.md §0.1 실패 표를 폴백 체인으로 구현.

```text
[LLM 점수 호출]
  → 성공(2.5초 내·스키마 통과·closed-set) → POI별 취향 점수
  → 타임아웃 2.5초 / 5xx / 스키마 위반(1회 재시도 후) / 서킷 open
       → 규칙 점수 결정론 경로 + "일부 추천이 기본 모드로 생성되었어요"
[후보 풀(M7)]
  → 외부 소스 실패 → 정본 캐시 축소 풀 → 저장 POI + 필수 방문지 최소 풀
[솔버(C2)]
  → 해 없음(제약 과잉) → 위반 완화 제안(자동 변경 없음) + 부분해 초안(G161)
  → 전 경로 실패 → 숙소 + 시각 고정 필수 방문지만 최소 일정 + "다시 시도"
```

- 설계 원칙: (a) 타임아웃은 예산이 아니라 폴백 전환 트리거(2.5초 < 5초 예산), (b) 서킷 open/half-open·LLM 오류·솔버 검증 실패는 전부 계측(A12), (c) 폴백은 반드시 사용자 고지·계측과 짝(침묵 실패 금지), (d) 결정론 폴백 모드는 완전 결정성(동일 입력→동일 출력, PBT (d)), (e) 최종 폴백은 결정론 솔버가 만든 유효한 최소 일정(빈 화면 불가).
- 검증 기준: RESILIENCY-10 — C1·C2 명시 타임아웃·독립 서킷·폴백(코드 리뷰+계약 테스트). fake로 LLM 타임아웃·5xx·스키마 위반·서킷 open 주입 시 규칙 점수 폴백 실동작, 솔버 해 없음 시 최소 일정·완화 제안 노출 PR CI 통과. NFR-U5-RES-04 결정론 폴백 결정성 PBT.

**PAT-U5-03 솔버 warm-start·오라클 검증 — 고정 블록 불변·확정 재검증**
- 문제: 재생성·편집 시 사용자가 고정(LOCK)한 슬롯·시각 고정 필수 방문지·체류 고정값이 흔들리면 신뢰가 깨진다. 솔버 최적화 로직 버그가 있으면 하드 제약 위반이 그대로 출력된다. 확정 시점과 편집 시점 사이 상황이 바뀔 수 있다.
- 적용: warm-start(고정 블록 초기 해 고정) + 독립 오라클 검증 분리.
  - warm-start(G46): 재생성 시 LOCK·체류 고정·수동 추가 POI·시각 고정 필수 방문지를 불변 고정 블록으로 놓고 나머지만 재배치. 방식 전환(같이 고르기→완전 AI) 시에도 확정 슬롯 보존.
  - 오라클 검증 분리(D37): 솔버 산출 배치를 독립 검증기로 하드 제약(영업시간·이동 부등식·고정 블록 불변·closed-set) 재확인 — 최적화 로직과 검증 로직 분리(솔버 버그 ≠ 제약 위반 통과). 검증 실패 배치는 결과에서 제외.
  - 확정 시점 재검증(G56 — U6 재사용): 편집·재계획 확정 버튼 시점에 `C2.validate` 1회 재검증 — 그 사이 변화로 무효화 시 확정 차단·재산출 안내.
  - 클라 경량 검증기 규칙 공유(D28): 편집 즉시 재검증은 클라 경량 검증기, 저장은 서버 확정 검증 — 규칙 단일 원천 파생(통과→거부 불일치 차단).
- 검증 기준: D37 하드 제약 4계열 100%(머지 차단). PBT (a)(b)(c) — 영업시간 배치·이동 부등식·고정 블록 불변(warm-start 전후 동일). D28 클라/서버 규칙 동치 이중 실행 계약 테스트.

**PAT-U5-04 트랜잭셔널 처리 — 일자별 독립 TX·확정 스냅샷 원자성**
- 문제: 점진 생성은 부분 결과를 노출한다 — 일자별 저장이 하나의 큰 TX면 부분 노출 불가·실패 시 전체 롤백. 확정(plan 동결)과 POI 스냅샷·이벤트 발행이 원자적이지 않으면 반쪽 확정. LLM·솔버 호출을 TX 안에서 하면 외부 지연이 DB 커넥션을 잡는다.
- 적용: services.md §0.2·§1.3 TX 경계를 그대로 구현.

| 경계 | 원자성 단위 | 원칙 |
|---|---|---|
| 일자별 저장 | 일자별 독립 TX(TX1 day1, TXn dayN) | 부분 노출 허용 — GenerationSession 상태가 진행 정본 |
| 전체 완료 | 세션 `GENERATED` 전이 + outbox `ItineraryGenerated` | 전체 완료 TX만 발행(부분 완료는 이벤트 없음) |
| 확정 | plan 스냅샷 동결 + `M7.snapshotUserConfirmed` + outbox `ItineraryConfirmed` | 단일 TX 원자성(호출자 TX 참여 예외, D13·D14) |
| 외부 호출 | LLM(4)·솔버(5·7)·카카오모빌리티은 TX 밖 | 외부 지연이 커넥션 점유 금지 |
| 편집 | `validateEdit` 무상태 / `applyEdit`만 TX | 재검증은 DB 미변경 |

- 설계 원칙: (a) 아웃박스 패턴(상태 변경 TX에 outbox insert, 커밋 후 J10 릴레이 발행, at-least-once, 구독자 멱등), (b) 확정=plan 동결+스냅샷+이벤트 원자(반쪽 확정 불가), (c) current 갱신(U6 재계획)은 plan 불변(D14), (d) 외부 호출 TX 밖(커넥션 보호·PAT-PERF-02 벌크헤드 정합).
- 검증 기준: 일자별 독립 TX·부분 노출 테스트, 확정 원자성(plan+스냅샷+이벤트 단일 TX) 테스트. PBT (f) plan/current 직렬화 왕복. 아웃박스 at-least-once·구독자 멱등(eventId) 계약 테스트(CP5). 외부 호출 TX 밖 검증.

**PAT-U5-05 LLM rate-limit·기능별 티어 라우팅·비용 계측**
- 문제: LLM 호출은 곧 운영비. 무제한 호출·상위 모델 남용·후보 폭발은 비용 폭증이고, 어뷰징은 보안·비용 이중 위협. 국외 벤더면 개인정보 국외 이전 고지 의무(G181).
- 적용: 호출량을 구조적으로 억제하고 계측.
  - 전 일자 공용 1회 호출(COST-01): 생성 세션당 점수 1회, 잔여 일자는 점수 재사용 — 20일 여행에서 LLM 1회. 1차 비용 방벽.
  - 기능별 티어(D11·G194): 취향 점수·재질의=경량, 회고·배치 설명=상위. 티어→모델 매핑 remote config.
  - 사용자별 rate-limit(SECURITY-11): U1 PAT-SEC-03 레이트리미터 재사용(LC-3 전역) — 반복 생성·어뷰징 차단(동시 10 G142 정합).
  - 후보 프루닝(G142): LLM 입력 후보 지역당 5천 상한·closed-set ID만 전송(토큰 비례 억제).
  - 비용 계측(A11·A15): 호출별 티어·토큰·추정 비용 로그·메트릭 → SI §8.2 LLM 비용 위젯·쿼터 80% 알람·월 비용 예산 알람.
  - 국외 이전(G181): 전송 필드 목적 최소화(closed-set ID·취향 축만, 타 계정·내부 지표 미포함), 국외 벤더 시 처리방침 고지(P7).
- 검증 기준: 전 일자 1회 호출·잔여 재호출 0 테스트, 티어별 모델 라우팅 테스트, rate-limit 발동 테스트, 후보 상한 프루닝 확인. A11·A15 LLM 쿼터·비용 메트릭 발행 확인. G181 전송 필드 최소화(타 계정·내부 지표 미포함) 검증.

**PAT-U5-06 closed-set 그라운딩 구조 — 출력 스키마·ID 화이트리스트 교차 검증**
- 문제: LLM은 존재하지 않는 장소를 환각하거나 프롬프트 인젝션으로 후보 밖 POI를 삽입할 수 있다. 그라운딩 오염은 일정 전체 신뢰를 무너뜨린다. LLM을 신뢰하는 설계는 근본적으로 취약.
- 적용: LLM 신뢰 불요 — 구조적 강제(G115).
  - closed-set 입력: M7이 발급한 후보 POI ID 목록만 LLM에 전달 — LLM은 목록 밖 POI를 알 수 없다.
  - 출력 스키마 검증: LLM 응답은 JSON Schema 검증(poi_id→score) — 형식 위반은 1회 재시도 후 규칙 점수 폴백.
  - ID 화이트리스트 교차 검증: C1 출구에서 출력 POI ID가 후보 풀 ⊆ 확인 — closed-set 밖 ID는 구조적 불가하나 방어적으로 드롭·계측. 프롬프트 인젝션이 그라운딩을 우회할 수 없다.
  - 서버 재조회 경계(D31): 컨텍스트는 서버가 요청자 권한으로 재조회 — 타 계정·내부 지표 미주입.
- 검증 기준: G115/D37 POI 그라운딩 하드 제약 100%(출력 POI ⊆ 후보 풀, 머지 차단). 프롬프트 인젝션·후보 밖 ID 주입 시 드롭·계측 테스트. SECURITY-11 서버 재조회 경계로 타 계정·내부 지표 미주입 테스트. 계정 무결성 하드 제약 테스트.

**전역 상속 패턴 (U5 재정의 금지 — U1·shared 정본)**

| 상속 패턴 | 정본 | U5 적용 지점 |
|---|---|---|
| PAT-SEC-01 인증 필터 체인(deny-by-default) | U1 nfr-design | 일정·생성 세션·슬롯 = 인증 필수·accountId 스코핑(IDOR 차단) |
| PAT-SEC-05 시크릿 관리(외부 주입·하드코딩 금지) | U1 nfr-design | LLM 벤더 키·카카오모빌리티 키 = Secrets Manager 주입 — 어댑터별 키 격리 |
| PAT-RES-01 외부 의존 격리 계약(4요소) | U1 nfr-design | PAT-U5-02가 C1(LlmPort)·C2(RoadDistancePort) 어댑터 계약을 이 형식으로 작성 |
| PAT-RES-03 우아한 성능 저하(부분 장애 격리) | U1 nfr-design | PAT-U5-02 폴백 체인 — LLM 실패→규칙 점수, 솔버 전경로→최소 일정 |
| PAT-PERF-02 커넥션 풀·벌크헤드 | U1 nfr-design | 솔버 CPU 스레드 풀 ↔ 편집 재검증·CRUD I/O 풀 분리(NFR-U5-SC-03) |
| PAT-OBS-01 구조화 로깅·PII 마스킹 | U1 nfr-design | LLM 어댑터 로그도 동일 마스킹·상관 ID(프롬프트·응답 PII·키 미출현, D31 경계) |
| PAT-OBS-03 메트릭·알람 대상 | U1 nfr-design | LLM 비용·쿼터(A11·A15)·어댑터 실패율·서킷 open(A12) — U5가 LLM 비용 계측 첫 소비자 |
| OPS-01·02·03 운영 프로세스 | U1 nfr-design | 티어→모델 매핑·후보 프루닝·타임아웃·폴백 순서 remote config 변경은 OPS-01 변경 관리 |

### 6.9 기술 스택 결정 (U5 유닛 로컬)

스택 대분류(RN Expo + Spring Boot Kotlin + PostgreSQL, D02)와 U1 라이브러리 정본은 기확정이다. U5는 그 위에 **① C1 LLM Gateway, ② C2 Solver Engine, ③ 점진 응답 스트리밍, ④ 백그라운드 잔여 일자 잡** 4개 지점만 구체화하고 나머지는 U1 결정을 상속한다. LLM 벤더·모델·단가는 P6 확정 — 본 유닛은 **벤더 중립 추상화 구조**만 확정한다.

| # | 영역 | 결정 | 상속/증분 | 근거 ID |
|---|---|---|---|---|
| U5-C1 | C1 LLM Gateway | `LlmPort` 추상화 + 단일 벤더 클라이언트(SDK/HTTP) · 기능별 티어 라우팅 · 타임아웃 · **출력 스키마 검증(JSON Schema)** · 사용자별 rate-limit · 비용 계측. 벤더/모델은 P6 후 config·시크릿 주입, 인터페이스는 지금 | 증분 | D11·D31·G115·G181·G194, SECURITY-11 |
| U5-C2 | C2 Solver Engine | **OPTW/TOPTW — 검증된 솔버 라이브러리(Timefold/OptaPlanner) 위 도메인 모델** vs 자체 휴리스틱 비교 → 권고. 결정론 폴백 모드 내장 · 클라 경량 검증기와 규칙 단일 원천 공유(D28) | 증분 | US-E5-03·04·09, G46·G106·G115, D28 |
| U5-S1 | 점진 응답 스트리밍 | **SSE(Server-Sent Events)** — 단계 텍스트·진행률·경과·일자 완료 단방향 스트림. 폴백 = 폴링 | 증분 | US-E5-09, D38, NFR-U5-PERF-04 |
| U5-S2 | 백그라운드 잔여 일자 잡 | **요청 단위 비동기 워커(JDK 21 가상 스레드 / `@Async` Executor)** — 별도 워커 서비스·큐 없음 | 증분 | NFR-U5-SC-02, unit-of-work U5(스케줄러 잡 없음), G142 |
| U5-S3 | LLM 벤더 클라이언트 | 벤더 공식 SDK(가용 시) 또는 Spring `RestClient`(U1 상속) — 어댑터 뒤 은닉 | 증분(U1 Spring 상속) | D11, component-dependency §6 |
| U5-S4 | rate-limit·복원력 | **Resilience4j**(타임아웃·서킷·rate-limiter — U3 확정분 재사용) + U1 PAT-SEC-03 레이트리미터 | 상속 | RESILIENCY-10, SECURITY-11, U3-S1 |
| U5-PD | 클라우드·시크릿·로그·알림 | **U1 PD-1~9 종결·SI 상속** — LLM·카카오모빌리티 키 Secrets Manager(SI §6 예약) | 상속 | SI, U1 infrastructure-design §0 |

**C1 LLM Gateway — 대안 비교**: (A) **자체 게이트웨이 추상화(권고)** — 벤더 교체·티어 라우팅·출력 검증·비용 계측을 한 곳에 격리(D11 정합). (B) 벤더 SDK 직접 호출 — 벤더 종속·출력 검증·rate-limit 분산으로 SECURITY-11·G115 강제 약화(비채택). (C) LangChain류 오케스트레이션 — 단일 벤더·단일 호출 패턴(전 일자 1회)에는 과설계(비채택). 선정 사유: closed-set 그라운딩(G115)·서버 재조회 경계(D31)·비용 통제는 LLM을 신뢰하지 않는 구조적 강제가 핵심이며 게이트웨이 한 곳에 격리해야 검증·교체·계측이 가능. **P6 미확정 상태에서도 인터페이스·검증·라우팅은 확정 가능**(벤더 무관·비차단). 지금 확정(벤더 무관): `LlmPort` 인터페이스·티어 라우팅·출력 스키마 검증·closed-set 교차 검증·rate-limit·비용 계측·전 일자 1회 호출·후보 프루닝 / P6 후 확정(벤더 의존): 벤더·모델(경량/상위 매핑)·단가·토큰 상한·후보 풀 크기 최종값·국외/국내 판별.

**C2 Solver Engine — 대안 비교**: (A) **검증 솔버 라이브러리 + 도메인 모델(권고, Timefold/OptaPlanner류 JVM 제약 솔버)** — 하드 제약(영업시간·이동 부등식·고정)의 선언적 표현·검증이 D37 하드 제약 테스트·PBT 1급 대상과 직결, warm-start(G46)·타임박스(0.5~0.8초)·best-so-far 반환이 성능 예산·부분해 폴백(G161)과 정합, JVM 네이티브라 신규 프로세스 0. 결정론 폴백 모드는 동일 엔진을 시드·타임박스·규칙 점수 고정으로 돌려 동일 입력→동일 출력 보장. (B) 자체 휴리스틱(그리디+로컬 서치) — 하드 제약 정확성·warm-start·품질을 전부 자체 검증해야 해 D37 리스크 큼(단, 결정론 폴백의 최소 배치는 자체 그리디로 충분·A와 병존). (C) 범용 MIP/CP 솔버(OR-Tools 등) — 문제 크기(후보 5천·동시 10)에 과설계·네이티브 바인딩 별도 프로세스가 SI 컴퓨트 모델과 불일치(비채택). **오라클 검증 분리(NFR-U5-QUAL-01)**: 솔버 산출 배치를 독립 검증기(오라클)로 하드 제약 재확인 — 솔버 최적화 로직과 검증 로직 분리("솔버 버그가 곧 제약 위반"이 되지 않게). **솔버 라이브러리·commons-math(거리·기하)는 U1 Gradle version catalog 추가·잠금 파일 커밋**(SECURITY-10 상속).

**점진 응답 스트리밍 — SSE(권고)·폴백 폴링**: (1) 진행 스트림은 단방향이라 WebSocket 양방향 불필요, (2) ALB 스티키니스 불요(WebSocket 인프라는 U11 이연), (3) SSE 스트림 수명(≤20초)이 ALB 유휴 타임아웃 60초 내라 인프라 변경 0, (4) Spring `SseEmitter`로 U1 스택 내 구현. 폴백: SSE 미지원 클라이언트·프록시는 생성 세션 상태 폴링(GenerationSession 상태가 진행 정본). WebSocket 비채택: 양방향·스티키니스 불필요하고 WebSocket 인프라는 U11 이연 결정이라 U5 선도입은 과설계.

**백그라운드 잔여 일자 잡 — 요청 단위 비동기 워커(권고)**: JDK 21 가상 스레드 또는 `@Async` Executor. 생성은 요청 수명 내 완결(≤20초)이라 큐·별도 워커 불필요하고(SI §4 브로커 미도입 정합), 진행 스트림(SSE)이 동일 프로세스에 있어야 직접 연계된다. 솔버 CPU 벌크헤드(NFR-U5-SC-03)로 무거운 solve가 편집 재검증·CRUD를 지연시키지 않게 스레드 풀 분리. 별도 워커+큐(SQS)·ShedLock 비채택: SI §4 결정과 배치·동시 10 규모에 과설계·주기 잡용 부적합. 전환 트리거: 동시 생성 실측이 태스크 CPU를 상시 포화시키거나 생성이 API p95를 열화시키면 솔버 워커 분리(EventBridge·큐) 재평가.

**상속·비결정 재확인**: 서버 프레임워크·인증·DB 접근·마이그레이션(U1 상속), Expo SDK·TypeScript strict·상태 관리·HTTP·PBT(fast-check)(U1 상속), 클라우드·CI/CD·배포·시크릿·로그(GD-1~7·SI·U1 PD-1~9 종결 상속), LLM 아키텍처(D11 기확정 — 게이트웨이 구조만·벤더는 P6), 거리 벤더(D08 기확정 — 카카오모빌리티 도로거리·C2 어댑터 격리·U3 미호출), 복원력 라이브러리(Resilience4j)·인메모리 캐시(Caffeine)(U3 확정분 재사용). **U5 신규 벤더·클라우드 결정 = LLM 벤더(P6) 1건뿐**이며 본 유닛은 벤더 중립 게이트웨이 구조로 비차단화한다.

---

## 7. 인프라

공유 인프라 정본은 shared-infrastructure.md(SI)다. **U5는 SI를 참조만 하고 재정의하지 않는다.** 본 섹션은 U5가 SI에 추가하는 인프라 증분(LLM 벤더 아웃바운드·솔버 CPU 사이징·점진 응답 채널·백그라운드 잡·LLM 비용 계측)만 기술한다. 배포 파이프라인 정본은 U1 deployment-architecture.md다.

### 7.1 요약 — 신규 AWS 리소스 사실상 0

U5는 연산 최중량 유닛이나 **신규 AWS 리소스는 사실상 0**이다 — SI가 이미 U5를 명시적 소비자로 예약해 두었기 때문이다: NAT 아웃바운드(§2.1) + LLM·카카오모빌리티 시크릿(§6 "LLM API 키(U5) — 예약") + LLM 비용 계측 메트릭(§8.2 대시보드 "LLM 비용 U5 확장 슬롯") + A11 쿼터·A15 비용 예산 알람 + 워커 스레드 실행 모델(§1.2). U5 인프라 결정은 넷 — ① LLM 벤더 아웃바운드·시크릿, ② 솔버 CPU 연산 배치(기존 태스크 vs 별도 워커), ③ 점진 응답 채널(SSE)의 ALB 영향, ④ 백그라운드 생성 잡 — 이며 전부 기존 리소스 내 확장/설정이다.

**선결 경계**: LLM 벤더·모델·단가·후보 풀 크기 최종값·국외 이전 여부는 P6(LLM 벤더 계약·비용 산정) 확정 대상이다. 본 섹션은 아웃바운드 경로·시크릿 항목·비용 계측·연산 배치까지 벤더 중립으로 확정한다(비차단).

### 7.2 LLM 벤더 아웃바운드 · 시크릿 보관 (SI §2·§6 상속)

- 아웃바운드 경로: ECS(프라이빗 앱 서브넷) → NAT Gateway(SI §2.1, 기존 1개) → LLM 벤더 API·카카오모빌리티. `sg-app` 아웃바운드 443은 SI §2.2가 이미 허용("목적지 IP 가변 SaaS 예외 문서화") — SG 변경 0. 아웃바운드 목적지 문서화(egress 허용 목록):

| 목적지 | 어댑터(포트 · 소유) | 용도 |
|---|---|---|
| **LLM 벤더 API**(단일 관리형, D11) | `LlmPort` · C1 | 취향 점수(경량)·배치 설명·회고(상위 티어) — P6 벤더 확정 |
| 카카오모빌리티(도로 거리) | `RoadDistancePort` · C2 | 이동시간 추정 입력(D08·G106) — 실패 시 직선거리 폴백 |

- 시크릿(SI §6 프레임): 외부 API 키를 Secrets Manager에 등록(신규 서비스 아님 — SI §6 예약 항목 활성화): **`external/llm`**(LLM 벤더 API 키), **`external/kakao-mobility`**(카카오모빌리티 키 — U3에서 "U5에서 등록"으로 예약). ECS 태스크 정의 `secrets` ARN 참조 주입 — 코드·이미지·Terraform state 평문 0(NFR-U5-SEC-05·NFR-U1-SEC-11). 로테이션은 벤더 콘솔 주기 준수(P6 후 확정).
- 어댑터 타임아웃·서킷·rate-limit(NFR-U5-RES-06·COST-03)은 앱 소관(Resilience4j) — 인프라는 SI §8.2 A12(어댑터 실패율·서킷 open)·A11(쿼터 80%) 알람과 LLM 비용 계측(§7.6)을 제공.
- 국외 이전(G181): 벤더가 국외 리전인 경우 아웃바운드가 국외로 향한다 — 개인정보 국외 이전·처리위탁 고지(P7 개인정보처리방침) 대상. 전송 필드는 closed-set 후보 ID·취향 축으로 목적 최소화(D31·PAT-U5-06 — 인프라 밖 앱 강제). 벤더 국내/국외 판별은 P6 확정.

### 7.3 솔버 연산 배치 — 기존 ECS 태스크 내 CPU 집약 워커 (별도 워커 미도입)

C2 Solver Engine은 외부 무의존 인프로세스 결정론 연산이다 — 아웃바운드·DB 외 인프라 표면이 없다. 유일한 인프라 질문은 CPU 집약 연산 10개 동시(G142)를 어디서 돌리는가다.

| 기준 (G142 · 동시 생성 10) | **A. 기존 ECS 태스크 내 워커 스레드 (권고)** | B. 별도 솔버 워커 서비스 + 큐 |
|---|---|---|
| 신규 AWS 리소스 | **0** — 앱 프로세스 내 CPU 벌크헤드 스레드 풀 | +ECS 서비스·큐(SQS)·SG — SI §4 "브로커 미도입" 위반 |
| 진행 스트림(SSE) 연계 | **직접**(동일 프로세스) | 크로스 프로세스 팬아웃 필요 |
| 규모 정합(동시 10·저 DAU) | **적합** — solve당 0.5~0.8초·문제 크기 소, 1 vCPU/2GB(SI §1.2)로 흡수 판단 | 과설계(G142) |
| 격리(무거운 solve ↔ 편집·CRUD) | CPU 스레드 풀 분리(NFR-U5-SC-03 벌크헤드) | 프로세스 분리(과잉) |

- **확정 권고: A(기존 ECS 태스크 내 CPU 집약 워커 스레드) · 별도 솔버 워커 미도입.** 근거: 솔버는 인프로세스 결정론 코드라 아웃바운드·상태 공유가 없어 별도 서비스 이점이 없고, 동시 10·solve당 0.5~0.8초는 기존 태스크 2개(1 vCPU/2GB)로 흡수 가능한 규모, 별도 워커+큐는 SI §4(브로커 없음·DB 기반) 결정과 배치되고 SSE 진행 연계가 끊긴다.
- 태스크 CPU 사이징 재검토(SI §1.2 대비): SI §1.2 태스크 사이즈(1 vCPU/2GB)는 JVM 상주 + argon2id 검증(U1) 기준 산정. U5의 CPU 집약 solve 동시 10은 새 부하 프로파일이므로 Functional Design/Code Generation에서 부하 실측 후 판단: 동시 10 solve가 1 vCPU를 상시 포화시키면 (a) 태스크 vCPU 상향(1→2) 또는 (b) 오토스케일 CPU 임계 하향(SI §1.2 Target Tracking 60%)으로 대응. 솔버 CPU 벌크헤드로 무거운 solve 스레드 풀 ↔ 편집 재검증·CRUD I/O 풀 분리. 동시 생성 세마포어(NFR-U5-COST-03과 통합)로 동시 10 상한 보호.
- 전환 트리거: 동시 생성 실측이 태스크 CPU를 상시 포화시키거나 solve가 API p95를 열화(A2·A4 상관 관측)시키면 솔버 워커 분리(EventBridge + ECS RunTask) 재평가. 그 전까지 별도 워커 미도입(과설계 금지).
- C2 결정론 폴백은 순수 연산: 규칙 점수 + 결정론 솔버 단독 모드는 외부 무의존(LLM·카카오모빌리티 없이 배치) — 인프라 표면 0, LLM/외부 장애와 독립 동작.

### 7.4 점진 응답 채널 — SSE (ALB 영향 최소)

첫 1일 5초 게이트 후 잔여 일자를 백그라운드로 채우며 진행을 스트리밍한다(PAT-U5-01). 채널은 SSE.

- ALB 영향(SI §2.3): SSE는 롱리브드 HTTP 응답 — ALB 유휴 타임아웃 60초 > 전체 생성 예산 20초이므로 단일 SSE 스트림이 유휴 없이 진행 이벤트를 흘려 타임아웃 내 종료. 스티키니스 불요(WebSocket 인프라는 U11 이연) — SSE는 단일 요청 수명이라 다중 인스턴스 세션 고정 불필요. **ALB 설정 변경 0** — 기존 `/api/*` 대상 그룹 흡수.
- 폴백: SSE 미지원 프록시·클라이언트는 GenerationSession 상태 폴링(세션 상태가 진행 정본)으로 대체. 폴링도 기존 `/api/*` 경로 재사용(신규 리소스 0).
- HTTP/keep-alive: SSE는 HTTP/1.1 keep-alive로 동작 — Fargate 태스크·ALB 기본 설정 내(별도 프로토콜 설정 불요).

### 7.5 백그라운드 생성 잡 — 요청 단위 비동기 (스케줄러/큐 신규 없음)

잔여 일자 생성은 요청 단위 비동기 워커(스케줄러 잡 없음)다.

- 실행 모델: 생성 요청 수명 내(≤20초) 앱 프로세스 내부 JDK 21 가상 스레드 / `@Async` Executor로 잔여 일자 solve 실행. **ShedLock 스케줄 잡·EventBridge·SQS 신규 없음**(SI §1.2 스케줄러 프레임은 주기 잡용 — 요청 구동 생성엔 미사용, SI §4 브로커 없음 정합).
- 격리: 백그라운드 solve 워커 풀은 요청 처리 풀·편집 재검증 풀과 분리(NFR-U5-SC-03 벌크헤드) — 백그라운드가 신규 요청 수락을 막지 않게.
- 크래시 내성: 백그라운드 미완료 시 GenerationSession 상태가 `DAY1_READY`/부분 상태로 남아 '생성 중' 식별 — 재진입 시 '이어서 생성'(G161). `ItineraryGenerated`는 전체 완료 TX만 발행(부분 미발행) — 크래시가 반쪽 이벤트를 만들지 않는다.

### 7.6 LLM 비용 계측 · 외부 알람 (SI §8.2 구체화)

- LLM 비용 메트릭(NFR-U5-COST-05): C1이 호출별 티어·토큰·추정 비용을 CloudWatch 커스텀 메트릭(`cloudwatch:PutMetricData` — SI §7.1 태스크 역할 허용)으로 발행 → SI §8.2 대시보드 `trippilot-{env}-ops`의 "LLM 비용 계측(U5 확장 슬롯)" 위젯 활성화. U5가 이 슬롯의 첫 소비자다.

| 알람(SI 프레임) | U5 소스 | 임계 | 단계 |
|---|---|---|---|
| A11 외부 쿼터 80% | LLM 벤더·카카오모빌리티 호출량 vs 문서화 쿼터 | 80% | P2 |
| A12 어댑터 실패율·서킷 open | LLM·카카오모빌리티 어댑터 | 실패율 >20%(5분) 또는 서킷 open | P2 |
| **A15 월 비용 예산**(AWS Budgets) | LLM 호출 비용 포함 월 예산 | 예산 80%·100% | P2 |

- 알람 라우팅은 SNS `trippilot-{env}-alerts` → OPS-02 프로세스. LLM 쿼터·단가는 P6 벤더 계약 확정 후 문서화. A15 비용 예산은 LLM 운영비를 반영해 SI §10 비용 개요에 추가 예산 라인으로 편입(P6 산정 후).
- 관측(§6.7): LLM 오류·솔버 검증 실패·타임아웃은 전부 계측(침묵 실패 금지) — PAT-OBS-01·03 상속, 어댑터 로그는 D31 경계로 프롬프트·응답 PII·키 미출현.

### 7.7 SI 대비 델타 표

| 계층 (SI 절) | 신규 AWS 리소스 | 변경 | 근거 |
|---|---|---|---|
| 컴퓨트 ECS (SI §1) | **0** | 태스크 CPU 사이징 재검토(동시 10 solve 부하 실측 후 vCPU 상향/오토스케일 임계 조정 판단) — 별도 솔버 워커 미도입 | §7.3, G142 |
| 네트워크 VPC·NAT·ALB (SI §2) | **0** | 0 — NAT 아웃바운드(LLM·카카오모빌리티)·`sg-app` 443·`/api/*` 재사용. SSE ALB 설정 변경 0(유휴 60초>20초·스티키니스 불요). 아웃바운드 허용 목록 문서화만 | §7.2·§7.4, SI §2.1·2.3 |
| 데이터베이스 RDS (SI §3) | **0** | 테이블 ~6개(일정 plan/current·일자·슬롯·생성 세션/초안·추천 이유 메타·LLM 호출 로그) — 기존 RDS·Flyway 확장 | §6.5, unit-of-work U5 |
| 캐시 (신규 계층) | **0** | 0 — U5는 M7 후보 풀(closed-set) 소비자, LLM 응답 캐싱 없음(개인화·closed-set별 상이) | §6.1 |
| 시크릿·KMS (SI §6) | **0** | Secrets Manager 항목 2개 활성화(`external/llm`·`external/kakao-mobility`) — SI §6 예약분 | §7.2, SI §6 |
| 관측성 CloudWatch (SI §8) | **0** | LLM 비용 위젯 활성화(U5 확장 슬롯)·A11·A12·A15 LLM 소스 편입 | §7.6, SI §8.2 |
| 메시징·비동기 (SI §4) | **0** | 0 — 백그라운드 생성은 요청 단위 비동기 워커(큐·브로커 없음, SI §4 정합) | §7.5 |
| 스토리지 S3·CloudFront (SI §5) | **0** | 0 — U5는 사진·정적 자산 없음 | SI §5 |

**총계: 신규 AWS 리소스 0 / 변경 = RDS 스키마 확장(테이블 ~6개) + Secrets Manager 항목 2개 활성화 + LLM 비용·쿼터·예산 알람/위젯 활성화 + 태스크 CPU 사이징 재검토(부하 실측 후).** U5는 연산이 무겁지만 인프라는 SI가 예약한 프레임(NAT·시크릿·비용 계측·워커 모델) 내에서 종결된다 — 솔버는 인프로세스, LLM은 아웃바운드 1종이라 신규 인프라 표면이 없다.

### 7.8 배포 — shared 파이프라인 재사용

U5는 별도 배포 아키텍처 문서를 만들지 않는다 — 전역 배포 파이프라인 정본(U1 deployment-architecture.md)을 재사용한다.

- 서버(M8·C1·C2 모듈 + 일정 마이그레이션): `server/**` 경로이므로 `server-ci.yml`·`server-deploy.yml` **수정 없이** 커버(U1이 "유닛별 모듈 추가는 워크플로 수정 불요"로 완성). 일정·세션·슬롯·LLM 로그 테이블 추가는 Flyway forward-only(신규 테이블 = N-1 호환 "자유", OPS-01). 롤백=버전 고정 재배포(GD-4)·롤링(GD-5) 상속. **LLM·카카오모빌리티 시크릿은 배포 전 Secrets Manager 등록.** 솔버 라이브러리·commons-math는 Gradle version catalog + 잠금 파일(SECURITY-10 상속).
- 모바일(`features/itinerary`·`shared/validation`): `apps/mobile/**` 경로 — `mobile-ci.yml`(tsc·ESLint·Jest+fast-check) 커버. **순수 JS/TS 화면**(생성 진행·시간표/지도 2보기·편집·확정)이라 **네이티브 델타 없음** — expo-updates OTA 반영 가능(U3 카카오 지도 SDK 같은 네이티브 재빌드 불요). 지도 표시는 U3 `shared/map` 상속. 클라 경량 검증기(`shared/validation`)는 서버 규칙 단일 원천 파생(D28).
- 환경: dev(자동)·prod(승인 게이트) 승격 상속. **LLM 티어→모델 매핑·후보 프루닝 상한·타임아웃·폴백 순서·rate-limit·벤더 단가는 remote config·시크릿으로 환경별 독립**(SI §9) — P6 확정 후 값 주입(코드 재배포 없이 조정, OPS-01 변경 관리).

**U5 배포 델타**: 서버·모바일 모두 기존 워크플로 흡수(0 델타). 유일한 배포 전 조치는 LLM·카카오모빌리티 시크릿 등록(P6 후)과 LLM 파라미터 remote config 주입이며 인프라 파이프라인 변경은 없다.
