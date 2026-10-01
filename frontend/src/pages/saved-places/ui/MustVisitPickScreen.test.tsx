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
 *  - **CS-11 (TRIP-1042 AC-2 · BR-U1-58 ②)** 지역 밖은 머리글 아래 보이되 **흐리고 고를 수 없다** —
 *    체크가 없고 행이 disabled 다(TRIP-1012 A4 "밖도 고를 수 있다"를 뒤집음). 밖 행엔 순번이 없다(TRIP-1106 결정 1-A).
 *  - **CS-16 (TRIP-1106 AC-1·2)** 이미 선택된 밖 행은 채운 체크로 보이고 누르면 해제 콜백이 나간다 — 흐림은 그대로.
 *  - **CS-13 (TRIP-1042 AC-4)** 지역 안이 0건이면 results 얼굴 목록 머리에 region-empty 블록(제목 + CTA,
 *    삽화 없음)이 끼고 '+ 탐색에서 더 담기' 행은 빠진다. CTA 는 더 담기 콜백을 올린다.
 *  - **CS-14 (TRIP-1042 AC-9)** 행 위치는 페이지가 준 표기(`부산 사하구`)를 쓰고, 없으면 `place.region`.
 *
 * 왜 화면 단위인가: 재는 것은 "props 를 받았을 때 무엇을 그리는가"다. 실제 나간 시드·라우팅은
 * `pages/saved-places/ui/SavedPlacesPage.integration.test.tsx` `select ›` 관점 몫이다. 이 화면은 훅 0(props-only)
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

/** 행과 "지역 밖" 머리글을 화면 순서대로(트리 pre-order) testID 문자열로 — 요소 배열을 통째 비교하지 않는다. */
function orderedPickIds(): string[] {
  return screen
    .queryAllByTestId(/^mustvisit-pick-(row-|region-outside$)/)
    .map((node) => String(node.props.testID));
}

describe('🔴 CS-11 · 지역 밖 목록은 머리글 한 줄 아래 흐리게, 고를 수 없게 (TRIP-1042 AC-2 · 1012 A4 반전)', () => {
  it('안 2곳 → "이 여행 지역 밖 2곳" → 밖 2곳 순이고, 밖 행은 체크 없이 disabled·흐림이며 눌러도 콜백이 없다', () => {
    const props = renderScreen({
      savedPlaces: SIX.slice(0, 2),
      outsideRegionPlaces: SIX.slice(2, 4),
      selectedPoiIds: ['p1'],
    });

    expect(orderedPickIds()).toEqual([
      'mustvisit-pick-row-p1',
      'mustvisit-pick-row-p2',
      'mustvisit-pick-region-outside',
      'mustvisit-pick-row-p3',
      'mustvisit-pick-row-p4',
    ]);

    // 머리글 — 문구 완전 일치(N=밖 개수), 새 색·크기 없이 기존 캡션 토큰.
    const header = screen.getByTestId('mustvisit-pick-region-outside');
    expect(header).toHaveTextContent('이 여행 지역 밖 2곳');
    expect(String(header.props.className)).toContain('text-caption');
    expect(String(header.props.className)).toContain('text-muted');

    // 순번은 지역 안 행에만 있다(TRIP-1106 결정 1-A — 밖 행 순번이 "선택 번호"로 읽혀 뺐다).
    [
      ['p1', '1'],
      ['p2', '2'],
    ].forEach(([poiId, rank]) => {
      expect(
        within(screen.getByTestId(`mustvisit-pick-rank-${poiId}`)).getByText(
          rank
        )
      ).toBeOnTheScreen();
    });
    ['p3', 'p4'].forEach((poiId) => {
      expect(screen.queryByTestId(`mustvisit-pick-rank-${poiId}`)).toBeNull();
    });
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 4곳 · 1곳 선택됨'
    );

    // 지역 안 — 체크가 서고 행은 열려 있다(긍정 짝).
    ['p1', 'p2'].forEach((poiId) => {
      const row = screen.getByTestId(`mustvisit-pick-row-${poiId}`);
      expect(row).not.toBeDisabled();
      expect(String(row.props.className)).not.toContain('opacity-40');
      expect(
        screen.getByTestId(`mustvisit-pick-check-${poiId}`)
      ).toBeOnTheScreen();
    });

    // 지역 밖 — 체크(버튼·두 글리프) 자체가 없고, 행이 disabled 이며 흐리다(opacity 0.4).
    ['p3', 'p4'].forEach((poiId) => {
      const row = screen.getByTestId(`mustvisit-pick-row-${poiId}`);
      expect(screen.queryByTestId(`mustvisit-pick-check-${poiId}`)).toBeNull();
      expect(
        screen.queryByTestId(`mustvisit-pick-check-filled-${poiId}`)
      ).toBeNull();
      expect(
        screen.queryByTestId(`mustvisit-pick-check-outline-${poiId}`)
      ).toBeNull();
      expect(row).toBeDisabled();
      expect(String(row.props.className)).toContain('opacity-40');
    });

    // 밖 행을 눌러도 선택 콜백이 나가지 않는다.
    fireEvent.press(screen.getByTestId('mustvisit-pick-row-p3'));
    expect(props.onToggleSelect).not.toHaveBeenCalled();
  });
});

