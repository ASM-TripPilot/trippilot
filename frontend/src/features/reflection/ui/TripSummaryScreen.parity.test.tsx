import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ShellTabKey } from '@/shared/ui/BottomTabBar';

import {
  TripSummaryScreen,
  type TripSummaryScreenProps,
} from './TripSummaryScreen';

// 실물 MapView 는 JS 키 없는 jest 에서 map-failure 로 떨어져 center 가 안 흐른다 — 관찰 목으로
// 갈아끼운다(동결 `TripSummaryScreen.test.tsx` 와 동일 목, ★10). center 를 map-root 텍스트로 노출.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * TRIP-764 · j04 여행 요약 default·error **Figma 정합**(순수 프레젠테이션) — 지도 캡션·일차 카드
 * 2톤·순서목록 라벨·바텀탭. 조회·조립은 페이지 몫이라 여긴 완성 VM 을 props 로 넣고 렌더 계약만
 * 잠근다(동결 `TripSummaryScreen.test.tsx`(TRIP-572, AC-1·2·3·5) 와 형제 — 그 파일은 무편집).
 *
 * ★ 신 계약(구현 전이라 프로덕션 타입엔 아직 없다) — 테스트만 캐스팅으로 표현하고 구현자가 채운다
 *   (선례 `DailyReflectionScreen.faces.test`·`.default.test` 의 ExtendedProps):
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

  it('map-pending(좌표 없음) 얼굴엔 범례 캡션이 없다 — 없는 지도의 범례 차단(5-b 경고-1)', () => {
    // 준비: MAP 얼굴이나 좌표 없음 → 지도 대신 "지도 준비 중"(hasMap=false, DayHighlight 계약상 실런타임 유일 얼굴).
    renderScreen({ view: 'MAP', mapPins: [] });

    // 단언: 지도 준비 중 자리표시는 뜨고, 그 없는 지도의 범례는 안 뜬다.
    expect(
      screen.getByTestId('reflection-summary-map-pending')
    ).toBeOnTheScreen();
    expect(screen.queryByText(MAP_CAPTION)).toBeNull();
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
    expect(screen.getByTestId('reflection-summary-day-card')).toBeOnTheScreen();
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
        screen.getByTestId('shell-tabbar-tab-records').props.accessibilityState
          ?.selected
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
