/**
 * 닉네임 형식 검증 — **얇은 재수출**. 구현 본문은 `shared/validation/nicknameFormat` 로 승격됐다
 * (TRIP-608, `features/settings` 와 공유하기 위해). 여기엔 코드포인트 계수 구현이 남아 있지 않다
 * (복제가 아니라 이동 — `nicknameSharedPromotion.test.ts` 가 이 성질을 잠근다).
 *
 * 기존 소비처(`useNickname.ts`·onboarding 테스트)가 이 상대경로를 그대로 물게 두어 회귀 0.
 */

export {
  validateNicknameFormat,
  NICKNAME_MIN_LENGTH,
  NICKNAME_MAX_LENGTH,
  type NicknameFormatReason,
  type NicknameFormatResult,
} from '@/shared/validation/nicknameFormat';
