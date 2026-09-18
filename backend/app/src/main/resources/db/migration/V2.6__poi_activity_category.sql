-- V2.6 poi 카테고리 '액티비티' 추가 (TRIP-264 · U2 BE-4)
-- 근거: backend/docs/design/ai-backend-경계-계약-초안.md 결정 2 (경계 코드 8종, ACTIVITY 추가 — AI 회신 합의)
-- poi.category 인라인 CHECK(auto명 poi_category_check)를 교체해 '액티비티' 허용. 기존 값·행 영향 없음(순증).

ALTER TABLE poi DROP CONSTRAINT poi_category_check;
ALTER TABLE poi ADD CONSTRAINT poi_category_check
  CHECK (category IN ('명소','맛집','카페','야경','자연','쇼핑','문화','액티비티'));
