/**
 * BR-U0-11 — U0 온보딩에서 노출하는 필수 약관 3종(표시 순서 = 이 배열 순서, 법정 고지라 결정론적으로 고정).
 * 서버가 이 셋 밖의 종을 줘도(6종) 걸러내므로, 노출 안 하는 약관을 사용자가 선언하지 않은 증적으로 담는
 * 일이 구조적으로 불가능해진다(BR-U0-12). 세 종 모두 필수다(BR-U0-10).
 * 약관 화면(노출·제출)과 재진입 판정(셋 다 granted 인가)이 같은 목록을 쓴다(TRIP-1421).
 */
export const ONBOARDING_TERMS_TYPES = [
  'TERMS_OF_SERVICE',
  'PRIVACY_POLICY',
  'LOCATION_TERMS',
];
