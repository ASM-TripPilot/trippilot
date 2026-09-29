import { render, screen, within } from '@testing-library/react-native';

import type { MapCenter } from '@/shared/map';
import {
  closestAncestor,
  isInsideSheet,
  treeIndexOf,
} from '@/test-support/sheetTree';

import { TripRecordsView, type TripRecordsViewProps } from './TripRecordsView';

// 셸이 네이버 네이티브 MapView 를 태우므로 관찰 목으로 갈아끼운다(형제 TripRecordsView.test 선례).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * TRIP-761 · AC-1·AC-3 → TRIP-1085 AC-4 — j01 manual-checkin 얼굴의 GPS 미동의 배너 + 지도 ⊘ 배지.
 * (옛 `features/record/ui/TripRecordsScreen.manualCheckin.test.tsx` 를 옮겨 새 뷰로 렌더한다.)
 *
 * 무엇을 보장하나:
 *  - AC-1(761)  `manualCheckin` true → 배너(`record-gps-banner`) + 제목·본문 카피. false/미주입 → 부재.
 *  - AC-3(761)  true → ⊘ 배지(`record-map-gps-off`) + "GPS 자동기록 꺼짐" + testID 노드 자신이
 *               `pointerEvents="none"`. false → 부재.
 *  - 🔴 1085 AC-4 · Figma 4705:3557 — 배너는 **시트 안, 헤더 바로 아래**(헤더 < 배너 < 안내문). 배지는
 *               **시트 밖, 셸의 좌상단 일차 칩과 같은 컨테이너**(= 셸 `mapCard` 슬롯)다 — 지도 위에 새
 *               absolute 오버레이를 직접 얹지 않는다(repo-traps 지도 절: 그 경우를 지키는 소스 가드가 없다).
 *
 * ⚠️ 실제 덮임·터치 통과·dashed 테두리·색은 jest 사각(6-b). `pointerEvents` prop 이 유일한 예방 그물이다.
 *
 * (개념) `closestAncestor(node, 조건)` = 위로 올라가며 조건에 맞는 첫 조상 · `within(노드).queryByTestId`
 *   = 그 서브트리 안에서만 찾기 · `.props.pointerEvents` = 그 노드에 실린 prop 을 직접 읽기.
 */

const CENTER: MapCenter = { lat: 35.1532, lng: 129.1187 };

// 사용자 가시 카피 = 계약(Figma 1562:1816 → 4705:3557 동일). — = EM DASH(U+2014), · = U+00B7.
const BANNER_TITLE = 'GPS 미동의 — 수동 체크인으로 기록해요';
const BANNER_BODY =
  '위치 권한이 없어 좌표·이동 경로는 자동 기록되지 않아요. 방문한 장소를 직접 선택해 기록하세요.';
const BADGE_TEXT = 'GPS 자동기록 꺼짐';
const MANUAL_NOTICE =
  '수동 체크인 · 방문한 곳을 직접 선택해 기록하세요 (좌표 자동기록 비활성)';

function baseProps(): TripRecordsViewProps {
  return {
    tripTitle: '부산 여행',
    dayTabs: [{ day: '2026-08-20', label: '1일차' }],
    activeDay: '2026-08-20',
    onSelectDay: jest.fn(),
    onPressBack: jest.fn(),
    mapCenter: CENTER,
    mapPins: [],
    cards: [],
    onPressComplete: jest.fn(),
    onPressSkip: jest.fn(),
    onPressSpontaneous: jest.fn(),
  };
}

function renderView(overrides: Partial<TripRecordsViewProps> = {}) {
  render(<TripRecordsView {...baseProps()} {...overrides} />);
}

describe('🔴 TRIP-761 · AC-1 · GPS 미동의 배너', () => {
  it('A1a · manualCheckin true → 배너 + 제목·본문 카피가 뜬다', () => {
    renderView({ manualCheckin: true });

    expect(screen.getByTestId('record-gps-banner')).toBeTruthy();
    expect(screen.getByText(BANNER_TITLE)).toBeTruthy();
    expect(screen.getByText(BANNER_BODY)).toBeTruthy();
  });

  it('A1b · manualCheckin false → 배너 부재(무회귀 짝)', () => {
    renderView({ manualCheckin: false });

    expect(screen.queryByTestId('record-gps-banner')).toBeNull();
    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
  });

  it('A1c · manualCheckin 미주입 → 배너 부재(기존 호출자·프리뷰 무영향)', () => {
    renderView();

    expect(screen.queryByTestId('record-gps-banner')).toBeNull();
  });

  it('🔴 A1d · 배너는 시트 안, 헤더 바로 아래 · 안내문 위다 (1085 AC-4 · Figma 4705:3557)', () => {
    renderView({ manualCheckin: true, noticeCopy: MANUAL_NOTICE });

    const banner = screen.getByTestId('record-gps-banner');
    expect(isInsideSheet(banner)).toBe(true);

    const root = screen.UNSAFE_root;
    const header = treeIndexOf(
      root,
      screen.getByTestId('record-trip-sheet-header')
    );
    const bannerAt = treeIndexOf(root, banner);
    const notice = treeIndexOf(root, screen.getByText(MANUAL_NOTICE));
    expect(header).toBeGreaterThanOrEqual(0);
    expect(header).toBeLessThan(bannerAt);
    expect(bannerAt).toBeLessThan(notice);
  });
});

describe('🔴 TRIP-761 · AC-3 · 지도 ⊘ "GPS 자동기록 꺼짐" 배지', () => {
  it('A3a · manualCheckin true → 배지 + 문구 + pointerEvents="none"', () => {
    renderView({ manualCheckin: true });

    const badge = screen.getByTestId('record-map-gps-off');
    expect(badge).toBeTruthy();
    expect(screen.getByText(BADGE_TEXT)).toBeTruthy();
    expect(badge.props.pointerEvents).toBe('none');
  });

  it('A3b · manualCheckin false → 배지 부재(무회귀 짝)', () => {
    renderView({ manualCheckin: false });

    expect(screen.queryByTestId('record-map-gps-off')).toBeNull();
    expect(screen.queryByText(BADGE_TEXT)).toBeNull();
  });

  it('🔴 A3c · 배지는 시트 밖, 셸 좌상단 일차 칩과 같은 컨테이너(mapCard 슬롯)에 선다 (1085 AC-4)', () => {
    renderView({ manualCheckin: true });

    const badge = screen.getByTestId('record-map-gps-off');
    expect(isInsideSheet(badge)).toBe(false);

    // 위로 올라가며 셸 일차 칩 줄(sheet-daychip-root)을 품은 첫 조상 = 셸의 좌상단 오버레이 컨테이너.
    // 그 컨테이너는 셸 루트 **안**이어야 한다 — 뷰가 셸 바깥에서 absolute 로 얹으면 칩 줄을 품은 첫
    // 조상이 셸 루트 자신이나 그 위(record-trip-view)가 되어 아래 단언이 red 가 된다.
    const shellRoot = screen.getByTestId('map-sheet-shell-root');
    const overlay = closestAncestor(
      badge,
      (node) => within(node).queryByTestId('sheet-daychip-root') !== null
    );
    expect(overlay).not.toBeNull();
    const overlayInsideShell =
      overlay !== null &&
      closestAncestor(overlay, (node) => node === shellRoot) !== null;
    expect(overlayInsideShell).toBe(true);
  });
});
