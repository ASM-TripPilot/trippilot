-- POI 대표 사진의 공공누리 유형 — 관광공사(TourAPI) 사진은 1유형(출처표시)과 3유형(출처표시+변경금지)으로 갈린다.
-- 앱은 TYPE3 사진을 자르지 않고 전체를 보이고(contain), TYPE1 은 지금처럼 채운다(2026-11-02 B안).
-- NULL = 모름(관광공사 사진이 아니거나 아직 수집 전). 값은 수집본 provenance.cpyrht_div_cd("Type1"·"Type3")에서 온다.
-- image_url 이 바뀌면 Poi.refreshed 가 이 칸도 그 사진의 값으로 바꾼다(V2.87 썸네일과 같은 규칙).
ALTER TABLE poi
  ADD COLUMN image_license text CHECK (image_license IN ('TYPE1', 'TYPE3'));
