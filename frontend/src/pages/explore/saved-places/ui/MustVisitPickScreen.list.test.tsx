import { render, screen } from '@testing-library/react-native';

import type { Place, SavedPlace } from '@/shared/api/index.schemas';

import { MustVisitPickScreen } from './MustVisitPickScreen';

/**
 * TRIP-1363 — d02 select 목록은 FlatList(가상화)다. 담은 곳 100개여도 처음 보이는 행만 마운트되고,
 * 머리(지역 0건 블록)·꼬리('+ 탐색에서 더 담기')·밖 캡션 위치는 전과 같다. 선택은 Set 판정이어도 같은 결과다.
 */
function place(poiId: string): Place {
  return {
    poiId,
    nameKo: `장소-${poiId}`,
    category: '명소',
    lat: 35.1,
    lng: 129.1,
    region: '수영구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}
const saved = (n: number, prefix = 'p'): SavedPlace[] =>
  Array.from({ length: n }, (_, i) => ({
    savedPlaceId: `sp-${prefix}${i}`,
    savedAt: '2026-08-01T00:00:00.000Z',
    place: place(`${prefix}${i}`),
  }));

const noop = jest.fn();
function ui(over: Partial<React.ComponentProps<typeof MustVisitPickScreen>>) {
  return (
    <MustVisitPickScreen
      state={{ kind: 'results' }}
      savedPlaces={[]}
      selectedPoiIds={[]}
      onToggleSelect={noop}
      onComplete={noop}
      onPressAddMore={noop}
      onRetry={noop}
      onPressBrowse={noop}
      onBack={noop}
      {...over}
    />
  );
}

describe('TRIP-1363 · MustVisitPickScreen FlatList', () => {
  it('V1 · 100곳이어도 전부 마운트하지 않는다(가상화)', () => {
    render(ui({ savedPlaces: saved(100) }));
    const rows = screen.getAllByTestId(/^mustvisit-pick-row-/).length;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(100);
    expect(screen.getByTestId('mustvisit-pick-complete')).toBeTruthy();
  });

  it('V2 · 선택·잠금은 Set 판정이어도 행에 그대로 반영된다', () => {
    render(
      ui({
        savedPlaces: saved(3),
        selectedPoiIds: ['p0', 'p1'],
        lockedPoiIds: ['p1'],
      })
    );
    expect(screen.getByTestId('mustvisit-pick-check-p0')).toBeSelected();
    expect(screen.getByTestId('mustvisit-pick-check-p1')).toBeSelected();
    expect(screen.getByTestId('mustvisit-pick-check-p1')).toBeDisabled();
    expect(screen.getByTestId('mustvisit-pick-check-p2')).not.toBeSelected();
  });

  it('V3 · 밖 캡션은 안 행 다음·밖 첫 행 앞에, 꼬리 CTA 는 맨 끝에 있다', () => {
    render(ui({ savedPlaces: saved(2), outsideRegionPlaces: saved(2, 'o') }));
    expect(screen.getByTestId('mustvisit-pick-region-outside')).toBeTruthy();
    expect(screen.getByText('이 여행 지역 밖 2곳')).toBeTruthy();
    expect(screen.getByTestId('mustvisit-pick-addmore')).toBeTruthy();
    expect(screen.getAllByTestId(/^mustvisit-pick-row-/)).toHaveLength(4);
    expect(screen.queryByTestId('mustvisit-pick-rank-o0')).toBeNull();
  });

  it('V4 · 지역 안 0건이면 머리에 region-empty 블록이 서고 꼬리 CTA 는 없다', () => {
    render(
      ui({ regionEmptyLabel: '서울', outsideRegionPlaces: saved(1, 'o') })
    );
    expect(screen.getByTestId('mustvisit-pick-region-empty')).toBeTruthy();
    expect(screen.queryByTestId('mustvisit-pick-addmore')).toBeNull();
  });
});
