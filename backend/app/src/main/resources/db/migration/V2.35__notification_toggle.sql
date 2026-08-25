-- 알림 종류별 토글(U6 정본 §2.2 · TRIP-548).
--
-- 번호 근거: V2.31·V2.32 는 TRIP-547 이, V2.33·V2.34 는 TRIP-542(사진 메타·메모)가 가져갔다.
-- 정본은 V2.34 를 제안했으나 그 표가 "머지 시점 재배정"을 명시한다. V2.29·V2.30 은 비워 둔다 —
-- 앞 번호를 뒤늦게 채우면 이미 V2.31 을 적용한 환경에서 Flyway 가 거부한다.

CREATE TABLE notification_toggle (
  account_id     uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  -- SYSTEM 을 제외한 7종. notification.kind 와 같은 이유로 **CHECK 를 걸지 않는다** —
  -- 커뮤니티(U7) 개통 때 어휘를 넓히자고 마이그레이션이 붙는 것을 피한다.
  kind           varchar(16) NOT NULL,
  push_enabled   boolean NOT NULL,
  in_app_enabled boolean NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, kind)
);

-- INV-U6-04 — `SYSTEM` 행은 만들지 않는다. 만들면 언젠가 꺼지고, 그러면 보안·계정 알림이 사라진다.
-- 애플리케이션이 막지만 DB 도 같은 말을 한다.
ALTER TABLE notification_toggle ADD CONSTRAINT ck_notification_toggle_not_system CHECK (kind <> 'SYSTEM');
