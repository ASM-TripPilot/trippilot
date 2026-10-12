import { fireEvent, render, screen } from '@testing-library/react-native';

import { VisitRecordCard, type VisitRecordCardVM } from './VisitRecordCard';

/** TRIP-1340 · j01 방문 카드 '자동 기록' 칩 + 되돌리기 진입(BR-U10-29~31). manual-checkin 문구는 건드리지 않는다. */
const card = (over: Partial<VisitRecordCardVM> = {}): VisitRecordCardVM => ({
  visitCheckId: 'v1',
  slotKey: '2026-06-11#p1',
  poiId: 'p1',
  nameKo: '감천문화마을',
  arrivedAt: '2026-06-11T00:30:00Z',
  completedAt: '2026-06-11T01:30:00Z',
  skippedAt: null,
  arrivedLabel: '09:30',
  ...over,
});

describe('VisitRecordCard auto record', () => {
  it('VR1 자동 출처 → 칩 + ⋯, 누르면 visitCheckId 로 1회', () => {
    const onPressRevertAuto = jest.fn();
    render(
      <VisitRecordCard
        card={card({ autoRecorded: true })}
        onPressRevertAuto={onPressRevertAuto}
      />
    );
    expect(screen.getByTestId('record-visit-auto-badge-v1')).toHaveTextContent(
      '자동 기록'
    );
    fireEvent.press(screen.getByTestId('record-visit-auto-revert-v1'));
    expect(onPressRevertAuto).toHaveBeenCalledWith('v1');
  });

  it('VR2 수동 기록 → 칩·되돌리기 없음(콜백을 줘도)', () => {
    render(<VisitRecordCard card={card()} onPressRevertAuto={jest.fn()} />);
    expect(screen.queryByTestId('record-visit-auto-badge-v1')).toBeNull();
    expect(screen.queryByTestId('record-visit-auto-revert-v1')).toBeNull();
  });
});
