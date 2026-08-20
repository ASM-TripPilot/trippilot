import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import type { ActualRouteView } from '../model/actualDistance';
import { LiveMapScreen } from './LiveMapScreen';

// 실물 KakaoMapView 는 JS 키가 없는 jest 에서 map-failure 로 떨어져 center/pins 가 안 흐른다 —
// 관찰 목으로 갈아끼운다(배럴 경유 import 여야 목이 붙는다, DraftScreen 선례).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

const slot = (
  poiId: string,
  lat: number | null,
  lng: number | null
): ItineraryDaysItemSlotsItem => ({
  poiId,
  startAt: '10:00:00',
  endAt: '11:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  lat,
  lng,
  tags: [],
});

const enabledRoute: ActualRouteView = {
  enabled: true,
  reason: null,
  distanceKm: 1.24,
};
const disabledRoute: ActualRouteView = {
  enabled: false,
  reason: '위치 권한을 켜면 실제 이동 경로가 기록돼요',
  distanceKm: 0,
};

const base = {
  slots: [slot('a', 35.15, 129.11), slot('b', 35.16, 129.12)],
  toggle: 'plan' as const,
  onToggle: jest.fn(),
  actualRoute: disabledRoute,
};

describe('LiveMapScreen', () => {
  it('M1 계획 핀의 첫 좌표를 지도 center 로 주고 인터랙티브(viewOnly=false)로 띄운다', () => {
    render(<LiveMapScreen {...base} />);
    const map = screen.getByTestId('map-root');
    // 목이 center 를 텍스트로 노출한다.
    expect(map).toHaveTextContent('35.15,129.11');
    // 인터랙티브 — 제스처 차단(viewOnly)을 켜지 않는다(AC, 제스처 자체는 실기 전용).
    expect(map.props.viewOnly).not.toBe(true);
    // 좌표 있는 두 슬롯이 핀으로 흐른다.
    expect(map.props.pins).toHaveLength(2);
  });

  it('M2 계획｜실제 토글을 그리고, 누르면 그 값으로 콜백한다', () => {
    const onToggle = jest.fn();
    render(<LiveMapScreen {...base} onToggle={onToggle} />);
    expect(screen.getByTestId('execution-map-plan-toggle')).toBeTruthy();
    expect(screen.getByTestId('execution-map-actual-toggle')).toBeTruthy();

    fireEvent.press(screen.getByTestId('execution-map-actual-toggle'));
    expect(onToggle).toHaveBeenCalledWith('actual');
  });

  it('M3 계획 토글이면 실제 거리·비활성 안내를 둘 다 안 그린다', () => {
    render(<LiveMapScreen {...base} toggle="plan" />);
    expect(screen.queryByTestId('execution-map-actual-distance')).toBeNull();
    expect(screen.queryByTestId('execution-map-actual-disabled')).toBeNull();
  });

  it('M4 실제 토글 + 위치 동의 있으면 누적 실제 거리(거리만)를 그린다', () => {
    render(
      <LiveMapScreen {...base} toggle="actual" actualRoute={enabledRoute} />
    );
    expect(
      screen.getByTestId('execution-map-actual-distance')
    ).toHaveTextContent('실제 이동 1.2km');
    expect(screen.queryByTestId('execution-map-actual-disabled')).toBeNull();
  });

  it('M5 실제 토글 + 위치 동의 없으면 비활성 + 사유를 그리고 거리는 안 그린다 (BR-U4-42)', () => {
    render(
      <LiveMapScreen {...base} toggle="actual" actualRoute={disabledRoute} />
    );
    expect(screen.getByTestId('execution-map-actual-disabled')).toHaveTextContent(
      disabledRoute.reason as string
    );
    expect(screen.queryByTestId('execution-map-actual-distance')).toBeNull();
  });

  it('M6 각주 "앱을 켜 둔 구간만 기록돼요"를 항상 그린다 (BR-U4-41)', () => {
    render(<LiveMapScreen {...base} />);
    expect(screen.getByTestId('execution-map-footnote')).toHaveTextContent(
      '앱을 켜 둔 구간만 기록돼요'
    );
  });
});
