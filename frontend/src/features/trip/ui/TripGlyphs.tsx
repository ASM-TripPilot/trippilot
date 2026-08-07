import type { ComponentType } from 'react';
import Svg, { Path } from 'react-native-svg';

// g01 위저드 1/2 전용 인라인 벡터 글리프(AuthGlyphs/OnboardingGlyphs/StayGlyphs/ExploreGlyphs
// 패턴 계승 · Figma 파일 1MTF3dtptIrbg8gld5IdO2, 노드 1675:1183). 전부 Figma 벡터 path
// 실측이다(근사 안 함 — StayGlyphs.tsx 규율과 동일). features 간 직접 import 금지 관례라
// StayGlyphs·ExploreGlyphs와 겹치는 아이콘(chevron·pin·plus)도 새로 그린다.
//
// 색은 이 파일 안에서만 raw hex로 고정한다(선례 — `ui/` 안이지만 `*Glyphs.tsx`는 raw-hex
// 스캔 가드 제외 관례, `docs/structure.md` §지금 작업하려면). SVG `stroke`/`fill`은
// className을 못 받는다.

const INK = '#222222';
const BODY = '#3F3F3F';
const MUTED = '#6A6A6A';
const MUTED_SOFT = '#9AA1AB';
const PRIMARY = '#FF385C';
const PRIMARY_TEXT = '#C13515';
const ON_PRIMARY = '#FFFFFF';
/** 등록 숙소 행의 비활성 색(Figma `2226:2027`) — 토큰 컬렉션에 없는 푸른 회색이다.
 * 같은 값이 `features/trip/ui/TripWizardStep1Screen.tsx`의 제목 임의값 클래스에도 있다 —
 * 색을 바꿀 땐 두 자리를 함께 고친다(색은 어떤 테스트도 단언하지 않는다). */
const DISABLED = '#C2CCD6';

type GlyphProps = {
  size?: number;
  testID?: string;
};

type SelectableGlyphProps = GlyphProps & { selected?: boolean };

/** 동반 유형 4아이콘의 공용 타입 — 선택 시 칩 배경이 분홍으로 차므로 아이콘도 흰색으로
 * 바뀐다(Figma 실측 — 선택된 '친구' 칩의 사람 아이콘이 `stroke="white"`). */
export type GlyphComponent = ComponentType<SelectableGlyphProps>;

function companionStroke(selected?: boolean): string {
  return selected ? ON_PRIMARY : BODY;
}

// 앱바 뒤로가기(24) — Figma `1675:1185`.
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

