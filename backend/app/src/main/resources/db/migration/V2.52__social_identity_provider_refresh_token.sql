-- 제공자 revoke 토큰(TRIP-933) — 계정 파기 때 Apple 토큰을 revoke 하기 위한 refresh_token 보관.
--
-- App Store 5.1.1(v): 애플 로그인을 제공하는 앱은 계정 삭제 시 Sign in with Apple REST API 로 사용자
-- 토큰을 revoke 해야 한다. revoke 에는 refresh_token 이 필요하고, 그것은 로그인 때 받은
-- authorizationCode 를 교환해야만 나온다 — 그래서 로그인 시점에 받아 파기 시점까지 들고 있는다.
--
-- **평문이 아니다.** 앱이 AES-256-GCM 으로 암호화해 base64(iv ‖ 암호문+태그)로 넣는다(키는
-- SOCIAL_TOKEN_ENCRYPTION_KEY env). 컬럼 이름의 `_enc` 가 그 약속이다.
--
-- **값이 있다 = 아직 revoke 하지 않았다.** 별도 재시도 큐 테이블을 두지 않는다 — revoke 성공 시 NULL 로
-- 지우고, 실패하면 남겨 다음 스위프가 다시 집는다. 애플 외 제공자는 항상 NULL.
-- 계정이 실제로 파기되면 social_identity 행과 함께 사라진다(account FK CASCADE).
--
-- V2.51 다음. 원격 브랜치 중 V2.52 이상을 쓰는 것이 없음을 확인했다(2026-09-23).
ALTER TABLE social_identity
  ADD COLUMN provider_refresh_token_enc text;
