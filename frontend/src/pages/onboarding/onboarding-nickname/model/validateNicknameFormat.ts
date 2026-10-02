/**
 * 닉네임 형식 검증 — **얇은 재수출**. 구현 본문은 `shared/validation/nicknameFormat` 로 승격됐다
 * (TRIP-608, `features/settings` 와 공유하기 위해). 여기엔 코드포인트 계수 구현이 남아 있지 않다
 * (복제가 아니라 이동).
 *
 * 기존 소비처(`useNickname.ts`·onboarding 테스트)가 이 경로를 그대로 물게 두어 회귀 0(`useNickname.ts`는 TRIP-1146으로 `pages/onboarding/onboarding-nickname/model/`로 이사해 절대경로로 문다).
 */

export {
  validateNicknameFormat,
  NICKNAME_MIN_LENGTH,
  NICKNAME_MAX_LENGTH,
  type NicknameFormatReason,
  type NicknameFormatResult,
} from '@/shared/validation/nicknameFormat';
