// react-native-svg 의 stroke/fill prop 은 NativeWind className 을 받지 못한다(진짜 색 값이
// 필요하다) — LocationGlyphs 아이콘 색을 여기 상수로 모은다. features/auth/lib/gradients.ts 와
// 같은 이유·같은 패턴이다: NativeWind 클래스가 아니라 컴포넌트 prop 으로 직접 넘어가는 값이라
// "토큰"은 아니지만, 값 자체는 tailwind.config 의 primary·ink·muted-soft·info 색과 정확히 같다
// (onboardingStructure.test.ts 의 raw hex 가드는 .tsx 화면 표면만 보므로 .ts 상수 모듈은
// 대상 밖이다 — 화면 소스에 hex 리터럴을 직접 박지 않기 위한 의도적 분리).
export const LOCATION_ICON_COLORS = {
  primary: '#FF385C',
  ink: '#222222',
  mutedSoft: '#9AA1AB',
  info: '#0B6E63',
} as const;
