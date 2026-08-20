import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

import type { ProjectedSlot } from '../model/slotProgress';
import { LiveItineraryScreen } from './LiveItineraryScreen';

// 지도 세그먼트가 LiveMapScreen→KakaoMapView 를 태우므로 관찰 목으로 갈아끼운다(배럴 경유).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

/**
 * TRIP-395 · LiveItineraryScreen(i01) — 여행 중 일정의 default 렌더 = "기록 없음" 변형.
 * 일자 칩 · 세그먼트(일정｜지도) · 타임라인. 기록이 없으면 전 슬롯이 예정으로 그려진다.
 *
 * 3동작 뼈대: 준비=days·오늘 슬롯·세그먼트 → 실행=render/press → 단언=구조·콜백.
 */

const DAYS: ItineraryDaysItem[] = [
  { date: '2026-08-20', slots: [] },
  { date: '2026-08-21', slots: [] },
];

const slotOf = (poiId: string): ProjectedSlot => ({
  state: 'upcoming',
  slot: {
    poiId,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: `장소 ${poiId}`,
    distanceRange: null,
    openingHours: null,
    tags: [],
  },
});

const baseProps = {
  days: DAYS,
  activeDayIndex: 0,
  slots: [slotOf('a'), slotOf('b')],
  segment: 'itinerary' as const,
  onSelectDay: jest.fn(),
  onSelectSegment: jest.fn(),
  toggle: 'plan' as const,
  onToggle: jest.fn(),
  actualRoute: {
    enabled: false,
    reason: '위치 권한을 켜면 기록돼요',
    distanceKm: 0,
  },
  // TRIP-395(재정합) 신규 prop — 헤더 제목(trip.title 기반)·부제(주입 문자열)·탭바 콜백.
  tripTitle: '부산 여행',
  subtitle: '6월 11일 목요일 · 오늘 일정',
  onPressTab: jest.fn(),
};

// className 은 NativeWind 가 렌더 트리에 평문 prop 으로 남긴다(SocialLoginScreen.visual 선례).
// 공백으로 쪼갠 토큰 배열로 만들어 원소 일치(toContain)로 스타일을 잰다.
function classTokens(node: { props?: { className?: unknown } }): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.split(/\s+/).filter(Boolean) : [];
}

describe('LiveItineraryScreen', () => {
  it('S1 루트·일자 칩·세그먼트 토글을 그린다', () => {
    render(<LiveItineraryScreen {...baseProps} />);
    expect(screen.getByTestId('execution-live-screen')).toBeTruthy();
    expect(screen.getByTestId('execution-live-daychip-0')).toBeTruthy();
    expect(screen.getByTestId('execution-live-daychip-1')).toBeTruthy();
    expect(screen.getByTestId('execution-live-segment-itinerary')).toBeTruthy();
    expect(screen.getByTestId('execution-live-segment-map')).toBeTruthy();
  });

  it('S2 일정 세그먼트면 오늘 슬롯을 타임라인 카드로 그린다', () => {
    render(<LiveItineraryScreen {...baseProps} />);
    expect(screen.getByTestId('execution-live-slot-2026-08-20#a')).toBeTruthy();
    expect(screen.getByTestId('execution-live-slot-2026-08-20#b')).toBeTruthy();
  });

  it('S3 지도 세그먼트면 타임라인 카드 대신 지도(LiveMapScreen)를 그린다', () => {
    render(<LiveItineraryScreen {...baseProps} segment="map" />);
    expect(screen.getByTestId('execution-live-map')).toBeTruthy();
    expect(screen.queryByTestId('execution-live-slot-2026-08-20#a')).toBeNull();
  });

  it('S8 지도 세그먼트 peek가 slots에서 도출된 "남은 N곳"을 그린다 (03bB 경고-1 배선 seam 잠금)', () => {
    // baseProps.slots = 예정 2개 → LiveItineraryScreen이 buildMapPeek로 도출해 LiveMapScreen에
    // 넘기는 그 배선 한 줄을 잠근다(도출·렌더는 각자 잠기나 그 사이 배선은 무심판이었다).
    render(<LiveItineraryScreen {...baseProps} segment="map" />);
    expect(
      screen.getByTestId('execution-map-peek-remaining')
    ).toHaveTextContent('남은 2곳');
  });

  it('S4 일자 칩·세그먼트를 누르면 콜백이 그 값으로 불린다', () => {
    const onSelectDay = jest.fn();
    const onSelectSegment = jest.fn();
    render(
      <LiveItineraryScreen
        {...baseProps}
        onSelectDay={onSelectDay}
        onSelectSegment={onSelectSegment}
      />
    );

    fireEvent.press(screen.getByTestId('execution-live-daychip-1'));
    expect(onSelectDay).toHaveBeenCalledWith(1);

    fireEvent.press(screen.getByTestId('execution-live-segment-map'));
    expect(onSelectSegment).toHaveBeenCalledWith('map');
  });

  it('S5 헤더 제목("{trip.title} · N일차")·부제(주입 문자열)를 그린다 (AC-5)', () => {
    render(
      <LiveItineraryScreen
        {...baseProps}
        activeDayIndex={1}
        tripTitle="부산 여행"
        subtitle="6월 11일 목요일 · 오늘 일정"
      />
    );
    // 제목 = "부산 여행 · 2일차"(정확 일치 — 일차 순번은 activeDayIndex+1, 화면 소유).
    expect(screen.getByTestId('execution-live-header-title')).toHaveTextContent(
      '부산 여행 · 2일차'
    );
    // 부제 = 주입 문자열 그대로(execution 안에서 new Date 안 함 — page/shared 가 포맷).
    expect(
      screen.getByTestId('execution-live-header-subtitle')
    ).toHaveTextContent('6월 11일 목요일 · 오늘 일정');
  });

  it('S6 선택 세그먼트 색이 bg-ink 가 아니라 primary 계열이다 (AC-6)', () => {
    render(<LiveItineraryScreen {...baseProps} segment="itinerary" />);
    const selected = screen.getByTestId('execution-live-segment-itinerary');
    const tokens = classTokens(selected);
    expect(tokens).toContain('bg-primary');
    expect(tokens).not.toContain('bg-ink');
  });

  it('S7 바닥에 탭바(activeKey=일정)를 그리고 탭 누름을 콜백으로 넘긴다 (AC-3)', () => {
    const onPressTab = jest.fn();
    render(<LiveItineraryScreen {...baseProps} onPressTab={onPressTab} />);

    expect(screen.getByTestId('shell-tabbar-root')).toBeTruthy();
    // 일정 탭이 활성(현재 화면이 일정) — 복제 탭바 activeKey='itinerary'.
    expect(
      screen.getByTestId('shell-tabbar-icon-itinerary-active')
    ).toBeTruthy();

    fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));
    expect(onPressTab).toHaveBeenCalledWith('home');
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-explore'));
    expect(onPressTab).toHaveBeenCalledWith('explore');
  });
});
