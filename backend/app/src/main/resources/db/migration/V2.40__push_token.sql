-- 푸시 토큰(U6 정본 §2.3 · TRIP-549). Expo push token 을 계정·기기 단위로 보관한다(DEC-U6-3).
--
-- 번호 근거: 이 줄기가 V2.32(예약)·V2.35(토글)를 썼고, 다른 줄기가 V2.36~V2.39 를 쓰고 있어
-- 겹치지 않는 다음 번호를 집었다. 열린 PR 중 마이그레이션을 건드리는 것은 없다(실측).
-- 정본은 이 테이블을 V2.35 로 적었지만 그 번호는 이미 토글이 쓰고 있다 — 번호는 머지 시점 사실이다.

CREATE TABLE push_token (
  push_token_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  -- **토큰이 곧 신원이다.** UNIQUE 인 이유는 기기 교체·재설치로 같은 토큰이 다른 계정에 붙을 수 있어서다
  -- — 그때 계정을 옮겨야지 두 계정이 같은 기기에 쏘면 남의 알림이 간다.
  token          varchar(255) NOT NULL UNIQUE,
  device_id      varchar(64),
  platform       varchar(8) NOT NULL CHECK (platform IN ('IOS','ANDROID')),
  -- `location_consent_state.os_permission_mirror` 와 **같은 꼴의 미러**다(어휘도 같게 맞춘다).
  -- 서버가 OS 권한을 알 방법이 없어 클라이언트가 알려 주는 값이며, 채널 판정의 입력이다.
  os_permission  varchar(16) NOT NULL DEFAULT 'NOT_DETERMINED'
                 CHECK (os_permission IN ('GRANTED','DENIED','NOT_DETERMINED')),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  -- INV-U6-07 — Expo 가 `DeviceNotRegistered` 를 주면 **즉시** 찍는다. 죽은 토큰에 계속 쏘면
  -- 레이트리밋을 먹어 살아 있는 기기의 알림까지 밀린다. 지우지 않는 이유는 같은 토큰이 다시
  -- 등록될 때 되살릴 자리가 필요하고, "언제 죽었나"가 조사에 쓰이기 때문이다.
  invalidated_at timestamptz
);

-- 발송이 매번 도는 조회. 유효 토큰 **전부**를 본다(INV-U6-06 다기기).
CREATE INDEX ix_push_token_active ON push_token (account_id) WHERE invalidated_at IS NULL;
