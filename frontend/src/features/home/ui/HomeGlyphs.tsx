import Svg, { Circle, Path } from 'react-native-svg';

// 홈 "발견·영감 피드" 전용 인라인 벡터 글리프(AuthGlyphs/OnboardingGlyphs 패턴 계승 · TRIP-316).
// features 간 직접 import 금지(importBoundary)라 화면끼리 글리프를 공유하지 않는다 — 이 파일은
// features/home 전용이며 shared/ui/BottomTabBar(탭 아이콘)와는 별개다.
// 색은 이 파일 안에서만 raw hex로 고정한다(OnboardingGlyphs 선례 — `ui/` 안이지만
// `*Screen.tsx` 파일명 필터 밖이라 D-3(raw-hex 가드) 대상이 아니다).

const INK = '#222222';
const MUTED_SOFT = '#9AA1AB';
const PRIMARY = '#FF385C';
const WHITE = '#FFFFFF';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 인사 헤더 우측 알림 벨 — 장식만, 배지 dot은 화면 쪽에서 별도 View로 얹는다(no-op 대상).
export function BellGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d="M11 3.2C8.5 3.2 6.6 5.2 6.6 7.6V11.2L4.9 14C4.6 14.5 5 15.1 5.6 15.1H16.4C17 15.1 17.4 14.5 17.1 14L15.4 11.2V7.6C15.4 5.2 13.5 3.2 11 3.2Z"
        stroke={INK}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 17.3C9 18.3 9.9 19 11 19C12.1 19 13 18.3 13 17.3"
        stroke={INK}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 검색바 왼쪽 돋보기 — 플레이스홀더와 같은 muted-soft 톤.
export function SearchGlyph({ size = 19, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Circle cx={9} cy={9} r={6} stroke={MUTED_SOFT} strokeWidth={1.6} />
      <Path
        d="M13.5 13.5L17.5 17.5"
        stroke={MUTED_SOFT}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// magazineHero eyebrow('오늘의 여행 영감') 앞 반짝임 — 흰 pill 위 primary 4각 별.
export function SparkleGlyph({ size = 13, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M7 1L8.2 5.2L12.4 6.4L8.2 7.6L7 11.8L5.8 7.6L1.6 6.4L5.8 5.2L7 1Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}

// destCard 지역 라벨('부산 사하구') 앞 위치 핀 — 사진 위라 흰색.
export function LocationPinGlyph({ size = 12, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
    >
      <Path
        d="M6 1.2C4 1.2 2.5 2.7 2.5 4.7C2.5 7.2 6 10.8 6 10.8C6 10.8 9.5 7.2 9.5 4.7C9.5 2.7 8 1.2 6 1.2Z"
        stroke={WHITE}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <Circle cx={6} cy={4.7} r={1.3} stroke={WHITE} strokeWidth={1.2} />
    </Svg>
  );
}

// 카드·hero 우상단 하트 — 전부 사진 위라 흰색(장식 · no-op). 저장 상태 토글은 아직 없다.
export function HeartOutlineGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d="M11 19C11 19 3 14 3 8.6C3 5.9 5.1 3.8 7.7 3.8C9.1 3.8 10.4 4.5 11 5.6C11.6 4.5 12.9 3.8 14.3 3.8C16.9 3.8 19 5.9 19 8.6C19 14 11 19 11 19Z"
        stroke={WHITE}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// FAB('여행 만들기') 앞 plus — bg-primary 위라 on-primary(흰색) 고정.
export function PlusGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 4V20M4 12H20"
        stroke={WHITE}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}
