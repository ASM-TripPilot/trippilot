import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';

import type { MapCenter } from '@/shared/map';

import {
  TripRecordsScreen,
  type TripRecordsScreenProps,
} from './TripRecordsScreen';

// 지도 히어로가 KakaoMapView→WebView 를 태우므로 관찰 목으로 갈아끼운다(선례
// LiveItineraryScreen.test.tsx). 배럴 경유.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * TRIP-569 · US-REC-05 · AC-7 — j01 방문 기록 화면에 얹는 **일자별 귀속 그룹 헤더**.
 *
 * 무엇을 보장하나:
 *  - 그날을 덮는 숙소가 있으면 숙소명 + 날짜 헤더(`record-trip-attribution-stay`)가 뜬다.
 *  - 숙소가 없는 날(당일치기·이동일)은 날짜만 헤더(`record-trip-attribution-date`)가 뜬다.
 *  - 헤더·일자 탭·즉석 추가는 유지되고, 하트 FAB(`record-trip-saved-fab`)는 제거된다(TRIP-759 AC-5·AC-6).
 *
 * ★확장타입 재대입: 프로덕션 `TripRecordsScreenProps` 엔 아직 `attribution` prop 이 없다.
 *   구현 코드를 만들지 않으므로, 화면을 확장 prop 타입으로 재대입해 테스트만 컴파일한다.
 *   구현자가 이 계약(`attribution?`)을 실제 prop·헤더 렌더로 채운다.
 *
 * ★fill-함정 회피: "숙소 있음/없음"을 색·모양이 아니라 **상호배타 testID**(-stay/-date 의
 *   present/absent 짝)로 가른다 — SVG fill 변화는 심판 사각(repo 관례).
 *
 * ★매처(실검증): RNTL `getByText(문자열)` 은 완전 일치(matches.js `exact=true` → `===`).
 *   숙소명·라벨은 각자 별 `Text` leaf 라 그 노드의 전체 텍스트와 문자열이 정확히 같다.
 *   `toHaveTextContent`(형제 Text 무구분자 연결) 는 쓰지 않는다.
 */

/** 화면이 받을 완성값 — dayLabel('N일차') 조립은 페이지 몫. */
interface DayAttributionHeader {
  dayLabel: string;
  stayName?: string | null;
}
type ScreenWithAttr = TripRecordsScreenProps & {
  attribution?: DayAttributionHeader;
};
const Screen = TripRecordsScreen as unknown as (
  props: ScreenWithAttr
) => ReactElement;

const CENTER: MapCenter = { lat: 37.5665, lng: 126.978 };

function baseProps(): TripRecordsScreenProps {
  return {
    dayTabs: [
      { day: '2026-06-11', label: 'Day2' },
      { day: '2026-06-12', label: 'Day3' },
    ],
    activeDay: '2026-06-11',
    onSelectDay: jest.fn(),
    mapCenter: CENTER,
    mapPins: [],
    cards: [],
    onPressComplete: jest.fn(),
    onPressSkip: jest.fn(),
    onPressSpontaneous: jest.fn(),
    onPressBack: jest.fn(),
    onPressTab: jest.fn(),
  };
}

describe('AC-7 · 숙소 있는 날 — 숙소명 + 날짜 귀속 헤더', () => {
  it('record-trip-attribution-stay 에 숙소명·라벨이 뜨고 date-only 헤더는 없다', () => {
    render(
      <Screen
        {...baseProps()}
        attribution={{ stayName: '충무로 호텔', dayLabel: '2일차' }}
      />
    );

    expect(screen.getByTestId('record-trip-attribution-stay')).toBeTruthy();
    expect(screen.queryByTestId('record-trip-attribution-date')).toBeNull();
    expect(screen.getByText('충무로 호텔')).toBeTruthy();
    expect(screen.getByText('2일차')).toBeTruthy();
  });
});

describe('AC-7 · 숙소 없는 날 — 날짜만 헤더(당일치기·이동일)', () => {
  it('record-trip-attribution-date 에 라벨만 뜨고 숙소 헤더는 없다', () => {
    render(
      <Screen
        {...baseProps()}
        attribution={{ stayName: null, dayLabel: '3일차' }}
      />
    );

    expect(screen.getByTestId('record-trip-attribution-date')).toBeTruthy();
    expect(screen.queryByTestId('record-trip-attribution-stay')).toBeNull();
    expect(screen.getByText('3일차')).toBeTruthy();
  });
});

describe('🔴 TRIP-759 · 귀속 헤더·일자 탭·즉석 추가 유지 + 하트 FAB 제거', () => {
  it('일자 탭·즉석 추가는 헤더와 함께 남고, record-trip-saved-fab 는 사라진다', () => {
    render(
      <Screen
        {...baseProps()}
        attribution={{ stayName: '충무로 호텔', dayLabel: '2일차' }}
      />
    );

    // 유지(AC-6 무회귀) — 귀속 헤더가 딸린 채로도 탭·즉석 추가는 그대로.
    expect(screen.getByTestId('record-trip-day-tab-2026-06-11')).toBeTruthy();
    expect(screen.getByTestId('record-trip-spontaneous-add')).toBeTruthy();
    // 제거(AC-5) — 하트 FAB 는 Figma 정본에 없다 → present→absent 로 반전.
    // (개념) `queryByTestId(...)` = 없으면 null → `.toBeNull()` 로 부재를 단언.
    expect(screen.queryByTestId('record-trip-saved-fab')).toBeNull();
  });
});
