-- region — 행정구역 카탈로그(TRIP-357 · 부모 TRIP-356).
--
-- 여행지 선택이 자유 문자열이라 세 가지가 동시에 깨져 있었다:
--   ① 표기 흔들림(제주/제주도/제주특별자치도가 서로 다른 값으로 저장)
--   ② 고를 수 있는 지역과 받아주는 지역이 다름(프론트 상수 소수 vs 서버 좌표 판정)
--   ③ POI 없는 지역을 골라도 조용히 빈 일정(INV-1 닫힌 후보 풀 · INV-4 침묵 실패 금지)
-- 표준코드를 카탈로그로 두면 셋이 함께 풀린다.
--
-- V2.23 다음 번호. 열린 PR 중 db/migration 을 건드리는 것이 없어 충돌 없음(2026-08-19 확인).
CREATE TABLE region (
  -- 법정동코드 기반. **시도 2자리 · 시군구 5자리**로 자릿수가 다르다(코드 체계가 그렇다).
  region_code varchar(5)  PRIMARY KEY,
  name        varchar(40) NOT NULL,              -- 표시명. 시군구는 시도명을 빼고 짧게(예: '종로구')
  sido_code   varchar(2)  NOT NULL,              -- 시도 자신은 region_code 와 같다
  sido_name   varchar(30) NOT NULL,
  level       varchar(8)  NOT NULL CHECK (level IN ('SIDO','SIGUNGU')),
  lat         double precision,                  -- 중심좌표. 원본에 없어 후속에서 채운다(NULL 허용)
  lng         double precision,
  -- 목적지로 고를 수 있는가. 카탈로그에는 **다 담되** 고르는 것만 연다 —
  -- 도(道) 전체나 일반시의 행정구(수원시 장안구)는 여행지로 범위가 어긋난다.
  selectable  boolean     NOT NULL DEFAULT false,
  -- 그 지역이 보유한 ACTIVE POI 수. 여기서는 0으로 두고 TRIP-359 가 채운다 —
  -- 고르기 **전에** 커버리지를 알려 주기 위한 값이다(INV-1 을 화면이 정직하게 말하게 한다).
  poi_count   integer     NOT NULL DEFAULT 0 CHECK (poi_count >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 자동완성이 이름 부분일치로 돈다. 선택 가능한 것만 먼저 보이므로 그 조건을 인덱스에 싣는다.
CREATE INDEX ix_region_selectable_name ON region (name) WHERE selectable;
CREATE INDEX ix_region_sido ON region (sido_code, level);

-- 검색 별칭 — 표준코드를 그대로 쓰되 사용자가 아는 이름으로 찾게 한다.
--
-- **왜 필요한가**: 광주광역시(29)·전라남도(46)가 폐지되고 전남광주통합특별시(12)로 통합됐다(실측).
-- 표준명만 두면 사용자가 '광주'로 검색해도 아무것도 안 잡힌다. 표시명을 손대면 표준과 갈라지므로
-- 별칭을 따로 둔다 — 개편이 또 있어도 이 표만 늘리면 된다.
CREATE TABLE region_alias (
  alias       varchar(40) NOT NULL,
  region_code varchar(5)  NOT NULL REFERENCES region(region_code) ON DELETE CASCADE,
  PRIMARY KEY (alias, region_code)
);
CREATE INDEX ix_region_alias_code ON region_alias (region_code);
