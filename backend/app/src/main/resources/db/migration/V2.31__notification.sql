-- 인앱 알림함(U6 · TRIP-547) — 알림의 정본. 푸시는 즉시성 보조 수단이고, "누락 0"의 근거는 이 행이다.
--
-- 번호 근거: 정본(U6 domain-entities §5)은 V2.33 을 제안했지만 그 표는 "머지 시점 재배정"을 명시한다.
-- V2.28 도 같은 이유로 U5·U6 제안(visit_photo_meta)이 아니라 TRIP-539 가 가져갔다. 현재 최신은 V2.28 이고
-- 열린 PR 중 마이그레이션을 쓰는 것이 없어(2026-08-25 gh 실측) 이 티켓에 V2.31·V2.32 가 배정됐다.

CREATE TABLE notification (
  notification_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  -- 8종(STAY·TRIP_PRE·TRIP_DAY·SLOT_PRE·PLAN_B·REFLECTION·COMMUNITY·SYSTEM).
  -- **CHECK 를 걸지 않는다** — 커뮤니티(U7) 개통 때 어휘를 넓히자고 마이그레이션이 붙는 것을 피한다.
  -- 검증은 애플리케이션(NotificationKind.of)이 한다.
  kind               varchar(16)  NOT NULL,
  title              varchar(120) NOT NULL,
  body               varchar(400) NOT NULL,
  -- 알림에서 어디로 들어가는가. 진입이 없는 알림은 둘 다 null.
  action_type        varchar(24),
  action_payload     jsonb,
  -- INV-U6-01 멱등 키. 아웃박스는 at-least-once 라 같은 이벤트가 두 번 배달될 수 있고,
  -- 그때 알림이 두 개 생기면 사용자가 같은 말을 두 번 듣는다. 앱 로직이 아니라 **DB 가** 막는다.
  -- 스케줄러가 만든 알림은 원천 이벤트가 없어 null 이다 — PostgreSQL 의 UNIQUE 는 null 을 서로 다르게 본다.
  source_event_id    uuid UNIQUE,
  dedup_key          varchar(120),
  occurred_at        timestamptz  NOT NULL DEFAULT now(),
  read_at            timestamptz,
  -- INV-U6-02 푸시 결과는 **적재와 독립**이다. 발송이 실패해도 위의 행은 그대로 남는다.
  -- TRIP-547 은 이 두 칸을 만들기만 하고 채우지 않는다(발송은 TRIP-549).
  push_sent_at       timestamptz,
  push_failed_reason varchar(200)
);

-- 알림함 목록·catch-up 커서의 유일한 접근 경로.
CREATE INDEX ix_notification_account_occurred ON notification (account_id, occurred_at DESC);
-- 미읽음 뱃지. 전체의 일부만 담으므로 부분 인덱스로 둔다.
CREATE INDEX ix_notification_unread ON notification (account_id) WHERE read_at IS NULL;
