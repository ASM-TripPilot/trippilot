import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { LOCATION_ICON_COLORS } from './lib/locationColors';

// c08-location 전용 벡터 글리프(TRIP-162 전체화면 정합). Figma 좌표를 react-native-svg 로
// 1:1 옮긴다(AuthGlyphs.tsx 와 같은 인라인 방식). onboarding 피처의 글리프(OnboardingGlyphs)와
// 의도적으로 별도 파일이다 — shared/ 는 features/ 를 import 하면 안 되므로(경계 역방향)
// LocationPreprompt 는 자기 로컬 글리프를 갖는다. 색은 locationColors 상수를 쓴다 — stroke/fill
// 은 raw 값이 필요해 className 토큰을 못 받지만, 이 파일(.tsx)에 hex 리터럴을 직접 박으면
// onboardingStructure.test.ts 의 토큰 우회 가드에 걸린다(값은 tailwind 토큰과 동일).

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 내비바 back chevron — 표시만(장식), 실동작 미배선. terms·nickname 의 것과 좌표는 같지만
// import 경계상 복제가 맞는 선택이다(위 주석 참고).
export function LocationBackChevronGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M15 18L9 12L15 6"
        stroke={LOCATION_ICON_COLORS.ink}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 레이더 히어로 — 동심원 3개(중심에서 멀수록 옅어지는 opacity) + 채워진 중심 점.
// Figma 컨테이너(342x184) 좌표를 viewBox 로 고정하고 width="100%" 로 실제 폭에 비례
// 스케일한다 — 기기 폭이 Figma 시안(390)과 달라도 중심이 항상 컨테이너 가운데에 온다.
export function LocationRadarHero({ testID }: { testID?: string }) {
  return (
    <View
      testID={testID}
      className="h-[184px] w-full overflow-hidden rounded-card bg-surface-soft"
    >
      <Svg width="100%" height="100%" viewBox="0 0 342 184" fill="none">
        <Circle
          cx={171}
          cy={92}
          r={76.2}
          stroke={LOCATION_ICON_COLORS.primary}
          strokeWidth={1.6}
          opacity={0.2}
        />
        <Circle
          cx={171}
          cy={92}
          r={52.2}
          stroke={LOCATION_ICON_COLORS.primary}
          strokeWidth={1.6}
          opacity={0.36}
        />
        <Circle
          cx={171}
          cy={92}
          r={30.2}
          stroke={LOCATION_ICON_COLORS.primary}
          strokeWidth={1.6}
          opacity={0.58}
        />
        <Circle
          cx={171}
          cy={92}
          r={9}
          fill={LOCATION_ICON_COLORS.primary}
          stroke="#ffffff"
          strokeWidth={4}
        />
      </Svg>
    </View>
  );
}

// 거부 상태 offTile 아이콘(위치 핀 + 사선 = "위치 꺼짐").
export function LocationOffGlyph({ size = 34, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 34 34"
      fill="none"
    >
      <Path
        d="M28.3332 14.1668C28.3332 22.6668 16.9998 31.1668 16.9998 31.1668C16.9998 31.1668 5.6665 22.6668 5.6665 14.1668C5.6665 11.161 6.86055 8.27836 8.98596 6.15295C11.1114 4.02754 13.9941 2.8335 16.9998 2.8335C20.0056 2.8335 22.8883 4.02754 25.0137 6.15295C27.1391 8.27836 28.3332 11.161 28.3332 14.1668Z"
        stroke={LOCATION_ICON_COLORS.mutedSoft}
        strokeWidth={2.69167}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17 18.4165C19.3472 18.4165 21.25 16.5137 21.25 14.1665C21.25 11.8193 19.3472 9.9165 17 9.9165C14.6528 9.9165 12.75 11.8193 12.75 14.1665C12.75 16.5137 14.6528 18.4165 17 18.4165Z"
        stroke={LOCATION_ICON_COLORS.mutedSoft}
        strokeWidth={2.69167}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.6665 5.6665L28.3332 28.3332"
        stroke={LOCATION_ICON_COLORS.mutedSoft}
        strokeWidth={2.69167}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 거부 상태 안내 배너의 정보 아이콘.
export function LocationInfoGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 15.75C12.7279 15.75 15.75 12.7279 15.75 9C15.75 5.27208 12.7279 2.25 9 2.25C5.27208 2.25 2.25 5.27208 2.25 9C2.25 12.7279 5.27208 15.75 9 15.75Z"
        stroke={LOCATION_ICON_COLORS.info}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 8.25V12"
        stroke={LOCATION_ICON_COLORS.info}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 6H9.0075"
        stroke={LOCATION_ICON_COLORS.info}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
