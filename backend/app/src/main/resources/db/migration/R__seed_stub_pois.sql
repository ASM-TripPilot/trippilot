-- R__ 반복 시드 — 탐색 랜딩(US-EXPL-01)용 데모 POI. 실 수집(MapPlacePort 실연동) 전 임시.
-- 멱등: 고정 UUID + ON CONFLICT DO NOTHING. app_migrate 로 실행(미한정 테이블명).
-- 실 수집이 붙으면 이 시드는 제거한다(place-data 실 벤더 어댑터 단계).

INSERT INTO poi (poi_id, name_ko, lat, lng, category, region, data_status, source) VALUES
  ('e0000000-0000-4000-8000-000000000001', '성산일출봉', 33.4587, 126.9427, '자연', '제주', 'ACTIVE', 'MANUAL'),
  ('e0000000-0000-4000-8000-000000000002', '제주 흑돼지거리', 33.5108, 126.5219, '맛집', '제주', 'ACTIVE', 'MANUAL'),
  ('e0000000-0000-4000-8000-000000000003', '월정리 카페거리', 33.5563, 126.7960, '카페', '제주', 'ACTIVE', 'MANUAL'),
  ('e0000000-0000-4000-8000-000000000004', '한라산', 33.3617, 126.5292, '자연', '제주', 'ACTIVE', 'MANUAL')
ON CONFLICT (poi_id) DO NOTHING;
