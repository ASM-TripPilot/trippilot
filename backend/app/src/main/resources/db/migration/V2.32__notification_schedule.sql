-- 시각 기반 리마인드 예약(U6 DEC-U6-10 · TRIP-547).
--
-- 번호 근거: 정본은 V2.36 을 제안했으나 "머지 시점 재배정"을 명시했고, 이 티켓에 V2.31·V2.32 가 배정됐다
-- (V2.31 주석 참조).
--
-- **왜 테이블이 필요한가.** TRIP_PRE·TRIP_DAY·SLOT_PRE 는 아무 일도 일어나지 않았는데 시각이 되어 발화한다.
-- 아웃박스는 "일어난 일"을 나르는 통로라 이걸 만들 수 없다. 일정이 생성·재계획될 때 예정 시각을 미리 적어 두고
-- 폴링이 도래분을 집는다.

CREATE TABLE notification_schedule (
  schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  trip_id     uuid NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  -- TRIP_PRE | TRIP_DAY | SLOT_PRE — notification.kind 와 같은 어휘의 부분집합.
  -- notification 과 같은 이유로 CHECK 를 걸지 않는다(어휘의 주인은 NotificationKind 하나여야 한다).
  kind        varchar(16) NOT NULL,
  -- SLOT_PRE 만 가진다. 물리 키가 아니라 경계 키 "{date}#{poiId}"(BR-U2-04) — 재계획으로 슬롯 행이
  -- 갈려도 참조가 끊기지 않아야 한다.
  slot_key    varchar(100),
  fire_at     timestamptz NOT NULL,
  fired_at    timestamptz,
  -- INV-U6-09. 서버가 멈춰 있던 사이 시각이 지나 버린 예약은 **발화하지 않고 여기에 표시**한다 —
  -- "한 시간 전에 시작했어야 할 일정" 알림은 안 오느니만 못하다.
  canceled_at timestamptz
);

-- 폴링이 보는 유일한 조회다(ix_outbox_unpublished 와 같은 꼴). 발화·취소된 행은 다시 보지 않으므로 제외한다.
CREATE INDEX ix_notification_schedule_pending
  ON notification_schedule (fire_at) WHERE fired_at IS NULL AND canceled_at IS NULL;
