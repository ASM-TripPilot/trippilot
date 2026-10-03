import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { ShellTabKey } from '@/shared/ui/BottomTabBar';

import { DayHighlightCard } from './DayHighlightCard';
import {
  TripSummaryScreen,
  type TripSummaryScreenProps,
} from './TripSummaryScreen';

// 실물 KakaoMapView 는 JS 키가 없는 jest 에서 map-failure 로 떨어져 center/pins 가 안 흐른다 —
// 배럴 경유 관찰 목으로 갈아끼운다(LiveMapScreen·TripRecordsScreen 선례, ★10). 목은
// `<Text testID="map-root">${lat},${lng}</Text>` 로 center 를 노출한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

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

// ── TRIP-987 B-4·B-5 · 위치 전무 + 방문 0곳이면 빈 문구 (BR-U5-39 · INV-4 · QA #025) ──────
// "대신 방문 장소를 순서대로 보여드릴게요" 는 목록이 있을 때만 참이다 — 0곳이면 그 문장 대신 빈 문구를
// 그린다. 문구 "기록된 방문 장소가 없어요" 는 정본·Figma 출처가 없다(Seed Q5, 학습 검토 표시).

const INSTEAD = '대신 방문 장소를 순서대로 보여드릴게요';

const NO_LOCATION = '위치 기록이 없어 지도를 표시할 수 없어요';

describe('🔴 TRIP-987 B-4 · 방문 0곳이면 문장 아래가 비지 않는다', () => {
  it('VISIT_LIST + orderedVisits=[] → "대신…" 문장 없음 · 빈 문구 있음 · 위치 없음 박스는 그대로', () => {
    renderScreen({
      view: 'VISIT_LIST',
      stats: { totalVisits: 0, distanceText: '—', totalPhotos: 0 },
      dayCards: [],
      orderedVisits: [],
    });

    expect(screen.getByText(NO_LOCATION)).toBeOnTheScreen();
    expect(screen.queryByText(INSTEAD)).toBeNull();
    expect(
      screen.getByTestId('reflection-summary-visit-empty')
    ).toHaveTextContent('기록된 방문 장소가 없어요');
    expect(
      screen.queryAllByTestId('reflection-summary-visit-item')
    ).toHaveLength(0);
  });
});

describe('🟢 TRIP-987 B-5 · 방문이 있으면 지금 그대로(회귀 앵커)', () => {
  it('VISIT_LIST + 방문 3곳 → "대신…" 문장과 행 3개, 빈 문구 없음', () => {
    renderScreen({
      view: 'VISIT_LIST',
      stats: { totalVisits: 3, distanceText: '—', totalPhotos: 0 },
      orderedVisits: [
        { order: 1, dayLabel: '1일차', place: '광안리 해변' },
        { order: 2, dayLabel: '1일차', place: '감천문화마을' },
        { order: 3, dayLabel: '2일차', place: '해운대 해변' },
      ],
    });

    expect(screen.getByText(INSTEAD)).toBeOnTheScreen();
    expect(screen.getAllByTestId('reflection-summary-visit-item')).toHaveLength(
      3
    );
    expect(screen.queryByTestId('reflection-summary-visit-empty')).toBeNull();
  });
});

