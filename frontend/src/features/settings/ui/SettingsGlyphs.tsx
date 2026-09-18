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

/*
 * l05 설정(TRIP-608) 리딩 아이콘 셋 — Figma `1607:2440` 육안 재구성. l03 셋(위)과 이름이
 * 겹치지 않아 같은 파일에 이어 둔다. 색은 이 파일 안에서만 raw hex(선례 — `*Glyphs.tsx` 는
 * raw-hex 스캔 가드 제외, SVG stroke/fill 은 className 을 못 받는다). 기본 크기 22 = Figma 리딩
 * 아이콘 슬롯. 헤더 back chevron 만 24.
 */

/** 헤더 back chevron(좌향) — `ChevronRightGlyph`(우향, 카드 진입)와 방향만 다르다. */
export function ChevronLeftGlyph({ size = 24, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M15 6L9 12L15 18"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 계정(닉네임·이메일) 행 — 사람. */
export function PersonGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle cx={12} cy={8} r={3.4} stroke={INK} strokeWidth={1.7} />
      <Path
        d="M5 20C5 16 8 14 12 14C16 14 19 16 19 20"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 데이터 내보내기 행 — 아래로 내려받는 화살표 + 받침. */
export function DownloadGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Line
        x1={12}
        y1={4}
        x2={12}
        y2={15}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path
        d="M8 11L12 15L16 11"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1={5}
        y1={20}
        x2={19}
        y2={20}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 여행 스타일 행 — 반쪽 채운 대비 원(Figma 반원). */
export function ContrastGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle cx={12} cy={12} r={8} stroke={INK} strokeWidth={1.7} />
      <Path d="M12 4A8 8 0 0 1 12 20Z" fill={INK} />
    </Svg>
  );
}

/** 예산 행 — 원화(₩) 획 + 두 가로선. */
export function WonGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M5 7L8 17L12 9L16 17L19 7"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1={5}
        y1={11}
        x2={19}
        y2={11}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Line
        x1={5}
        y1={14}
        x2={19}
        y2={14}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 동행 유형 행 — 두 사람. */
export function PeopleGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Circle cx={9} cy={8} r={3} stroke={INK} strokeWidth={1.7} />
      <Path
        d="M3 19C3 15.7 5.7 13.5 9 13.5C12.3 13.5 15 15.7 15 19"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Circle cx={17.5} cy={8.5} r={2.4} stroke={INK} strokeWidth={1.7} />
      <Path
        d="M16 13.8C18.8 13.9 21 15.9 21 19"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 선호 활동 행 — 별. */
export function StarGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 4L14.3 9.2L20 9.8L15.8 13.6L17 19.2L12 16.3L7 19.2L8.2 13.6L4 9.8L9.7 9.2Z"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 이동 방식 행 — 좌우 화살표(교환). */
export function ArrowsSwapGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M4 9H19M19 9L16 6M19 9L16 12"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M20 15H5M5 15L8 12M5 15L8 18"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 음식 취향 행 — 포크·나이프. */
export function ForkKnifeGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M6 3V7C6 8.7 10 8.7 10 7V3"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1={8}
        y1={3}
        x2={8}
        y2={21}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path
        d="M16 3C18 5 18 11 16 13V21"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 일정 밀도·이동 선호 행 — 게이지(속도계). */
export function GaugeGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M4 16A8 8 0 0 1 20 16"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Line
        x1={12}
        y1={16}
        x2={15.5}
        y2={10.5}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={16} r={1.4} fill={INK} />
    </Svg>
  );
}

/** 위치정보 행 — 지도 핀. */
export function PinGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 21C12 21 5 14.5 5 9.5A7 7 0 0 1 19 9.5C19 14.5 12 21 12 21Z"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={9.5} r={2.4} stroke={INK} strokeWidth={1.7} />
    </Svg>
  );
}

/** 알림 행 — 종. */
export function BellGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M6 17V10A6 6 0 0 1 18 10V17L20 19H4L6 17Z"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path
        d="M10 19C10 20.4 11 21 12 21C13 21 14 20.4 14 19"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 제휴 안내 행 — 외부 링크(박스 밖으로 나가는 화살표). */
export function ExternalLinkGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M17 13V19A1 1 0 0 1 16 20H5A1 1 0 0 1 4 19V8A1 1 0 0 1 5 7H11"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M14 4H20V10M20 4L11 13"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * l04 등록 숙소 0건 안내(빈 상태) 일러스트 — 침대. `features/trip/ui/TripGlyphs` 에 `BedGlyph` 가
 * 있으나 features 경계로 import 불가라 여기 새로 그린다(리포 확립 관례). muted 톤(빈 상태 배지용).
 */
export function BedGlyph({ size = 22, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Line
        x1={3}
        y1={7}
        x2={3}
        y2={18}
        stroke={MUTED}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path
        d="M3 11H19A2 2 0 0 1 21 13V18"
        stroke={MUTED}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1={3}
        y1={15}
        x2={21}
        y2={15}
        stroke={MUTED}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path
        d="M7 11V9H12V11"
        stroke={MUTED}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 위험 영역(계정 삭제) 행 — 휴지통. */
export function TrashGlyph({ size = 22, testID }: GlyphProps) {
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
        y1={7}
        x2={19}
        y2={7}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path
        d="M8 7V5A1 1 0 0 1 9 4H15A1 1 0 0 1 16 5V7"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path
        d="M7 7L8 20A1 1 0 0 0 9 21H15A1 1 0 0 0 16 20L17 7"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Line
        x1={10}
        y1={11}
        x2={10}
        y2={17}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Line
        x1={14}
        y1={11}
        x2={14}
        y2={17}
        stroke={INK}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}
