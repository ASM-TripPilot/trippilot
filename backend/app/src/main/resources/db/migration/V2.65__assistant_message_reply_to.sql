-- 도우미 응답이 **어느 턴의 답인지**를 행에 적는다(TRIP-1378).
--
-- V2.65 — 착수 시점 최신(V2.64) + 1. 열린 PR 중 마이그레이션을 쓰는 것이 없음을 확인했다(2026-10-14).
--
-- V2.64 에는 이 칸이 없어 "그 턴의 응답"을 **위치**(사용자 행 뒤 ~ 다음 사용자 행 앞)로 정했다. 한 대화에 서로 다른
-- 두 턴이 겹쳐 처리되면 위치가 섞인다: 먼저 들어온 턴의 답이 늦게 들어온 턴의 사용자 행 뒤에 적혀, 늦은 턴의
-- 응답으로 읽히고 먼저 온 턴은 영영 응답이 없는 턴이 된다(재전송할 때마다 다시 처리된다 — 멱등 INV-U8-05 파손).
-- 앱이 대기를 취소하고 새 말을 보내면 서버의 앞선 처리는 아직 돌고 있어, 흔한 흐름이다.
--
-- 사용자 행의 `client_turn_id` 를 그대로 가리킨다. FK 는 걸지 않는다 — `(session_id, client_turn_id)` 유니크의
-- 한쪽만 가리킬 수 없고, 두 행은 같은 세션의 CASCADE 로 함께 사라진다.
ALTER TABLE assistant_message ADD COLUMN reply_to uuid;

-- 멱등 재생과 "이미 답했는가" 확인이 이 조회다. 도우미 행에만 값이 있다.
CREATE INDEX ix_assistant_message_reply_to ON assistant_message (session_id, reply_to) WHERE reply_to IS NOT NULL;
