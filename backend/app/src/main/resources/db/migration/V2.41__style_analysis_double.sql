-- V2.39 가 avg_places_per_day·avg_radius_km 를 numeric 으로 정의했으나, 엔티티(StyleAnalysisEntity)·
-- 도메인·서비스는 전부 Double(float8) 이다. Hibernate 스키마 검증이 타입 불일치로 부팅을 막았다
-- (numeric vs float(53)). 코드가 정본이므로 DB 를 float8 로 넓힌다(기존 값 안전 변환, forward-only).
ALTER TABLE style_analysis
  ALTER COLUMN avg_places_per_day TYPE double precision,
  ALTER COLUMN avg_radius_km      TYPE double precision;
