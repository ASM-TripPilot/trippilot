import { render, screen } from '@testing-library/react-native';

import type { CompareRow as CompareRowVM } from '../model/compareRows';
import { CompareRow } from './CompareRow';

/**
 * TRIP-570 · AC-2·AC-3·AC-4 · j02 비교 행 — kind('actual'|'unvisited'|'change')별 라벨/배지/시각.
 * 한 컴포넌트가 VM 의 kind 로 갈라 그린다(색이 아니라 kind별 distinct 라벨 텍스트로 잠금 —
 * fill 함정 회피). testID `record-compare-row`(kind 무관 루트, 화면이 행 개수를 셈).
 *
 * 무엇을 보장하나:
 *  - 🔴 RW-1(AC-4 실제): [실제] 라벨 + 장소명 + arrivedAt 시각.
 *  - 🔴 RW-2(AC-2 미방문): [계획] 라벨 + 미방문 배지 + 장소명.
 *  - 🔴 RW-3(AC-3 변경): [변경] 라벨 + 전·후 장소(별개 leaf) + 사유 + 시각.
 *  - 🔴 RW-3b(poiId 폴백): 이름 해소 실패로 라벨이 poiId 여도 그 텍스트가 렌더된다(구조 유지).
 *
 * (개념) `getByText('...')` = leaf 완전일치(못 찾거나 여러 개면 throw) — 전·후 장소를 별개 leaf 로
 *   그려야 각각 잡힌다. `getByText(/15:40/)` = 정규식 부분일치(주변 카피에 무관하게 시각만 확인).
 */

const actualRow: CompareRowVM = {
  kind: 'actual',
  key: 'a1',
  date: '2026-06-11',
  poiId: 'poi1',
  placeLabel: '광안리 해변',
  timeLabel: '14:20',
};

const unvisitedRow: CompareRowVM = {
  kind: 'unvisited',
  key: 'u1',
  date: '2026-06-11',
  poiId: 'poi9',
  placeLabel: '○○ 전망대',
};

const changeRow: CompareRowVM = {
  kind: 'change',
  key: 'c1',
  date: '2026-06-11',
  beforeLabel: '△△ 카페',
  afterLabel: '◇◇ 실내카페',
  reason: '휴무',
  timeLabel: '15:40',
  sourceType: 'PLAN_B',
};

describe('🔴 RW-1 · AC-4 실제 행', () => {
  it('[실제] 라벨 + 장소명 + arrivedAt 시각을 그린다', () => {
    render(<CompareRow row={actualRow} />);

    expect(screen.getByTestId('record-compare-row')).toBeOnTheScreen();
    expect(screen.getByText('[실제]')).toBeOnTheScreen();
    expect(screen.getByText('광안리 해변')).toBeOnTheScreen();
    expect(screen.getByText(/14:20/)).toBeOnTheScreen();
  });
});

describe('🔴 RW-2 · AC-2 미방문 행', () => {
  it('[계획] 라벨 + 미방문 배지 + 장소명을 그린다', () => {
    render(<CompareRow row={unvisitedRow} />);

    expect(screen.getByTestId('record-compare-row')).toBeOnTheScreen();
    expect(screen.getByText('[계획]')).toBeOnTheScreen();
    expect(screen.getByText('미방문')).toBeOnTheScreen();
    expect(screen.getByText('○○ 전망대')).toBeOnTheScreen();
  });
});

describe('🔴 RW-3 · AC-3 변경 행', () => {
  it('[변경] 라벨 + 전·후 장소(별개 leaf) + 사유 + 시각을 그린다', () => {
    render(<CompareRow row={changeRow} />);

    expect(screen.getByTestId('record-compare-row')).toBeOnTheScreen();
    expect(screen.getByText('[변경]')).toBeOnTheScreen();
    expect(screen.getByText('△△ 카페')).toBeOnTheScreen();
    expect(screen.getByText('◇◇ 실내카페')).toBeOnTheScreen();
    expect(screen.getByText('휴무')).toBeOnTheScreen();
    expect(screen.getByText(/15:40/)).toBeOnTheScreen();
  });

  it('RW-3b · 이름 해소 실패로 라벨이 poiId 여도 그 텍스트가 렌더된다', () => {
    render(
      <CompareRow
        row={{ ...changeRow, beforeLabel: 'poiA', afterLabel: 'poiB' }}
      />
    );

    expect(screen.getByText('poiA')).toBeOnTheScreen();
    expect(screen.getByText('poiB')).toBeOnTheScreen();
  });
});
