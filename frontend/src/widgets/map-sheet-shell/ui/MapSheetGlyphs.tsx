import Svg, { Circle, Path } from 'react-native-svg';

// TRIP-783 · 지도+시트 셸 전용 인라인 SVG 글리프. widgets → `@/features` import 는 층 린트가 막아
// (widgetsStructure F FAIL) `features/itinerary/ui/ItineraryGlyphs` 의 Back/Car/Walk 를 **바이트 복제**
// 한다(리포 글리프 로컬 복제 관례의 N번째 사본). 색은 이 파일에서만 raw hex 로 고정한다(SVG stroke/fill
// 은 className 을 못 받고 `*Glyphs.tsx` 는 raw-hex 스캔 제외 관례 · docs/structure.md §지금 작업하려면).

const INK = '#222222';
const MUTED = '#6A6A6A';
const PRIMARY = '#FF385C';
const PRIMARY_TEXT = '#C13515';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 좌상단 back — 흰 원 안 뒤로가기 chevron. BackChevronGlyph(ItineraryGlyphs) 바이트 복제.
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

// 커넥터 이동수단 · 도보(16) — WalkGlyph(ItineraryGlyphs) 바이트 복제. `distanceRange` 에 `차량` 이
// 없으면 이 글리프를 쓴다. 거리 글자와 같은 muted.
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

// 커넥터 이동수단 · 차량(16) — CarGlyph(ItineraryGlyphs) 바이트 복제. `distanceRange` 에 `차량` 이
// 있으면 이 글리프를 쓴다. 거리 글자와 같은 muted.
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

// ✦ 스파클(18) — FullAiGlyph(ItineraryGlyphs) 바이트 복제, h07 진행 카드 제목의 AI 표식.
// widget 은 primary 톤 하나만 쓰므로 tone 인자 없이 primary 채움으로 고정한다(YAGNI).
export function FullAiGlyph({ size = 18, testID }: GlyphProps) {
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
        fill={PRIMARY}
      />
    </Svg>
  );
}

// ✓ 체크(12) — CheckGlyph(ItineraryGlyphs) 바이트 복제, 진행 게이지 done 셀 라벨 앞 표식.
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

// 지도핀-꺼짐(16) — 지도 폴백 바 아이콘 원 안 표식(TRIP-919, Figma `4287:2126` 벡터 그대로). muted.
export function MapPinOffGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M3.6 3.6C2.98178 4.50233 2.65595 5.57292 2.66667 6.66667C2.66667 10.6667 8 14.6667 8 14.6667C8.8638 13.9573 9.66661 13.1768 10.4 12.3333"
        stroke={MUTED}
        strokeWidth={1.33333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12.8 9C13.1523 8.27267 13.3346 7.47481 13.3333 6.66667C13.333 5.63215 13.0318 4.62006 12.4665 3.7537C11.9011 2.88733 11.096 2.20409 10.1492 1.78722C9.20236 1.37034 8.15475 1.23782 7.13396 1.40581C6.11318 1.5738 5.16328 2.03504 4.4 2.73333"
        stroke={MUTED}
        strokeWidth={1.33333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.06667 6.06667C5.97178 6.36829 5.94977 6.6881 6.00242 6.99988C6.05507 7.31165 6.1809 7.6065 6.36957 7.86023C6.55824 8.11397 6.80438 8.31935 7.0878 8.45953C7.37122 8.59971 7.68383 8.6707 8 8.66667C8.42993 8.67213 8.85018 8.53889 9.19842 8.28671C9.54667 8.03453 9.80438 7.67684 9.93333 7.26667"
        stroke={MUTED}
        strokeWidth={1.33333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M1.33333 1.33333L14.6667 14.6667"
        stroke={MUTED}
        strokeWidth={1.33333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 새로고침(16) — 지도 폴백 바 [다시 시도] 버튼 표식(TRIP-919, Figma `4287:2133` 벡터 그대로). ink.
export function RetryGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M13.3333 7.33333C13.2818 6.07284 12.7851 4.87144 11.9314 3.94255C11.0778 3.01367 9.92255 2.41745 8.6709 2.25981C7.41924 2.10217 6.15222 2.39332 5.09494 3.08153C4.03765 3.76975 3.25855 4.81047 2.89605 6.01882C2.53355 7.22716 2.61111 8.52488 3.11497 9.68144C3.61882 10.838 4.51634 11.7785 5.64807 12.3359C6.77981 12.8933 8.07248 13.0314 9.29645 12.7258C10.5204 12.4202 11.5964 11.6906 12.3333 10.6667"
        stroke={INK}
        strokeWidth={1.33333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M13.3333 2.66667V7.33333H8.66667"
        stroke={INK}
        strokeWidth={1.33333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
