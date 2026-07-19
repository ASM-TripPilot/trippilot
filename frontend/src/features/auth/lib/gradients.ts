// 브랜드 그라디언트 stop 상수 — 스플래시 배경과 앱아이콘 박스가 공유하는 1출처(D1).
// 색은 NativeWind className(tailwind.config 미러)이 아니라 LinearGradient 의 colors/locations
// prop 으로 넘어가는 raw 값이라 토큰이 아니다 — 그래서 여기 상수로 모은다.
// `as const` 로 읽기전용 튜플이 되어 LinearGradient 의 `[Color, Color, ...]` 튜플 타입에 맞는다.

// 스플래시 전체화면 배경: 흰색 → 옅은 분홍(55%) → 분홍(100%) 세로 3-stop.
export const SPLASH_BACKGROUND_COLORS = [
  '#ffffff',
  '#fff3f6',
  '#ffe1e7',
] as const;
export const SPLASH_BACKGROUND_LOCATIONS = [0, 0.55, 1] as const;

// 앱아이콘 박스: 위 → 아래 브랜드 그라디언트 2-stop(스플래시 94px·로그인 56px 공용).
export const APP_ICON_COLORS = ['#ff5c79', '#e8264c'] as const;
