import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import type { ActualRouteView } from '../model/actualDistance';
import type { MapPeekView } from '../model/mapPeek';
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

// TRIP-397(재정합) 신규 — 사전 도출된 peek(부모가 buildMapPeek 로 만들어 주입, 02aB ★1).
const peek: MapPeekView = {
  remainingCount: 2,
  now: { name: '광안리 해변' },
  next: { name: '부산시립미술관' },
};

const base = {
  slots: [slot('a', 35.15, 129.11), slot('b', 35.16, 129.12)],
  toggle: 'plan' as const,
  onToggle: jest.fn(),
  actualRoute: disabledRoute,
  // 신규 prop — 구코드는 무시하므로 M1~M6(보존 앵커)에 무영향.
  peek,
  onPressFullItinerary: jest.fn(),
};

// className 은 NativeWind 가 렌더 트리에 평문 prop 으로 남긴다(LiveItineraryScreen.test 선례).
// 공백으로 쪼갠 토큰 배열로 원소 일치(toContain)로 스타일을 잰다.
function classTokens(node: { props?: { className?: unknown } }): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.split(/\s+/).filter(Boolean) : [];
}

describe('LiveMapScreen', () => {
  // ── 보존(회귀 앵커) — 단언 무변경, base props 확장만 ──────────────────────
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
    expect(
      screen.getByTestId('execution-map-actual-disabled')
    ).toHaveTextContent(disabledRoute.reason as string);
    expect(screen.queryByTestId('execution-map-actual-distance')).toBeNull();
  });

  it('M6 각주 "앱을 켜 둔 구간만 기록돼요"를 항상 그린다 (BR-U4-41)', () => {
    render(<LiveMapScreen {...base} />);
    expect(screen.getByTestId('execution-map-footnote')).toHaveTextContent(
      '앱을 켜 둔 구간만 기록돼요'
    );
  });

  // ── 신규(재정합) ─────────────────────────────────────────────────────────
  it('M7 토글 라벨이 "계획 동선"/"실제 경로"다 (Figma i03)', () => {
    render(<LiveMapScreen {...base} />);
    expect(screen.getByTestId('execution-map-plan-toggle')).toHaveTextContent(
      '계획 동선'
    );
    expect(screen.getByTestId('execution-map-actual-toggle')).toHaveTextContent(
      '실제 경로'
    );
  });

  it('M8 선택 토글 색이 bg-ink 가 아니라 흰색(bg-canvas) pill 이다 (Figma i03)', () => {
    render(<LiveMapScreen {...base} toggle="plan" />);
    const tokens = classTokens(screen.getByTestId('execution-map-plan-toggle'));
    expect(tokens).toContain('bg-canvas');
    expect(tokens).not.toContain('bg-ink');
  });

  it('M9 계획 뷰 peek 헤더에 "남은 N곳"(예정 슬롯 수)을 그린다 (AC-10)', () => {
    render(<LiveMapScreen {...base} toggle="plan" />);
    expect(screen.getByTestId('execution-map-peek')).toBeTruthy();
    expect(
      screen.getByTestId('execution-map-peek-remaining')
    ).toHaveTextContent('남은 2곳');
  });

  it('M10 peek 지금/다음 2행에 슬롯 이름을 그린다 (AC-10)', () => {
    render(<LiveMapScreen {...base} />);
    expect(screen.getByTestId('execution-map-peek-now')).toHaveTextContent(
      '광안리 해변'
    );
    expect(screen.getByTestId('execution-map-peek-next')).toHaveTextContent(
      '부산시립미술관'
    );
  });

  it('M11 "전체 일정 >" 링크를 누르면 전체 일정 콜백을 부른다', () => {
    const onPressFullItinerary = jest.fn();
    render(
      <LiveMapScreen {...base} onPressFullItinerary={onPressFullItinerary} />
    );
    fireEvent.press(screen.getByTestId('execution-map-peek-all'));
    expect(onPressFullItinerary).toHaveBeenCalledTimes(1);
  });

  it('M12 실제 뷰 peek — 남은곳 대신 실제 거리, 지금/다음 행은 유지 (★2 상호배타)', () => {
    render(
      <LiveMapScreen {...base} toggle="actual" actualRoute={enabledRoute} />
    );
    // actual 에선 "남은 N곳" 대신 실제 거리가 헤더를 차지한다.
    expect(screen.queryByTestId('execution-map-peek-remaining')).toBeNull();
    expect(screen.getByTestId('execution-map-actual-distance')).toBeTruthy();
    // 지금/다음 미리보기 행은 양쪽 토글 공통.
    expect(screen.getByTestId('execution-map-peek-now')).toHaveTextContent(
      '광안리 해변'
    );
  });
});
