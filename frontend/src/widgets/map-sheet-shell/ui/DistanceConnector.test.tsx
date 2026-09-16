import { render, screen } from '@testing-library/react-native';

import { DistanceConnector } from './DistanceConnector';

/**
 * TRIP-783 · AC-3·AC-4·E3 — 카드 사이 거리 커넥터(widgets). 서버 `distanceRange` 문자열을
 * 가공 없이 그대로 나르고(BR-U3-08), null 이면 "이동 거리 계산 중"을 그린다(INV-3 — 소요시간 필드 없음).
 * 이동수단 아이콘(🚗/🚶)은 `차량` 포함 여부로 선택하나 SVG 글리프라 jest 원리적 사각(6-b 육안).
 * 점선·[길찾기]는 신 설계에서 제거 — 그 부재를 잠근다.
 *
 * 3동작 뼈대: 준비=거리 문자열/null 로 렌더 → 실행=렌더만 → 단언=거리 leaf 완전일치·소요시간 0.
 */

// 소요시간 표기 탐지기(TimeSheet CS6·executionDurationStructure 이식). HH:mm(숫자 뒤 `:`)·bare km 은 안 걸린다.
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 렌더된 문자열 전부 — INV-3 부정 스캔 모집단(TimeSheet CS6 헬퍼 이식). */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

const SLOT_KEY = '2026-06-10#poi-hwangnyeongsan';

describe('🔴 DistanceConnector · C1 — 거리 통과 렌더(AC-3 완전일치)', () => {
  it('distanceRange 를 leaf 하나에 값 그대로 담는다', () => {
    render(<DistanceConnector slotKey={SLOT_KEY} distanceRange="2.1km" />);

    expect(screen.getByTestId(`sheet-connector-${SLOT_KEY}`)).toBeOnTheScreen();
    expect(
      screen.getByTestId(`sheet-connector-distance-${SLOT_KEY}`)
    ).toHaveTextContent('2.1km');
    // 완전일치 잠금(02a ★1) — 부분포함이면 통과, exact 라 실패.
    expect(
      screen.getByTestId(`sheet-connector-distance-${SLOT_KEY}`)
    ).not.toHaveTextContent('2.1');
  });
});

describe('🔴 DistanceConnector · C2 — E3 거리 null → "이동 거리 계산 중"', () => {
  it('distanceRange 가 null 이면 계산 중 문구를 그린다(빈 칸 금지)', () => {
    render(<DistanceConnector slotKey={SLOT_KEY} distanceRange={null} />);

    expect(
      screen.getByTestId(`sheet-connector-distance-${SLOT_KEY}`)
    ).toHaveTextContent('이동 거리 계산 중');
  });
});

describe('🔴 DistanceConnector · C3 — INV-3 렌더 스캔(소요시간 0)', () => {
  it.each(['2.1km', '차량 · 15.0km', null])(
    'distanceRange=%p 어떤 값에도 소요시간 표기가 렌더되지 않는다',
    (distanceRange) => {
      render(
        <DistanceConnector slotKey={SLOT_KEY} distanceRange={distanceRange} />
      );

      const texts = renderedTexts();
      // 긍정 앵커 — 커넥터가 실제로 무언가 그린다.
      expect(texts.length).toBeGreaterThan(0);
      // 부정 — 소요시간 표기 0(분·시간·소요).
      expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);
    }
  );
});

describe('🔴 DistanceConnector · C4 — 점선/[길찾기] 스텁 제거', () => {
  it('신 설계는 [길찾기] 어포던스를 그리지 않는다', () => {
    render(<DistanceConnector slotKey={SLOT_KEY} distanceRange="2.1km" />);

    expect(screen.queryByText('길찾기')).toBeNull();
  });
});
