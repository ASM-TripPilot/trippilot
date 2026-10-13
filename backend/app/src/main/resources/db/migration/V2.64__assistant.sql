-- U8 AI 도우미(C16) — 대화 세션·메시지·변경 제안·일 사용량 (TRIP-1377).
--
-- V2.64 — 착수 시점 최신(V2.63) + 1. 열린 PR 중 마이그레이션을 쓰는 것이 없음을 확인했다(2026-10-13).
-- 정본(domain-entities §4)은 테이블마다 파일을 나누자고 했지만 한 파일에 둔다 — 넷이 서로 FK 로 묶여
-- 있어 따로 적용될 일이 없고, 번호 넷을 한꺼번에 잡으면 그 사이 다른 PR 과 채번이 겹칠 자리만 늘어난다.
--
-- **법정 로그가 아니다.** 사용자가 이력을 지우고(`b06`) 보존 만료 청소가 DELETE 를 쓴다 —
-- 동의 로그·위치 법정 로그의 append-only 권한 제약을 여기 걸지 않는다(domain-entities §4).
--
-- 계정·여행에는 전부 CASCADE 를 건다(DATA-U8-03) — 개인 발화라 탈퇴·여행 삭제와 함께 사라지는 것이 맞다.

-- ── 세션: 대화 맥락의 단위(DEC-U8-5) ─────────────────────────────────────────
CREATE TABLE assistant_session (
  session_id        uuid         PRIMARY KEY,
  account_id        uuid         NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  trip_id           uuid         REFERENCES trip(trip_id) ON DELETE CASCADE,  -- NULL = 일반(무컨텍스트) 세션
  status            varchar(16)  NOT NULL CHECK (status IN ('ACTIVE','CLOSED')),
  -- 상대(ai) `DialogueContext` 직렬형. 백엔드는 turn_index 만 올리고 나머지는 해석하지 않는다(INV-U8-07).
  dialogue_context  jsonb        NOT NULL DEFAULT '{}'::jsonb,
  refusal_streak    smallint     NOT NULL DEFAULT 0 CHECK (refusal_streak >= 0),
  created_at        timestamptz  NOT NULL,
  last_turn_at      timestamptz  NOT NULL,
  expires_at        timestamptz  NOT NULL   -- last_turn_at + 보존 기간(DATA-U8-01). 턴마다 연장된다.
);

-- INV-U8-01 — 여행 하나당 ACTIVE 세션 최대 1, 일반 세션도 최대 1. 같은 여행의 대화가 두 갈래로 쪼개지지 않는다.
-- NULL 은 유니크에서 서로 다르다고 보므로 일반 세션은 따로 건다.
CREATE UNIQUE INDEX ux_assistant_session_active_trip
  ON assistant_session (account_id, trip_id) WHERE status = 'ACTIVE' AND trip_id IS NOT NULL;
CREATE UNIQUE INDEX ux_assistant_session_active_general
  ON assistant_session (account_id) WHERE status = 'ACTIVE' AND trip_id IS NULL;
CREATE INDEX ix_assistant_session_account_recent ON assistant_session (account_id, last_turn_at DESC);
CREATE INDEX ix_assistant_session_expires ON assistant_session (expires_at);

-- ── 제안: [적용] 전의 변경안(DEC-U8-2). 메시지가 참조하므로 먼저 만든다 ──────────
CREATE TABLE assistant_proposal (
  proposal_id          uuid         PRIMARY KEY,
  session_id           uuid         NOT NULL REFERENCES assistant_session(session_id) ON DELETE CASCADE,
  account_id           uuid         NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  trip_id              uuid         NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  kind                 varchar(16)  NOT NULL CHECK (kind IN ('EDIT')),
  base_fingerprint     varchar(64)  NOT NULL,   -- 제안을 만든 시점 일정의 내용 지문 — 낡음 판정(INV-U8-04)
  after                jsonb        NOT NULL,   -- 전체 일자·슬롯. 소요시간 없음(INV-U8-09)
  diff                 jsonb        NOT NULL,
  violations           jsonb        NOT NULL DEFAULT '[]'::jsonb,
  apply_hint           varchar(16)  CHECK (apply_hint IN ('AUTO_APPLY','CONFIRM_REQUIRED')),
  status               varchar(16)  NOT NULL
                         CHECK (status IN ('PROPOSED','APPLIED','STALE','DISMISSED','EXPIRED','FAILED')),
  expires_at           timestamptz  NOT NULL,
  applied_at           timestamptz,
  -- 적용 결과 추적(US-ASSIST-05). FK 를 걸지 않는다 — 리비전·변경 이력은 남의 테이블이고,
  -- 여기 행이 지워져도(이력 지우기) 그쪽은 남아야 한다(BR-U8-20).
  revision_id          uuid,
  change_log_entry_id  uuid,
  created_at           timestamptz  NOT NULL
);
CREATE INDEX ix_assistant_proposal_session ON assistant_proposal (session_id);

