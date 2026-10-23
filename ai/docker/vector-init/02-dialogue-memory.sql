-- 도우미 세션 메모리 (assistant-orchestrator FD DE §4) — 컨테이너 최초 기동 1회.
-- DDL 정본은 둘이다: 여기(compose initdb)와 deploy/eks/bootstrap.sql(EKS 마스터 Job). 문장이 같아야 하며
-- deploy/eks/tests/test_runtime.py 가 둘을 대조한다. PgDialogueMemoryStore(agents/adapters/pg_memory_store.py)는 DML 만 소유한다.
-- 기존 볼륨에는 initdb 가 다시 돌지 않는다 — `docker compose down -v` 또는 이 파일을 ai-vectordb 에 수동 적용.
-- GRANT 가 없는 이유: 이 컨테이너는 POSTGRES_USER(ai_kb)가 DB 소유자이고 앱도 그 롤로 붙는다. bootstrap.sql 의
-- `GRANT … TO ai_user` 를 그대로 두면 롤이 없어 initdb 가 ON_ERROR_STOP 으로 초기화를 통째로 멈춘다.
CREATE TABLE IF NOT EXISTS public.dialogue_memory (
  session_id            text PRIMARY KEY,      -- BE assistant_session.session_id
  account_ref           text,                  -- BE account id (불투명 문자열, 로그 금지)
  trip_id               text,
  summary               jsonb NOT NULL DEFAULT '[]',   -- ≤20 줄, 줄 ≤120자 (LLM 요약 또는 결정론 압축)
  summarized_turn_index integer NOT NULL DEFAULT 0,    -- 이 요약이 덮은 마지막 turn_index
  updated_at            timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL           -- updated_at + 90일 (BE DATA-U8-01 과 같은 값, 쓸 때 연장)
);
CREATE INDEX IF NOT EXISTS ix_dialogue_memory_account ON public.dialogue_memory (account_ref, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_dialogue_memory_trip ON public.dialogue_memory (trip_id);
-- 기억 줄 벡터(2026-10-23 — 이번 말과 관련된 기억 줄만 꺼낸다, BR-AO-09 개정). 행은 dialogue_memory 를 따라 지워진다(ON DELETE CASCADE)
-- — 이력 지우기·여행 삭제·계정 삭제 3호출과 TTL 정리가 이 표에도 그대로 걸린다(BR-AO-10). 기존 볼륨에는 이 문장만 수동 적용.
CREATE TABLE IF NOT EXISTS public.dialogue_memory_vectors (
  session_id text NOT NULL REFERENCES public.dialogue_memory (session_id) ON DELETE CASCADE,
  line       text NOT NULL,                 -- 그 세션 summary 의 한 줄 그대로
  model      text NOT NULL,                 -- 임베딩 모델 id — 바뀌면 옛 벡터는 검색에 안 걸리고 다음 요약 때 다시 만든다
  embedding  vector(1024) NOT NULL,
  PRIMARY KEY (session_id, line)
);
