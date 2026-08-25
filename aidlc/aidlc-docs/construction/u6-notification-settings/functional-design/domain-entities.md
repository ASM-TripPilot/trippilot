# U6 Notification & Settings — Domain Entities

> 정본 순위: 리포 실물 > 계약 정본 > 라이브 Figma > aidlc 산출물 > 인셉션.
> **재사용 절은 실장 기술**(실측 확인분), **신설 절은 설계**다.

---

## 1. 소유 경계표

| 엔티티 | 물리 | 소유 | U6 접근 |
|---|---|---|---|
| `outbox_event` | **V1.0 실재** — 계약·`EventEnvelope`·발행 구현까지 있고 **릴레이만 없다**(§0.1) | **공용**(`common/core/event`) — U6가 릴레이를 설계(DEC-U6-1·1a) | 읽기(릴레이) |
| `shedlock` | **V1.0 실재**(라이브러리 의존성은 **없음**) | 공용 | 릴레이 단일 실행 보장 |
| `notification` | **신설 V2.33** | U6 | 쓰기 |
| `notification_toggle` | **신설 V2.34** | U6 | 쓰기 |
| `push_token` | **신설 V2.35** | U6 | 쓰기 |
| `notification_schedule` | **신설 V2.36** | U6 | 쓰기 |
| `account` | V1.1 | U0 | 읽기 |
| `location_consent_state` | V1.3 (`os_permission_mirror`·`legal_consent`·`gps_recording_opt_in`) | U0 | **읽기만** — 변경은 `PUT /me/location-consent` |
| `location_legal_log` | V1.3 · **append-only** | U0 | **접근 안 함** — 철회 파기 트리거는 U0가 처리 |
| `style_analysis` | U5 V2.32 (+`trait_gauges`) | U5 | 읽기 |
| `trip`·`stay`·`saved_stay` | V2.3·V2.26·V2.2 | U1 | 읽기 |

> 마이페이지·설정은 **자기 테이블이 없다**(DEC-U6-5·6). U6가 새로 만드는 것은 **알림 4종뿐**이다.

---

## 2. 신설

### 2.1 `notification` (V2.33) — 인앱함 + catch-up의 정본

| 필드 | 타입 | 비고 |
|---|---|---|
| `notification_id` | uuid PK | |
| `account_id` | uuid FK → `account` | CASCADE |
| `kind` | varchar(16) | **8종**(§2.5) |
| `title` · `body` | varchar | `l01` 2줄 — 예: `비 예보 — '○○공원' 일정이 영향받아요` |
| `action_type` · `action_payload` | varchar(24)? · jsonb? | `l01`의 **`대안 일정 보기 ›`** 같은 진입. 없으면 null |
| `source_event_id` | uuid? **UNIQUE** | `outbox_event.event_id` — **멱등 키**(INV-U6-01) |
| `dedup_key` | varchar(120)? | 중복 억제 판정용(예: `PLAN_B#{tripId}#{slotKey}`) |
| `occurred_at` | timestamptz | `l01`의 `10분 전`·`어제` 상대 시각 원천 |
| `read_at` | timestamptz? | null = 미읽음 → **좌측 빨간 dot** |
| `push_sent_at` · `push_failed_reason` | timestamptz? · varchar? | 푸시 결과. **인앱 적재와 독립**(INV-U6-02) |

- 인덱스: `(account_id, occurred_at DESC)` — `l01` 목록·catch-up 커서.
- 부분 인덱스: `(account_id) WHERE read_at IS NULL` — 미읽음 뱃지.

**INV-U6-01** — `source_event_id`가 UNIQUE라 **같은 아웃박스 이벤트로 알림이 두 번 생기지 않는다.** at-least-once 전달의 멱등을 DB가 보장한다(재시도가 중복 알림이 되지 않는다).

**INV-U6-02** — **인앱 적재는 푸시 성공 여부와 무관하다.** 푸시가 실패해도 행은 남고 catch-up으로 전달된다. 이것이 "누락 0"의 유일한 근거다.

**INV-U6-03** — `kind = SYSTEM`인 행은 **토글과 무관하게 항상 적재**된다(`l02` 하단 문구의 실체).

### 2.2 `notification_toggle` (V2.34)

| 필드 | 타입 | 비고 |
|---|---|---|
| `account_id` | uuid FK | |
| `kind` | varchar(16) | **`SYSTEM` 제외 7종** |
| `push_enabled` · `in_app_enabled` | boolean | `l02`의 2컬럼 |
| `updated_at` | timestamptz | |
| PK | `(account_id, kind)` | |

**기본값(실물 `l02`에서 읽음)**: `SLOT_PRE`·`PLAN_B`는 **푸시 OFF·인앱 ON**, 나머지 5종은 **둘 다 ON**.

**INV-U6-04** — `SYSTEM` 행은 **만들지 않는다.** 만들면 언젠가 꺼진다.

**INV-U6-05** — `COMMUNITY` 행은 **만들되 UI에서 숨긴다**(DEC-U6-8). U7 개통 시 마이그레이션 0으로 켠다.

### 2.3 `push_token` (V2.35)

| 필드 | 타입 | 비고 |
|---|---|---|
| `push_token_id` | uuid PK | |
| `account_id` | uuid FK | CASCADE |
| `token` | varchar(255) UNIQUE | **Expo push token**(DEC-U6-3) |
| `device_id` · `platform` | varchar(64) · varchar(8) | `IOS`\|`ANDROID` |
| `os_permission` | varchar(16) | `l02 permission-denied` 판정 입력. `location_consent_state.os_permission_mirror`와 **같은 꼴의 미러** |
| `last_seen_at` · `invalidated_at` | timestamptz · timestamptz? | 만료·기기 교체 정리 |

