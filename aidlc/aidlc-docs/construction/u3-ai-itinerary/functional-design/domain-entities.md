# U3 AI Itinerary Generation — Domain Entities

> **원칙**: 실장 우선(U2 §0 규칙 1과 동형). backend `modules/itinerary-generation`에 **이미 존재하는 엔티티는 실장을 정본으로 기록**하고, 신설이 필요한 것만 새로 정의한다.
> POI·후보풀은 U1(C7) 소유 — 여기서는 `sourcePoiId`·`poiSnapshotId` 참조만 다룬다.

---

## 1. 기존 엔티티 (실장 = 정본)

### 1.1 `Itinerary` — 여행 1건의 일정 (실재)

| 필드 | 타입 | 규칙 |
|---|---|---|
| `itineraryId` | UUID | |
| `tripId` | UUID | 여행 1:1 |
| `status` | `ItineraryStatus{PLANNED, CONFIRMED}` | **단방향 잠금**(US-SCHED-12). 재편집 전이는 BR-U3-09 |
| `solveMode` | `SolveMode{FULL_AI, DETERMINISTIC, MINIMAL}` | U2 BR-U2-03 매핑 결과 |
| `days` | `List<ItineraryDay>` | |

### 1.2 `ItineraryDay` (실재)

| 필드 | 규칙 |
|---|---|
| `date` · `dayOrder` | |
| `slots` | `List<VisitSlot>` — **순서 오름차순 정렬 보장** |

### 1.3 `VisitSlot` (실재 · V2.7 + V2.8)

| 필드 | 규칙 |
|---|---|
| `sourcePoiId` | 생성 시점 POI — **항상 존재** |
| `poiSnapshotId` | **확정 시 동결**(INV-U1-03). PLANNED 동안 `null` |
| `orderIndex` | ≥ 0 |
| `startAt` · `endAt` | `LocalTime`. **솔버 검증값만**(INV-2) |
| `isFixed` | 앵커·시각 고정 필수 방문지 |
| `hasViolation` | 편집 후 위반 지속 가시화(US-SCHED-07) |
| `endsNextDay` | 자정 넘김(HC4) — true면 `endAt < startAt` 허용. DB `CHECK (ends_next_day OR end_at >= start_at)` |

- **duration 필드 없음(INV-3) — 타입으로 보장.** 이 유닛에서 추가하지 않는다.

---

## 2. 신설 엔티티

### 2.1 `ItineraryRevision` — 일정 편집 이력 (DEC-U3-1 · h36)

되돌리기 지점 1건. **U3가 소유하는 것은 "사용자 편집 + AI 생성 기준 버전"뿐**이다.

| 필드 | 타입 | 규칙 |
|---|---|---|
| `revisionId` | UUID | |
| `itineraryId` | UUID | |
| `seq` | Int | 단조 증가. 되돌리기는 **새 리비전을 쌓는다**(과거 삭제 없음) |
| `actor` | `RevisionActor{USER, AI}` | 화면의 `나`/`AI` 배지 |
| `kind` | `RevisionKind{BASELINE, GENERATE, EDIT, RESTORE}` | `BASELINE` = "AI가 처음 짠 일정 · 기준 버전" |
| `summary` | String | "광안리 해변 추가" · "용궁사 순서 이동" — **표시 문구** |
| `detail` | String? | "+ 광안리 해변 (14:30)" · "3번째 → 5번째" |
| `snapshot` | jsonb | 복원용 일정 전체 스냅숏 |
| `createdAt` | Instant | "18분 전" 상대 표기의 원천 |

- **1차 미포함**: `planbTriggerId`(U4 소관) · `companionUserId`(U9, DEC-U3-8로 제외). **컬럼도 만들지 않는다** — 유닛이 오면 그때 추가.
- **보존 정책**: 여행 종료 시 U5 아카이브 change-log로 이관/참조되는지는 **U5 설계에서 결정**(여기서 정하지 않음).

### 2.2 `GenerationSession` — 생성 진행 상태 (h09·h10)

첫 1일 조기 노출 + 백그라운드 채움을 표현한다(US-SCHED-09).

| 필드 | 규칙 |
|---|---|
| `sessionId` | UUID |
| `itineraryId` | UUID? — day1 확정 전에는 null 가능 |
| `status` | `GenerationStatus{RUNNING, DAY1_READY, COMPLETED, FAILED, CANCELED}` |
| `mode` | `GenerationMode{FULLY_AI, CO_PLAN, MANUAL}` |
| `partial` | jsonb — day1만 담긴 중간 결과 |
| `isFallback` · `candidatesLevel` | 경계 응답 전달분(폴백 배너 근거) |
| `startedAt` · `day1ReadyAt` · `finishedAt` | 진행률·단계 텍스트의 원천 |

- **취소**(h09 [취소]): `CANCELED`로 두고 부분 결과는 버린다. 백그라운드 전환은 세션을 살린 채 화면만 이탈.

---

## 3. 불변식 (INV-U3-\*)

| ID | 불변식 |
|---|---|
| **INV-U3-01** | `Itinerary.days`는 여행 기간의 각 날짜에 정확히 1개. 누락·중복 없음 |
| **INV-U3-02** | `ItineraryDay.slots`는 `orderIndex` 오름차순이며 값이 연속(0..n-1) |
| **INV-U3-03** | `isFixed=true` 슬롯은 재생성·repair·되돌리기 어느 경로에서도 시각이 바뀌지 않는다(HC3) |
| **INV-U3-04** | `status=CONFIRMED`인 동안 슬롯 변경 API는 거부된다 |
| **INV-U3-05** | 확정 시 모든 슬롯의 `poiSnapshotId`가 채워진다(null 없음) |
| **INV-U3-06** | `ItineraryRevision.seq`는 itinerary 안에서 유일·단조. 되돌리기도 **새 seq를 쌓는다**(이력 삭제 금지) |
| **INV-U3-07** | 초안 단계(h11·h17) 응답에는 **고정 블록을 제외한 슬롯의 시각을 렌더하지 않는다**(DEC-U3-3) — 데이터는 있어도 표시하지 않는다 |
| **INV-U3-08** | 재생성 계열 동작은 **직전 상태를 리비전으로 남긴 뒤에만** 실행된다(§business-logic-model 1.1) |

---

## 4. 도메인 이벤트

| 이벤트 | 발행 시점 | 구독 |
|---|---|---|
| `ItineraryGenerated` | 생성 완료(아웃박스) | C14 알림 · U5 아카이브 |
| `ItineraryConfirmed` | 확정 | C14 알림(출발 리마인드) · U4(Plan-B 기준선) |
| `ItineraryEdited` | 편집 저장 | U5 change-log |
| `ItineraryRestored` | 되돌리기 적용 | U5 change-log |

- `ItineraryConfirmed`가 **Plan-B의 실행 기준선**을 확정한다(US-SCHED-08).

---

## 5. 소유 경계 확인

| 데이터 | 소유 |
|---|---|
| POI 정본·후보풀·영업시간 | **U1 / C7** — U3는 `sourcePoiId`로 조회만(DEC-U3-9) |
| 여행·앵커·필수 방문지(`must_visit`) | **U1 / C4·C6** — U3는 화면만(DEC-U3-7) |
| 솔버 해·검증·설명 | **U2 경계 뒤(AI)** |
| 일정·슬롯·편집 이력·생성 세션 | **U3** |
| Plan-B 트리거·재계획 이력 | **U4** |
| 방문 실적·사진·아카이브 change-log | **U5** |
