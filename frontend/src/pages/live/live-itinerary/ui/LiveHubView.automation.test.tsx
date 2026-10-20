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

/**
 * TRIP-1486 · i01 자동 기록 스위치 줄(Figma u10f — 켜짐 4985:3306 · 일시 중지 4987:3327). 시트 헤더 안, 안내 띠와 같은 자리.
 * 3동작 뼈대: 준비=automationSwitch prop(+안내 띠) → 실행=렌더·스위치 탭 → 단언=카피·스위치 상태·콜백.
 * 스위치 줄이 서는 조건(ARMED 또는 일시 중지)은 페이지가 판정한다(통합 U6~U9) — 이 뷰는 prop 이 있으면 그린다.
 */
describe('LiveHubView automationSwitch', () => {
  const SWITCH = 'execution-live-automation-switch';

  it('AS1 미전달이면 스위치 줄이 없다(플래그 OFF 무회귀)', () => {
    render(<LiveHubView {...base} />);
    expect(
      screen.queryByTestId('execution-live-automation-switch-row')
    ).toBeNull();
    expect(screen.queryByTestId(SWITCH)).toBeNull();
  });

  it('AS2 켜짐: 제목 「자동 기록」 · 기록 중 부제 · 스위치 켜짐(접근성 이름은 제목)', () => {
    render(
      <LiveHubView
        {...base}
        automationSwitch={{ paused: false, onToggle: jest.fn() }}
      />
    );
    expect(
      screen.getByTestId('execution-live-automation-switch-title')
    ).toHaveTextContent('자동 기록');
    expect(
      screen.getByTestId('execution-live-automation-switch-detail')
    ).toHaveTextContent('여행 날짜 동안 방문과 다닌 길을 기록해요');
    const toggle = screen.getByRole('switch', { name: '자동 기록' });
    expect(toggle).toBe(screen.getByTestId(SWITCH));
    expect(toggle).toBeChecked();
  });

  it('AS3 일시 중지: 같은 제목 · 수동 [도착] 안내 부제 · 스위치 꺼짐', () => {
    render(
      <LiveHubView
        {...base}
        automationSwitch={{ paused: true, onToggle: jest.fn() }}
      />
    );
    expect(
      screen.getByTestId('execution-live-automation-switch-title')
    ).toHaveTextContent('자동 기록');
    expect(
      screen.getByTestId('execution-live-automation-switch-detail')
    ).toHaveTextContent('일시 중지했어요 · [도착]으로 직접 남겨요');
    expect(screen.getByTestId(SWITCH)).not.toBeChecked();
  });

  it('AS4 스위치를 누르면 onToggle 이 정확히 1회 불린다(켜짐·일시 중지 모두)', () => {
    const onToggle = jest.fn();
    const { rerender } = render(
      <LiveHubView {...base} automationSwitch={{ paused: false, onToggle }} />
    );
    fireEvent.press(screen.getByTestId(SWITCH));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <LiveHubView {...base} automationSwitch={{ paused: true, onToggle }} />
    );
    fireEvent.press(screen.getByTestId(SWITCH));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  // TRIP-1486 5-b W1 · 토글(46×28)이 터치 기준보다 작아 줄 전체를 누를 수 있게 했다 — 줄을 눌러도 같은 콜백이다.
  it('AS4b 스위치 줄 어디를 눌러도 onToggle 이 정확히 1회 불린다', () => {
    const onToggle = jest.fn();
    render(
      <LiveHubView {...base} automationSwitch={{ paused: false, onToggle }} />
    );
    fireEvent.press(screen.getByTestId(`${SWITCH}-row`));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('AS5 안내 띠와 스위치 줄은 함께 선다 — 띠가 위, 스위치가 아래(사용자 결정 Q6)', () => {
    render(
      <LiveHubView
        {...base}
        automationNotice={{
          title: '보내지 못한 자동 기록 2건',
          detail: '방문 기록에서 직접 남겨 주세요',
        }}
        automationSwitch={{ paused: false, onToggle: jest.fn() }}
      />
    );
    // 정규식 getAllBy 는 렌더 트리 순서(위→아래)로 돌려준다 — 두 testID 의 앞뒤를 그대로 읽는다.
    const found = screen.getAllByTestId(
      /^execution-live-automation-(notice|switch-row)$/
    );
    expect(found.map((el) => el.props.testID)).toEqual([
      'execution-live-automation-notice',
      'execution-live-automation-switch-row',
    ]);
  });
});
