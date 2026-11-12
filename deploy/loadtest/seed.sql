-- 부하 테스트 계정 — 개발 DB 에만. account_id 는 md5('trippilot-loadtest-<n>') 로 정해져 있어 다시 돌려도 같은 계정이다
-- (mint.py 가 같은 식으로 토큰의 sub 를 만든다). 이메일 도메인 .test 는 실제로 배달되지 않는다.
\set ON_ERROR_STOP on
SET search_path = app;
INSERT INTO account (account_id, email, age_method, age_confirmed_at, verified_at)
SELECT md5('trippilot-loadtest-' || g)::uuid, 'loadtest-' || g || '@trippilot.test', 'SELF_DECLARED', now(), now()
FROM generate_series(1, :n) AS g
ON CONFLICT (account_id) DO NOTHING;
SELECT count(*) AS loadtest_accounts FROM account WHERE email LIKE 'loadtest-%@trippilot.test';
