import type { PutMeLocationConsentBody } from '@/shared/api/generated/schemas';

/**
 * 위치 동의 토글 하나 → PUT 바디(BR-U6-29 · DEC-U6-11 · PBT-U6-F3). L2(법정 동의)·L3(GPS 옵트인)를
 * **항상 같은 값**으로 낸다 — 이 함수가 PUT 바디의 유일 조립점이므로(단일 통로는
 * `locationConsentPutBodyOwnership.test.ts` 가 소스 층에서 잠근다) "legalConsent 만 먼저 보내는"
 * 분리 전송이 원천적으로 생기지 않는다. 어디서도 이 두 필드를 직접 리터럴 조립하지 말 것.
 */
export function consentPutBody(toggleOn: boolean): PutMeLocationConsentBody {
  return { legalConsent: toggleOn, gpsRecordingOptIn: toggleOn };
}
