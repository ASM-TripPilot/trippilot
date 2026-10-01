/**
 * TRIP-775 · l03 카드 그림자(Figma 1602:2388 — 0/2/10 · 6%). NativeWind 그림자 유틸이 이 값을 못
 * 내서 RN style 로 준다(`LocationConsentScreen` 의 지역 상수와 같은 값 — 그쪽은 손대지 않았다).
 */
export const CARD_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;
