import { render, screen } from '@testing-library/react-native';

import type { StyleCardVM } from '../model/styleCardModel';
import { StyleSummaryCard } from './StyleSummaryCard';

/**
 * TRIP-775 · l03 스타일 카드 ↔ Figma 1602:2388 — 게이지 좌측 정렬 · 헤드라인 슬롯.
 *
 * 무엇을 보장하나:
 *  - AC-4 게이지 행이 양끝 벌림(`justify-between`)이 아니다 — dot 이 라벨 바로 뒤에 붙는다.
 *  - AC-4 `headline` 을 받으면 그 문장을 보이고, 안 받으면 문장 자리가 아예 없다
 *    (서버에 헤드라인 필드가 없는 동안 비워 두는 계약 공백 슬롯).
 *
 * 채움 dot 개수(AC-S2)·메타줄 부재(AC-S1)는 `StyleSummaryCard.test.tsx` 가 진다.
 */

const OFFICIAL: StyleCardVM = {
  kind: 'official',
  descriptors: ['#바다', '#미식', '#느긋'],
  gauges: [
    { label: '여유로움', value: 4 },
    { label: '미식 취향', value: 4 },
    { label: '활동성', value: 3 },
  ],
  sampleTripCount: 6,
  updatedAt: '2026-08-28T09:00:00Z',
};

const HEADLINE = '바다와 미식을 천천히 즐기는 여행자';

/** className 을 공백으로 쪼갠 토큰 배열(부분 문자열 오탐 방지). */
function tokens(className: unknown): string[] {
  return typeof className === 'string' ? className.split(/\s+/) : [];
}

describe('AC-4 · 게이지 정렬', () => {
  it('게이지 3행 모두 양끝 벌림(justify-between)이 아니다', () => {
    render(<StyleSummaryCard vm={OFFICIAL} />);

    const rows = screen.getAllByTestId('my-style-gauge');
    expect(rows).toHaveLength(3);
    rows.forEach((row) => {
      expect(tokens(row.props.className)).not.toContain('justify-between');
    });
  });
});

describe('AC-4 · 헤드라인 슬롯(계약 공백)', () => {
  it('headline 을 주입하면 그 문장 한 줄이 보인다', () => {
    render(<StyleSummaryCard vm={OFFICIAL} headline={HEADLINE} />);

    expect(screen.getByTestId('my-style-headline')).toHaveTextContent(HEADLINE);
  });

  it('headline 을 주입하지 않으면 문장 자리가 없다(카드는 그대로)', () => {
    render(<StyleSummaryCard vm={OFFICIAL} />);

    expect(screen.queryByTestId('my-style-headline')).toBeNull();
    expect(screen.getByTestId('my-style-card')).toBeOnTheScreen();
  });
});
