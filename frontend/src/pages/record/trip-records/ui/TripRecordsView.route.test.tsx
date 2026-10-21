import { render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { TripRecordsView } from './TripRecordsView';

/**
 * TRIP-1520 · j01 풀 지도 — 계획｜실제 토글 없이 실제 경로를 계획 동선 위에 늘 겹친다(BR-U10-41 개정 · Figma u10e 4862:3807).
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
  it('TR1 실제 경로가 오면 → 누를 것 없이 점선 세그먼트 2, 토글·거리 알약 없음', () => {
    // 준비: 그날 실제 경로 세그먼트 2개 → 실행: 렌더 → 단언: 점선 2, 토글·거리 testID 0
    render(
      <TripRecordsView
        {...base}
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
    expect(screen.queryByTestId('record-map-route-toggle-plan')).toBeNull();
    expect(screen.queryByTestId('record-map-route-toggle-actual')).toBeNull();
    expect(screen.queryByTestId('record-map-route-distance')).toBeNull();
  });

  it('TR2 실제 경로가 없으면 → 레이어 0, 사유 안내 없음', () => {
    render(<TripRecordsView {...base} />);
    // 앵커: 시트 머리는 그려졌다(빈 렌더의 공허 통과 차단).
    expect(screen.getByTestId('record-trip-sheet-header')).toBeTruthy();
    expect(screen.queryAllByTestId('map-route-segment')).toHaveLength(0);
    expect(screen.queryByTestId('record-map-route-disabled-reason')).toBeNull();
  });
});
