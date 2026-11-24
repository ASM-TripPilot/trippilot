-- 장소 탐색(`GET /places`)이 요청마다 poi 전체를 훑지 않게 — TRIP-1843.
--
-- 왜: 이름 검색은 `lower(name_ko) like '%' || q || '%'`(앞 와일드카드), 지역 목록은 `substring(region_code, 1, len) in (...)`
-- 이라 기존 인덱스(region·좌표·region_code)를 못 탄다. 운영 7일 `/places` 3,977건 · p95 581 ms 로 서버 시간 1위,
-- 개발 서버 부하(backend 2)에서 DB CPU 99.5% 포화. 로컬 실험(실제 공유본 108,029건): 첫 장 8~22 ms 중 15~18 ms 가 전체 스캔.
--
-- 이름 검색 = 바이그램(2글자 조각) GIN. pg_trgm 은 3글자 단위라 2글자 검색어(카페·공원·시장…)에서 플래너가 쓰지 않는다
-- (실측: 3글자 '박물관' 만 줄었다). 조각 포함(@>)으로 후보를 좁히고, 정확한 일치는 기존 like 가 그대로 다시 본다.
-- 조각 수는 lower 뒤 길이로 센다 — 대소문자 변환이 글자 수를 바꾸는 콜레이션(ICU 등)에서도 끝 조각이 빠지지 않게.
-- 지역 목록 = 시도(2자리)는 표현식 인덱스, 시군구(5자리)는 기존 ix_poi_region_active(V2.25) — 쿼리를 그 모양으로 바꾼다.
CREATE FUNCTION poi_name_bigrams(t text) RETURNS text[]
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT coalesce(array_agg(DISTINCT substr(lower(t), i, 2)), '{}') FROM generate_series(1, char_length(lower(t)) - 1) AS i $$;

CREATE INDEX ix_poi_active_name_bigram ON poi USING gin (poi_name_bigrams(name_ko)) WHERE data_status = 'ACTIVE';
CREATE INDEX ix_poi_active_sido ON poi (left(region_code, 2)) WHERE data_status = 'ACTIVE';
