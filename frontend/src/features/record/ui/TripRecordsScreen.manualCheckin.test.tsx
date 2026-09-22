import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';

import type { MapCenter } from '@/shared/map';

import {
  TripRecordsScreen,
  type TripRecordsScreenProps,
} from './TripRecordsScreen';

// 지도 히어로가 네이버 네이티브 MapView 를 태우므로 관찰 목으로 갈아끼운다(형제 TripRecordsScreen.test 선례).
// ⊘ 배지는 그 MapView 의 형제 absolute 오버레이라, 목이 MapView 를 Text 로 그려도 배지 View 는 그대로 뜬다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * 🔴 TRIP-761 · AC-1·AC-3 — j01 manual-checkin 얼굴의 GPS 미동의 배너 + 지도 ⊘ "GPS 자동기록 꺼짐" 배지.
 *
 * 위치 권한이 없을 때(수동 체크인 모드) 화면이 두 표면을 새로 그린다. 페이지가 `manualCheckin` boolean 을
 * 내려 스위치한다(모드 판정=페이지 몫, 화면은 무상태).
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-1  `manualCheckin` true → 배너(`record-gps-banner`) + 제목·본문 카피가 뜬다. false/미주입 → 부재.
 *  - 🔴 AC-3  `manualCheckin` true → 지도 위 ⊘ 배지(`record-map-gps-off`) + "GPS 자동기록 꺼짐" + `pointerEvents="none"`.
 *            false → 부재.
 *
 * 왜 이렇게 테스트하나(02a §4-★2·★3):
 *  - **absent 짝(무회귀)** — 배너·배지 모두 false/미주입 시 부재 단언을 짝으로 둬 "일반 모드가 안 흔들림"을 잠근다.
 *  - **⊘ 배지 pointerEvents(6-b 예방)** — 지도 오버레이 가드 3종은 TripRecordsScreen 을 스코프 밖에 둬서(brief
 *    열린질문 1) 이 배지의 "실제 지도 덮음/터치통과"는 자동 심판이 원천 부재다. `.props.pointerEvents==='none'`
 *    단언이 유일한 예방 그물(실제 덮임·픽셀·⊘ 벡터는 6-b). 계약: **testID 노드 자신**이 그 prop 을 든다.
 *
 * ★기존 TripRecordsScreen.test.tsx 는 무수정 — 이 파일은 신규 `manualCheckin` prop 만 격리해 잠근다(blast-radius).
 * ★확장타입 재대입: 프로덕션 props 엔 아직 `manualCheckin`·`onPressManualCheck` 가 없다 — 구현 코드를 만들지
 *   않으므로 확장 타입으로 재대입해 테스트만 컴파일한다(기존 `ScreenWithAttr`/`ScreenWithCopy` 선례).
 *
 * (개념) `getByTestId('문자열')`=testID 완전일치 · `queryByTestId(...)`=없으면 null(부재 단언) ·
 *   `getByText(문자열)`=단일 Text leaf 완전일치(matches exact=true, 02a §5-B) ·
 *   `.props.pointerEvents`=그 host 노드에 실린 prop 직접 판독(RNTL 13.3.3 엔 toHaveProp 매처 부재, 02a §5-A).
 */

type ScreenWithManual = TripRecordsScreenProps & {
  manualCheckin?: boolean;
  onPressManualCheck?: (poiId: string) => void;
};
const Screen = TripRecordsScreen as unknown as (
  props: ScreenWithManual
) => ReactElement;

const CENTER: MapCenter = { lat: 35.1532, lng: 129.1187 };

// 사용자 가시 카피 = 계약(brief §화면·IO 실측, Figma 1562:1816). — = EM DASH(U+2014), · = U+00B7.
const BANNER_TITLE = 'GPS 미동의 — 수동 체크인으로 기록해요';
const BANNER_BODY =
  '위치 권한이 없어 좌표·이동 경로는 자동 기록되지 않아요. 방문한 장소를 직접 선택해 기록하세요.';
const BADGE_TEXT = 'GPS 자동기록 꺼짐';

function baseProps(): TripRecordsScreenProps {
  return {
    dayTabs: [{ day: '2026-08-20', label: 'Day1' }],
    activeDay: '2026-08-20',
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

describe('🔴 TRIP-761 · AC-1 · GPS 미동의 배너', () => {
  it('A1a · manualCheckin true → 배너 + 제목·본문 카피가 뜬다', () => {
    render(<Screen {...baseProps()} manualCheckin />);

    expect(screen.getByTestId('record-gps-banner')).toBeTruthy();
    expect(screen.getByText(BANNER_TITLE)).toBeTruthy();
    expect(screen.getByText(BANNER_BODY)).toBeTruthy();
  });

  it('A1b · manualCheckin false → 배너 부재(무회귀 짝)', () => {
    render(<Screen {...baseProps()} manualCheckin={false} />);

    expect(screen.queryByTestId('record-gps-banner')).toBeNull();
    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
  });

  it('A1c · manualCheckin 미주입 → 배너 부재(기존 호출자·프리뷰 무영향)', () => {
    render(<Screen {...baseProps()} />);

    expect(screen.queryByTestId('record-gps-banner')).toBeNull();
  });
});

describe('🔴 TRIP-761 · AC-3 · 지도 ⊘ "GPS 자동기록 꺼짐" 배지', () => {
  it('A3a · manualCheckin true → 배지 + 문구 + pointerEvents="none"', () => {
    render(<Screen {...baseProps()} manualCheckin />);

    const badge = screen.getByTestId('record-map-gps-off');
    expect(badge).toBeTruthy();
    expect(screen.getByText(BADGE_TEXT)).toBeTruthy();
    // 6-b 예방(02a §4-★3) — 지도 오버레이 가드가 이 화면을 스코프 밖에 둬 이 단언이 유일 그물.
    expect(badge.props.pointerEvents).toBe('none');
  });

  it('A3b · manualCheckin false → 배지 부재(무회귀 짝)', () => {
    render(<Screen {...baseProps()} manualCheckin={false} />);

    expect(screen.queryByTestId('record-map-gps-off')).toBeNull();
    expect(screen.queryByText(BADGE_TEXT)).toBeNull();
  });
});
