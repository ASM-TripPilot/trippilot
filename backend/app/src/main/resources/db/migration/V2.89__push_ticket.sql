-- Expo 푸시 티켓(TRIP-1707). 발송이 받은 티켓 id 를 남겨 둬야, 15분 뒤 영수증(getReceipts)으로 "Expo 가 접수했다"가 아니라
-- "기기까지 가는 길(APNs·FCM)에서 실패했다"를 서버가 안다. 지금은 티켓이 ok 면 곧바로 SENT 로 세어, .p8 미등록
-- (InvalidCredentials)이나 영수증으로만 드러나는 죽은 토큰(DeviceNotRegistered)이 전부 SENT 뒤에 가려진다.
--
-- 번호 근거: V2.88 이 최신이고 열린 PR 중 마이그레이션을 건드리는 것이 없다(실측, 머지 직전에 다시 확인한다).
-- 이 PR 은 기록만 한다 — 조회·판정(폴러)은 후속이다.

CREATE TABLE push_ticket (
  push_ticket_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Expo 티켓 id(status=ok 에만 있다). 영수증 응답은 이 id 를 키로 돌아온다.
  ticket_id       varchar(64)  NOT NULL UNIQUE,
  notification_id uuid NOT NULL REFERENCES notification(notification_id) ON DELETE CASCADE,
  -- 영수증엔 토큰이 없다 — 어느 기기 것인지 우리가 들고 있어야 DeviceNotRegistered 로 토큰을 무효화할 수 있다.
  -- FK 를 걸지 않는다: 토큰 행이 지워지거나 계정이 옮겨져도 이 기록은 영수증을 받을 때까지 남아야 하고, 무엇보다 이 INSERT 는
  -- 발송 트랜잭션 안에서 도므로 **실패할 수 없어야** 한다(실패하면 Postgres 트랜잭션이 통째로 abort 돼 발화가 롤백되고,
  -- 다음 폴링이 같은 예약을 다시 집어 유예(10분) 동안 매분 재발송한다). 길이는 코드에서 거른다(= PushToken.TOKEN_MAX).
  token           varchar(255) NOT NULL,
  platform        varchar(8)   NOT NULL CHECK (platform IN ('IOS','ANDROID')),
  sent_at         timestamptz  NOT NULL,
  -- NULL = 영수증 판정 전. 판정이 끝나면 셋이 함께 채워진다.
  checked_at      timestamptz,
  receipt_status  varchar(8)   CHECK (receipt_status IN ('OK','ERROR','EXPIRED')),
  -- Expo 오류 코드(DeviceNotRegistered·InvalidCredentials 등). 어휘 CHECK 는 걸지 않는다(V2.31 kind 와 같은 이유 — 벤더 어휘가 늘 수 있다).
  receipt_error   varchar(64),
  CHECK ((checked_at IS NULL) = (receipt_status IS NULL))
);

-- 폴러가 도는 조회: 아직 판정 안 된 것 중 오래된 순. 판정이 끝난 행은 인덱스에서 빠진다.
CREATE INDEX ix_push_ticket_due ON push_ticket (sent_at) WHERE checked_at IS NULL;
-- ON DELETE CASCADE(알림 삭제)가 이 칼럼으로 행을 찾는다.
CREATE INDEX ix_push_ticket_notification ON push_ticket (notification_id);
