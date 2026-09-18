-- R__ (repeatable) 기준 데이터 시드 — 약관 버전(P7) · 금칙어 사전(P8) 플레이스홀더.
-- repeatable: 파일 내용(체크섬)이 바뀌면 다음 migrate 때 재적용. 멱등(ON CONFLICT)으로 안전.
-- 데이터 추가/변경은 이 파일을 편집 → 커밋 → 팀원 `docker compose up` 시 자동 반영.
-- 실행 주체는 app_migrate(테이블 소유자). 버전 migration(V1.*) 이후 실행됨.

-- ── 약관 버전 (P7 플레이스홀더) ─────────────────────────────
-- 온보딩 필수 = 이용약관·개인정보 2종(설계 §7). 나머지는 각 동의 플로우에서 사용.
INSERT INTO terms_version (terms_type, version, body, effective_at, reconsent_required) VALUES
  ('TERMS_OF_SERVICE', '1.0', '[플레이스홀더] 이용약관 본문',        TIMESTAMPTZ '2026-01-01 00:00:00+00', false),
  ('PRIVACY_POLICY',   '1.0', '[플레이스홀더] 개인정보처리방침 본문', TIMESTAMPTZ '2026-01-01 00:00:00+00', false),
  ('LOCATION_TERMS',   '1.0', '[플레이스홀더] 위치정보 이용약관',     TIMESTAMPTZ '2026-01-01 00:00:00+00', false),
  ('MARKETING',        '1.0', '[플레이스홀더] 마케팅 정보 수신 동의',  TIMESTAMPTZ '2026-01-01 00:00:00+00', false),
  ('GPS_RECORDING',    '1.0', '[플레이스홀더] GPS 이동경로 기록 동의', TIMESTAMPTZ '2026-01-01 00:00:00+00', false),
  ('PERSONALIZATION',  '1.0', '[플레이스홀더] 개인화 추천 동의',       TIMESTAMPTZ '2026-01-01 00:00:00+00', false)
ON CONFLICT (terms_type, version) DO NOTHING;

-- ── 금칙어 사전 (P8 플레이스홀더) — 활성 버전 정확히 1개(INV-B1) ──
INSERT INTO banned_word_dictionary (dict_version, entries, active) VALUES
  ('seed-1.0',
   '[{"word":"비속어예시1","category":"PROFANITY"},{"word":"비속어예시2","category":"PROFANITY"}]'::jsonb,
   true)
ON CONFLICT (dict_version) DO UPDATE
  SET entries = EXCLUDED.entries, active = EXCLUDED.active;
