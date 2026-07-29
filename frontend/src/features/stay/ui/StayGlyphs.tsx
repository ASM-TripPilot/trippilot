import Svg, { Path } from 'react-native-svg';

// 숙소 검색 결과(e02) 전용 인라인 벡터 글리프(AuthGlyphs/OnboardingGlyphs/HomeGlyphs 패턴
// 계승 · Figma 1837:2283). features 간 직접 import 금지(importBoundary 의도 — features/stay는
// eslint FEATURES 목록 밖이라 기계 강제는 없지만, 02a T-16 판정대로 이 리포 관례를 따른다)라
// HomeGlyphs의 하트·OnboardingGlyphs의 뒤로가기 셰브론을 가져다 쓰지 않고 이 파일에 새로
// 그린다. 색은 이 파일 안에서만 raw hex로 고정한다(선례 — `ui/` 안이지만 `*Screen.tsx`
// 파일명 필터 밖이라 V1(raw-hex 가드) 대상이 아니다, 02a §6 판정②).

const INK = '#222222';
const BODY = '#3F3F3F';
const MUTED = '#6A6A6A';
const PRIMARY = '#FF385C';
const MUTED_SOFT = '#9AA1AB';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 앱바 뒤로가기(AC-10) — 표시만, 실동작 미배선(이번 범위 밖 — FAB·탭바와 같은 등급).
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
        d="M15 18L9 12L15 6"
        stroke={INK}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 필터 칩 '가격대'·'지역' 드롭다운 셰브론.
export function ChevronDownGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M3.5 5.5L7 9L10.5 5.5"
        stroke={BODY}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 필터 칩 '필터'(⇅) — 위/아래 화살표 쌍(정렬·필터 상투 아이콘).
export function FilterSlidersGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M4 9.5V2M4 2L1.8 4.2M4 2L6.2 4.2"
        stroke={BODY}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 4.5V12M10 12L7.8 9.8M10 12L12.2 9.8"
        stroke={BODY}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 경고 삼각형(TRIP-182 §3-7) — partial 배너(20px·tone='ink') · error 배지(32px·
// tone='primary') 겸용. 벡터는 Figma 1343:1429(배너, ink)·1344:1455(error, primary)에서
// 그대로 추출했다 — 두 노드는 좌표 비율이 완전히 같은 도형이라(20 grid ↔ 32 grid 스케일만
// 다름) 하나의 viewBox·path에 size prop만 바꿔 겸용한다.
export function WarningTriangleGlyph({
  size = 20,
  tone = 'ink',
  testID,
}: GlyphProps & { tone?: 'ink' | 'primary' }) {
  const color = tone === 'primary' ? PRIMARY : INK;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 2.5L18.3333 16.6667H1.66667L10 2.5Z"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 7.5V11.6667"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 14.1667H10.0083"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 위치 핀(TRIP-182 §3-2) — empty 배지 32px, 분홍. Figma 1341:1378 벡터 그대로.
export function MapPinGlyph({ size = 32, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
    >
      <Path
        d="M26.6667 13.3333C26.6667 21.3333 16 29.3333 16 29.3333C16 29.3333 5.33333 21.3333 5.33333 13.3333C5.33333 10.5044 6.45714 7.79125 8.45753 5.79086C10.4579 3.79047 13.171 2.66667 16 2.66667C18.829 2.66667 21.5421 3.79047 23.5425 5.79086C25.5429 7.79125 26.6667 10.5044 26.6667 13.3333Z"
        stroke={PRIMARY}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 17.3333C18.2091 17.3333 20 15.5425 20 13.3333C20 11.1242 18.2091 9.33333 16 9.33333C13.7909 9.33333 12 11.1242 12 13.3333C12 15.5425 13.7909 17.3333 16 17.3333Z"
        stroke={PRIMARY}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 수동 등록 유도 카드 배지 플러스(TRIP-182 §3-2) — 22px, 분홍. Figma 1341:1391 벡터 그대로.
export function PlusGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d="M11 4.58333V17.4167"
        stroke={PRIMARY}
        strokeWidth={2.38333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.58333 11H17.4167"
        stroke={PRIMARY}
        strokeWidth={2.38333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 수동 등록 유도 카드 우측 셰브론(TRIP-182 §3-2) — 20px, muted-soft. Figma 1341:1397 벡터 그대로.
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
        d="M7.5 5L12.5 10L7.5 15"
        stroke={MUTED_SOFT}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 카드 저장 하트 — 정적 미저장(외곽선) 아이콘 하나뿐이다(01b Seed Q9 · AC-7 정직한 스텁 —
// 저장 API가 없는 채로 채워진 하트를 그리면 "저장됐다"는 거짓말이 된다).
// ponytail: 회색 플레이스홀더 전제, 실사진 붙으면 흰색으로 되돌린다
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
