-- TRIP-U1 숙소 정본 — 스텁(제주 5곳) 교체를 위한 테이블.
-- 번호 근거: V2.25 까지 사용 중이고 열린 PR 중 마이그레이션을 쓰는 것이 없다(2026-08-20 gh 실측).
--
-- **왜 테이블이 필요한가.** 지금 숙소 검색은 요청마다 벤더를 부른다(StaySearchService). 실 공급자를
-- 그대로 꽂으면 사용자 검색 1회 = 외부 호출 1회가 되어, 쿼터가 곧 검색 가능 횟수가 된다.
-- POI 와 같은 구조(배치 수집 → 정본 → 런타임은 DB)로 옮긴다.

CREATE TABLE stay (
  external_source varchar(20)  NOT NULL,   -- LOCALDATA · (후속) TOURAPI
  external_id     varchar(60)  NOT NULL,   -- 공급자 내 식별자(LOCALDATA=관리번호)
  name            varchar(200) NOT NULL,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  -- 표시용 지역명(시군구). 판정·조회는 region_code 로 한다 — 문자열은 표기가 흔들린다.
  region          varchar(60)  NOT NULL,
  region_code     varchar(5)   REFERENCES region(region_code),
  stay_type       varchar(20)  NOT NULL,   -- 호텔·리조트·게스트하우스…
  -- 편의시설. **비어 있는 것과 "없는 것"은 다르다** — LOCALDATA 는 이 정보를 주지 않으므로
  -- 전부 빈 배열이고, 그 사실은 응답에서 따로 알린다(필터가 조용히 0건을 내지 않도록).
  amenities       text[]       NOT NULL DEFAULT '{}',
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (external_source, external_id)
);

-- 지역별 조회가 유일한 접근 경로다. 시도 롤업은 코드 접두사로 하므로 정렬된 인덱스가 그대로 쓰인다.
CREATE INDEX ix_stay_region_code ON stay (region_code, name);
