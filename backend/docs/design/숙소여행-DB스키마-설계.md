# TripPilot 숙소·여행 DB 스키마 설계 (마이그레이션 설계) — 초안

> 대상 유닛: 숙소·여행 (C7 Place Data · C3 Accommodation Search · C4 Saved Accommodation · C5 Affiliate Link · C6 Trip) · 밴드 d·e·g
> 근거 정본: `construction/u1-accommodation-trip/functional-design/domain-entities.md`(엔티티·불변식 INV-U1-##), `business-rules.md`(BR-U1-##), `nfr-design/logical-components.md`(LC-U1-#), `nfr-requirements/tech-stack-decisions.md`(U1-TS-#) · 기준선 `전체-최소-스키마.dbml`(밴드 d·e·g)
> 상태: **설계 확정**(결정 2026-07-25, 6절) — 아직 레포 미배치·미실행. `U1-DB스키마-설계.md` 형식 계승. TRIP-174에서 V2.x 마이그레이션으로 구현.

## 0. 범위

숙소·여행 엔티티를 PostgreSQL 16 물리 스키마로 설계한다. U0 기반(V1.0~1.7) 위에 **V2.x**로 증분 추가한다(포워드 온리, 단일 히스토리). 외부 데이터는 **소유 여부로 저장 전략이 갈린다**(§0.1). 컨벤션·롤 권한 모델은 U0(`U1-DB스키마-설계.md` §1·§2)를 그대로 상속하며, 여기서는 델타만 기록한다.

### 0.1 데이터 소유·최신성 모델 (설계 근간 — LC-U1-1~3·U1-TS-5)

| 데이터 | 소유 | 저장 | 최신성 |
|---|---|---|---|
| **POI**(장소 정본) | 앱 소유 | **PostgreSQL 영속**(`poi`) | `data_status`로 관리 · 확정 시 `poi_snapshot` 동결 |
| **SavedPlace·SavedStay·Trip 계열** | 앱 소유 | PostgreSQL 영속 | 등록/확정 시점 값 보존(동결) |
| **숙소 정적 콘텐츠**(이름·좌표·편의시설) | 외부 비소유 | **Redis 조회 캐시**(TTL) — PG 테이블 없음 | 캐싱 허용 · stale-if-error |
| **최저가 스냅숏**("부터 가격") | 준정적 | `stay_price_snapshot` 배치 영속 | `PriceSnapshotBatch` 일 1회(ShedLock) |
| **정확 1박가** | 휘발 | **저장·캐싱 절대 금지**(LivePriceGateway) | 표시 시점 조회 후 즉시 폐기 |

## 1. 설계 컨벤션 (U0 상속 + 델타)

U0 컨벤션(`app` 단일 스키마 · snake_case · PK `<entity>_id` uuid v4 · `timestamptz` UTC · enum=`varchar`+`CHECK` · 집합=`text[]`+`<@` · 소프트삭제 `deleted_at`)을 그대로 따른다. 델타:

| 항목 | 결정 | 근거 |
|---|---|---|
| 좌표 | **`lat`·`lng double precision`**(확정 6절) — 반경은 bounding-box 프리필터+하버사인. PostGIS 미도입 | domain `coord Point` |
| 조회 캐시 | **Redis 신규 도입**(U1-TS-4·Q8=B) — 원본은 PG, Redis는 그 위 짧은 TTL 캐시. 로컬 `docker-compose`에 컨테이너 추가 전제 | U1-TS-4 |
| 외부 참조 | 스냅숏·법정성 참조는 **FK 미강제**(값 보존 — 원본 폐업/삭제해도 유지) | INV-U1-03 |
| append-only | 이 유닛은 신규 append-only 테이블 없음 → U1.7 `ALTER DEFAULT PRIVILEGES`가 신규 테이블 DML 자동 부여(신규 grants 마이그레이션 불필요) | — |

## 2. 테이블 설계

### 2.1 place-data (C7 · 밴드 d)

```sql
-- V2.0 poi  (정본 장소 — 앱 소유 영속)
CREATE TABLE poi (
  poi_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ko       varchar(200) NOT NULL,
  lat           double precision NOT NULL,           -- INV-U1-02 좌표 필수
  lng           double precision NOT NULL,
  category      varchar(12)  NOT NULL CHECK (category IN ('명소','맛집','카페','야경','자연','쇼핑','문화')),  -- d04 필터 칩
  region        varchar(60),                          -- 시·군·구(표시용)
  opening_hours varchar(200),                         -- NULL=미확인
  data_status   varchar(12)  NOT NULL DEFAULT 'UNVERIFIED'
                CHECK (data_status IN ('ACTIVE','UNVERIFIED','LOST','CLOSED')),  -- INV-U1-01 게이트
  source        varchar(12)  NOT NULL CHECK (source IN ('KAKAO_LOCAL','TOURAPI','MANUAL')),
  saved_count   bigint       NOT NULL DEFAULT 0,      -- d01·d04 '저장 수' 반정규화 카운터(이벤트/배치 갱신)
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
-- 후보풀(ACTIVE)·지역 조회. INV-1: 조회는 data_status='ACTIVE'만 (ArchUnit 게이트 우회 금지 규칙 병행)
CREATE INDEX ix_poi_active_region ON poi (region) WHERE data_status = 'ACTIVE';
```

```sql
-- V2.0 poi_snapshot  (확정 시점 동결본 — 원본 변경과 독립)
CREATE TABLE poi_snapshot (
  poi_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_poi_id   uuid NOT NULL,                      -- 원본 참조(FK 미강제 — INV-U1-03)
  name_ko         varchar(200) NOT NULL,              -- 값 동결
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  category        varchar(12)  NOT NULL,
  snapshot_at     timestamptz  NOT NULL DEFAULT now()
);
```

```sql
-- V2.0 saved_place  (담은 장소 ♥ — 계정 귀속)
CREATE TABLE saved_place (
  saved_place_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  poi_id         uuid NOT NULL REFERENCES poi(poi_id),
  saved_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_saved_place UNIQUE (account_id, poi_id)   -- INV-U1-04 (accountId,poiId) 유일
);
CREATE INDEX ix_saved_place_account ON saved_place (account_id, saved_at DESC);
```

### 2.2 accommodation-search (C3 · 밴드 e)

> 외부 숙소 **정적 콘텐츠는 Redis 캐시**(PG 테이블 없음). **정확 1박가는 미저장**(LivePriceGateway). PG에는 배치 최저가 스냅숏만 둔다.

```sql
-- V2.1 stay_price_snapshot  (최저가 '부터 가격' — 배치 일1회 갱신)
CREATE TABLE stay_price_snapshot (
  external_source varchar(40)  NOT NULL,              -- 공급자
  external_id     varchar(120) NOT NULL,             -- 공급자 내 숙소 ID
  lowest_amount   bigint,                             -- NULL=가격 미확인(INV-U1-06)
  currency        varchar(3)   NOT NULL DEFAULT 'KRW',
  captured_at     timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (external_source, external_id)
);
```

### 2.3 saved-accommodation (C4 · 밴드 e·g)

```sql
-- V2.2 saved_stay  (저장/등록 숙소 — 앱 소유, 등록시점 값 보존)
CREATE TABLE saved_stay (
  saved_stay_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  name            varchar(200) NOT NULL,             -- 등록시점 보존(외부 조회 불가해져도 사용)
  lat             double precision,                   -- 등록시점 좌표
  lng             double precision,
  coord_confirmed boolean NOT NULL DEFAULT false,     -- INV-U1-08 false면 거점 배정 불가
  check_in        date,                               -- nullable(저장만 한 숙소)
  check_out       date,
  external_source varchar(40),                        -- 직접등록(PIN)이면 NULL
  external_id     varchar(120),
  register_route  varchar(12) NOT NULL CHECK (register_route IN ('MAP_SEARCH','LINK_PASTE','PIN')),  -- DEC-6 3경로
  memo            varchar(500),                       -- US-STAY-04
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(), -- 편집(PATCH /saved-stays) 추적
  CONSTRAINT chk_savedstay_dates CHECK (check_out IS NULL OR check_in IS NULL OR check_out > check_in)  -- INV-U1-09
);
CREATE INDEX ix_saved_stay_account ON saved_stay (account_id, created_at DESC);
```

### 2.4 trip (C6 · 밴드 g)

```sql
-- V2.3 trip
CREATE TABLE trip (
  trip_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  title               varchar(120) NOT NULL,          -- 미입력 시 목적지 기반 자동생성
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  party               int  NOT NULL DEFAULT 1 CHECK (party >= 1),
  companion_type      varchar(8) CHECK (companion_type IN ('혼자','친구','연인','가족')),  -- G-U1-10 매핑(온보딩 '커플'→'연인')
  budget_total        bigint,                          -- 온보딩 취향 상속(입력화면 없음 G-U1-09)
  preference_snapshot jsonb NOT NULL,                  -- 생성시점 취향 동결 + 여행별 오버라이드(G-U1-11)
  status              varchar(12) NOT NULL DEFAULT 'PLANNED'
                      CHECK (status IN ('PLANNED','CONFIRMED','ACTIVE','ENDED')),  -- INV-U1-13 단방향
  deleted_at          timestamptz,                     -- 소프트 삭제
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(), -- 편집(PATCH /trips) 추적
  CONSTRAINT chk_trip_dates CHECK (end_date >= start_date)   -- INV-U1-11
);
CREATE INDEX ix_trip_account ON trip (account_id, start_date DESC) WHERE deleted_at IS NULL;
```

```sql
-- V2.3 trip_destination  (다도시 목적지 · 신설 G-U1-08)
CREATE TABLE trip_destination (
  trip_destination_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id  uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  seq      int  NOT NULL,                             -- 표시 순서
  region   varchar(60) NOT NULL,
  nights   int  NOT NULL CHECK (nights >= 0),
  CONSTRAINT ux_trip_destination_seq UNIQUE (trip_id, seq)
  -- INV-U1-14 Σnights ≤ (end_date−start_date): 교차 집계라 서비스 검증(§4)
);
```

```sql
-- V2.3 must_visit  (필수 방문지)
CREATE TABLE must_visit (
  must_visit_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  poi_snapshot_id uuid NOT NULL REFERENCES poi_snapshot(poi_snapshot_id),  -- 사본 참조(INV-U1-03)
  source_poi_id   uuid NOT NULL,                      -- 중복 판정 키(INV-U1-18)
  type            varchar(8) NOT NULL CHECK (type IN ('ANYTIME','FIXED')),
  fixed_date      date,
  fixed_start     time,
  dwell_min       int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_mustvisit_fixed CHECK (type <> 'FIXED' OR (fixed_date IS NOT NULL AND fixed_start IS NOT NULL)),  -- INV-U1-17
  CONSTRAINT ux_must_visit_poi UNIQUE (trip_id, source_poi_id)   -- INV-U1-18 동일 장소 중복 불가
);
```

### 2.5 거점 (base — trip·saved_stay 의존이라 뒤 버전)

```sql
-- V2.4 base_assignment  (구간 거점)
CREATE TABLE base_assignment (
  base_assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  saved_stay_id uuid NOT NULL REFERENCES saved_stay(saved_stay_id) DEFERRABLE INITIALLY DEFERRED,  -- 사용 중 직접삭제 차단(커밋검사)+계정 퍼지 cascade 허용
  date_from     date NOT NULL,
  date_to       date NOT NULL,                        -- 다박=단일 배정(INV-U1-15)
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_base_dates CHECK (date_to > date_from)   -- INV-U1-15
);
CREATE INDEX ix_base_assignment_trip ON base_assignment (trip_id);
```

```sql
-- V2.4 trip_base_day  (날짜별 확정 거점 — 커버리지 차단형)
CREATE TABLE trip_base_day (
  trip_id       uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  day_date      date NOT NULL,
  saved_stay_id uuid REFERENCES saved_stay(saved_stay_id) DEFERRABLE INITIALLY DEFERRED,  -- NULL 허용(destination_center). 사용 중 직접삭제 차단+퍼지 허용
  resolution    varchar(20) NOT NULL CHECK (resolution IN ('auto','prev_stay','destination_center','user_pick')),
  PRIMARY KEY (trip_id, day_date)                     -- 하루 1행 보장. 전-날짜 완비(INV-U1-16)는 CoverageResolver/PBT 소관
);
```

### 2.6 affiliate-link (C5 · 밴드 e)

```sql
-- V2.5 ota_partner
CREATE TABLE ota_partner (
  ota_partner_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              varchar(40)  NOT NULL UNIQUE,
  name              varchar(100) NOT NULL,
  deeplink_template varchar(500) NOT NULL,
  secret_ref        varchar(200),                     -- Secrets Manager 참조(평문 시크릿 금지 SEC-U1-02)
  active            boolean NOT NULL DEFAULT true
);
```

```sql
-- V2.5 outbound_click  (아웃바운드 추적 — 내부 지표, 사용자 미노출)
CREATE TABLE outbound_click (
  outbound_click_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  saved_stay_id     uuid REFERENCES saved_stay(saved_stay_id) ON DELETE SET NULL,
  stay_external_id  varchar(120),
  ota_partner_id    uuid NOT NULL REFERENCES ota_partner(ota_partner_id),
  tracking_id       varchar(64) NOT NULL,             -- 서버 추적 ID(HMAC-SHA256 서명 대상 SEC-U1-02)
  postback_status   varchar(12) NOT NULL DEFAULT 'NONE' CHECK (postback_status IN ('NONE','RECEIVED')),
  clicked_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_outbound_tracking UNIQUE (tracking_id)   -- 포스트백 멱등(같은 거래ID 재수신 무변화 INV-U1-10)
);
CREATE INDEX ix_outbound_account ON outbound_click (account_id, clicked_at DESC);
```

## 3. 이벤트 (아웃박스 — U0 자산 재사용, 신규 인프라 없음)

`StayRegistered`·`StayUpdated`·`TripCreated`·`TripEnded`·`MustVisitChanged`·`TripBaseResolved` 6종을 `outbox_event`로 발행(at-least-once·멱등 구독). 신규 테이블 없음 — U0 트랜잭셔널 아웃박스에 도메인 이벤트만 추가.

또한 **'내 주변' 숙소 탐색 이용 사실**은 U0 `location_legal_log`에 append(BR-U1-11·LEGAL-U1-02) — 위치정보 이용 증적. 신규 테이블 없이 U0 append-only 로그 재사용.

## 4. 불변식 → 강제 위치 매핑

| 불변식 | DB 강제 | 앱 강제(추가) |
|---|---|---|
| INV-U1-01 수집 게이트 | `poi.data_status` CHECK | `PoiCollectionGate` 승격 판정 + **PBT-U1-1**(후보풀에 미통과 0) + ArchUnit 우회금지 |
| INV-U1-02 좌표 필수 | `poi.lat/lng NOT NULL` | 저장·담기 전 검증 |
| INV-U1-03 스냅숏 동결 | FK 미강제(`source_poi_id`) | 확정 시 값 복사 |
| INV-U1-04 담기 유일·복사 | `ux_saved_place` | 여행 생성 시 MustVisit로 복사(참조 아님) |
| INV-U1-05·06 가격 2단 | `stay_price_snapshot`만 영속 | LivePriceGateway 캐싱 금지·즉시 폐기 · NULL→"가격 미확인" |
| INV-U1-08 좌표 확정 | `coord_confirmed` | false면 거점 배정 차단 |
| INV-U1-09 체크아웃>체크인 | `chk_savedstay_dates` | — |
| INV-U1-10 포스트백 멱등 | `ux_outbound_tracking` | HMAC 서명·skew ±5분 검증, 지표 응답 차단 |
| INV-U1-11 여행 날짜 | `chk_trip_dates` | 생성 전 차단 |
| INV-U1-12 국내 강제 | — (지오코딩 판정) | 목적지 KR 영역 검증(서비스) |
| INV-U1-13 상태 단방향 | `status` CHECK(값도메인) | 전이표 가드 + PBT · ENDED/deleted 후 편집 차단 |
| INV-U1-14 Σnights≤기간 | — (교차 집계) | 서비스 검증 + 프론트 PBT(`nightsSum`) |
| INV-U1-15 거점 구간 | `chk_base_dates` | 여행 기간 내 검증 |
| INV-U1-16 커버리지 차단 | `trip_base_day` PK(하루 1행) | 전-날짜 완비 = `CoverageResolver` + **PBT-U1-2** · `TripBaseResolved`로 게이트 해제 |
| INV-U1-17 FIXED 필수 | `chk_mustvisit_fixed` | — |
| INV-U1-18 중복 금지 | `ux_must_visit_poi` | — |
| INV-U1-19 필수 보존 | — | 생성·재생성 후 누락 금지(입력 보존만; 실현가능성=U2·U3) |
| INV-3 소요시간 미표시 | (스키마에 duration 컬럼 없음) | 거리만 노출 · 프론트 PBT |
| BR-U1-56 객체수준 인가 | — | 소유 계정만 접근, 타 계정 404 |

DB로 못 막는 것(수집 게이트·커버리지 판정·국내 강제·상태 전이·Σnights)은 **Kotest PBT**(게이트·커버리지 blocking) + 서비스 가드가 담당.

## 5. Flyway 마이그레이션 파일 구성

`app/src/main/resources/db/migration/` — U0(V1.x) 이어 V2.x. **의존 순서**로 배열(모듈 소유 ≠ 파일 순서).

```
V2.0__place_data.sql       poi · poi_snapshot · saved_place
V2.1__accommodation.sql    stay_price_snapshot            (정적콘텐츠=Redis · 정확가=미저장)
V2.2__saved_stay.sql       saved_stay
V2.3__trip.sql             trip · trip_destination · must_visit   (must_visit→poi_snapshot 의존)
V2.4__trip_base.sql        base_assignment · trip_base_day        (trip·saved_stay 의존)
V2.5__affiliate.sql        ota_partner · outbound_click           (saved_stay 의존)
```

- 신규 append-only 없음 → `V1.7` `ALTER DEFAULT PRIVILEGES`가 신규 테이블 `app_user` DML 자동 부여. **별도 grants 마이그레이션 불필요.**
- 시드(`ota_partner` 초기 제휴사)는 `R__` repeatable 또는 `V2.6__seed_ota.sql`로 분리.

## 6. 설계 결정 (확정 2026-07-25)

1. **좌표 저장** — ✅ **`lat/lng double precision`** 확정. 반경 검색은 bounding-box 프리필터(lat·lng btree 인덱스) + 하버사인 정렬. PostGIS는 **미도입** — DAU 소규모·바운디드 데이터셋이라 불필요, geo 쿼리 병목 실측 시 `geography` 컬럼 추가(forward)로 승격.
2. **최저가 스냅숏** — ✅ **PG 영속** 확정(`stay_price_snapshot`, 키 `(external_source, external_id)`). 배치 결과 감사·캐시 무효화 용이. 정확 1박가는 여전히 미저장(캐싱 금지).
3. **`poi.saved_count`** — ✅ **반정규화 카운터** 확정(이벤트/배치 갱신). BR-U1-06(집계 실패 시 배지 생략)이라 강일관성 불필요.
4. **마이그레이션 버전대** — ✅ U0=V1.x 이어 **V2.x**(tech-stack U1-TS 명시).
5. **Redis 로컬 스택** — ✅ `docker-compose.yml`에 Redis 컨테이너 추가(U1-TS-4). TRIP-174에 포함.
6. **모듈↔파일 순서** — ✅ `base_assignment`/`trip_base_day`는 saved-accommodation 소유지만 `trip` 의존이라 V2.4(trip 뒤). 파일 순서=의존, 코드 소유=모듈.

## 7. 기준선(dbml) 대비 델타 요약

| 테이블 | dbml 대비 |
|---|---|
| `poi` | +`region`·`source`·`saved_count`, `coord`→`lat/lng` |
| `saved_stay` | +`register_route`·`memo`, 날짜 nullable 명시 |
| `outbound_click` | +`tracking_id`(유니크)·`postback_status`·`stay_external_id` |
| `ota_partner` | +`secret_ref`·`active` |
| `trip` | +`companion_type`·`preference_snapshot`, `destination`(단일)→`trip_destination`(다도시) |
| `trip_destination` | **신설** |
| `stay_price_snapshot` | **신설**(dbml 제외였던 가격 스냅숏 영속화) |
| `poi_snapshot`·`saved_place`·`base_assignment`·`trip_base_day`·`must_visit` | dbml과 대체로 일치 |