/**
 * TRIP-1106 — 여행지를 바꾸기 전에 담아 둔 밖 항목이 선택된 채 들어오면, 그 행엔 체크를 보여 주고 해제만
 * 받는다. "선택된 것에만 체크를 그린다" 한 조건이라 해제 뒤 체크가 사라지는 것(다시 켤 수 없음)은 페이지
 * 통합 테스트(W2)가 잰다 — 이 화면은 제어형이라 스스로 바뀌지 않는다(CS-4).
 *
 * ★ 체크가 disabled 행 안에 있어 `toBeDisabled()`는 조상 때문에 늘 true 다(RNTL 이 조상까지 본다, 02a ★5).
 *   누를 수 있는지는 press → 콜백으로 잰다.
 */
describe('🔴 CS-16 · 이미 선택된 지역 밖 행은 채운 체크로 보이고 누르면 해제 콜백이 나간다 (TRIP-1106 AC-1·2·10 · Q4)', () => {
  it('p3(밖·선택)은 채운 체크+selected, p4(밖·미선택)는 체크 없음, 둘 다 순번 없음, p3 흐림 유지, 누르면 onToggleSelect(p3)', () => {
    const props = renderScreen({
      savedPlaces: SIX.slice(0, 2),
      outsideRegionPlaces: SIX.slice(2, 4),
      selectedPoiIds: ['p1', 'p3'],
    });

    // 선택된 밖 행 — 안 행과 같은 체크(버튼 + 채운 글리프 + selected).
    const outsideCheck = screen.getByTestId('mustvisit-pick-check-p3');
    expect(outsideCheck).toBeSelected();
    expect(
      screen.getByTestId('mustvisit-pick-check-filled-p3')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('mustvisit-pick-check-outline-p3')).toBeNull();

    // 선택 안 된 밖 행 — 새로 켤 수단이 없다(BR-U1-58 ②).
    expect(screen.queryByTestId('mustvisit-pick-check-p4')).toBeNull();

    // 밖 행은 순번 없음, 흐림은 그대로(Q4 — 가독성은 6-b 육안).
    ['p3', 'p4'].forEach((poiId) => {
      expect(screen.queryByTestId(`mustvisit-pick-rank-${poiId}`)).toBeNull();
    });
    expect(
      String(screen.getByTestId('mustvisit-pick-row-p3').props.className)
    ).toContain('opacity-40');

    // 부제는 페이지가 준 선택 수 그대로(밖 선택 포함 여부는 페이지가 정한다 — 결정 0).
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 4곳 · 2곳 선택됨'
    );

    fireEvent.press(outsideCheck);

    expect(props.onToggleSelect).toHaveBeenCalledTimes(1);
    expect(props.onToggleSelect).toHaveBeenCalledWith('p3');
  });
});

describe('CS-12 · 지역 밖이 0곳이면 머리글을 그리지 않는다 (TRIP-1012 · 무회귀)', () => {
  it('outsideRegionPlaces 가 비면 머리글 0개 · 행 6개 그대로다', () => {
    renderScreen({ outsideRegionPlaces: [] });

    expect(
      screen.queryAllByTestId('mustvisit-pick-region-outside')
    ).toHaveLength(0);
    expect(screen.getAllByTestId(/^mustvisit-pick-row-/)).toHaveLength(6);
  });
});

