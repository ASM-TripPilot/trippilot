# U5 Records & Reflection — Domain Entities

> 정본 순위: **리포 실물 > 계약 정본 > 라이브 Figma > aidlc 산출물 > 인셉션**(2026-08-22 사용자 지시).
> 이 문서의 `visit_check`·`change_log_entry` 절은 **실장 기술**이고, 나머지는 **신설 설계**다. 둘을 섞어 읽지 말 것.

---

## 1. 소유 경계표

| 엔티티 | 물리 | 소유 유닛 | U5 접근 | 근거 |
|---|---|---|---|---|
| `itinerary` · `visit_slot` | V2.7·V2.8 | U3(생성) · U4(재계획) | **읽기** | plan 계층 |
| `visit_check` | **V2.21 실재** | **U5**(이관 · DEC-U5-2) | 쓰기 | V2.21 주석의 명시 지시 |
| `visit_photo_meta` | **신설 V2.28** | U5 | 쓰기 | US-REC-02 |
| `visit_memo` | **신설 V2.29** | U5 | 쓰기 | US-REC-02 |
| `reflection` | **신설 V2.30** | U5 | 쓰기 | US-REC-06·07 |
| `trip_summary` | **신설 V2.31** | U5 | 쓰기 | US-REC-08 |
| `style_analysis` | **신설 V2.32** | U5 | 쓰기 | US-REC-09 |
| `actual_route_point` | **미실장** | **U4**(DEC-U5-6 · Q5=B) | 읽기 | 사용자 결정 |
| `change_log_entry` | V2.11 실재 | `change-log` 모듈(DEC-U5-8) | **읽기** | append-only 계약 보호 |
| `trip` · **`base_assignment`·`trip_base_day`** · `stay` | V2.3·V2.4·V2.26 | U1 | 읽기 | 숙소·날짜 귀속(US-REC-05). ⚠ `trip_base`라는 테이블은 **없다** — V2.4의 실제 이름은 이 둘이다(2026-08-22 실측 정정) |
| `poi` | V2.0 | U1(C7) | 읽기 | 방문 장소 표시·카테고리 통계 |
| 오프라인 큐 | **기기 로컬** | 클라이언트 | — | DEC-U5-10 — 서버에 큐 테이블 없음 |

---

## 2. 승계 — `visit_check` (V2.21 실장 · 확장 없음)

실장 그대로다. **이번 유닛에서 컬럼을 늘리지 않는다.**

| 필드 | 타입 | 비고(실장 주석 요약) |
|---|---|---|
| `visit_check_id` | uuid PK | |
| `trip_id` | uuid FK → `trip` | ON DELETE CASCADE |
| `slot_key` | varchar(100)? | 슬롯 **경계 키** `"{date}#{poiId}"`(BR-U2-04). 물리 키가 아닌 이유 = 재계획으로 슬롯 행이 갈려도 실적 참조가 끊기지 않아야 한다. **null = 즉석 방문** |
| `poi_id` | uuid | |
| `arrived_at` · `completed_at` · `skipped_at` | timestamptz? | 완료는 도착 이후(CHECK). 완료·건너뜀 동시 참 불가(CHECK) |
| `source` | varchar(14) | `AUTO_GEOFENCE` \| `MANUAL` |
| `created_at` · `updated_at` | timestamptz | **`updated_at`이 오프라인 충돌 판정 기준이다**(BR-U5-22) |

- 유니크: `(trip_id, slot_key) WHERE slot_key IS NOT NULL` — 즉석 방문은 다건 허용.
- **체류는 컬럼이 아니다** — `completed_at − arrived_at` 파생(V2.21 정본).

**INV-U5-01** — **`status` enum을 만들지 않는다.** V2.21 주석은 "U5 이관 시 status enum 으로 흡수될 수 있다"고 열어 뒀지만, 상태는 세 timestamp에서 **파생**한다: `skipped_at≠null → SKIPPED`, `completed_at≠null → COMPLETED`, `arrived_at≠null → IN_PROGRESS`, 그 외 `UPCOMING`. 저장하면 timestamp와 어긋날 수 있고, 어긋난 쪽이 무엇인지 나중에 알 수 없다(V2.21이 체류를 파생으로 둔 것과 같은 논리). 선재 dbml `visit_record.status`는 이 결정으로 정정 대상이다(G-U5-3).

**INV-U5-02** — 즉석 방문(`slot_key = null`)은 **plan 계층에 어떤 행도 만들지 않는다.** 계획에 없던 곳은 끝까지 계획에 없다.

---

## 3. 신설 — C12 Travel Archive

### 3.1 `visit_photo_meta` (V2.28 · US-REC-02)