describe('Figma 정합 — 지도 캡션·2톤 카드·방문행 라벨·바텀탭', () => {
  // TRIP-764 (옛 TripSummaryScreen.parity.test.tsx)
  /**
   * TRIP-764 · j04 여행 요약 default·error **Figma 정합**(순수 프레젠테이션) — 지도 캡션·일차 카드
   * 2톤·순서목록 라벨·바텀탭. 조회·조립은 페이지 몫이라 여긴 완성 VM 을 props 로 넣고 렌더 계약만
   * 잠근다(위 TRIP-572 묶음(AC-1·2·3·5)과 형제 — 그 묶음은 무편집).
   *
   * ★ 신 계약(구현 전이라 프로덕션 타입엔 아직 없다) — 테스트만 캐스팅으로 표현하고 구현자가 채운다
   *   (선례 `DailyReflectionScreen.test` 의 3얼굴·default 묶음 ExtendedProps):
   *   ① DayCardVM shape 변경: `{dateLabel,countLabel}` → `{dayLabel,visitCountLabel}`(날짜 제거·2톤 분리).
   *   ② `onPressTab?` prop 신설(하단 BottomTabBar 배선, j03 동형).
   *
   * 무엇을 보장하나(승인 계약):
   *  - 🔴 AC-2(지도 캡션): MAP 얼굴에 `코랄 선 = 이동 경로 · 숙 = 거점 숙소` 가 뜨고, VISIT_LIST 엔 없다.
   *  - 🔴 AC-3(2톤 카드): 카드가 `1일차`(완전일치=자기 Text)와 `5곳`(별도 Text)을 그리고 날짜는 없다.
   *  - 🟢 AC-4(방문라벨 구조 앵커): 방문 행이 `1일차`+장소명(별도 Text)이고 옛 `Day1` 은 없다.
   *  - 🔴 AC-6(바텀탭): 양 얼굴에 BottomTabBar(records 활성) + 탭 press → onPressTab(key) 1회.
   *
   * (개념) `getByText('문자열')`=host Text **완전 일치**(정규화 후 전체 문자열 동일 — 융합 노드면 부분을
   *   못 집는다) → 2톤을 "별도 Text"로 강제 · `getByText(/정규식/)`=**부분매칭**(구분자 `· 5곳` vs `5곳`
   *   흔들림 회피) · `queryByText`=부재 확인(getBy 는 못 찾으면 throw) · `.props.accessibilityState?.selected`
   *   =선택을 색 아닌 접근성 플래그로 판독. (RNTL 13.3.3 node_modules+1런 확인, 02a §5.)
   *
   * INV-3: 이 파일 픽스처 문자열에 "N분"·"N시간"·"소요"를 두지 않는다(선재 G6′ 소스 스캔 오탐 방지).
   */

  const MAP_CAPTION = '코랄 선 = 이동 경로 · 숙 = 거점 숙소';

  // 신 계약을 테스트 로컬로 표현 — 프로덕션 `TripSummaryScreenProps` 는 안 고친다(구현자 몫).
  interface ParityDayCardVM {
    key: string;
    dayLabel: string;
    visitCountLabel: string;
    subtitle: string;
  }

  type ParityProps = Omit<TripSummaryScreenProps, 'dayCards'> & {
    dayCards: ParityDayCardVM[];
    onPressTab?: (key: ShellTabKey) => void;
  };

  const Screen = TripSummaryScreen as unknown as (
    props: ParityProps
  ) => ReactElement;

  function baseProps(over: Partial<ParityProps> = {}): ParityProps {
    return {
      stats: { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
      distanceSourceLabel: '근사',
      view: 'MAP',
      mapCenter: { lat: 35.1531, lng: 129.1187 },
      mapPins: [{ number: 1, lat: 35.1531, lng: 129.1187 }],
      dayCards: [
        {
          key: '2026-06-11',
          dayLabel: '1일차',
          visitCountLabel: '5곳',
          subtitle: '광안리 해변→전포 카페거리',
        },
      ],
      orderedVisits: [],
      shareEnabled: true,
      onShare: jest.fn(),
      onBack: jest.fn(),
      onPressTab: jest.fn(),
      ...over,
    };
  }

  function renderScreen(over: Partial<ParityProps> = {}) {
    const props = baseProps(over);
    render(<Screen {...props} />);
    return props;
  }

  const VISIT_LIST_OVER: Partial<ParityProps> = {
    view: 'VISIT_LIST',
    stats: { totalVisits: 12, distanceText: '—', totalPhotos: 24 },
    dayCards: [],
    orderedVisits: [
      { order: 1, dayLabel: '1일차', place: '광안리 해변' },
      { order: 2, dayLabel: '2일차', place: '해운대 해변' },
    ],
  };

  describe('🔴 AC-2 · 지도 캡션 — MAP 존재 ↔ VISIT_LIST 부재', () => {
    it('MAP 얼굴에 "코랄 선 = 이동 경로 · 숙 = 거점 숙소" 가 그려진다', () => {
      renderScreen({ view: 'MAP' });

      expect(screen.getByText(MAP_CAPTION)).toBeOnTheScreen();
    });

    it('VISIT_LIST 얼굴엔 캡션이 없다(짝 — 모든 얼굴에 캡션 오구현 차단)', () => {
      renderScreen(VISIT_LIST_OVER);

      expect(screen.queryByText(MAP_CAPTION)).toBeNull();
    });

    it('좌표 없는 MAP 얼굴엔 지도 자리표시도 범례도 없다 — "지도 준비 중" 제거(TRIP-939 AC-4)', () => {
      // 준비: MAP 얼굴이나 좌표 없음(hasMap=false, DayHighlight 계약상 실런타임 유일 얼굴).
      renderScreen({ view: 'MAP', mapPins: [] });

      // 단언: 가짜 자리표시("지도 준비 중")도, 없는 지도의 범례도 그리지 않는다(심사 2.1).
      expect(screen.queryByTestId('reflection-summary-map-pending')).toBeNull();
      expect(screen.queryByText(/지도 준비 중/)).toBeNull();
      expect(screen.queryByText(MAP_CAPTION)).toBeNull();
      // 짝 앵커: 날짜 카드는 그대로 그려진다(화면이 통째로 빈 것이 아니다).
      expect(
        screen.getByTestId('reflection-summary-day-card')
      ).toBeOnTheScreen();
    });
  });

  describe('🔴 AC-3 · 일차 카드 2톤·날짜줄 제거', () => {
    it('카드가 `1일차`(자기 Text)·`5곳`(별도 Text)을 그리고 날짜는 없다', () => {
      renderScreen({ view: 'MAP' });

      // 완전일치 — 융합('1일차 · 5곳' 한 노드)이면 못 집어 실패 → 별도 Text 강제.
      expect(screen.getByText('1일차')).toBeOnTheScreen();
      // 부분매칭 — 방문수는 별도 Text('· 5곳' 든 '5곳' 이든 허용).
      expect(screen.getByText(/5곳/)).toBeOnTheScreen();
      // 부재 짝 — 날짜줄 제거.
      expect(screen.queryByText('6월 11일 목요일')).toBeNull();
      // testID 유지.
      expect(
        screen.getByTestId('reflection-summary-day-card')
      ).toBeOnTheScreen();
    });
  });

  describe('🟢 AC-4 · 순서목록 방문행 라벨(구조 앵커 · 행위 red 는 AC-1 모델)', () => {
    it('방문 행이 `N일차`+장소명(별도 Text)이고 옛 `Day1` 은 없다', () => {
      renderScreen(VISIT_LIST_OVER);

      // 라벨·장소가 각각 자기 Text — 융합/하드코딩 'Day' 접두를 차단.
      expect(screen.getByText('1일차')).toBeOnTheScreen();
      expect(screen.getByText('2일차')).toBeOnTheScreen();
      expect(screen.getByText('광안리 해변')).toBeOnTheScreen();
      expect(screen.getByText('해운대 해변')).toBeOnTheScreen();
      // 부재 짝 — 영문 라벨 소멸.
      expect(screen.queryByText('Day1')).toBeNull();
      expect(screen.queryByText('Day2')).toBeNull();
      // reflection testID 유지(record testID 아님 = features 경계).
      expect(
        screen.queryAllByTestId('reflection-summary-visit-item').length
      ).toBeGreaterThanOrEqual(2);
    });
  });

  describe('🔴 AC-6 · 바텀탭(records 활성 + onPressTab 배선)', () => {
    it.each([['MAP'], ['VISIT_LIST']] as const)(
      '%s 얼굴에 탭바가 뜨고 기록 탭이 활성이다',
      (view) => {
        renderScreen(view === 'MAP' ? { view: 'MAP' } : VISIT_LIST_OVER);

        expect(screen.getByTestId('shell-tabbar-root')).toBeOnTheScreen();
        expect(
          screen.getByTestId('shell-tabbar-tab-records').props
            .accessibilityState?.selected
        ).toBe(true);
      }
    );

    it('다른 탭 press → onPressTab 을 그 키로 1회 부른다', () => {
      const { onPressTab } = renderScreen({ view: 'MAP' });

      fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));

      expect(onPressTab).toHaveBeenCalledTimes(1);
      expect(onPressTab).toHaveBeenCalledWith('home');
    });
  });
});
