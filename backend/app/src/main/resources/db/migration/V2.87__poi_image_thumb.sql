-- POI 사진 썸네일(CDN) — 원본(image_url, TourAPI 940px·100~215KB)을 560px WebP 로 줄여 CloudFront 로 내린다.
-- image_thumb_url NULL = 아직 안 만든 곳 → 서버는 원본 image_url 을 그대로 준다(깨진 사진을 만들지 않는다).
-- 값은 backend/scripts/poi_thumbs.py 배치가 채운다. 수집이 image_url 을 바꾸면 Poi.refreshed 가 이 열을 비운다.
ALTER TABLE poi
  ADD COLUMN image_thumb_url text CHECK (image_thumb_url LIKE 'https://%');