| 필드 | 타입 | 비고 |
|---|---|---|
| `visit_photo_meta_id` | uuid PK | |
| `visit_check_id` | uuid FK → `visit_check` | ON DELETE CASCADE |
| `local_asset_id` | varchar(255) | **기기 로컬 자산 식별자**(iOS `PHAsset` localIdentifier / Android MediaStore ID). 바이너리는 서버에 없다 |
| `device_id` | varchar(64) | 어느 기기의 자산인가 — 기기가 바뀌면 이 사진은 못 연다 |
| `taken_at` | timestamptz? | 촬영 시각(EXIF) |
| `exif_lat` · `exif_lng` | double? | **위치 동의가 있을 때만 저장**(INV-U5-04) |
| `sort_order` | int | `j01` 썸네일 순서 |
| `created_at` | timestamptz | |

**INV-U5-03** — 서버에 **사진 바이너리를 저장하지 않는다**(DEC-U5-9). `storage_key` 류 컬럼을 만들지 않는다 — 만들어 두면 다음 사이클이 채운다. 커뮤니티 공개(U7)는 별도 테이블로 신설하고 이 테이블을 늘리지 않는다.

**INV-U5-04** — 위치 동의(V1.3 `gps_recording_opt_in`)가 없으면 `exif_lat/lng`는 **null로 저장**한다. 사진에 좌표가 박혀 있어도 서버는 받지 않는다.

**INV-U5-05** — 원본 자산이 삭제되거나 접근 권한이 없으면 화면은 **"사진을 불러올 수 없어요"를 표기**하고, 메모·방문 체크·메타데이터는 **사진과 무관하게 남는다**(US-REC-02 예외 · INV-4).

### 3.2 `visit_memo` (V2.29 · US-REC-02)

| 필드 | 타입 | 비고 |
|---|---|---|
| `visit_memo_id` | uuid PK | |
| `visit_check_id` | uuid FK, **UNIQUE** | 방문 하나에 메모 하나 — `j01`이 카드당 단일 입력이다 |
| `text` | varchar(2000) | |
| `created_at` · `updated_at` | timestamptz | |

> 별도 테이블로 두는 이유: 메모는 나중에 오고(방문 직후엔 비어 있다) 자주 갱신된다. `visit_check`에 붙이면 실적 행이 메모 편집마다 갱신돼 충돌 판정(`updated_at`)이 오염된다.

---

## 4. 신설 — C13 AI Reflection/Summary

### 4.1 `reflection` (V2.30 · US-REC-06·07)

| 필드 | 타입 | 비고 |
|---|---|---|
| `reflection_id` | uuid PK | |
| `trip_id` | uuid FK → `trip` | CASCADE |
| `day_date` | date | 여행지 기준 날짜 |
| `draft_narrative` | text | **원본 초안**(생성물) |
| `edited_narrative` | text? | 사용자 수정본 |
| `source` | varchar(8) | `AI` \| `RULE` \| `BASIC` (DEC-U5-5a) |
| `stats` | jsonb | `{visitCount, distanceKm, distanceSource, photoCount}` |
| `generated_at` · `updated_at` | timestamptz | |

- 유니크: `(trip_id, day_date)` — 하루 하나.

**INV-U5-06** — **초안과 수정본을 각각 보관한다**(US-REC-07: "원본 초안과 별도로 저장하고 수정본을 최종 표시본으로 쓴다"). 표시본 = `edited_narrative ?? draft_narrative`. 수정이 초안을 덮으면 "AI가 뭐라고 했었나"가 사라진다.

**INV-U5-07** — `stats`는 **비어 있을 수 없다**. 방문이 0곳이어도 `{0,0,…}`을 채운다 — 기본 카드(폴백 ③)가 이 값만으로 그려지기 때문이다(PBT-U5-1).

### 4.2 `trip_summary` (V2.31 · US-REC-08)

| 필드 | 타입 | 비고 |
|---|---|---|
| `trip_id` | uuid **PK** = FK → `trip` | 여행당 하나 |
| `narrative` | text | |
| `highlights` | jsonb | 날짜별 하이라이트 — `j04`의 `Day N · 5곳 · 광안리→감천, 바다와 골목` |
| `stats` | jsonb | `{totalVisits, totalDistanceKm, distanceSource, totalPhotos}` |
| `source` | varchar(8) | `AI` \| `RULE` \| `BASIC` |
| `generated_at` | timestamptz | |

### 4.3 `style_analysis` (V2.32 · US-REC-09)

