import Svg, { Circle, Path } from 'react-native-svg';

// 홈 대시보드 전용 인라인 벡터 글리프(AuthGlyphs/OnboardingGlyphs 패턴 계승 · TRIP-170).
// features 간 직접 import 금지(importBoundary)라 화면끼리 글리프를 공유하지 않는다 — 이 파일은
// features/home 전용이며 shared/ui/BottomTabBar(탭 아이콘)와는 별개다.
// 색은 화면(screens/) 밖인 이 파일 안에서만 raw hex로 고정한다(OnboardingGlyphs 선례 —
// screens/ 스코프만 raw-hex 가드 대상이라 components/는 예외).

const INK = '#222222';
const MUTED = '#6A6A6A';
const PRIMARY = '#FF385C';
const PRIMARY_TEXT = '#C13515';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 상단바 알림 벨 — 장식만, 배지 dot은 화면 쪽에서 별도 View로 얹는다(A-6a no-op 대상).
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

// 다음 일정 카드 라벨 옆 시계 아이콘.
export function ClockGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Circle cx={8} cy={8} r={6} stroke={MUTED} strokeWidth={1.3} />
      <Path
        d="M8 5V8L10 9.5"
        stroke={MUTED}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 이어서 하기 카드 아이콘 타일(연필) — primary-pale 배경 위에 primary-text 톤.
export function PencilGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d="M14.5 4.5L17.5 7.5L8 17H5V14L14.5 4.5Z"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 이어서 하기 카드 trailing chevron.
export function ChevronRightGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M7.5 4.5L13 10L7.5 15.5"
        stroke={MUTED}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// '급상승'(인기 카드) · '인기'(커뮤니티 카드) 배지 공용 불꽃 아이콘.
export function FlameGlyph({ size = 12, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
    >
      <Path
        d="M6 1C4.8 3 3.5 4.2 3.5 6.3C3.5 8.3 4.8 9.7 6 9.7C7.2 9.7 8.5 8.3 8.5 6.3C8.5 5.6 8.2 5 7.8 4.6C7.8 5.4 7.3 6 6.7 6C7 5 6.6 2.8 6 1Z"
        fill={PRIMARY_TEXT}
      />
    </Svg>
  );
}

// 취향 블록 featured 카드 trailing 하트(장식 · no-op).
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
        stroke={MUTED}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 새 여행 만들기 버튼 · 첫 사용자 대시 카드 공용 plus. tone으로 두 색 변형만 노출한다 —
// 화면(screens/) 쪽에서 raw hex를 직접 넘기면 D-3(raw-hex 가드)가 red가 되므로, 색 선택은
// 이 파일 안의 의미 있는 이름(tone)으로만 받는다.
export function PlusGlyph({
  size = 20,
  tone = 'ink',
  testID,
}: GlyphProps & { tone?: 'ink' | 'muted' }) {
  const color = tone === 'muted' ? MUTED : INK;
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
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 커뮤니티 카드 social row — 좋아요 수 옆 하트. Figma는 빨강 채움(fill, node 1632:1185/1257:1171
// 재확인 · 픽셀 추출 #FF385C = 토큰 primary 그대로)이라 HeartOutlineGlyph(취향 featured 카드,
// 아웃라인·MUTED)와 색·채움 모두 다르다 — 두 하트는 원래 별도 함수라 여기 한쪽만 고친다.
export function LikeHeartGlyph({ size = 15, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 15 15"
      fill="none"
    >
      <Path
        d="M7.5 13C7.5 13 2 9.6 2 5.9C2 4 3.5 2.5 5.3 2.5C6.3 2.5 7.1 3 7.5 3.7C7.9 3 8.7 2.5 9.7 2.5C11.5 2.5 13 4 13 5.9C13 9.6 7.5 13 7.5 13Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}

// 커뮤니티 카드 social row — 댓글 수 옆 말풍선.
export function CommentGlyph({ size = 15, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 15 15"
      fill="none"
    >
      <Path
        d="M2 3.5H13V10.5H6L3.5 12.5V10.5H2V3.5Z"
        stroke={MUTED}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 커뮤니티 카드 routeMap 자리 — 실 지도 데이터가 없어(브리프 §6) 동선을 흉내내는 장식용
// 점+선. 지도 API를 흉내내지 않는다 — 순수 장식(§6-3 명시 예외: 실 이미지 소스 없음).
export function RouteDotsGlyph({ size = 56, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
    >
      <Path
        d="M10 40L22 24L34 30L46 12"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={10} cy={40} r={3} fill={PRIMARY} />
      <Circle cx={22} cy={24} r={2.5} fill={PRIMARY} />
      <Circle cx={34} cy={30} r={2.5} fill={PRIMARY} />
      <Circle cx={46} cy={12} r={3} fill={PRIMARY} />
    </Svg>
  );
}
