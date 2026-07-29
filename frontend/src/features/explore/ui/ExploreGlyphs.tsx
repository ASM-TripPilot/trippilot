import Svg, { Circle, Path } from 'react-native-svg';

// 탐색(밴드 d·e00) 전용 인라인 벡터 글리프 — StayGlyphs/HomeGlyphs 패턴 계승.
// features 간 직접 import 금지 관례라 StayGlyphs의 셰브론을 가져다 쓰지 않고 여기 새로 그린다.
// 색은 이 파일 안에서만 raw hex로 고정한다(`*Screen.tsx` 파일명 필터 밖 — raw-hex 가드 대상 아님).

const INK = '#222222';
const MUTED = '#6A6A6A';
const MUTED_SOFT = '#9AA1AB';

type GlyphProps = {
  size?: number;
  testID?: string;
};

/** 앱바 뒤로가기 셰브론. */
export function BackChevronGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M15 5L8 12l7 7"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 검색 돋보기. */
export function SearchGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle cx={11} cy={11} r={6.5} stroke={MUTED_SOFT} strokeWidth={1.8} />
      <Path
        d="M16 16l4.5 4.5"
        stroke={MUTED_SOFT}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** '내 주변' 위치 핀. */
export function NearbyPinGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 21s7-6.1 7-11a7 7 0 10-14 0c0 4.9 7 11 7 11z"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={2.6} stroke={INK} strokeWidth={1.8} />
    </Svg>
  );
}

/** 안내 배너 정보 아이콘. */
export function InfoGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle cx={12} cy={12} r={9} stroke={MUTED} strokeWidth={1.8} />
      <Path
        d="M12 11v6"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={7.5} r={1.1} fill={MUTED} />
    </Svg>
  );
}
