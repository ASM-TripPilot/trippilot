import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import {
  MustVisitPickScreen,
  type MustVisitPickScreenProps,
} from './MustVisitPickScreen';

/**
 * TRIP-706 [d02] select 모드 화면 `MustVisitPickScreen` — **렌더 계약**(props-only 순수 뷰).
 *
 * 무엇을 보장하나:
 *  - **CS-1 (AC-7)** 6곳이면 순번 1..6 + 이름·지역구·태그 + 체크 토글이 행마다 선다.
 *  - **CS-2 (AC-5·AC-7)** 선택/미선택은 **서로 다른 글리프 testID + `accessibilityState.selected`**로
 *    갈리고(색 fill 아님 — repo-traps §글리프), 앱바가 "M곳 선택됨"의 M 을 반영한다.
 *  - **CS-3 (AC-5)** 체크 press 는 선택/미선택 어느 쪽이든 `onToggleSelect(poiId)`를 한 번 올린다.
 *  - **CS-4 (AC-6)** 화면은 제어형이다 — press 해도 스스로 글리프를 바꾸지 않는다(내부 state 없음).
 *  - **CS-5 (AC-2)** 0곳이면 완료가 **진짜 disabled** — 눌러도 `onComplete` 0회(3단), 1곳이면 열린다.
 *  - **CS-6 (AC-8)** loading 은 스켈레톤 4행 + 더 담기 부재 + 완료 disabled(3단).
 *  - **CS-7 (AC-11)** 얼굴은 `state` 로만 갈린다 — loading 인데 목록이 6곳이어도 스켈레톤만 뜬다.
 *  - **CS-8 (AC-9)** empty 는 안내 카피(save-empty 와 다름) + 개행 + 둘러보기, 완료 바 부재.
 *  - **CS-9 (AC-10)** error 는 원형 느낌표 + 전용 카피 + 다시 시도, 완료 바 부재.
 *  - **CS-10 (AC-7)** 더 담기·뒤로가 각자의 콜백을 한 번 올린다.
 *
 * 왜 화면 단위인가: 재는 것은 "props 를 받았을 때 무엇을 그리는가"다. 실제 나간 시드·라우팅은
 * `pages/saved-places/ui/SavedPlacesPage.select.integration.test.tsx` 몫이다. 이 화면은 훅 0(props-only)
 * 이라 QueryClient·SafeAreaProvider 래퍼가 필요 없다(02a §4-5 확인).
 *
 * ★ 매처 근거(02a §5): `toBeSelected`/`toBeDisabled`=accessibilityState 읽음(RN Pressable 이 disabled
 *   prop→accessibilityState.disabled 매핑) · `toHaveTextContent(문자열)`=완전 일치(부분 아님) ·
 *   `fireEvent.press`는 accessibilityState.disabled 단독으론 안 막힘 → 3단이 진짜 disabled prop 강제.
 */

function makePlace(poiId: string, overrides: Partial<Place> = {}): Place {
  return {
    poiId,
    nameKo: `장소-${poiId}`,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '수영구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
    ...overrides,
  };
}

/** 6곳 — savedAt 오름차순이라 정렬 순 p1..p6. 대표 p1 에 지역구·태그를 실어 AC-7 을 잰다. */
const SIX: SavedPlace[] = [
  {
    savedPlaceId: 'sp-1',
    savedAt: '2026-08-01T01:00:00.000Z',
    place: makePlace('p1', {
      nameKo: '감천문화마을',
      region: '사하구',
      tags: ['골목'],
    }),
  },
  {
    savedPlaceId: 'sp-2',
    savedAt: '2026-08-01T02:00:00.000Z',
    place: makePlace('p2', { nameKo: '광안리 해변', region: '수영구' }),
  },
  {
    savedPlaceId: 'sp-3',
    savedAt: '2026-08-01T03:00:00.000Z',
    place: makePlace('p3', { nameKo: '전포 카페거리', region: '부산진구' }),
  },
  {
    savedPlaceId: 'sp-4',
    savedAt: '2026-08-01T04:00:00.000Z',
    place: makePlace('p4', { nameKo: '해운대 해변', region: '해운대구' }),
  },
  {
    savedPlaceId: 'sp-5',
    savedAt: '2026-08-01T05:00:00.000Z',
    place: makePlace('p5', { nameKo: '해동용궁사', region: '기장군' }),
  },
  {
    savedPlaceId: 'sp-6',
    savedAt: '2026-08-01T06:00:00.000Z',
    place: makePlace('p6', { nameKo: '자갈치 시장', region: '중구' }),
  },
];

