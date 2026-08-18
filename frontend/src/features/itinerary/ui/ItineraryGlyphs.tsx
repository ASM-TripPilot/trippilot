import Svg, { Circle, Path } from 'react-native-svg';

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

// `고정` 칩 자물쇠(12) — Figma `1876:1089`. h25 는 primary-pale 칩이라 primary-text(기본),
// h24 는 surface-strong(회색) 칩이라 `tone="muted"` 로 회색 자물쇠를 쓴다(같은 도형, 색만 스냅).
export function LockGlyph({
  size = 12,
  tone = 'primaryText',
  testID,
}: GlyphProps & { tone?: CircleGlyphTone }) {
  const stroke = tone === 'muted' ? MUTED : PRIMARY_TEXT;
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
        stroke={stroke}
        strokeWidth={1.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 5V3.5C4 2.96957 4.21071 2.46086 4.58579 2.08579C4.96086 1.71071 5.46957 1.5 6 1.5C6.53043 1.5 7.03914 1.71071 7.41421 2.08579C7.78929 2.46086 8 2.96957 8 3.5V5"
        stroke={stroke}
        strokeWidth={1.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// h24 편집 카드 드래그 핸들 ⋮⋮(18) — Figma `1896:1083`. 6점(2열×3행) 회색. 롱프레스로 드래그를
// 잡는 손잡이라 어포던스가 은은한 muted-soft 다(비고정 슬롯에만 붙는다).
export function DragHandleGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Circle cx={6.5} cy={4.5} r={1.4} fill={MUTED_SOFT} />
      <Circle cx={11.5} cy={4.5} r={1.4} fill={MUTED_SOFT} />
      <Circle cx={6.5} cy={9} r={1.4} fill={MUTED_SOFT} />
      <Circle cx={11.5} cy={9} r={1.4} fill={MUTED_SOFT} />
      <Circle cx={6.5} cy={13.5} r={1.4} fill={MUTED_SOFT} />
      <Circle cx={11.5} cy={13.5} r={1.4} fill={MUTED_SOFT} />
    </Svg>
  );
}

// h24 편집 카드 삭제 휴지통(18) — Figma `1896:1083`. 비고정 슬롯 우상단. 회색 muted.
export function TrashGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M3 5H15"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7 5V3.5C7 3.22386 7.22386 3 7.5 3H10.5C10.7761 3 11 3.22386 11 3.5V5"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.5 5L4.95 14C4.97761 14.5523 5.43318 15 5.98613 15H12.0139C12.5668 15 13.0224 14.5523 13.05 14L13.5 5"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7.5 8V12"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <Path
        d="M10.5 8V12"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// h24 [장소 추가] 버튼 플러스(18) — Figma `1896:1083`. 버튼 글자와 같은 ink.
export function PlusGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 3.75V14.25"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M3.75 9H14.25"
        stroke={INK}
        strokeWidth={1.8}
        strokeLinecap="round"
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

// h35 완화 카드 우측 chevron-right(20) — Figma `1906:1083`. 위 `ChevronDownGlyph` 와 같은
// 획 두께·색을 90° 돌린 형태다(같은 화면 스택에서 한 벌로 보이게).
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
        strokeWidth={1.83333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// h35 히어로 배지 안의 「위치-off」(36) — Figma `1906:1083`. 지도 핀 위에 사선 하나를 그어
// "여기서 찾을 곳이 없다"를 말한다. 색은 브랜드 primary 로, 배지 배경(primary-pale)과 한 쌍이다.
export function LocationOffGlyph({ size = 36, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 21.5C12 21.5 19.5 15.25 19.5 9.75C19.5 5.60786 16.1421 2.25 12 2.25C7.85786 2.25 4.5 5.60786 4.5 9.75C4.5 15.25 12 21.5 12 21.5Z"
        stroke={PRIMARY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 12.25C13.3807 12.25 14.5 11.1307 14.5 9.75C14.5 8.36929 13.3807 7.25 12 7.25C10.6193 7.25 9.5 8.36929 9.5 9.75C9.5 11.1307 10.6193 12.25 12 12.25Z"
        stroke={PRIMARY}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.75 3.75L20.25 20.25"
        stroke={PRIMARY}
        strokeWidth={1.8}
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

// h31 지도 폴백 경고 삼각형(24) — Figma `1912:1083`. 지도를 못 불러온 자리의 △! 표식. 회색
// muted 로, 실패지만 치명적이지 않다는 톤(카드 목록으로 계속 볼 수 있다)에 맞춘다.
export function WarningTriangleGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 4.5L21 20H3L12 4.5Z"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 10V14"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 16.8H12.008"
        stroke={MUTED}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// h34 appbar 공유 아이콘(22) — TRIP-354 Q3. Figma `1884:1083` 우상단. iOS 공유(상자+위 화살표)
// 형태를 손으로 재구성했다(Figma 벡터 실측 아님 — `AlertCircleGlyph` 선례처럼 도형만 맞춤). 정적
// 스텁이라 탭 동작은 없다(실동작은 후속 TRIP-300). 앱바 제목과 같은 ink.
export function ShareGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 3V15"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 6.5L12 3L16 6.5"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 10H6C4.89543 10 4 10.8954 4 12V19C4 20.1046 4.89543 21 6 21H18C19.1046 21 20 20.1046 20 19V12C20 10.8954 19.1046 10 18 10H16"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 구간행 이동수단 아이콘 · 도보(16) — TRIP-354. Figma `2246:1942`. 걷는 사람 실루엣을 손으로
// 재구성. distanceRange 꼬리가 "도보 추정" 이면 이 글리프를 쓴다(차량은 아래 `CarGlyph`). 거리
// 글자와 같은 muted.
export function WalkGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Circle cx={9} cy={3} r={1.5} fill={MUTED} />
      <Path
        d="M9 5.5L8 9"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 9L6.5 13"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 9L10 11.5V13"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 6.5L11 8"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 구간행 이동수단 아이콘 · 차량(16) — TRIP-354. Figma `2246:1942`. 자동차 실루엣을 손으로
// 재구성. distanceRange 꼬리가 "차량 추정" 이면 이 글리프를 쓴다. 거리 글자와 같은 muted.
export function CarGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M2 11L3 7.5C3.13 7.2 3.42 7 3.75 7H12.25C12.58 7 12.87 7.2 13 7.5L14 11V12.5H2V11Z"
        stroke={MUTED}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={5} cy={12.5} r={1} fill={MUTED} />
      <Circle cx={11} cy={12.5} r={1} fill={MUTED} />
    </Svg>
  );
}

// "지도 크게 보기" 확대 아이콘(14) — TRIP-354 Q5. Figma `2246:1989` pill. 네 귀 화살표(maximize)
// 를 손으로 재구성. pill 글자와 같은 ink.
export function ExpandGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M6 3H3V6"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 3H13V6"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6 13H3V10"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 13H13V10"
        stroke={INK}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// h31 지도 폴백 재시도 새로고침(18) — Figma `1912:1083`. 호(arc)+화살촉 한 벌. 재시도 버튼
// 글자와 같은 muted 로 은은한 어포던스.
export function RefreshGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M15.8 8.5C15.2 5.65 12.85 3.75 10 3.75C6.55 3.75 3.75 6.55 3.75 10C3.75 13.45 6.55 16.25 10 16.25C12.6 16.25 14.85 14.65 15.75 12.3"
        stroke={MUTED}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15.5 4.5V8.5H11.5"
        stroke={MUTED}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// h04 시작 방법 3방식 아이콘(24) — Figma `1903:1083`(opt 카드 아이콘 노드 1903:1092·1902·1115).
// 전부 벡터 path 실측. `react-native-svg-transformer` 가 없어 .svg 파일 import 가 안 되므로
// 리포 관례대로 인라인 글리프로 둔다.

// 「완전 AI가 짜기」 — 4각 반짝임(fill). h04 카드는 회색(`body`) 기본, h09 진행 카드 히어로는
// 브랜드 primary 로(같은 도형, 색만 스냅 — LockGlyph 의 tone 패턴 계승).
export function FullAiGlyph({
  size = 24,
  tone = 'body',
  testID,
}: GlyphProps & { tone?: 'body' | 'primary' }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 2L13.8 10.2L22 12L13.8 13.8L12 22L10.2 13.8L2 12L10.2 10.2L12 2Z"
        fill={tone === 'primary' ? PRIMARY : BODY}
      />
    </Svg>
  );
}

// 「AI와 같이 짜기」 — 반쯤 채운 원(테두리 + 왼쪽 절반 fill).
export function CoPickGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21Z"
        stroke={PRIMARY_TEXT}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 3C9.61305 3 7.32387 3.94821 5.63604 5.63604C3.94821 7.32387 3 9.61305 3 12C3 14.3869 3.94821 16.6761 5.63604 18.364C7.32387 20.0518 9.61305 21 12 21V3Z"
        fill={PRIMARY_TEXT}
      />
    </Svg>
  );
}

// 「직접 짜기」 — 3줄 목록.
export function ManualGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M4 7H20"
        stroke={BODY}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 12H20"
        stroke={BODY}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 17H20"
        stroke={BODY}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
