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

/**
 * TRIP-977 · l03 세그먼트 선택 탭 그림자 — 옛 className 그림자 유틸이 기기에서 실제로 내던 값
 * (NativeWind 네이티브 프리셋 sm: 0 1 1 · 35%, `nativewind/dist/tailwind/native.js`)을 그대로 옮겨
 * TRIP-604 시각을 유지한다(웹 Tailwind 값 0/1/2 · 5% 가 아니다). 선택마다 붙었다 떨어지는 그림자를
 * className 으로 주면 css-interop 이 CSS 변수를 새로 단 컴포넌트를 재마운트하고 dev 경고가 props 를
 * 직렬화하다 크래시한다(QA #026). style 로만 준다.
 */
export const SEGMENT_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.35,
  shadowRadius: 1,
  elevation: 1,
} as const;
