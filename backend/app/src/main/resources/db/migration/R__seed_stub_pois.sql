-- R__ 반복 시드 — 탐색 랜딩(US-EXPL-01)용 데모 POI. 실 수집(MapPlacePort 실연동) 전 임시.
-- 멱등: 고정 UUID + ON CONFLICT DO NOTHING. app_migrate 로 실행(미한정 테이블명).
-- 실 수집이 붙으면 이 시드는 제거한다(place-data 실 벤더 어댑터 단계).

-- image_url 은 채우지 않는다(TRIP-219) — 실 수집 전이라 정당한 원본이 없고, 가짜 URL 은
-- 클라에 깨진 이미지를 그린다. NULL 이면 클라가 자리만 비운다.
INSERT INTO poi (poi_id, name_ko, lat, lng, category, region, data_status, source, tags) VALUES
  ('e0000000-0000-4000-8000-000000000001', '성산일출봉', 33.4587, 126.9427, '자연', '제주', 'ACTIVE', 'MANUAL', '{일출,바다,명소}'),
  ('e0000000-0000-4000-8000-000000000002', '제주 흑돼지거리', 33.5108, 126.5219, '맛집', '제주', 'ACTIVE', 'MANUAL', '{미식,골목}'),
  ('e0000000-0000-4000-8000-000000000003', '월정리 카페거리', 33.5563, 126.7960, '카페', '제주', 'ACTIVE', 'MANUAL', '{카페,바다,감성}'),
  ('e0000000-0000-4000-8000-000000000004', '한라산', 33.3617, 126.5292, '자연', '제주', 'ACTIVE', 'MANUAL', '{자연,등산}')
-- DO NOTHING 이면 이미 시드된 DB 에 tags 가 반영되지 않는다(R__ 는 체크섬 변경 시 재실행되므로 갱신이 맞다).
ON CONFLICT (poi_id) DO UPDATE SET tags = EXCLUDED.tags;