describe('🔴 CS-13 · 지역 안이 0건이면 목록 머리에 region-empty 블록 (TRIP-1042 AC-4 · Figma 4685:2646)', () => {
  it('제목·CTA 가 정확한 문구로 뜨고, 지역 밖은 흐린 행으로 이어지며, 더 담기 행은 없다', () => {
    const props = renderScreen({
      savedPlaces: [],
      outsideRegionPlaces: SIX.slice(0, 2),
      regionEmptyLabel: '부산',
      selectedPoiIds: [],
    });

    // 블록 — 제목은 Text 노드 완전 일치로 잰다(블록 전체 글자엔 CTA 가 섞여 완전 일치가 깨진다, 02a ★13).
    const block = screen.getByTestId('mustvisit-pick-region-empty');
    const title = within(block).getByText('부산에 담은 곳이 없어요');
    expect(String(title.props.className)).toContain('text-section');
    // 삽화 없음(진짜 0곳 얼굴의 콜라주와 다르다).
    expect(within(block).queryByTestId('mustvisit-pick-empty-art')).toBeNull();

    const cta = screen.getByTestId('mustvisit-pick-region-empty-browse');
    expect(cta).toHaveTextContent('탐색에서 부산 장소 담기');
    expect(String(cta.props.className)).toContain('bg-primary');

    // 그 아래 지역 밖 — 머리글 + 흐린 행 2개, 체크는 하나도 없다.
    expect(
      screen.getByTestId('mustvisit-pick-region-outside')
    ).toHaveTextContent('이 여행 지역 밖 2곳');
    expect(screen.getAllByTestId(/^mustvisit-pick-row-/)).toHaveLength(2);
    expect(screen.queryAllByTestId(/^mustvisit-pick-check-/)).toHaveLength(0);

    // CTA 가 '+ 탐색에서 더 담기' 행을 대신한다. 진짜 0곳 얼굴도 아니다.
    expect(screen.queryByTestId('mustvisit-pick-addmore')).toBeNull();
    expect(screen.queryByTestId('mustvisit-pick-empty')).toBeNull();

    // 부제·완료는 results 얼굴 그대로 — 담은 곳 2곳, 고를 수 있는 곳이 없어 완료는 닫힌다.
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 2곳 · 0곳 선택됨'
    );
    expect(screen.getByTestId('mustvisit-pick-complete')).toBeDisabled();

    fireEvent.press(cta);
    expect(props.onPressAddMore).toHaveBeenCalledTimes(1);
  });

  it('무회귀 · 라벨을 안 주면 블록이 없고 더 담기 행이 그대로 있다', () => {
    renderScreen();

    expect(screen.getByTestId('mustvisit-pick-addmore')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('mustvisit-pick-region-empty')).toHaveLength(
      0
    );
  });
});

describe('🔴 CS-14 · 행 위치는 페이지가 준 표기를 쓴다 (TRIP-1042 AC-9)', () => {
  it('p1 은 "부산 사하구", 표기를 안 준 p2 는 place.region(수영구) 그대로다', () => {
    renderScreen({ locationLabels: { p1: '부산 사하구' } });

    const first = screen.getByTestId('mustvisit-pick-row-p1');
    expect(within(first).getByText('부산 사하구')).toBeOnTheScreen();
    expect(within(first).queryByText('사하구')).toBeNull();

    const second = screen.getByTestId('mustvisit-pick-row-p2');
    expect(within(second).getByText('수영구')).toBeOnTheScreen();
  });
});

/**
 * TRIP-1093 결정 3 (01b Q3) — 여행 모드 완료가 실패하면 화면에 남아 한 줄로 알린다(INV-4 · BR-U1-55).
 *
 * 무엇을 보장하나:
 *  - `completeError` 가 있으면 `mustvisit-pick-complete-error` 배너가 **완료 버튼보다 위**(트리 순서 앞)에
 *    그 문구 그대로 뜬다. 재시도 버튼은 없다 — 완료를 다시 누르는 것이 재시도다.
 *  - 값이 없으면(`null`·미지정) 배너가 없다 — 위저드 모드 호출부는 이 prop 을 모른다.
 * 문구는 페이지가 `mustVisitFailureNotice` 로 만든다(화면은 받은 글자만 그린다).
 */
const COMPLETE_ERROR = 'mustvisit-pick-complete-error';
const FAILURE_NOTICE = '꼭 갈 곳 2곳 중 1곳을 등록하지 못했어요';

describe('🔴 CS-15 · 완료 실패 배너 (TRIP-1093 AC-11 · 01b Q3)', () => {
  it('completeError 가 있으면 배너가 완료 버튼 위에 그 문구 그대로 뜬다', () => {
    renderScreen({ selectedPoiIds: ['p1'], completeError: FAILURE_NOTICE });

    expect(screen.queryAllByTestId(COMPLETE_ERROR).length).toBe(1);
    // 문자열 인자 = 정규화 후 완전 일치(02a §5).
    expect(screen.getByTestId(COMPLETE_ERROR)).toHaveTextContent(
      FAILURE_NOTICE
    );

    const order = screen
      .queryAllByTestId(/^mustvisit-pick-complete(-error)?$/)
      .map((node) => String(node.props.testID));
    expect(order).toEqual([COMPLETE_ERROR, 'mustvisit-pick-complete']);
  });

  it.each([
    ['null', null],
    ['미지정', undefined],
  ])('completeError 가 %s 이면 배너가 없다 (선제 green)', (_label, value) => {
    renderScreen({ selectedPoiIds: ['p1'], completeError: value });

    // 앵커 — 결과 얼굴의 완료 버튼은 떴다(공허 통과 방지).
    expect(screen.getByTestId('mustvisit-pick-complete')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(COMPLETE_ERROR).length).toBe(0);
  });
});
