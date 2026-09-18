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

// 안내 정보 아이콘. 색은 호출자가 정한다 — LiveLocationPage 는 기본(info 청록)을 쓰고,
// LocationPreprompt 거부 안내는 뉴트럴(mutedSoft)로 넘긴다(TRIP-592 위계 전환). stroke prop 은
// className 을 못 받아 값이 필요하므로 상수를 그대로 넘긴다(raw hex 아님, 가드 밖).
export function LocationInfoGlyph({
  size = 18,
  testID,
  color = LOCATION_ICON_COLORS.info,
}: GlyphProps & { color?: string }) {
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
        stroke={color}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 8.25V12"
        stroke={color}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 6H9.0075"
        stroke={color}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// l06 용도 3항목 아이콘(시계·좌우화살표·핀). 색은 호출자 주입(기본 ink) — permission-denied 는
// 컨테이너 opacity 로 dimmed 하므로 색 상수는 하나로 족하다. hex 리터럴을 .tsx 에 직접 박으면
// onboardingStructure.test.ts F2 가드에 걸리므로 반드시 LOCATION_ICON_COLORS 경유.

// (1) 이동 지연 감지 — 시계.
export function LocationClockGlyph({
  size = 20,
  testID,
  color = LOCATION_ICON_COLORS.ink,
}: GlyphProps & { color?: string }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
      <Path
        d="M12 7.5V12L15 13.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// (2) 실시간 Plan-B 재계획 — 좌우 화살표(스왑).
export function LocationSwapGlyph({
  size = 20,
  testID,
  color = LOCATION_ICON_COLORS.ink,
}: GlyphProps & { color?: string }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M7 8H20M20 8L16 4M20 8L16 12"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17 16H4M4 16L8 12M4 16L8 20"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// (3) 주변 숙소·일정 추천 — 위치 핀.
export function LocationPinGlyph({
  size = 20,
  testID,
  color = LOCATION_ICON_COLORS.ink,
}: GlyphProps & { color?: string }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M20 10c0 5.25-8 11-8 11s-8-5.75-8-11a8 8 0 1 1 16 0Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={3} stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

// permission-denied 상단 배너 경고 삼각형(⚠).
export function LocationWarningGlyph({
  size = 20,
  testID,
  color = LOCATION_ICON_COLORS.ink,
}: GlyphProps & { color?: string }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 3.5 22 20H2L12 3.5Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 10V14"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 17H12.01"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 거부 안내 줄의 닫기(×) 아이콘. features 3곳의 CloseGlyph 는 경계상 import 불가라(shared→features
// 금지) 여기 신설한다 — kit §6 close SVG(6,6→18,18 / 18,6→6,18)를 뉴트럴 mutedSoft 로 그린다.
export function LocationCloseGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M6 6L18 18M18 6L6 18"
        stroke={LOCATION_ICON_COLORS.mutedSoft}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
