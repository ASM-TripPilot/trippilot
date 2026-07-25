-- V2.0 place-data (C7 · 밴드 d) — POI 정본 + 확정 동결 스냅숏 + 담은 장소
-- 근거: backend/docs/design/숙소여행-DB스키마-설계.md · construction/u1-accommodation-trip
-- 좌표=lat/lng double(확정) · 반경은 bounding-box 프리필터 + 하버사인.

CREATE TABLE poi (
  poi_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ko       varchar(200) NOT NULL,
  lat           double precision NOT NULL,           -- INV-U1-02 좌표 필수
  lng           double precision NOT NULL,
  category      varchar(12)  NOT NULL CHECK (category IN ('명소','맛집','카페','야경','자연','쇼핑','문화')),
  region        varchar(60),                          -- 시·군·구(표시용)
  opening_hours varchar(200),                         -- NULL=미확인
  data_status   varchar(12)  NOT NULL DEFAULT 'UNVERIFIED'
                CHECK (data_status IN ('ACTIVE','UNVERIFIED','LOST','CLOSED')),  -- INV-U1-01 수집 게이트
  source        varchar(12)  NOT NULL CHECK (source IN ('KAKAO_LOCAL','TOURAPI','MANUAL')),
  saved_count   bigint       NOT NULL DEFAULT 0,      -- '저장 수' 반정규화 카운터(이벤트/배치 갱신)
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
-- INV-1: 조회는 ACTIVE만. 지역 조회 + 반경 bounding-box 프리필터용 좌표 인덱스.
CREATE INDEX ix_poi_active_region ON poi (region)     WHERE data_status = 'ACTIVE';
CREATE INDEX ix_poi_active_coord  ON poi (lat, lng)   WHERE data_status = 'ACTIVE';

CREATE TABLE poi_snapshot (
  poi_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_poi_id   uuid NOT NULL,                      -- 원본 참조(FK 미강제 — INV-U1-03 폐업/삭제돼도 유지)
  name_ko         varchar(200) NOT NULL,              -- 값 동결
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  category        varchar(12)  NOT NULL,
  snapshot_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE saved_place (
  saved_place_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  poi_id         uuid NOT NULL REFERENCES poi(poi_id),
  saved_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_saved_place UNIQUE (account_id, poi_id)   -- INV-U1-04 (accountId,poiId) 유일
);
CREATE INDEX ix_saved_place_account ON saved_place (account_id, saved_at DESC);
