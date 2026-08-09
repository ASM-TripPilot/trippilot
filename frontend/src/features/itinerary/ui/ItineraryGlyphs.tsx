import Svg, { Path } from 'react-native-svg';

// h05·h07 전용 인라인 벡터 글리프(TripGlyphs/StayGlyphs/ExploreGlyphs 패턴 계승 · Figma 파일
// 1MTF3dtptIrbg8gld5IdO2, 노드 1875:1083 · 1904:1083). 전부 Figma 벡터 path 실측이다.
// features 간 직접 import 금지 관례라 TripGlyphs 와 겹치는 아이콘(chevron 계열)도 새로 그린다.
//
// 색은 이 파일 안에서만 raw hex 로 고정한다(선례 — `ui/` 안이지만 `*Glyphs.tsx` 는 raw-hex
// 스캔 가드 제외 관례, `docs/structure.md` §지금 작업하려면). SVG `stroke`/`fill` 은
// className 을 못 받는다.

const INK = '#222222';
const PRIMARY = '#FF385C';
const BODY = '#3F3F3F';
const MUTED = '#6A6A6A';
const MUTED_SOFT = '#9AA1AB';
const PRIMARY_TEXT = '#C13515';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 앱바 뒤로가기(24) — Figma `1875:1086` · `1904:1085`.
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

// `고정` 칩 자물쇠(12) — Figma `1876:1089`.
export function LockGlyph({ size = 12, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
    >
      <Path
        d="M9 5H3C2.44772 5 2 5.44772 2 6V9.5C2 10.0523 2.44772 10.5 3 10.5H9C9.55228 10.5 10 10.0523 10 9.5V6C10 5.44772 9.55228 5 9 5Z"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 5V3.5C4 2.96957 4.21071 2.46086 4.58579 2.08579C4.96086 1.71071 5.46957 1.5 6 1.5C6.53043 1.5 7.03914 1.71071 7.41421 2.08579C7.78929 2.46086 8 2.96957 8 3.5V5"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// `시각 고정` 칩 체크(12) — Figma `1876:1096`.
export function CheckGlyph({ size = 12, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
    >
      <Path
        d="M10 3L4.5 8.5L2 6"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// h11 안내줄 체크 원(20) — Figma `1870:1092`. 위 `CheckGlyph` 의 체크를 `InfoCircleGlyph` 의
// 원 안에 넣은 형태라 세 아이콘이 한 벌로 보인다(이 파일의 기존 합성 방식과 같다).
export function CheckCircleGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z"
        stroke={PRIMARY}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M13.3333 7.5L8.75 12.0833L6.66667 10"
        stroke={PRIMARY}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 카드 우측 편집 연필(20) — Figma `1876:1099`. FIXED 항목에만 붙는다.
export function PencilGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 16.6667H17.5"
        stroke={MUTED_SOFT}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M13.75 2.91667C14.0815 2.58515 14.5312 2.3989 15 2.3989C15.4688 2.3989 15.9185 2.58515 16.25 2.91667C16.5815 3.24819 16.7678 3.69783 16.7678 4.16667C16.7678 4.63551 16.5815 5.08515 16.25 5.41667L5.83333 15.8333L2.5 16.6667L3.33333 13.3333L13.75 2.91667Z"
        stroke={MUTED_SOFT}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 카드 우측 해제 ×(20) — Figma `1876:1111`. ANYTIME 항목에만 붙는다.
export function CloseGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M5 5L15 15"
        stroke={MUTED_SOFT}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15 5L5 15"
        stroke={MUTED_SOFT}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// h07 시작 시각 필드 시계(20) — Figma `1904:1113`.
export function ClockGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z"
        stroke={BODY}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 5.83333V10L12.5 11.6667"
        stroke={BODY}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// h07 시작 시각 필드 chevron-down(20) — Figma `1904:1117`.
export function ChevronDownGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M5 7.5L10 12.5L15 7.5"
        stroke={MUTED_SOFT}
        strokeWidth={1.83333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 원형 아이콘 두 종이 쓰는 색조. 빈 목록 얼굴은 배지 배경(primary-pale) 위라 primary-text 다. */
export type CircleGlyphTone = 'muted' | 'primaryText';

const CIRCLE_STROKE: Record<CircleGlyphTone, string> = {
  muted: MUTED,
  primaryText: PRIMARY_TEXT,
};

// h07 안내 박스 ⓘ(20) — Figma `1904:1131`. 빈 목록 얼굴의 배지도 같은 도형을 키워 쓴다.
export function InfoCircleGlyph({
  size = 20,
  tone = 'muted',
  testID,
}: GlyphProps & { tone?: CircleGlyphTone }) {
  const stroke = CIRCLE_STROKE[tone];
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z"
        stroke={stroke}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 9.16667V13.3333"
        stroke={stroke}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 6.66667H10.0083"
        stroke={stroke}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 조회 실패 얼굴·실패 알림의 경고 원(20). h05·h07 에 실패 프레임이 없어(정본 공백) 위
// `InfoCircleGlyph` 와 **같은 원**에 느낌표 배치만 뒤집었다 — 두 아이콘이 한 벌로 보인다.
export function AlertCircleGlyph({
  size = 20,
  tone = 'primaryText',
  testID,
}: GlyphProps & { tone?: CircleGlyphTone }) {
  const stroke = CIRCLE_STROKE[tone];
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z"
        stroke={stroke}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 6.66667V10.8333"
        stroke={stroke}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 13.75H10.0083"
        stroke={stroke}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
