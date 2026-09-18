-- 생성 방식 영속(TRIP-268 · US-SCHED-09).
-- 지금까지 방식(완전 AI / 같이 고르기 / 직접 만들기)은 요청 파라미터로만 있고 남지 않아,
-- 재조회·재생성 시 "이 일정을 어떻게 만들었는지"를 알 수 없었다.
--
-- solve_mode 와 다른 축이다: solve_mode 는 **AI 가 어떻게 풀었나**(FULL_AI/DETERMINISTIC/MINIMAL),
-- generation_mode 는 **사용자가 무엇을 골랐나**. 직접 만들기는 AI 를 아예 부르지 않아 solve_mode 로는 표현되지 않는다.
ALTER TABLE itinerary ADD COLUMN generation_mode varchar(10) NOT NULL DEFAULT 'FULLY_AI'
  CHECK (generation_mode IN ('FULLY_AI','CO_PLAN','MANUAL'));
