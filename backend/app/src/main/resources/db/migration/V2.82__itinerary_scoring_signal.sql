-- 취향 점수 신호 영속(TRIP-1173 · AI 계약 PR #834).
--
-- solve_mode 는 조립기 축이라 LLM 이 점수를 못 매겨도 FULL_AI 로 남는다 — 그래서 앱이 "LLM 이 안 돈다"와
-- "LLM 이 돌았다"를 구분하지 못했다. AI 는 generate 응답에 점수 출처와 밟은 강등 계단을 싣는다.
--
-- 판정은 AI 소유다 — 백엔드는 그대로 보관·전달하고 재계산하지 않는다.
-- scoring_mode: LLM(전 후보 LLM 점수) · MIXED(LLM + 규칙 보충) · RULE(규칙만). NULL = 모름
--   (필드 없던 옛 응답 · 직접 만들기 · 최소 폴백 · 이 마이그레이션 전 행 — 소급하지 않는다).
-- degradations: ["llm:c1_fallback", ...] 기계 코드 배열. 빈 배열 = 강등 없음(또는 모름).
ALTER TABLE itinerary
  ADD COLUMN scoring_mode varchar(8) NULL CHECK (scoring_mode IN ('LLM','MIXED','RULE')),
  ADD COLUMN degradations jsonb NOT NULL DEFAULT '[]'::jsonb;
