import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

/**
 * TRIP-604 · l03 마이페이지 전용 인라인 벡터 글리프. features 간 직접 import 금지 관례라
 * chevron·share 등 다른 feature 에 이름이 겹치는 글리프도 여기 새로 그린다(리포 확립 관례 —
 * `ChevronRightGlyph` 는 이미 4벌). 스크린샷 육안 재구성(l03 은 개별 벡터 노드가 얇아 실측
 * path 대신 형태 재구성 — `AlertCircleGlyph` 선례와 동형).
 *
 * 색은 이 파일 안에서만 raw hex 로 고정한다(선례 — `ui/` 안이지만 `*Glyphs.tsx` 는 raw-hex 스캔
 * 가드 제외 관례). SVG `stroke`/`fill` 은 className 을 못 받는다.
 */

const INK = '#222222';
const MUTED = '#6A6A6A';
const HAIRLINE_STRONG = '#DDDDDD';

type GlyphProps = {
  size?: number;
  testID?: string;
};

/** 우향 chevron — 카드·행 진입 어포던스(회고 진입·설정 행 공용). */
export function ChevronRightGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M9 6L15 12L9 18"
        stroke={HAIRLINE_STRONG}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 헤더 우상단 아이콘(설정/모양 — Figma l03 의 태양형 글리프). onPress 미배선(Q6). */
export function SettingsSunGlyph({ size = 24, testID }: GlyphProps) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle cx={12} cy={12} r={4} stroke={INK} strokeWidth={1.7} />
      {rays.map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x1 = 12 + Math.cos(rad) * 7;
        const y1 = 12 + Math.sin(rad) * 7;
        const x2 = 12 + Math.cos(rad) * 9;
        const y2 = 12 + Math.sin(rad) * 9;
        return (
          <Line
            key={deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={INK}
            strokeWidth={1.7}
            strokeLinecap="round"
          />
        );
      })}
    </Svg>
  );
}

/** 등록 숙소·예약 기록 행 — 책갈피/기록. */
export function BookmarkGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M6 4H18V20L12 16L6 20V4Z"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 여행 스타일 분석 행 — 막대 그래프. */
export function BarChartGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Line
        x1={5}
        y1={20}
        x2={19}
        y2={20}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Rect
        x={6}
        y={11}
        width={3.4}
        height={7}
        rx={1}
        stroke={INK}
        strokeWidth={1.7}
      />
      <Rect
        x={12}
        y={7}
        width={3.4}
        height={11}
        rx={1}
        stroke={INK}
        strokeWidth={1.7}
      />
    </Svg>
  );
}

/** 내 일정 공개/공유 설정 행 — 공유 노드. */
export function ShareNodesGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle cx={7} cy={12} r={2.4} stroke={INK} strokeWidth={1.7} />
      <Circle cx={17} cy={6} r={2.4} stroke={INK} strokeWidth={1.7} />
      <Circle cx={17} cy={18} r={2.4} stroke={INK} strokeWidth={1.7} />
      <Line
        x1={9}
        y1={11}
        x2={15}
        y2={7}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Line
        x1={9}
        y1={13}
        x2={15}
        y2={17}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 내가 공유한 일정 행 — 목록. */
export function ListGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Line
        x1={9}
        y1={7}
        x2={19}
        y2={7}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Line
        x1={9}
        y1={12}
        x2={19}
        y2={12}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Line
        x1={9}
        y1={17}
        x2={19}
        y2={17}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Circle cx={5} cy={7} r={1} fill={INK} />
      <Circle cx={5} cy={12} r={1} fill={INK} />
      <Circle cx={5} cy={17} r={1} fill={INK} />
    </Svg>
  );
}

/** 숨긴 사용자 관리 행 — 가려진 눈. */
export function EyeOffGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M4 12C6 8 9 6 12 6C15 6 18 8 20 12C18 16 15 18 12 18C9 18 6 16 4 12Z"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={2.6} stroke={INK} strokeWidth={1.7} />
      <Line
        x1={5}
        y1={5}
        x2={19}
        y2={19}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 설정 행 — 톱니. */
export function GearGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle cx={12} cy={12} r={3} stroke={INK} strokeWidth={1.7} />
      <Path
        d="M12 3.5V6M12 18V20.5M20.5 12H18M6 12H3.5M18 6L16.3 7.7M7.7 16.3L6 18M18 18L16.3 16.3M7.7 7.7L6 6"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 편집 버튼 안의 연필 — 프로필 편집. */
export function PencilGlyph({ size = 14, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M16 4L20 8L8 20H4V16L16 4Z"
        stroke={MUTED}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 회고 진입 하트(default 프레임 우하단 원형 어포던스) — 종료 카드 회고와 결이 같은 장식. */
export function HeartGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 20C12 20 4 15 4 9.5C4 7 6 5 8.5 5C10 5 11.3 5.8 12 7C12.7 5.8 14 5 15.5 5C18 5 20 7 20 9.5C20 15 12 20 12 20Z"
        fill="#FF385C"
      />
    </Svg>
  );
}
