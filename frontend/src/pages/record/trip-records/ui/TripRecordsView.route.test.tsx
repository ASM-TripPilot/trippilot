import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { TripRecordsView } from './TripRecordsView';

/**
 * TRIP-1343 · j01 풀 지도 계획｜실제 토글 + 실제 경로 레이어(BR-U10-41 · Figma u10e 4862:3807).
 * 지도 키가 없으면 MapView 가 실패 표면만 그리므로 키를 넣고 본다.
 */
const KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL: string | undefined;
ORIGINAL = process.env[KEY];
beforeEach(() => {
  process.env[KEY] = 'test-naver-client-id';
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[KEY];
  else process.env[KEY] = ORIGINAL;
});

type Props = ComponentProps<typeof TripRecordsView>;
const base = {
  tripTitle: '부산 여행',
  dayTabs: [{ day: '2026-06-11', label: '1일차' }],
  activeDay: '2026-06-11',
  mapCenter: { lat: 35.1, lng: 129 },
  mapPins: [],
  cards: [],
  onSelectDay: jest.fn(),
  onPressComplete: jest.fn(),
  onPressSkip: jest.fn(),
} as unknown as Props;

describe('TripRecordsView route layer', () => {
  it('TR1 경로 있음·실제 선택 → 점선 세그먼트 2 + 거리 라벨', () => {
    const onChange = jest.fn();
    render(
      <TripRecordsView
        {...base}
        routeToggle={{
          mode: 'actual',
          actualAvailable: true,
          distanceLabel: '실제 2.8km',
          onChange,
        }}
        actualRoute={[
          [
            { lat: 35.1, lng: 129 },
            { lat: 35.101, lng: 129.001 },
          ],
          [
            { lat: 35.11, lng: 129.01 },
            { lat: 35.111, lng: 129.011 },
          ],
        ]}
      />
    );
    expect(screen.getAllByTestId('map-route-segment')).toHaveLength(2);
    expect(screen.getByTestId('record-map-route-distance')).toHaveTextContent(
      '실제 2.8km'
    );
    fireEvent.press(screen.getByTestId('record-map-route-toggle-plan'));
    expect(onChange).toHaveBeenCalledWith('plan');
  });

  it('TR2 경로 없음 → 실제 비활성 + 사유, 레이어 0', () => {
    render(
      <TripRecordsView
        {...base}
        routeToggle={{
          mode: 'plan',
          actualAvailable: false,
          disabledReason: '위치 동의가 없어요',
          onChange: jest.fn(),
        }}
      />
    );
    expect(
      screen.getByTestId('record-map-route-disabled-reason')
    ).toHaveTextContent('위치 동의가 없어요');
    expect(screen.queryAllByTestId('map-route-segment')).toHaveLength(0);
  });

  it('TR3 토글 미전달(플래그 OFF) → 토글 없음', () => {
    render(<TripRecordsView {...base} />);
    expect(screen.queryByTestId('record-map-route-toggle-plan')).toBeNull();
  });
});
