# U1 Accommodation & Trip Setup — Domain Entities

> 기술 중립 도메인 모델. 선재 `backend/docs/design/전체-최소-스키마.dbml`을 기준선으로 삼되, 라이브 Figma와 충돌하는 항목은 이번 설계가 덮어쓴다(Q1=D). **신설·개정 항목은 ⚠로 표기**.
> 불변식 ID: `INV-U1-##`. 규칙 대응은 `business-rules.md`의 `BR-U1-##`.

---

## 1. 장소 (C7 Place Data — U1 소유, DEC-4)

### Poi — 정본 장소
| 속성 | 타입 | 비고 |
|---|---|---|
| id | UUID | |
| nameKo | string | |
| coord | Point(lat, lng) | **필수** — 좌표 없는 POI는 존재할 수 없음 |
| category | enum | 명소·맛집·카페·야경·자연·쇼핑·문화 (d04 필터 칩과 동일 도메인) |
| region | string | 시·군·구 (표시용: "사하구", "수영구") |
| openingHours | string? | 미확인 시 null → 화면은 "미확인" 표기 |
| dataStatus | enum | `ACTIVE` · `UNVERIFIED` · `LOST` · `CLOSED` |
| source | enum ⚠ | `KAKAO_LOCAL` · `TOURAPI` · `MANUAL` — 수집 게이트 판정 입력 |
| savedCount | int ⚠ | d01·d04의 "1.2k 저장" 표시용 파생 집계 |

- **INV-U1-01 (INV-1 집행)**: `dataStatus = ACTIVE`이고 수집 게이트를 통과한 POI만 후보풀에 들어간다. 외부·웹 출처는 `UNVERIFIED`로 먼저 등록되며, 게이트 통과 전에는 추천·후보에 노출되지 않는다.
- **INV-U1-02**: 좌표가 없으면 저장·담기·필수 방문지 지정 불가.

### PoiSnapshot — 확정 시점 동결본
| 속성 | 타입 | 비고 |
|---|---|---|
| id · sourcePoiId | UUID | 원본 참조(FK 미강제 — 원본 삭제돼도 유지) |
| nameKo · coord · category | 값 복사 | 동결 |
| snapshotAt | timestamp | |

- **INV-U1-03**: `must_visit`·방문 기록(U5)은 항상 `PoiSnapshot`을 참조한다. 원본 `Poi`가 폐업·이동해도 **확정된 여행 내용은 바뀌지 않는다**.

### SavedPlace — 담은 장소 (♥)
`(accountId, poiId)` 유일 · `savedAt`. 계정 귀속(기기 무관).
- **INV-U1-04**: 담기는 로그인 사용자만. 담은 장소는 여행 생성 시 `MustVisit(ANYTIME)` 시드로 **복사**(참조 아님)된다.

---

## 2. 숙소 (C3·C4)

### Stay — 외부 숙소 (앱 비소유 · 조회 캐시)
| 속성 | 타입 | 비고 |
|---|---|---|
| externalSource · externalId | string | 공급자 + 공급자 내 ID |
| name · coord · region | | 정적 콘텐츠(캐싱 허용) |
| amenities | enum[] | 주차·조식·와이파이·오션뷰 … (e03 편의시설) |
| stayType | enum | 호텔·게스트하우스·펜션·리조트 |
| **lowestPriceSnapshot** ⚠ | { amount, currency, capturedAt } ? | **"부터 가격"** — 정적 취급, 갱신 주기 명시(DEC-11) |

- **INV-U1-05 (가격 2단)**: 목록·카드에 노출되는 값은 `lowestPriceSnapshot`뿐이다. **정확 1박가는 저장하지 않는다** — 상세·딥링크 시점에 `LivePricePort`로 조회하고 즉시 버린다(ADR-0012).
- **INV-U1-06**: 스냅숏이 없으면 금액 자리에 `가격 미확인`을 표기한다. 가격 부재가 카드 자체를 숨기는 사유가 되지 않는다(부분 실패 — US-STAY-11).

### SavedStay — 저장한 숙소 (♥ · 계정 귀속) ⚠ 개정
| 속성 | 타입 | 비고 |
|---|---|---|
| id · accountId | UUID | |
| name · coord | | 등록 시점 값 보존(외부 조회 불가해져도 사용 가능) |
| coordConfirmed | bool | 지도에서 위치 확인 완료 여부 |
| checkIn · checkOut | date? | **nullable** — 저장만 한 숙소는 날짜가 없다 |
| externalSource · externalId | string? | 직접 등록(핀 지정)이면 null |
| registerRoute | enum ⚠ | `MAP_SEARCH` · `LINK_PASTE` · `PIN` (DEC-6 3경로) |
| memo | string? | US-STAY-04 메모 |
| createdAt | timestamp | |

- **INV-U1-07 (CQ1=A의 핵심)**: `SavedStay`에는 **거점 여부 필드가 없다.** 거점은 `BaseAssignment`(여행×숙소×날짜구간) 관계로만 표현된다. e04의 `거점` 배지는 "현재 여행에서 거점으로 쓰이는 중"을 조인으로 파생한 표시다.
- **INV-U1-08**: `coordConfirmed = false`면 등록(거점 배정) 불가 — 화면은 "지도에서 위치를 확인해 주세요"로 차단(e05 conflict).
- **INV-U1-09**: `checkOut > checkIn` (같은 날 불가). 둘 중 하나만 있으면 저장은 되지만 거점 배정은 불가.

