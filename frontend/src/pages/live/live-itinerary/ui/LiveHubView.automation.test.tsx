import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/entities/itinerary-slot';

import { LiveHubView } from './LiveHubView';

/**
 * TRIP-1339 · i01 자동 기록 안내 1줄(BR-U10-22·46 · Figma u10c 4857:3012). 시트 헤더 위 띠 — 푸시·오류 화면 아님.
 * 3동작 뼈대: 준비=안내 prop → 실행=렌더·탭 → 단언=띠·링크.
 */
const slot: ItineraryDaysItemSlotsItem = {
  poiId: 'p1',
  startAt: '09:30:00',
  endAt: '10:30:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  alternatives: [],
  nameKo: '감천문화마을',
  distanceRange: null,
  openingHours: null,
  lat: 35.09,
  lng: 129.01,
  tags: [],
};

const base = {
  tripTitle: '부산 여행',
  days: [{ date: '2026-06-11' }],
  activeDayIndex: 0,
  slots: [{ slot, state: 'upcoming' as const }],
  onBack: jest.fn(),
  onSelectDay: jest.fn(),
  onPressManualEdit: jest.fn(),
};

describe('LiveHubView automationNotice', () => {
  it('AN1 미전달이면 띠가 없다(플래그 OFF 무회귀)', () => {
    render(<LiveHubView {...base} />);
    expect(screen.queryByTestId('execution-live-automation-notice')).toBeNull();
  });

  it('AN2 강등 안내: 제목·사유·[설정 열기] 1회 호출', () => {
    const onPressSettings = jest.fn();
    render(
      <LiveHubView
        {...base}
        automationNotice={{
          title: '자동 기록이 꺼졌어요',
          detail: "위치 권한이 '사용하는 동안'으로 바뀌었어요",
          onPressSettings,
        }}
      />
    );
    expect(
      screen.getByTestId('execution-live-automation-notice')
    ).toHaveTextContent(/자동 기록이 꺼졌어요/);
    expect(
      screen.getByTestId('execution-live-automation-notice-detail')
    ).toHaveTextContent("위치 권한이 '사용하는 동안'으로 바뀌었어요");
    fireEvent.press(
      screen.getByTestId('execution-live-automation-notice-settings')
    );
    expect(onPressSettings).toHaveBeenCalledTimes(1);
  });

  it('AN3 폐기 건수 안내는 설정 링크 없이', () => {
    render(
      <LiveHubView
        {...base}
        automationNotice={{
          title: '보내지 못한 자동 기록 2건',
          detail: '방문 기록에서 직접 남겨 주세요',
        }}
      />
    );
    expect(
      screen.queryByTestId('execution-live-automation-notice-settings')
    ).toBeNull();
  });
});
