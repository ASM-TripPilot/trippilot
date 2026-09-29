// react-native-svg 의 stroke prop 은 NativeWind className 을 받지 못한다(진짜 색 값이 필요하다) —
// PushGlyphs 색을 여기 상수로 둔다. shared/location/lib/locationColors.ts 와 같은 이유·같은 패턴이다:
// 값은 tailwind.config 의 primary 와 정확히 같고, onboardingStructure.test.ts 의 raw hex 가드는
// .tsx 화면 표면만 보므로 .ts 상수 모듈로 분리해 화면 소스에 hex 리터럴을 박지 않는다.
export const PUSH_ICON_COLORS = {
  primary: '#FF385C',
} as const;