### OtaPartner · OutboundClick (C5)
- `OtaPartner`: code · name · deeplinkTemplate · active
- `OutboundClick`: accountId · savedStayId? · stayExternalId · otaPartnerId · clickedAt · **postbackStatus** ⚠(`NONE`·`RECEIVED`)
- **INV-U1-10**: 전환·수수료는 **내부 운영 지표로만** 저장하며 어떤 사용자 대면 응답에도 포함하지 않는다. 포스트백 처리는 멱등(같은 거래 ID 재수신 시 무변화).

---

## 3. 여행 (C6)

### Trip
| 속성 | 타입 | 비고 |
|---|---|---|
| id · accountId | UUID | |
| title | string | 미입력 시 목적지 기반 자동 생성 |
| startDate · endDate | date | **필수** |
| party | int | 기본 1 |
| companionType | enum ⚠ | 혼자 · 친구 · 연인 · 가족 (g01) — 온보딩 `커플`↔`연인` 매핑(G-U1-10) |
| budgetTotal | long? | 온보딩 취향 예산에서 상속. **입력 화면은 현재 없음**(G-U1-09) |
| preferenceSnapshot | json ⚠ | 생성 시점 취향 동결 + 여행별 오버라이드(g01 "바꾸기", G-U1-11) |
| status | enum | `PLANNED` · `CONFIRMED` · `ACTIVE` · `ENDED` (DEC-7) |
| deletedAt | timestamp? | 소프트 삭제 |

- **INV-U1-11**: `endDate ≥ startDate`. 위반 시 생성 거부.
- **INV-U1-12 (DEC-9)**: 모든 목적지가 **대한민국 영역** 안이어야 생성된다. 하나라도 밖이면 생성 거부.
- **INV-U1-13**: 상태 전이는 `PLANNED → CONFIRMED → ACTIVE → ENDED` 단방향. `ENDED`·`deletedAt` 이후 편집 불가.

### TripDestination ⚠ 신설 (G-U1-08)
| 속성 | 타입 | 비고 |
|---|---|---|
| tripId · seq | | 표시 순서 |
| region | string | "부산" · "경주" |
| nights | int | g01의 "· 2박" |

- **INV-U1-14**: `Σ nights ≤ (endDate − startDate)`. 도시별 박수 합이 여행 기간을 넘을 수 없다.
- 단일 도시 여행은 원소 1개짜리 목록으로 표현한다(특수 케이스 없음).

### BaseAssignment — 구간 거점
`tripId · savedStayId · dateFrom · dateTo`
- **INV-U1-15**: `dateFrom < dateTo`, 그리고 구간은 여행 기간 안에 있어야 한다. 벗어나면 경고 + 여행 기간 확장 여부 질의(US-TRIP-03).
- 다박은 **하나의 배정**으로 표현한다(US-TRIP-07 "N박 체류" 묶음 표시).

### TripBaseDay — 날짜별 확정 거점
`tripId · dayDate (PK) · savedStayId? · resolution`
`resolution ∈ auto · prev_stay · destination_center · user_pick`
- **INV-U1-16 (DEC-8 차단형)**: 여행 기간의 **모든 날짜**에 대해 `TripBaseDay` 행이 존재하고 `savedStayId`가 정해져야(또는 `destination_center`로 명시 확정돼야) 일정 생성 진입이 허용된다. 자동 채움은 후보가 정확히 1개인 날(`auto`)에만 일어난다.

### MustVisit — 필수 방문지
`tripId · poiSnapshotId · type(ANYTIME|FIXED) · fixedDate? · fixedStart? · dwellMin?`
- **INV-U1-17**: `type = FIXED`면 `fixedDate`·`fixedStart` 필수이며 `fixedDate`는 여행 기간 안이어야 한다.
- **INV-U1-18**: 같은 여행에 동일 `sourcePoiId`를 중복 추가할 수 없다.
- **INV-U1-19**: 생성·재생성 후에도 `MustVisit`는 누락되지 않는다(고정/필수 블록 유지 — US-TRIP-09). 실현가능성 판정은 U2·U3 소관이며 U1은 **입력 보존**만 책임진다.

---

## 4. 이벤트 (아웃박스)

| 이벤트 | 발행 시점 | 구독(예정) |
|---|---|---|
| `StayRegistered` | 거점 배정 완료 | U6 알림 · U3 일정 생성 유도 |
| `StayUpdated` | 등록 숙소 날짜·좌표 변경 | U3 재생성 질의 |
| `TripCreated` | 여행 생성 | U6 |
| `TripEnded` | 수동 종료 | U5 회고 트리거 · U6 |
| `MustVisitChanged` | 필수 방문지 추가·삭제·고정 변경 | U3 재계산 |
| `TripBaseResolved` ⚠ | 커버리지 해소 완료(전 날짜 확정) | U3 일정 생성 게이트 해제 |

- 전 이벤트는 U0에서 세운 **트랜잭셔널 아웃박스**를 통해 at-least-once로 발행되며 구독자는 멱등해야 한다.

---

## 5. INV-3 준수 (전 엔티티 공통)

**어떤 엔티티·DTO에도 `duration`(소요 시간) 필드를 두지 않는다.** 거리(`distanceM`)만 보유·노출한다 — d01 "해운대 · 350m", e03 "해수욕장 350m", e02 "감천 · 1.2km".
