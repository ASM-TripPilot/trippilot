import Svg, { Circle, Path } from 'react-native-svg';

// 탐색(밴드 d·e00) 전용 인라인 벡터 글리프 — StayGlyphs/HomeGlyphs 패턴 계승.
// features 간 직접 import 금지 관례라 StayGlyphs의 셰브론을 가져다 쓰지 않고 여기 새로 그린다.
// 색은 이 파일 안에서만 raw hex로 고정한다(`*Screen.tsx` 파일명 필터 밖 — raw-hex 가드 대상 아님).

const INK = '#222222';
const MUTED = '#6A6A6A';
const MUTED_SOFT = '#9AA1AB';
const PRIMARY = '#FF385C';

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

/** d04 카드 하트 토글 — 담기지 않음(외곽선, Figma `1692:1230` 계열 실측 path). */
export function HeartOutlineGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 16.0125L7.9125 15.0225C4.05 11.52 1.5 9.21 1.5 6.375C1.5 4.065 3.315 2.25 5.625 2.25C6.93 2.25 8.1825 2.8575 9 3.8175C9.8175 2.8575 11.07 2.25 12.375 2.25C14.685 2.25 16.5 4.065 16.5 6.375C16.5 9.21 13.95 11.52 10.0875 15.03L9 16.0125Z"
        stroke={INK}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** d04 카드 하트 토글 — 담김(채움, Figma `1692:1219` 계열 실측 path — 외곽선과 동일 path). */
export function HeartFilledGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 16.0125L7.9125 15.0225C4.05 11.52 1.5 9.21 1.5 6.375C1.5 4.065 3.315 2.25 5.625 2.25C6.93 2.25 8.1825 2.8575 9 3.8175C9.8175 2.8575 11.07 2.25 12.375 2.25C14.685 2.25 16.5 4.065 16.5 6.375C16.5 9.21 13.95 11.52 10.0875 15.03L9 16.0125Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}

/** "담음" 배지 안 작은 하트(Figma `1692:1222` 계열, 채움 하트의 축소 재사용 — 브리프 §4-5). */
export function HeartBadgeGlyph({ size = 12, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
    >
      <Path
        d="M6 10.675L5.275 10.015C2.7 7.68 1 6.14 1 4.25C1 2.71 2.21 1.5 3.75 1.5C4.62 1.5 5.455 1.905 6 2.545C6.545 1.905 7.38 1.5 8.25 1.5C9.79 1.5 11 2.71 11 4.25C11 6.14 9.3 7.68 6.725 10.02L6 10.675Z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

/** d04 empty 상태 배지 — 위치 핀(32px, 분홍). e02 `MapPinGlyph`(1341:1378)와 같은 도형을
 * feature 간 직접 import 금지 관례대로 이 파일에 다시 그린다. `tone`은 TRIP-223(d02) 행의
 * 지역구 핀(회색, 13px)을 위한 확장 — `FilterSlidersGlyph`·`WarningTriangleGlyph`의 색 prop
 * 선례를 따른다(브리프 §6-2, 범용 색상표는 만들지 않는다). 기본값은 기존 d04 용법과 동일. */
export function MapPinGlyph({
  size = 32,
  tone = 'primary',
  testID,
}: GlyphProps & { tone?: 'primary' | 'muted' }) {
  const stroke = tone === 'muted' ? MUTED : PRIMARY;
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
        stroke={stroke}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 17.3333C18.2091 17.3333 20 15.5425 20 13.3333C20 11.1242 18.2091 9.33333 16 9.33333C13.7909 9.33333 12 11.1242 12 13.3333C12 15.5425 13.7909 17.3333 16 17.3333Z"
        stroke={stroke}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** d04 filter-zero 상태 배지 — 슬라이더(32px). `tone`을 처음부터 파라미터화한다 — stay 쪽
 * 형제 컴포넌트가 색 prop 없이 먹색으로 굳어 있던 결함(구조 지도 실측)을 이 파일에 복사하지
 * 않기 위해서다. */
export function FilterSlidersGlyph({
  size = 32,
  tone = 'primary',
  testID,
}: GlyphProps & { tone?: 'ink' | 'primary' }) {
  const stroke = tone === 'primary' ? PRIMARY : INK;
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
        stroke={stroke}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 4.5V12M10 12L7.8 9.8M10 12L12.2 9.8"
        stroke={stroke}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** d04 error 상태 배지 — 경고 삼각형(32px). */
export function WarningTriangleGlyph({
  size = 32,
  tone = 'primary',
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
