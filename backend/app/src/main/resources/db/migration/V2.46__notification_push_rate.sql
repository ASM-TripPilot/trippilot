-- 푸시 발송량 소프트 상한(COST-U6-01) 조회용 인덱스 — TRIP-844
--
-- 번호 근거: V2.45(아웃박스 백오프)가 같은 트랙의 직전 번호이고, 그 외 열린 PR 중 db/migration 점유 없음.
--
-- 판정 쿼리는 "이 계정이 최근 1시간·1일에 **푸시가 나간** 알림이 몇 건인가"다.
-- 기존 인덱스 두 개로는 못 좁힌다:
--   ix_notification_account_occurred (account_id, occurred_at DESC) — occurred_at 은 적재 시각이라
--     푸시가 실제로 나갔는지와 무관하다(생략·실패한 것도 포함된다)
--   ix_notification_unread (account_id) WHERE read_at IS NULL — 읽음 축이라 무관
--
-- 부분 인덱스인 이유: 푸시가 안 나간 행(생략·실패)은 판정 대상이 아니다. 알림함 행은 계속 쌓이지만
-- 그중 실제 발송분만 색인해 인덱스가 표 전체를 따라 자라지 않게 한다.
CREATE INDEX ix_notification_pushed
  ON notification (account_id, push_sent_at DESC)
  WHERE push_sent_at IS NOT NULL;