**INV-U6-06** — 한 계정에 토큰이 여러 개일 수 있다(다기기). 발송은 **유효 토큰 전부**에 한다.

**INV-U6-07** — Expo가 `DeviceNotRegistered`를 돌려주면 **즉시 `invalidated_at`을 찍는다.** 죽은 토큰에 계속 쏘면 레이트리밋을 먹는다.

### 2.4 `notification_schedule` (V2.36) — 시각 기반 알림 (DEC-U6-10)

| 필드 | 타입 | 비고 |
|---|---|---|
| `schedule_id` | uuid PK | |
| `account_id` · `trip_id` | uuid FK | |
| `kind` | varchar(16) | `TRIP_PRE`\|`TRIP_DAY`\|`SLOT_PRE` |
| `slot_key` | varchar(100)? | `SLOT_PRE`만. 경계 키 `"{date}#{poiId}"`(BR-U2-04) |
| `fire_at` | timestamptz | 발화 예정 |
| `fired_at` · `canceled_at` | timestamptz? | |
| 인덱스 | `(fire_at) WHERE fired_at IS NULL AND canceled_at IS NULL` | 스케줄러 폴링 — `ix_outbox_unpublished`와 같은 꼴 |

**INV-U6-08** — 일정이 바뀌면(U3 재생성·U4 재계획) **미발화 행을 재계산**한다. 지난 일정에 대한 알림이 뒤늦게 울리지 않는다.

**INV-U6-09** — `fire_at`이 과거인 채로 발견되면(서버 중단 등) **일정 시각이 이미 지났으면 발화하지 않고 `canceled_at`을 찍는다.** "1시간 전에 시작했어야 할 일정" 알림은 해가 된다.

### 2.5 `NotificationKind` — 8종

| 값 | `l02` 행 | 토글 | 원천 |
|---|---|:-:|---|
| `STAY` | 숙소 등록·저장 완료 | ✅ | U1 이벤트 |
| `TRIP_PRE` | 여행 시작 전 | ✅ | 스케줄러 |
| `TRIP_DAY` | 당일 일정 | ✅ | 스케줄러 |
| `SLOT_PRE` | 일정 시작 전 | ✅ | 스케줄러 |
| `PLAN_B` | Plan-B 재계획 | ✅ | U4 이벤트 |
| `REFLECTION` | 회고 완료 | ✅ | U5 이벤트 |
| `COMMUNITY` | 커뮤니티 좋아요·댓글 | ✅(**UI 숨김**) | U7 이벤트 |
| **`SYSTEM`** | **없음** | ❌ | U0 auth |

> `varchar` + 애플리케이션 검증으로 둔다(DB CHECK 아님) — U7 개통 시 마이그레이션이 붙지 않게.

---

## 3. 제휴 고지 설정 (DEC-U6-7a)

값은 **계정 단위 서버 저장**이다. 두 갈래:

- **(a) `/me/preferences` 확장** — 설정 화면의 다른 취향 값과 같은 자리. 스키마 소유가 U0라 협의 필요
- **(b) `notification_toggle`과 나란한 `account_setting` 소형 테이블 신설**

**기본은 (a)** — `l05`가 이 토글을 **취향·계정과 같은 설정 목록**에 그린다. 다만 `/me/preferences`가 "여행 취향" 의미로 좁게 정의돼 있으면 (b)로 간다 → **O-U6-5**.

---

## 4. 구독 이벤트

**이름 규약은 실장이 정본**이다 — `{module}.{EventName}`(2026-08-24 실측). 인셉션의 `StayRegistered` 꼴은 정정 상신 대상(G-U6-9).

| 이벤트(실장 규약) | 발행 | 실장 | → 종류 |
|---|---|:-:|---|
| `auth.AccountCreated` | U0 | **✅ 발행 중** | — (U6 미소비) |
| `auth.AccountDeletionRequested` / `…Cancelled` | U0 | **✅ 발행 중** | `SYSTEM` 후보 |
| `itinerary.ItineraryGenerated` | U3 | **✅ 발행 중** | `notification_schedule` **적재 트리거**(DEC-U6-10) |
| `itinerary.ItineraryConfirmed` | U3 | **✅ 발행 중** | 같음 — 확정 시 스케줄 재계산 |
| `stay.StayRegistered`(가칭) | U1 | ❌ | `STAY` |
| `planb.PlanBTriggered`(가칭) | U4 | ❌ | `PLAN_B` |
| `reflection.ReflectionReady`(가칭) | U5 | ❌ | `REFLECTION` |
| `archive.VisitChecked`(가칭) | U5 | ❌ | (알림 없음 — 구독만 정의) |

**U6가 필요한 것 중 3종이 없다**(G-U6-2). 반대로 **`itinerary.*` 2종은 이미 발행 중이라, 리마인드 스케줄 적재는 U3 코드를 건드리지 않고 구독만으로 붙는다** — U6에서 가장 먼저 동작시킬 수 있는 경로다.

> ⚠️ 현재 발행은 **인프로세스**(`SpringDomainEventPublisher`)다. U6 소비는 **아웃박스 릴레이 경유**로 승격해야 at-least-once가 성립한다(DEC-U6-1a).

---

## 5. 마이그레이션

| 번호 | 내용 |
|---|---|
| **V2.33** | `notification` |
| **V2.34** | `notification_toggle` |
| **V2.35** | `push_token` |
| **V2.36** | `notification_schedule` |

- U5 제안분(V2.28~V2.32) 다음 번호. **머지 시점에 재배정**한다.
- 4종 전부 **계정 파기 대상**(CASCADE) — append-only 아님, 앱 롤에 DELETE 필요.
- `outbox_event`는 **기존 테이블 그대로** — 구현만 붙는다(마이그레이션 없음).
