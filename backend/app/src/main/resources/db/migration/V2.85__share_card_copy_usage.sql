-- 공유 카드 문구(j06)의 계정당 하루 AI 호출 횟수(TRIP-1411).
--
-- V2.85 — 작성 시 origin/develop 최댓값 V2.81 이고, 열린 PR 이 V2.82(#1528)·V2.83(#1529)·V2.84(#1559)를 쓴다(2026-10-22).
-- 머지 직전 develop 최댓값과 다시 맞춘다 — Flyway outOfOrder 가 꺼져 있어 더 작은 번호가 뒤에 오면 기동이 막힌다.
--
-- 이 경로는 부를 때마다 LLM 을 한 번 부르고 결과를 저장하지 않는다 — 세어 둘 행이 따로 없어 카운터를 둔다.
-- **계정당 한 행**이다(날짜를 키에 넣지 않는다): 새 날이 오면 같은 행을 1 로 되돌려 쓴다(날은 앞으로만 간다 — 늦게 온 옛 날 요청은
-- 저장된 새 날의 횟수로 센다, ShareCardUsageRepositoryAdapter). 그래서 행 수가 계정 수를 넘지 않고
-- 지난 날을 지우는 청소가 필요 없다. 지난 날의 횟수는 남지 않는다 — 상한 판정 말고 이 값을 읽는 곳이 없다.
-- 계정이 지워지면 함께 지운다(FK CASCADE — assistant_usage_daily 와 같은 관례).
CREATE TABLE share_card_copy_usage (
  account_id  uuid     PRIMARY KEY REFERENCES account(account_id) ON DELETE CASCADE,
  day         date     NOT NULL,
  calls       integer  NOT NULL CHECK (calls >= 0)
);