function renderScreen(overrides: Partial<MustVisitPickScreenProps> = {}) {
  const props: MustVisitPickScreenProps = {
    state: { kind: 'results' },
    savedPlaces: SIX,
    selectedPoiIds: [],
    onToggleSelect: jest.fn(),
    onComplete: jest.fn(),
    onPressAddMore: jest.fn(),
    onRetry: jest.fn(),
    onPressBrowse: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  };
  render(<MustVisitPickScreen {...props} />);
  return props;
}

describe('CS-1 · results 6행 골격 (AC-7)', () => {
  it('6곳이면 순번 1..6 + 이름·지역구·태그 + 체크 토글이 행마다 선다', () => {
    renderScreen();

    // 행 6개.
    expect(screen.getAllByTestId(/^mustvisit-pick-row-/)).toHaveLength(6);

    // 순번 1..6 — 배지 안의 숫자로 잰다(줄만 세면 배지가 엉뚱한 구현을 놓친다).
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].forEach((poiId, index) => {
      expect(
        within(screen.getByTestId(`mustvisit-pick-rank-${poiId}`)).getByText(
          String(index + 1)
        )
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId(`mustvisit-pick-check-${poiId}`)
      ).toBeOnTheScreen();
    });

    // 대표 행 — 이름·지역구·태그가 없어도 숨기지 않고 있으면 그린다.
    const row = screen.getByTestId('mustvisit-pick-row-p1');
    expect(within(row).getByText('감천문화마을')).toBeOnTheScreen();
    expect(within(row).getByText('사하구')).toBeOnTheScreen();
    expect(within(row).getByText('골목')).toBeOnTheScreen();
  });
});

describe('CS-2 · 선택/미선택 split + 앱바 M 반영 (AC-5·AC-7)', () => {
  it('선택 3곳은 채운 글리프+selected, 미선택 3곳은 빈 글리프+미selected, 앱바는 3곳 선택됨', () => {
    renderScreen({ selectedPoiIds: ['p1', 'p2', 'p3'] });

    // 선택 3곳 — 채운 글리프만, accessibilityState.selected=true.
    ['p1', 'p2', 'p3'].forEach((poiId) => {
      expect(
        screen.getByTestId(`mustvisit-pick-check-filled-${poiId}`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`mustvisit-pick-check-outline-${poiId}`)
      ).toBeNull();
      expect(
        screen.getByTestId(`mustvisit-pick-check-${poiId}`)
      ).toBeSelected();
    });

    // 미선택 3곳 — 빈 글리프만, selected=false. 색 fill 이 아니라 글리프 컴포넌트로 갈린다.
    ['p4', 'p5', 'p6'].forEach((poiId) => {
      expect(
        screen.getByTestId(`mustvisit-pick-check-outline-${poiId}`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`mustvisit-pick-check-filled-${poiId}`)
      ).toBeNull();
      expect(
        screen.getByTestId(`mustvisit-pick-check-${poiId}`)
      ).not.toBeSelected();
    });

    // 앱바 서브텍스트가 선택 수(M)를 반영한다 — toHaveTextContent 는 완전 일치(02a §5-3).
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 6곳 · 3곳 선택됨'
    );
  });
});

describe('CS-3 · 체크 press → onToggleSelect(poiId) 1회 (AC-5)', () => {
  it('미선택 체크를 누르면 그 poiId 로 한 번 올린다', () => {
    const props = renderScreen({ selectedPoiIds: ['p1'] });

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p4'));

    expect(props.onToggleSelect).toHaveBeenCalledWith('p4');
    expect(props.onToggleSelect).toHaveBeenCalledTimes(1);
  });

  it('이미 선택된 체크를 눌러도 같은 콜백을 한 번 올린다(해제 의도)', () => {
    const props = renderScreen({ selectedPoiIds: ['p1'] });

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p1'));

    expect(props.onToggleSelect).toHaveBeenCalledWith('p1');
    expect(props.onToggleSelect).toHaveBeenCalledTimes(1);
  });
});