-- ── 메시지: 표시용 대화 기록(DEC-U8-4) ───────────────────────────────────────
CREATE TABLE assistant_message (
  message_id      uuid         PRIMARY KEY,
  -- 표시 순서이자 페이지 커서. created_at 만으로는 한 턴의 사용자·도우미 행이 같은 시각일 때 순서가 흔들린다.
  seq             bigint       GENERATED ALWAYS AS IDENTITY UNIQUE,
  session_id      uuid         NOT NULL REFERENCES assistant_session(session_id) ON DELETE CASCADE,
  account_id      uuid         NOT NULL,   -- 비정규화 — 분당 리미터(SEC-U8-01)가 세션을 건너 계정으로 센다
  client_turn_id  uuid,                    -- 사용자 턴만. 멱등 키(INV-U8-05)
  role            varchar(16)  NOT NULL CHECK (role IN ('USER','ASSISTANT')),
  kind            varchar(24)  NOT NULL CHECK (kind IN
                    ('TEXT','CLARIFY','REVIEW','CANDIDATES','PROPOSAL','INFO','SCOPE','REFUSAL','FALLBACK','ACTION_LOG')),
  text            text,                    -- 사용자 원문(≤500) 또는 도우미 템플릿 문구. 정책 위반 입력은 NULL + redacted
  redacted        boolean      NOT NULL DEFAULT false,
  payload         jsonb,
  next_actions    jsonb        NOT NULL DEFAULT '[]'::jsonb,
  quick_replies   jsonb        NOT NULL DEFAULT '[]'::jsonb,
  footnote        text,                    -- 카드 아래 각주(프론트 계약 R3)
  proposal_id     uuid         REFERENCES assistant_proposal(proposal_id) ON DELETE SET NULL,
  -- 관측 칸(OBS-U8-01) — 알람·지표의 원천을 DB 행에 둔다. 화면에 쓰지 않는다.
  intent          varchar(40),
  match_route     varchar(16),
  outcome         varchar(32),
  llm_calls       integer      CHECK (llm_calls IS NULL OR llm_calls >= 0),
  latency_ms      integer      CHECK (latency_ms IS NULL OR latency_ms >= 0),
  created_at      timestamptz  NOT NULL,
  CONSTRAINT ux_assistant_message_turn UNIQUE (session_id, client_turn_id),
  -- INV-U8-03 — 도우미 응답은 다음 행동이 하나 이상이다(dead-end 금지). 거절·폴백도 예외가 아니다.
  CONSTRAINT ck_assistant_message_next_action
    CHECK (role <> 'ASSISTANT' OR jsonb_array_length(next_actions) >= 1),
  CONSTRAINT ck_assistant_message_text_length CHECK (text IS NULL OR char_length(text) <= 2000)
);
CREATE INDEX ix_assistant_message_session ON assistant_message (session_id, seq);
CREATE INDEX ix_assistant_message_limiter ON assistant_message (account_id, created_at) WHERE role = 'USER';

-- ── 일 사용량(COST-U8-01) — 대화 기록과 독립이다. 이력을 지워도 줄지 않는다 ─────
CREATE TABLE assistant_usage_daily (
  account_id  uuid     NOT NULL REFERENCES account(account_id) ON DELETE CASCADE,
  day         date     NOT NULL,
  turns       integer  NOT NULL DEFAULT 0 CHECK (turns >= 0),
  llm_turns   integer  NOT NULL DEFAULT 0 CHECK (llm_turns >= 0),
  PRIMARY KEY (account_id, day)
);
