import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ReactTestInstance } from 'react-test-renderer';

import { DayHighlightCard } from './DayHighlightCard';
import {
  TripSummaryScreen,
  type TripSummaryScreenProps,
} from './TripSummaryScreen';

/**
 * 호스트 노드가 "누를 수 있는 것"인가 — Pressable 은 onPress 가 없어도 호스트에 응답자 핸들러
 * (`onStartShouldSetResponder`·`onClick`)를 단다. 일반 View·Text 호스트엔 없다(02a ★6 · §5-B 실측).
 * 그래서 "눌러도 아무 일 없음"(press no-op)으로는 View 와 onPress 없는 Pressable 을 구분할 수 없다.
 */
function isTouchable(node: ReactTestInstance): boolean {
  return (
    typeof node.props.onStartShouldSetResponder === 'function' ||
    typeof node.props.onClick === 'function'
  );
}

// 실물 KakaoMapView 는 JS 키가 없는 jest 에서 map-failure 로 떨어져 center/pins 가 안 흐른다 —
// 배럴 경유 관찰 목으로 갈아끼운다(LiveMapScreen·TripRecordsScreen 선례, ★10). 목은
// `<Text testID="map-root">${lat},${lng}</Text>` 로 center 를 노출한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * TRIP-572 · AC-1·AC-2·AC-3·AC-5 — j04 요약 화면(무상태 프레젠테이션, VM 주입).
 * 조회·조립(summaryStats·resolveSummaryView·toOrderedVisitList·shareEnabled)은 페이지 몫이라
 * 여기선 완성 VM 을 props 로 넣고 렌더 계약만 잠근다(571 DailyReflectionScreen 동형).
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-1(정상): `view:'MAP'`+좌표 주입 → stats 3셀 · 지도(map-root) · 날짜카드 ≥1 이 그려진다.
 *  - 🔴 AC-2(BR-U5-39): `view:'VISIT_LIST'` → 지도 노드 부재 + 순서 방문 목록 ≥1 + 거리 셀 "—".
 *  - 🔴 AC-3(BR-U5-43): distanceSource 라벨(근사/경로)이 화면에 표기된다.
 *  - 🔴 AC-5(BR-U5-48): `shareEnabled:false` → 공유 버튼 비활성 + press 시 콜백 0회(종료·요약 전 공유 불가).
 *
 * (개념) `getByText('—')`=leaf 완전일치 · `queryByTestId`=부재 확인(getBy 는 못 찾으면 throw) ·
 *   `toBeDisabled()`=실제 disabled 판독(571·MyStaysScreen 선례) · `fireEvent.press` 는 disabled 를
 *   물리적으로 안 막으므로 콜백 0회 단언이 실질 그물.
 *
 * INV-3: 이 파일 픽스처의 place·라벨에 "N분"·"N시간"·"소요" 문자열을 두지 않는다(★9 오탐 방지).
 */

