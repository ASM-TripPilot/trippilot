-- V1.6 C3 Moderation — 금칙어 사전

CREATE TABLE banned_word_dictionary (
  dict_version varchar(40) PRIMARY KEY,
  entries      jsonb NOT NULL,             -- [{word, category}] · 매칭 원문은 검증 응답 미노출
  deployed_at  timestamptz NOT NULL DEFAULT now(),
  active       boolean NOT NULL DEFAULT false
);
-- INV-B1 활성 버전 항상 정확히 1개
CREATE UNIQUE INDEX ux_banned_active ON banned_word_dictionary ((active)) WHERE active;
