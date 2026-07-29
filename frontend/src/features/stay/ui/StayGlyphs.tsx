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
