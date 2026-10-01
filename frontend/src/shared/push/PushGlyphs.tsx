import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { PUSH_ICON_COLORS } from './lib/pushColors';

// c08-push 전용 벡터 글리프(TRIP-1108, Figma 4774:2965 bellHero). 짝 화면인 위치 카드의 레이더 히어로
// (shared/location/LocationGlyphs.tsx 의 LocationRadarHero)와 틀·동심원 좌표가 같고, 가운데 점 대신 벨이
// 들어간다. 동심원 SVG 에셋은 Figma 에서 받지 못해(404) 링 선 색·굵기·투명도는 위치 레이더 값을 따랐다 —
// 스크린샷 대조로 확인할 값이다(브리프 §4-2). 색은 pushColors 상수 경유(.tsx 에 hex 리터럴 금지).
const RING_OPACITIES = [
  { r: 76.2, opacity: 0.2 },
  { r: 52.2, opacity: 0.36 },
  { r: 30.2, opacity: 0.58 },
] as const;

export function PushBellHero({ testID }: { testID?: string }) {
  return (
    <View
      testID={testID}
      className="h-[184px] w-full overflow-hidden rounded-card bg-surface-soft"
    >
      <Svg width="100%" height="100%" viewBox="0 0 342 184" fill="none">
        {RING_OPACITIES.map(({ r, opacity }) => (
          <Circle
            key={r}
            cx={171}
            cy={92}
            r={r}
            stroke={PUSH_ICON_COLORS.primary}
            strokeWidth={1.6}
            opacity={opacity}
          />
        ))}
      </Svg>
      {/* 벨은 동심원 중심(컨테이너 가운데)에 겹친다 — viewBox 가 가운데 정렬로 스케일되므로 flex 중앙이 같은 점이다. */}
      <View className="absolute inset-0 items-center justify-center">
        <Svg width={28} height={28} viewBox="0 0 28 28" fill="none">
          <Path
            d="M21 9.33333C21 7.47682 20.2625 5.69634 18.9497 4.38359C17.637 3.07083 15.8565 2.33333 14 2.33333C12.1435 2.33333 10.363 3.07083 9.05025 4.38359C7.7375 5.69634 7 7.47682 7 9.33333C7 17.5 3.5 19.8333 3.5 19.8333H24.5C24.5 19.8333 21 17.5 21 9.33333Z"
            stroke={PUSH_ICON_COLORS.primary}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M15.9833 24.5C15.7741 24.8377 15.4821 25.1163 15.135 25.3095C14.7879 25.5028 14.3972 25.6042 14 25.6042C13.6028 25.6042 13.2121 25.5028 12.865 25.3095C12.5179 25.1163 12.2259 24.8377 12.0167 24.5"
            stroke={PUSH_ICON_COLORS.primary}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
    </View>
  );
}
