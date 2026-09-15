-- 리마인드 문구 AI 채움(TRIP-836 잔여) — 예약 행에 문구를 담는다.
--
-- 번호 근거: V2.46 이 최신이고 열린 PR 중 db/migration 을 점유한 것이 없다(2026-09-16 확인).
--
-- **왜 예약 행에 두나.** 문구는 예약을 적재할 때 한 번 받아 두고 발화 때 꺼내 쓴다. 발화 시점에
-- AI 를 부르면 (가) 발화가 상대 지연에 묶이고 (나) 리마인드 수만큼 호출이 늘며 (다) 상대가 죽은
-- 밤에 알림이 통째로 늦는다. 적재는 아웃박스 릴레이(배경)에서 도므로 사용자 대기에 안 걸린다.
--
-- **NULL 이 기본이고 그것이 정상이다.** 비어 있으면 발화가 종전 상수 문구를 쓴다(BR-U6 폴백).
-- AI 를 안 켠 환경·상대가 degraded 로 답한 경우·문구를 못 받은 예약이 전부 여기 해당한다.
-- 그래서 NOT NULL 도 기본값도 두지 않는다 — "받았다"와 "못 받았다"가 값으로 구분돼야 한다.
--
-- 길이: 푸시 본문은 잠금화면에 그대로 뜨므로 짧다(SEC-U6-01). 제목 60·본문 200 은 `notification`
-- 표의 같은 칸과 맞춘 값이고, 넘치면 상대 응답을 잘라 담는 것이 아니라 **그 문구를 안 쓴다**
-- (잘린 문장을 사용자에게 보이느니 상수 문구가 낫다).
ALTER TABLE notification_schedule
  ADD COLUMN title varchar(60),
  ADD COLUMN body  varchar(200);

COMMENT ON COLUMN notification_schedule.title IS
  'AI 가 채운 리마인드 제목. NULL = 못 받았거나 안 켰다 → 발화가 상수 문구를 쓴다(TRIP-836).';
COMMENT ON COLUMN notification_schedule.body IS
  'AI 가 채운 리마인드 본문. NULL 의 뜻은 title 과 같다.';