function baseProps(
  over: Partial<TripSummaryScreenProps> = {}
): TripSummaryScreenProps {
  return {
    stats: { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
    distanceSourceLabel: '근사',
    view: 'MAP',
    mapCenter: { lat: 35.1531, lng: 129.1187 },
    mapPins: [{ number: 1, lat: 35.1531, lng: 129.1187 }],
    // TRIP-764: DayCardVM shape 이관(날짜 제거 + Day1·5곳 → dayLabel·visitCountLabel 분리).
    // 이 파일의 단언은 카드 testID 존재만 보므로(내용 무단언) 이관해도 아래 it 블록은 불변·green.
    dayCards: [
      {
        key: '2026-06-11',
        dayLabel: '1일차',
        visitCountLabel: '5곳',
        subtitle: '광안리 해변→전포 카페거리',
      },
    ],
    orderedVisits: [
      { order: 1, dayLabel: 'Day1', place: '광안리 해변' },
      { order: 2, dayLabel: 'Day1', place: '감천문화마을' },
    ],
    shareEnabled: true,
    onShare: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

function renderScreen(over: Partial<TripSummaryScreenProps> = {}) {
  const props = baseProps(over);
  render(<TripSummaryScreen {...props} />);
  return props;
}

describe('🔴 AC-1 · 정상(MAP) — stats·지도·날짜카드 3영역', () => {
  it('view:MAP + 좌표 주입 시 stats·map-root·날짜카드를 그린다', () => {
    renderScreen({ view: 'MAP' });

    expect(screen.getByTestId('reflection-summary-stats')).toBeOnTheScreen();
    // 목이 center 를 텍스트로 노출한다 — 지도 히어로가 실제로 마운트됐다.
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    expect(
      screen.queryAllByTestId('reflection-summary-day-card').length
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('🔴 AC-2 · 정상(VISIT_LIST) — 위치 전무 정직 degrade (BR-U5-39)', () => {
  it('view:VISIT_LIST → 지도 부재 + 순서 방문 목록 ≥1 + 거리 셀 "—"', () => {
    renderScreen({
      view: 'VISIT_LIST',
      stats: { totalVisits: 12, distanceText: '—', totalPhotos: 24 },
      orderedVisits: [
        { order: 1, dayLabel: 'Day1', place: '광안리 해변' },
        { order: 2, dayLabel: 'Day1', place: '감천문화마을' },
        { order: 3, dayLabel: 'Day2', place: '해운대 해변' },
      ],
    });

    // 빈 지도 대신 목록 — 지도 노드가 아예 없다.
    expect(screen.queryByTestId('map-root')).toBeNull();
    expect(
      screen.queryAllByTestId('reflection-summary-visit-item').length
    ).toBeGreaterThanOrEqual(1);
    // 거리 셀은 0km 이 아니라 "—"(측정 못 함).
    expect(screen.getByText('—')).toBeOnTheScreen();
  });
});

describe('🔴 AC-3 · distanceSource 라벨 표기 (BR-U5-43)', () => {
  it('근사 라벨이 화면에 뜬다(1차는 늘 VISIT_LINE)', () => {
    renderScreen({ distanceSourceLabel: '근사' });

    expect(screen.getByText('근사')).toBeOnTheScreen();
  });
});

describe('🔴 AC-5 · 공유 진입점 비활성 (BR-U5-48)', () => {
  it('shareEnabled:false 면 공유 버튼이 비활성이고 press 해도 콜백 0회다', () => {
    const { onShare } = renderScreen({ shareEnabled: false });

    const share = screen.getByTestId('reflection-summary-share');
    expect(share).toBeDisabled();

    fireEvent.press(share);
    expect(onShare).not.toHaveBeenCalled();
  });

  it('shareEnabled:true 면 활성이고 press 시 콜백 1회다(짝)', () => {
    const { onShare } = renderScreen({ shareEnabled: true });

    const share = screen.getByTestId('reflection-summary-share');
    expect(share).not.toBeDisabled();

    fireEvent.press(share);
    expect(onShare).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 TRIP-939 AC-2b · 공유 카드가 미장전이면 진입점도 없다 (Q2 — 막다른 화면 차단)', () => {
  it('onShare 미주입(페이지가 armed:false 로 안 넘김) → 공유 버튼이 없다', () => {
    // 준비·실행: 공유 진입 콜백 없이 그린다.
    renderScreen({ onShare: undefined });

    // 단언: 공유 버튼 부재 + 짝 앵커(요약 통계는 그대로).
    expect(screen.queryByTestId('reflection-summary-share')).toBeNull();
    expect(screen.getByTestId('reflection-summary-stats')).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-939 AC-4 · 날짜 카드는 목적지가 없으면 버튼이 아니다 (A-2)', () => {
  it('화면이 카드에 onPress 를 안 넘기면 카드 루트가 누를 수 없는 요소다', () => {
    // 준비·실행: 기본 렌더(TripSummaryScreen 은 DayHighlightCard 에 onPress 를 넘기지 않는다).
    renderScreen();

    // 단언: 카드는 그려지되(앵커) 호스트가 터치 불가(Pressable 이 아닌 View).
    const card = screen.getByTestId('reflection-summary-day-card');
    expect(isTouchable(card)).toBe(false);
  });

  it('onPress 를 주면 카드가 버튼이 되고 press 시 1회(짝 — 목적지가 생기면 되살림)', () => {
    const onPress = jest.fn();
    render(
      <DayHighlightCard
        dayLabel="1일차"
        visitCountLabel="5곳"
        subtitle="광안리 해변→전포 카페거리"
        onPress={onPress}
      />
    );

    const card = screen.getByTestId('reflection-summary-day-card');
    expect(isTouchable(card)).toBe(true);
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
