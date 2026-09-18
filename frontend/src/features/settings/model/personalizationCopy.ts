import { PersonalizationInfoReason } from '@/shared/api/generated/schemas';

/**
 * l05 개인화 — reason 한 값 → 안내 문구(없으면 null). 문구의 **단일 출처**(BR-U5-44).
 *
 * - APPLIED: 문구 없음(null) — 반영 중인 목록이 대신 말한다(01b Q4, 발명 문구 회피).
 * - CONSENT_MISSING: 미동의 — 동의를 권하는 안내.
 * - NOT_ENOUGH_RECORDS: **이미 동의한** 사용자(기록만 모자람) — "동의하면…"류를 절대 내지 않는다(급소).
 */
export function personalizationCopy(
  reason: PersonalizationInfoReason
): string | null {
  switch (reason) {
    case PersonalizationInfoReason.CONSENT_MISSING:
      return '동의하면 지난 기록을 반영해요';
    case PersonalizationInfoReason.NOT_ENOUGH_RECORDS:
      return '기록이 더 쌓이면 반영돼요';
    case PersonalizationInfoReason.APPLIED:
      return null;
  }
}
