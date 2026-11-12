-- V2.91 위치 L2 백필(TRIP-1800) — 온보딩에서 위치기반서비스 약관(LOCATION_TERMS)에 동의했는데
-- 위치 L2(`location_consent_state.legal_consent`)가 꺼져 있는 계정을 맞춘다.
--
-- 앱 온보딩은 LOCATION_TERMS 를 필수로 받아 consent_record(ONBOARDING)에 남겼지만, L2 는 설정 토글
-- (`PUT /me/location-consent`)로만 켜졌다. 그래서 동의한 사용자(운영 284명 중 281명, 2026-11-06)의
-- GPS 가 막혀 있었다. 앞으로의 동의는 ConsentService 가 L2 를 같이 맞추고(같은 PR), 이 파일은 그 전 계정만.
--
-- 대상: LOCATION_TERMS **최신** 증적이 GRANT(철회한 사람 제외) · 계정 ACTIVE(탈퇴 진행 제외) · L2 꺼짐.
-- 법정 로그(append-only, INSERT 만)에 CONSENT_GRANTED 를 남긴다 — 앱 전이와 같은 키(termsType·version·channel)
-- 에 백필임을 밝히는 source 와 원래 동의 시각·증적 id(consentedAt·consentRecordId)를 더한다 — occurred_at 은 이 반영
-- 시각이고 동의 자체는 그 전이라, 사실확인자료가 "백필한 날 동의했다"로 읽히지 않게. channel 은 원래 동의한 경로다.
-- 좌표는 없다(V1.3 규약).
-- L3(GPS_RECORDING)·OS 미러는 건드리지 않는다 — 별개 동의·별개 사실이다.
WITH latest AS (
    SELECT DISTINCT ON (account_id) account_id, record_id, terms_version, action, channel, occurred_at
      FROM consent_record
     WHERE terms_type = 'LOCATION_TERMS'
     ORDER BY account_id, occurred_at DESC, record_id DESC
), target AS (
    SELECT l.account_id, l.record_id, l.terms_version, l.channel, l.occurred_at
      FROM latest l
      JOIN account a USING (account_id)
      LEFT JOIN location_consent_state s USING (account_id)
     WHERE l.action = 'GRANT'
       AND a.status = 'ACTIVE'
       AND COALESCE(s.legal_consent, false) = false
), logged AS (
    INSERT INTO location_legal_log (account_id, event_type, detail)
    SELECT account_id, 'CONSENT_GRANTED',
           jsonb_build_object('termsType', 'LOCATION_TERMS', 'version', terms_version,
                              'channel', channel, 'source', 'BACKFILL_TRIP_1800',
                              'consentedAt', to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                              'consentRecordId', record_id::text)
      FROM target
)
INSERT INTO location_consent_state (account_id, legal_consent, updated_at)
SELECT account_id, true, now() FROM target
ON CONFLICT (account_id) DO UPDATE SET legal_consent = true, updated_at = now();