// 여행지 칩 핀(14) — Figma `1860:2311`. 색은 primary가 아니라 primary-text(#C13515)다.
export function PinGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M11.6667 5.83333C11.6667 9.33333 7 12.8333 7 12.8333C7 12.8333 2.33333 9.33333 2.33333 5.83333C2.33333 4.59566 2.825 3.40867 3.70017 2.5335C4.57534 1.65833 5.76232 1.16667 7 1.16667C8.23768 1.16667 9.42466 1.65833 10.2998 2.5335C11.175 3.40867 11.6667 4.59566 11.6667 5.83333Z"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.16667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7 7.58333C7.9665 7.58333 8.75 6.79983 8.75 5.83333C8.75 4.86684 7.9665 4.08333 7 4.08333C6.0335 4.08333 5.25 4.86684 5.25 5.83333C5.25 6.79983 6.0335 7.58333 7 7.58333Z"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.16667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 여행지 칩 제거 ×(14) — Figma `1860:2316`.
export function RemoveGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M3.5 3.5L10.5 10.5"
        stroke={MUTED}
        strokeWidth={1.16667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10.5 3.5L3.5 10.5"
        stroke={MUTED}
        strokeWidth={1.16667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// '꼭 갈 곳' 썸네일 제거 ×(12) — Figma `1740:1087`. 도시 칩의 RemoveGlyph와 도형은
// 정비례하지만 색(#484848)과 굵기가 다르다 — 흰 원 위에 얹히는 아이콘이라 더 진하고 굵다.
const THUMB_REMOVE = '#484848';

export function ThumbRemoveGlyph({ size = 12, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
    >
      <Path
        d="M3 3L9 9"
        stroke={THUMB_REMOVE}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 3L3 9"
        stroke={THUMB_REMOVE}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 도시 추가 칩 +(14) — Figma `1860:2329`. 텍스트는 primary-text지만 아이콘은 primary다.
// '꼭 갈 곳' 점선 박스의 +(20, `1740:1110`)는 같은 도형의 정비례 확대라 size로 겸한다.
export function PlusGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M7 2.91667V11.0833"
        stroke={PRIMARY}
        strokeWidth={1.51667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M2.91667 7H11.0833"
        stroke={PRIMARY}
        strokeWidth={1.51667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 날짜 카드 캘린더(22) — Figma `1675:1226`.
export function CalendarGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
    >
      <Path
        d="M16.9583 4.125H5.04167C3.77601 4.125 2.75 5.15101 2.75 6.41667V16.5C2.75 17.7657 3.77601 18.7917 5.04167 18.7917H16.9583C18.224 18.7917 19.25 17.7657 19.25 16.5V6.41667C19.25 5.15101 18.224 4.125 16.9583 4.125Z"
        stroke={MUTED}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M2.75 8.25H19.25"
        stroke={MUTED}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7.33333 2.29167V5.5"
        stroke={MUTED}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M14.6667 2.29167V5.5"
        stroke={MUTED}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 날짜 카드 chevron-down(20) — Figma `1675:1234`.
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
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 인원·박수 스테퍼 −(20) — Figma `1675:1244`.
export function StepperMinusGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M4.16667 10H15.8333"
        stroke={INK}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 인원·박수 스테퍼 +(20) — Figma `1675:1248`.
export function StepperPlusGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 4.16667V15.8333"
        stroke={INK}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.16667 10H15.8333"
        stroke={INK}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 동반 유형 '혼자'(18) — Figma `1675:1253`.
export function SoloGlyph({
  size = 18,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = companionStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 9C10.6569 9 12 7.65685 12 6C12 4.34315 10.6569 3 9 3C7.34315 3 6 4.34315 6 6C6 7.65685 7.34315 9 9 9Z"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.75 15C3.75 13.6076 4.30312 12.2723 5.28769 11.2877C6.27226 10.3031 7.60761 9.75 9 9.75C10.3924 9.75 11.7277 10.3031 12.7123 11.2877C13.6969 12.2723 14.25 13.6076 14.25 15"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 동반 유형 '친구'(18) — Figma `1675:1258`. 라이브 default 선택 상태(흰색)로 실측했다.
export function FriendsGlyph({
  size = 18,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = companionStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M12 15.75V14.25C12 13.4544 11.6839 12.6913 11.1213 12.1287C10.5587 11.5661 9.79565 11.25 9 11.25H4.5C3.70435 11.25 2.94129 11.5661 2.37868 12.1287C1.81607 12.6913 1.5 13.4544 1.5 14.25V15.75"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.75 8.25C8.40685 8.25 9.75 6.90685 9.75 5.25C9.75 3.59315 8.40685 2.25 6.75 2.25C5.09315 2.25 3.75 3.59315 3.75 5.25C3.75 6.90685 5.09315 8.25 6.75 8.25Z"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16.5 15.75V14.25C16.4995 13.5853 16.2783 12.9396 15.871 12.4142C15.4638 11.8889 14.8936 11.5137 14.25 11.3475"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 2.3475C12.6453 2.51273 13.2173 2.88803 13.6257 3.41423C14.0342 3.94044 14.2559 4.58762 14.2559 5.25375C14.2559 5.91988 14.0342 6.56706 13.6257 7.09327C13.2173 7.61947 12.6453 7.99477 12 8.16"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 동반 유형 '연인'(18) — Figma `1675:1265`.
export function HeartGlyph({
  size = 18,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = companionStroke(selected);
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
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 동반 유형 '가족'(18, 집 모양) — Figma `1675:1269`.
export function FamilyGlyph({
  size = 18,
  selected,
  testID,
}: SelectableGlyphProps) {
  const stroke = companionStroke(selected);
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M2.25 7.875L9 2.25L15.75 7.875"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.75 7.35V15C3.75 15.1989 3.82902 15.3897 3.96967 15.5303C4.11032 15.671 4.30109 15.75 4.5 15.75H13.5C13.6989 15.75 13.8897 15.671 14.0303 15.5303C14.171 15.3897 14.25 15.1989 14.25 15V7.35"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7.125 15.75V10.875H10.875V15.75"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 취향 카드 반짝임(18, 채움) — Figma `1675:1277`.
export function SparkleGlyph({ size = 18, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 1.5L10.35 7.65L16.5 9L10.35 10.35L9 16.5L7.65 10.35L1.5 9L7.65 7.65L9 1.5Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}

// 인라인 오류 경고(15) — Figma `2228:1733`(nightsErr) · `2226:2115`(dateErr). 제출 실패
// 배너는 같은 도형을 18로 키워 쓴다(`2226:2122`) — 뷰박스를 그대로 스케일한 값이라 size
// prop 하나로 겸한다(15px·18px 두 export가 좌표까지 정비례).
export function AlertCircleGlyph({ size = 15, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 15 15"
      fill="none"
    >
      <Path
        d="M7.5 13.125C10.6066 13.125 13.125 10.6066 13.125 7.5C13.125 4.3934 10.6066 1.875 7.5 1.875C4.3934 1.875 1.875 4.3934 1.875 7.5C1.875 10.6066 4.3934 13.125 7.5 13.125Z"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.375}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7.5 5V8.125"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.375}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7.5 10.3125H7.50625"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.375}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 국내 차단 다이얼로그 배지 지구본(27) — Figma `2228:1926`.
export function GlobeGlyph({ size = 27, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 27 27"
      fill="none"
    >
      <Path
        d="M13.5 23.625C19.0919 23.625 23.625 19.0919 23.625 13.5C23.625 7.90812 19.0919 3.375 13.5 3.375C7.90812 3.375 3.375 7.90812 3.375 13.5C3.375 19.0919 7.90812 23.625 13.5 23.625Z"
        stroke={PRIMARY_TEXT}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.375 13.5H23.625"
        stroke={PRIMARY_TEXT}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M13.5 3.375C15.6907 6.296 16.875 9.84875 16.875 13.5C16.875 17.1512 15.6907 20.704 13.5 23.625C11.3093 20.704 10.125 17.1512 10.125 13.5C10.125 9.84875 11.3093 6.296 13.5 3.375Z"
        stroke={PRIMARY_TEXT}
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 침대 도형이 쓰는 색조. 도형은 하나고 색만 갈린다 — g01 등록 숙소 행의 세 얼굴에
 * g02(TRIP-225)의 두 자리가 더해졌다: 온램프 배너 22px `#6A6A6A`(`1707:1191`)와 empty 배지
 * 52px `#C13515`(`1708:1190`). */
export type BedTone =
  'body' | 'disabled' | 'mutedSoft' | 'muted' | 'primaryText';

const BED_STROKE: Record<BedTone, string> = {
  body: BODY,
  disabled: DISABLED,
  mutedSoft: MUTED_SOFT,
  muted: MUTED,
  primaryText: PRIMARY_TEXT,
};

// 등록 숙소 날짜 연계 침대(19) — Figma `2225:2363`(활성 #3F3F3F) · `2226:2027`(비활성
// #C2CCD6) · `2226:1918`(대안 18px #9AA1AB). 세 노드의 path를 받아 대조하니 좌표까지
// 정비례(19:18)라 색만 다른 같은 도형이었다 — AlertCircleGlyph처럼 size prop 하나로 겸한다.
export function BedGlyph({
  size = 19,
  tone = 'body',
  testID,
}: GlyphProps & { tone?: BedTone }) {
  const stroke = BED_STROKE[tone];
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 19 19"
      fill="none"
    >
      <Path
        d="M1.58333 3.16667V15.8333"
        stroke={stroke}
        strokeWidth={1.58333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M1.58333 6.33333H15.8333C16.2533 6.33333 16.656 6.50015 16.9529 6.79708C17.2499 7.09401 17.4167 7.49674 17.4167 7.91667V15.8333"
        stroke={stroke}
        strokeWidth={1.58333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M1.58333 13.4583H17.4167"
        stroke={stroke}
        strokeWidth={1.58333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4.75 6.33333V13.4583"
        stroke={stroke}
        strokeWidth={1.58333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// CTA 바 chevron-right(18, 흰색) — g01. `primaryText`는 g02(TRIP-225)의 인라인 링크 셰브런
// (`1861:2331` 변경 · `1866:2348` 거점으로 지정 — 16px `#C13515`)이다. 같은 도형인데 획이 더
// 가늘어(실측 1.46667@16 = 1.65@18) 색과 함께 실측값을 담는다. `MapPinGlyph`의 tone 선례대로
// 좁은 유니온이고, 범용 색상표는 만들지 않는다.
export function ChevronRightGlyph({
  size = 18,
  tone = 'onPrimary',
  testID,
}: GlyphProps & { tone?: 'onPrimary' | 'primaryText' }) {
  const onPrimary = tone === 'onPrimary';
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M6.75 4.5L11.25 9L6.75 13.5"
        stroke={onPrimary ? ON_PRIMARY : PRIMARY_TEXT}
        strokeWidth={onPrimary ? 2.2 : 1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// g02 후보 카드 `거점` 배지 안 마커(14, 흰색) — Figma `1866:2319`. 위 `PinGlyph`(물방울형)와
// **다른 도형**이라 새로 그린다(근사 금지 규율). 배지 배경이 항상 분홍이라 색 분기가 없다.
export function BaseBadgePinGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M7 12.8333V4.66667"
        stroke={ON_PRIMARY}
        strokeWidth={1.225}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M7 4.66667C7.9665 4.66667 8.75 3.88317 8.75 2.91667C8.75 1.95017 7.9665 1.16667 7 1.16667C6.0335 1.16667 5.25 1.95017 5.25 2.91667C5.25 3.88317 6.0335 4.66667 7 4.66667Z"
        stroke={ON_PRIMARY}
        strokeWidth={1.225}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M2.91667 7H1.16667C1.16667 8.5471 1.78125 10.0308 2.87521 11.1248C3.96917 12.2188 5.4529 12.8333 7 12.8333C8.5471 12.8333 10.0308 12.2188 11.1248 11.1248C12.2188 10.0308 12.8333 8.5471 12.8333 7H11.0833"
        stroke={ON_PRIMARY}
        strokeWidth={1.225}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// g02 후보 카드 우상단 하트(26, 채움) — Figma `1866:2316`. 이 목록의 출처가 `GET /saved-stays`라
// 카드는 정의상 전부 저장된 숙소다 → 외곽(미저장) 상태가 이 화면에는 없다. 토글은 e04
// (TRIP-192) 몫이라 이 칸은 그리기만 하고 심판을 걸지 않는다(02a ★16).
export function HeartFilledGlyph({ size = 26, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 26 26"
      fill="none"
    >
      <Path
        d="M13 23.1292L11.4292 21.6992C5.85 16.64 2.16667 13.3033 2.16667 9.20833C2.16667 5.87167 4.78833 3.25 8.125 3.25C10.01 3.25 11.8192 4.1275 13 5.51417C14.1808 4.1275 15.99 3.25 17.875 3.25C21.2117 3.25 23.8333 5.87167 23.8333 9.20833C23.8333 13.3033 20.15 16.64 14.5708 21.71L13 23.1292Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}

// g02 지정됨 pill 안 체크(14) — Figma `1866:2332`.
export function CheckGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
    >
      <Path
        d="M11.6667 3.5L5.25 9.91667L2.33333 7"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// g02 empty `숙소 둘러보기` 돋보기(20) — Figma `1708:1208`.
export function SearchGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M9.16667 15C12.3883 15 15 12.3883 15 9.16667C15 5.94501 12.3883 3.33333 9.16667 3.33333C5.94501 3.33333 3.33333 5.94501 3.33333 9.16667C3.33333 12.3883 5.94501 15 9.16667 15Z"
        stroke={INK}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17.5 17.5L13.75 13.75"
        stroke={INK}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// g02 경고 삼각형 — error 배지 32px(`2456:1502`)과 blocked 안내행 20px(`2456:1514`)이 **같은
// 노드**다(좌표·획이 32:20으로 정비례 — 실측). `BedGlyph` 선례대로 size prop 하나로 겸한다.
export function WarningTriangleGlyph({ size = 32, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
    >
      <Path
        d="M16 4L29.3333 26.6667H2.66667L16 4Z"
        stroke={PRIMARY}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 12V18.6667"
        stroke={PRIMARY}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 22.6667H16.0133"
        stroke={PRIMARY}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
