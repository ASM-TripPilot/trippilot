import { render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { LiveSlotCard } from './LiveSlotCard';

/**
 * TRIP-395 · LiveSlotCard(i01) — 여행 중 한 슬롯의 카드.
 *
 * 표면 = 상태 배지 · 계획 시각("15:00 도착 예정") · 장소명 · 영업시간 · 다음 구간 거리.
 * [방문 완료]·[사진]·[메모]는 **비활성 자리만**(BR-U4-38 — 표시하되 동작 안 함, U5 소관).
 * 각 leaf 는 값 하나만 담아 `toHaveTextContent`(완전 일치)로 읽는다(PoiSlotCard 규율 계승).
 *
 * 3동작 뼈대: 준비=슬롯+상태 → 실행=render → 단언=필드 텍스트·비활성.
 */

const DATE = '2026-08-20';
const slot = (
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem => ({
  poiId: 'poi-1',
  startAt: '15:00:00',
  endAt: '16:30:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo: '광안리 해수욕장',
  distanceRange: '약 1.2km · 도보 추정',
  openingHours: '09:00 - 21:00',
  tags: [],
  ...over,
});

const key = (poiId = 'poi-1') => `${DATE}#${poiId}`;

describe('LiveSlotCard', () => {
  it('C1 계획 시각을 "HH:mm 도착 예정"으로, 장소명·영업시간·거리를 각 leaf로 그린다', () => {
    render(<LiveSlotCard slot={slot()} date={DATE} state="upcoming" />);

    // 계획 시각 — startAt "15:00:00" → "15:00 도착 예정" (재추정 아님, 서버값 슬라이스)
    expect(
      screen.getByTestId(`execution-live-slot-time-${key()}`)
    ).toHaveTextContent('15:00 도착 예정');
    expect(
      screen.getByTestId(`execution-live-slot-name-${key()}`)
    ).toHaveTextContent('광안리 해수욕장');
    expect(
      screen.getByTestId(`execution-live-slot-hours-${key()}`)
    ).toHaveTextContent('09:00 - 21:00');
    expect(
      screen.getByTestId(`execution-live-slot-distance-${key()}`)
    ).toHaveTextContent('약 1.2km · 도보 추정');
  });

  it('C2 상태 배지가 done/active/upcoming에 따라 완료/진행 중/예정을 그린다', () => {
    const cases: Array<['done' | 'active' | 'upcoming', string]> = [
      ['done', '완료'],
      ['active', '진행 중'],
      ['upcoming', '예정'],
    ];
    for (const [state, label] of cases) {
      const { unmount } = render(
        <LiveSlotCard slot={slot()} date={DATE} state={state} />
      );
      expect(
        screen.getByTestId(`execution-live-slot-status-${key()}`)
      ).toHaveTextContent(label);
      unmount();
    }
  });

  it('C3 영업시간이 null이면 "미확인"을 그린다 (빈칸 아님)', () => {
    render(
      <LiveSlotCard
        slot={slot({ openingHours: null })}
        date={DATE}
        state="upcoming"
      />
    );
    expect(
      screen.getByTestId(`execution-live-slot-hours-${key()}`)
    ).toHaveTextContent('미확인');
  });

  it('C4 다음 구간 거리가 null이면 거리 줄이 아예 없다 (INV-3 파생 금지 · 문자열 그대로만)', () => {
    render(
      <LiveSlotCard
        slot={slot({ distanceRange: null })}
        date={DATE}
        state="upcoming"
      />
    );
    expect(
      screen.queryByTestId(`execution-live-slot-distance-${key()}`)
    ).toBeNull();
  });

  it('C5 [방문 완료]·[사진]·[메모]는 비활성 자리만이다 (BR-U4-38)', () => {
    render(<LiveSlotCard slot={slot()} date={DATE} state="upcoming" />);

    for (const role of ['visit', 'photo', 'memo']) {
      const btn = screen.getByTestId(`execution-live-slot-${role}-${key()}`);
      expect(btn).toBeDisabled();
    }
  });

  it('C6 루트 testID가 slotKey 규약({date}#{poiId})을 따른다', () => {
    render(
      <LiveSlotCard slot={slot({ poiId: 'xyz' })} date={DATE} state="active" />
    );
    expect(
      screen.getByTestId(`execution-live-slot-${key('xyz')}`)
    ).toBeTruthy();
  });
});
