import type { ReactElement } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { TOUR_PAGE_COUNT } from '../model/tourPages';

// c10 기능 안내 전용 SVG 장식(TRIP-1595). 색은 SVG stroke/fill 이 className 을 못 받는 리포 관례대로 이 파일 안에서만 raw hex 로 고정한다
// (primary·hairline-strong 토큰과 같은 값 — `shared/ui/glyphs/colors.ts` 와 같은 처지). 경로·핀은 S2 모션이 같은 컴포넌트에 얹힌다.

const PRIMARY = '#FF385C';
const HAIRLINE_STRONG = '#DDDDDD';

/**
 * 코랄 점선 경로 — `d` 를 직접 둔다(Figma export SVG 는 점선이 조각으로 구워져 있어 못 쓴다).
 * `width`·`height` 는 경로 노드 크기이고 좌표는 그 로컬 좌표다.
 */
export function TourRoute({
  d,
  width,
  height,
}: {
  d: string;
  width: number;
  height: number;
}): ReactElement {
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Path
        d={d}
        fill="none"
        stroke={PRIMARY}
        strokeWidth={2.4}
        strokeDasharray="2 9"
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 핀 본체 — 스플래시 큰 핀과 같은 모양(27×34, 팁 (13.5, 33)). 번호가 없는 정류장 핀·도착 핀이 이 한 벌을 쓴다.
const PIN_BODY =
  'M13.5 0.944445C6.7 0.944445 1.22222 6.13889 1.22222 12.75C1.22222 20.7778 13.5 33.0556 13.5 33.0556C13.5 33.0556 25.7778 20.7778 25.7778 12.75C25.7778 6.13889 20.3 0.944445 13.5 0.944445Z';
const PIN_HOLE =
  'M13.5 16.9056C15.7951 16.9056 17.6556 15.0451 17.6556 12.75C17.6556 10.455 15.7951 8.59445 13.5 8.59445C11.205 8.59445 9.34445 10.455 9.34445 12.75C9.34445 15.0451 11.205 16.9056 13.5 16.9056Z';

/** 무번호 정류장 핀 27×34 — 팁이 경로 꼭짓점이다. 6장의 도착 핀도 같은 모양이다. */
export function TourStopPin(): ReactElement {
  return (
    <Svg width={27} height={34} viewBox="0 0 27 34" fill="none">
      <Path
        d={PIN_BODY}
        fill={PRIMARY}
        stroke="#FFFFFF"
        strokeWidth={2.26667}
      />
      <Path d={PIN_HOLE} fill="#FFFFFF" />
    </Svg>
  );
}

/** 번호 핀 28×36 몸통 — 숫자는 호출부가 위에 얹는다(3/6 지도 카드). 구멍 없이 숫자가 그 자리에 앉는다. */
export function TourMapPinBody(): ReactElement {
  return (
    <Svg width={28} height={36} viewBox="0 0 27 34" fill="none">
      <Path
        d={PIN_BODY}
        fill={PRIMARY}
        stroke="#FFFFFF"
        strokeWidth={2.26667}
      />
    </Svg>
  );
}

/**
 * 진행 점 6개(158×8) + 점 사이 점 셋 링크. 지난·현재 점과 그 점에 닿은 링크는 primary, 남은 것은 hairline-strong.
 * 현재 장은 `now`(1부터) — 6장이면 전부 primary.
 */
export function TourProgressDots({ now }: { now: number }): ReactElement {
  const items: ReactElement[] = [];
  for (let i = 1; i <= TOUR_PAGE_COUNT; i += 1) {
    const cx = (i - 1) * 30 + 4;
    items.push(
      <Circle
        key={`dot-${i}`}
        cx={cx}
        cy={4}
        r={4}
        fill={i <= now ? PRIMARY : HAIRLINE_STRONG}
      />
    );
    if (i < TOUR_PAGE_COUNT) {
      const fill = i + 1 <= now ? PRIMARY : HAIRLINE_STRONG;
      [9, 15, 21].forEach((offset) =>
        items.push(
          <Circle
            key={`link-${i}-${offset}`}
            cx={cx + offset}
            cy={4}
            r={1}
            fill={fill}
          />
        )
      );
    }
  }
  return (
    <Svg width={158} height={8} viewBox="0 0 158 8">
      {items}
    </Svg>
  );
}

/** 불꽃 14 — 1/6 `지금 급상승` 메타 장식(앱 카드엔 없는 Figma 장식). */
export function TourFlameGlyph(): ReactElement {
  return (
    <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
      <Path
        d="M7 1.16667C7 1.16667 9.91667 3.5 9.91667 6.41667C9.91667 7.19021 9.60938 7.93208 9.06239 8.47906C8.51541 9.02604 7.77355 9.33333 7 9.33333C6.22645 9.33333 5.48459 9.02604 4.93761 8.47906C4.39062 7.93208 4.08333 7.19021 4.08333 6.41667C4.08333 5.25 4.66667 4.375 5.25 3.79167C5.25 4.66667 5.71667 5.25 6.3 5.25C6.88333 5.25 7.29167 4.66667 7 3.73333C6.65 2.91667 7 1.98333 7 1.16667Z"
        fill={PRIMARY}
      />
    </Svg>
  );
}

/** 4/6 방문 행 체크 18 — success 원 + 흰 테두리 2 + 굵은 흰 체크(공용 `CheckGlyph` 는 획이 가늘어 별도). */
export function TourVisitCheck(): ReactElement {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <Circle
        cx={9}
        cy={9}
        r={8}
        fill="#0E9384"
        stroke="#FFFFFF"
        strokeWidth={2}
      />
      <Path
        d="M12.67 6.75L8.62 10.79L6.83 9"
        stroke="#FFFFFF"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 4/6 모션 시작 모양 — 체크가 들어오기 전의 빈 링(hairline-strong). 체크가 켜질 때 같이 빠진다(TRIP-1596). */
export function TourVisitCheckRing(): ReactElement {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <Circle cx={9} cy={9} r={8} stroke={HAIRLINE_STRONG} strokeWidth={2} />
    </Svg>
  );
}

/**
 * 3/6 단순화 지도 바탕 342×200(결정 D2) — 해안선·도로 몇 줄로만 그린 추상 도형이다. 이미지 basemap·출처 표기 없음.
 * 핀·동선·거리 라벨은 위에 RN 으로 얹는다.
 */
export function TourMapBackdrop(): ReactElement {
  return (
    <Svg width={342} height={200} viewBox="0 0 342 200" fill="none">
      <Rect width={342} height={200} fill="#EFF1EF" />
      {/* 공원·녹지 */}
      <Path d="M0 0H70C74 30 60 60 30 70C16 74 6 70 0 66Z" fill="#E3EBE0" />
      {/* 바다 — 오른쪽 아래에서 항구 쪽으로 파고든다 */}
      <Path
        d="M342 96C318 98 296 106 282 124C270 140 262 152 238 160C222 166 214 180 206 200H342Z"
        fill="#D9DFE3"
      />
      <Path
        d="M342 56C332 58 322 64 314 74C308 82 300 88 290 90"
        stroke="#D9DFE3"
        strokeWidth={10}
        strokeLinecap="round"
      />
      {/* 큰 도로 */}
      <Path
        d="M-4 150C50 138 110 132 182 150C216 158 250 150 280 132"
        stroke="#FFFFFF"
        strokeWidth={5}
        strokeLinecap="round"
      />
      <Path
        d="M96 -4C112 52 140 104 150 204"
        stroke="#FFFFFF"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <Path
        d="M168 -4L186 70L262 92"
        stroke="#FFFFFF"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 골목 */}
      <Path
        d="M0 100H78M20 40L120 70M210 0V48H300M40 190L120 170M170 110L230 124"
        stroke="#FFFFFF"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M0 124H60M118 22H176M230 150L204 192"
        stroke="#E1E4E1"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 3/6 지도 동선 — 핀 팁 4점을 직선으로 잇는다(킷 §8 "동선은 직선"). 흰 casing 6 + 코랄 3. */
export function TourMapRoute({
  points,
}: {
  points: readonly (readonly [number, number])[];
}): ReactElement {
  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`)
    .join(' ');
  return (
    <Svg
      width={342}
      height={200}
      viewBox="0 0 342 200"
      fill="none"
      style={{ position: 'absolute', left: 0, top: 0 }}
    >
      <Path
        d={d}
        stroke="#FFFFFF"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d={d}
        stroke={PRIMARY}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** 지도 축척바 56×6 — 양 끝 눈금이 있는 `ㄴ━┘` 꼴. */
export function TourScaleBar(): ReactElement {
  return (
    <Svg width={56} height={6} viewBox="0 0 56 6" fill="none">
      <Path
        d="M1 0V5H55V0"
        stroke="#3F3F3F"
        strokeWidth={2}
        strokeLinecap="square"
      />
    </Svg>
  );
}