| 필드 | 타입 | 비고 |
|---|---|---|
| `account_id` | uuid **PK** = FK → `account` | **계정 단위** |
| `descriptors` | jsonb | 대표 디스크립터. `l03` 문장(`바다와 미식을 천천히 즐기는 여행자`) + 취향 칩(`#바다 #미식 #느긋`)의 원천 |
| `trait_gauges` | jsonb | **신설(2026-08-24 · `l03` 시각 확인)** — dot 게이지 **3축** `{여유로움, 미식취향, 활동성}`(각 0~5). ⚠ US-NOTIF-08 스토리 원문은 "밀도·반경 dot 게이지"인데 **실물 화면의 축이 다르다** — 화면 정본을 따르되 산출식은 미정(O-U5-9) |
| `category_breakdown` | jsonb | `[{category, ratio}]` — `j05` 막대 4행 |
| `avg_places_per_day` | numeric | `j05` `4곳` |
| `avg_radius_km` | numeric | `j05` `평균 이동 반경 1.2km` |
| `avg_dwell_minutes` | int? | `j05` `평균 체류 72분` — **노출한다**(DEC-U5-13 · BR-U5-08a). 개별 방문 체류는 계속 미노출 |
| `sample_trip_count` · `sample_visit_count` | int | `분석에 사용된 여행 3회` · 임계 판정(≥10) |
| `updated_at` | timestamptz | `마지막 갱신 6.13` |

**INV-U5-08** — 계정 단위라 **여행이 지워져도 남는다**. 단, 계정 삭제(U0 유예 삭제)에는 함께 파기된다.

**INV-U5-09** — `sample_visit_count < 10`이면 **정식 분석을 만들지 않는다.** `j05 data-insufficient`가 온보딩 취향 기반 임시 미리보기를 그리되 **"정식 아님"을 명시**한다(US-REC-09 예외). 임시 미리보기는 이 테이블에 **저장하지 않는다** — 저장하면 정식 분석과 구분이 사라진다.

---

## 5. 재사용 (읽기 전용)

| 엔티티 | 무엇을 읽나 |
|---|---|
| `change_log_entry`(V2.11) | `j02 변경` 탭 — `source_type`·`reason`·`before/after_snapshot`(전후 장소) |
| `visit_slot`(V2.7) | `j02 계획` 탭 — 미방문 판정(계획엔 있는데 `visit_check`가 없는 슬롯) |
| `actual_route_point`(U4·미실장) | 실제 동선 폴리라인. **없으면 방문점 연결선으로 근사**(DEC-U5-12) |
| `base_assignment` · `trip_base_day`(V2.4) · `stay`(V2.26) | 날짜별 기준 숙소(US-REC-05) — `j04`의 `숙` 마커 |
| **`poi.category`**(V2.0 · CHECK 교체 V2.6) | 스타일 분석 카테고리 통계의 입력. 허용값 **8종** = `명소·맛집·카페·야경·자연·쇼핑·문화·액티비티`. ⚠ `activity_category`라는 컬럼은 **없다**(V2.6은 컬럼 추가가 아니라 `poi_category_check` 교체다 — 2026-08-22 실측 정정) |
| `consent`(V1.3 `gps_recording_opt_in`) | EXIF 위치 저장 여부(INV-U5-04)·실제 경로 레이어 활성 |

---

## 6. 이벤트

| 이벤트 | 발행 | 페이로드 | 구독 |
|---|---|---|---|
| `VisitChecked` | **U5**(이관 후) | `tripId · slotKey? · poiId · arrivedAt · completedAt?` | U4 Plan-B(체류 초과) · U6 알림. ⚠ **아직 코드에 없다** — 설계 문서(`전체-API-서피스.md`)에만 존재하고 backend 구현 0건(2026-08-22 실측). "발행 주체 변경"이 아니라 **U5가 신설**하는 것이다(G-U5-13) |
| `TripEnded` | U1 `trip` | `tripId · endedAt` | **U5**(요약 생성) · U6 |
| `ReflectionReady` | **U5**(신규) | `tripId · day_date? · kind(DAILY\|SUMMARY) · source` | U6 알림(`j03` 인앱 카드/푸시) |

아웃박스 경유 · at-least-once · 멱등 구독자(U0 스캐폴딩).

---

## 7. 마이그레이션 (제안 번호)

| 번호 | 내용 |
|---|---|
| **V2.28** | `visit_photo_meta` |
| **V2.29** | `visit_memo` |
| **V2.30** | `reflection` |
| **V2.31** | `trip_summary` |
| **V2.32** | `style_analysis` |

- 현재 최신은 **V2.27**(실측). U4 잔여분(`actual_route_point` 등)이 먼저 머지되면 번호가 밀린다 — **번호는 머지 시점에 재배정**한다.
- **append-only 회수 대상 없음.** 이 5종은 전부 사용자 데이터라 파기 대상이고, 앱 롤에 DELETE 권한이 있어야 한다(`change_log_entry`·`location_legal_log`와 다르다).
- 전부 `trip` 또는 `account` FK CASCADE — 여행/계정 파기 시 함께 지워진다.
