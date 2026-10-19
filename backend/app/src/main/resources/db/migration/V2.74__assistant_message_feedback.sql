-- 도우미 답변 평가(좋아요·싫어요, US-ASSIST-09)와 그 평가를 AI 로그에 잇는 추적 번호.
--
-- V2.74 — 착수 시점 최신(V2.73) + 1. 열린 PR 중 마이그레이션을 쓰는 것이 없음을 확인했다(2026-10-19).
--
-- **평가는 답의 부속이다** — 메시지당 하나(PK = message_id), 다시 누르면 바꾸고(upsert) 취소하면 행이 사라진다.
-- 메시지 FK 에 CASCADE 를 건다(V2.64 와 같은 이유 — 개인 발화의 부속이라 대화가 사라지는 길을 그대로 따른다):
-- 이력 지우기(세션 hard delete)·여행 삭제 구독·계정 삭제 구독·90일 보존 청소가 전부 세션을 지우고, 세션 → 메시지 → 평가로
-- 연쇄된다. 파기 경로를 따로 두지 않는다 — 두면 그 길을 빠뜨린 파기에서 평가만 살아남는다.
-- **법정 로그가 아니다** — append-only 권한 제약을 걸지 않는다(취소가 DELETE 다).
--
-- account_id 는 비정규화다(assistant_message 와 같다) — 계정 FK 를 따로 걸지 않는다. 계정 파기는 세션 연쇄로 이미 닿고,
-- 둘째 FK 는 같은 행을 두 길로 지울 뿐이다.
--
-- 평가·지표 용도로만 쓴다 — 어떤 모델의 학습 데이터로도 쓰지 않는다(BR-U8-63).
CREATE TABLE assistant_message_feedback (
  message_id  uuid         PRIMARY KEY REFERENCES assistant_message(message_id) ON DELETE CASCADE,
  account_id  uuid         NOT NULL,
  rating      varchar(8)   NOT NULL CHECK (rating IN ('UP','DOWN')),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()   -- 바꾼 시각. 처음 남긴 시각(created_at)은 바꿔도 그대로다
);

-- 추적 번호(BR-U8-64) — 그 턴의 해석 호출에 실어 보낸 `request_meta.request_id`. AI 는 같은 값을 trace_id 로
-- 로그(llm_cost·FallbackEvent·LlmCallRecord)에 남긴다 — 평가를 프롬프트 판본·모델·폴백과 잇는 열쇠다.
-- 해석을 부르지 않은 턴(버튼·빠른 답·버튼 모드)과 사용자 행은 NULL. **expand-only** — 옛 행·옛 파드는 이 칸을 모른다.
ALTER TABLE assistant_message ADD COLUMN trace_id varchar(64);
