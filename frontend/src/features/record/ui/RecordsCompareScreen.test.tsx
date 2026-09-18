import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CompareRow as CompareRowVM } from '../model/compareRows';
import {
  RecordsCompareScreen,
  type RecordsCompareScreenProps,
} from './RecordsCompareScreen';

/**
 * TRIP-570 · AC-1·AC-8 · j02 기록 비교 화면(무상태 프레젠테이션, VM 주입 — j04
 * `TripSummaryScreen.test` 동형). 조회·조립은 페이지 몫이라 여기선 완성 VM 을 props 로 넣고 렌더
 * 계약만 잠근다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 SC-1(AC-1 정상): 세그 + 행목록 + 지도 degrade 자리표시(record-compare-map-pending).
 *    ★지도 실렌더 단언 0 — KakaoMapView 폴리라인·핀은 jest 원리적 사각(repo-traps).
 *  - 🔴 SC-2(필터 아님): 활성 탭이 'actual' 이어도 리스트는 actual+unvisited+change 전 행을 표시
 *    (01b·Figma — 세그는 지도 레이어 강조 토글이지 리스트 필터가 아니다).
 *  - 🔴 SC-3/4(AC-8 귀속): baseStayName 있으면 숙소 헤더(-stay), null 이면 날짜 헤더(-date), 상호배타.
 *  - 🔴 SC-5: 뒤로 press → onBack 1회.
 *
 * (개념) `queryAllByTestId(id).length` = 그 testID 노드 개수(0 이어도 throw 안 함) ·
 *   `queryByTestId` = 부재 확인(getBy 는 못 찾으면 throw) · `getByText` = leaf 완전일치.
 */

const rows: CompareRowVM[] = [
  {
    kind: 'actual',
    key: 'a1',
    date: '2026-06-11',
    poiId: 'poi1',
    placeLabel: '광안리 해변',
    timeLabel: '14:20',
  },
  {
    kind: 'unvisited',
    key: 'u1',
    date: '2026-06-11',
    poiId: 'poi9',
    placeLabel: '○○ 전망대',
  },
  {
    kind: 'change',
    key: 'c1',
    date: '2026-06-11',
    beforeLabel: '△△ 카페',
    afterLabel: '◇◇ 실내카페',
    reason: '휴무',
    timeLabel: '15:40',
    sourceType: 'PLAN_B',
  },
];

function baseProps(
  over: Partial<RecordsCompareScreenProps> = {}
): RecordsCompareScreenProps {
  return {
    activeTab: 'actual',
    onSelectTab: jest.fn(),
    rows,
    attribution: { dayLabel: '6월 11일', stayName: '해운대 A호텔' },
    onBack: jest.fn(),
    ...over,
  };
}

function renderScreen(over: Partial<RecordsCompareScreenProps> = {}) {
  const props = baseProps(over);
  render(<RecordsCompareScreen {...props} />);
  return props;
}

describe('🔴 SC-1 · 정상 — 세그 · 행목록 · 지도 degrade', () => {
  it('세그와 행목록을 그리고, 지도는 준비 중 자리표시로 접힌다', () => {
    renderScreen({ activeTab: 'actual' });

    expect(screen.getByTestId('record-compare-segment')).toBeOnTheScreen();
    expect(
      screen.queryAllByTestId('record-compare-row').length
    ).toBeGreaterThanOrEqual(1);
    // 지도 degrade — 좌표 계약 부재라 실렌더 대신 자리표시(j04 동형). map-root 단언은 안 한다.
    expect(screen.getByTestId('record-compare-map-pending')).toBeOnTheScreen();
  });
});

describe('🔴 SC-2 · 필터 아님 — 활성 탭 무관 전체 행', () => {
  it('activeTab=actual 이어도 3종 행(실제·미방문·변경) 전부를 표시한다', () => {
    renderScreen({ activeTab: 'actual' });

    expect(screen.queryAllByTestId('record-compare-row')).toHaveLength(3);
  });
});

describe('🔴 SC-3 · AC-8 귀속(숙소 있음)', () => {
  it('baseStayName 이 있으면 숙소 헤더를 그린다(날짜 헤더는 부재)', () => {
    renderScreen({
      attribution: { dayLabel: '6월 11일', stayName: '해운대 A호텔' },
    });

    expect(
      screen.getByTestId('record-compare-attribution-stay')
    ).toBeOnTheScreen();
    expect(screen.getByText('해운대 A호텔')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-compare-attribution-date')).toBeNull();
  });
});

describe('🔴 SC-4 · AC-8 귀속(숙소 null → 날짜만)', () => {
  it('stayName 이 null 이면 날짜 헤더를 그린다(숙소 헤더는 부재)', () => {
    renderScreen({ attribution: { dayLabel: '6월 11일', stayName: null } });

    expect(
      screen.getByTestId('record-compare-attribution-date')
    ).toBeOnTheScreen();
    expect(screen.getByText('6월 11일')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-compare-attribution-stay')).toBeNull();
  });
});

describe('🔴 SC-5 · 뒤로', () => {
  it('뒤로 press → onBack 1회', () => {
    const { onBack } = renderScreen();

    fireEvent.press(screen.getByTestId('record-compare-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