describe('CS-4 · 제어형 화면 — 자가 토글 없음 (AC-6)', () => {
  it('체크를 눌러도 화면이 스스로 글리프를 바꾸지 않는다(선택은 부모 소유)', () => {
    renderScreen({ selectedPoiIds: ['p1'] });

    // 준비 — p4 는 미선택(빈 글리프).
    expect(
      screen.getByTestId('mustvisit-pick-check-outline-p4')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p4'));

    // 콜백은 나갔지만 glyph 는 그대로 — 화면에 useState 가 없다는 증거(props 제어형).
    expect(
      screen.getByTestId('mustvisit-pick-check-outline-p4')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('mustvisit-pick-check-filled-p4')).toBeNull();
  });
});

describe('CS-5 · 0곳 완료 disabled 3단 (AC-2 화면부)', () => {
  it('선택 0곳이면 완료가 진짜 disabled — 눌러도 onComplete 0회', () => {
    const props = renderScreen({ selectedPoiIds: [] });

    const complete = screen.getByTestId('mustvisit-pick-complete');
    expect(complete).toBeDisabled();

    fireEvent.press(complete);
    expect(props.onComplete).not.toHaveBeenCalled();
  });

  it('짝 · 1곳 선택이면 활성 — 누르면 onComplete 1회', () => {
    const props = renderScreen({ selectedPoiIds: ['p1'] });

    const complete = screen.getByTestId('mustvisit-pick-complete');
    expect(complete).not.toBeDisabled();

    fireEvent.press(complete);
    expect(props.onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('CS-6 · loading 스켈레톤 4행 (AC-8)', () => {
  it('스켈레톤 4행 + 더 담기 부재 + 완료 disabled(3단)', () => {
    const props = renderScreen({
      state: { kind: 'loading' },
      savedPlaces: [],
    });

    // 정확히 4행 — 0..3 존재, 4 부재(D7 · save 6행 재사용 안 함).
    [0, 1, 2, 3].forEach((r) => {
      expect(
        screen.getByTestId(`mustvisit-pick-skeleton-row-${r}`)
      ).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('mustvisit-pick-skeleton-row-4')).toBeNull();

    // 더 담기 링크 없음(brief §90).
    expect(screen.queryByTestId('mustvisit-pick-addmore')).toBeNull();

    // 완료 비활성 — 3단(disabled + press + 0회).
    const complete = screen.getByTestId('mustvisit-pick-complete');
    expect(complete).toBeDisabled();
    fireEvent.press(complete);
    expect(props.onComplete).not.toHaveBeenCalled();
  });
});

describe('CS-7 · 얼굴은 state 로만 갈린다 (AC-11)', () => {
  it('loading 이면 목록이 6곳이어도 스켈레톤만 뜬다(길이로 재판정 안 함)', () => {
    renderScreen({ state: { kind: 'loading' }, savedPlaces: SIX });

    expect(
      screen.getByTestId('mustvisit-pick-skeleton-row-0')
    ).toBeOnTheScreen();
    // 화면이 savedPlaces.length 로 얼굴을 재도출하면 여기서 6행이 뜬다 — state 단일 출처면 0행.
    expect(screen.queryAllByTestId(/^mustvisit-pick-row-/)).toHaveLength(0);
  });
});

describe('CS-8 · empty (AC-9)', () => {
  it('안내 카피(save-empty 와 다름) + 개행 + 둘러보기, 완료 바 부재', () => {
    const props = renderScreen({ state: { kind: 'empty' }, savedPlaces: [] });

    expect(screen.getByTestId('mustvisit-pick-empty')).toBeOnTheScreen();
    expect(screen.getByText('아직 담은 곳이 없어요')).toBeOnTheScreen();

    // 서브카피 — save-empty 와 다른 select 전용 문구(내용은 완전 일치, 02a §5-3).
    const subcopy = screen.getByTestId('mustvisit-pick-empty-subcopy');
    expect(subcopy).toHaveTextContent(
      '탐색에서 마음에 드는 곳을 먼저 담아 주세요 담은 곳이 여기 모이면 꼭 갈 곳으로 고를 수 있어요'
    );
    // 개행 존재 — normalizer 가 \n 을 공백으로 접어(02a §5-3) 위 매처론 못 봐 raw children 으로 잰다.
    expect(String(subcopy.props.children)).toContain('\n');

    fireEvent.press(screen.getByTestId('mustvisit-pick-browse'));
    expect(props.onPressBrowse).toHaveBeenCalledTimes(1);

    // 하단 완료 바 없음(brief §98).
    expect(screen.queryByTestId('mustvisit-pick-complete')).toBeNull();
  });
});

describe('CS-9 · error (AC-10)', () => {
  it('원형 느낌표 + 전용 카피 + 다시 시도, 완료 바 부재', () => {
    const props = renderScreen({ state: { kind: 'error' }, savedPlaces: [] });

    expect(screen.getByTestId('mustvisit-pick-error')).toBeOnTheScreen();
    expect(screen.getByTestId('mustvisit-pick-error-icon')).toBeOnTheScreen();
    expect(screen.getByText('담은 곳을 불러오지 못했어요')).toBeOnTheScreen();
    expect(
      screen.getByText('네트워크를 확인하고 다시 시도해 주세요')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('mustvisit-pick-error-retry'));
    expect(props.onRetry).toHaveBeenCalledTimes(1);

    expect(screen.queryByTestId('mustvisit-pick-complete')).toBeNull();
  });
});

describe('CS-10 · 더 담기·뒤로 링크 (AC-7)', () => {
  it('더 담기 press → onPressAddMore, 뒤로 press → onBack', () => {
    const props = renderScreen();

    fireEvent.press(screen.getByTestId('mustvisit-pick-addmore'));
    expect(props.onPressAddMore).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('mustvisit-pick-back'));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});
