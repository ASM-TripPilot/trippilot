import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { processColor } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { Place, SavedPlace } from '@/shared/api/generated/schemas';

import { optimisticSavedPlaceId } from '../model/savedPlaceIndex';
import {
  SavedPlaceListScreen,
  type SavedPlaceListScreenProps,
} from './SavedPlaceListScreen';

/**
 * A-1·A-3·A-4·A-5·A-6·A-7 · E-1~E-3 · N-2·N-3 · 01b Seed Q4·Q5·Q6·Q7·Q8·Q10·Q11
 * — d02 담은 장소 화면의 **렌더 계약**.
 *
 * 무엇을 보장하나:
 *  - **T-1 (A-1)** N곳이면 부제가 `{N}곳 · 마음에 든 순서대로`이고 행마다 순번 1..N 이 붙는다.
 *  - **T-2~T-5 (A-3·A-4·A-7 · BR-U1-06)** 지역·태그·사진·상태배지가 없어도 **행을 숨기지 않는다.**
 *  - **T-6·T-7 (A-5·A-6)** 하트와 하단 CTA 가 각자의 콜백을 정확히 한 번 올린다.
 *  - **T-8 (E-1·E-2·E-3)** 0곳이면 안내 + `장소 둘러보기`만 있고 여행 만들기 CTA 도 부제도 없다.
 *  - **T-9 (Seed Q11)** 낙관 삽입 항목의 testID 에는 **콜론이 섞인다** — 그 형태를 실제로 지나간다.
 *  - **T-10·T-11 (Seed Q6)** loading·error 얼굴이 실재하고, 실패를 "담은 게 없다"로 위장하지 않는다.
 *  - **T-12 (N-2)** 해제 실패 배너는 **목록이 남아 있어도** 보인다.
 *  - **T-13 (Seed Q7)** 게스트는 목록·빈 상태가 아니라 로그인 안내를 본다.
 *  - **T-14 (N-3 · INV-3)** 어떤 얼굴에서도 소요 시간 문자열이 나타나지 않는다.
 *
 * TRIP-1144 로 옛 `.appBar`(TRIP-1086)·`.rowtap`(TRIP-456) 두 파일을 맨 아래 `앱바`·`행 탭` describe 로 합쳤다.
 *
 * 왜 화면 단위인가: 여기서 재는 것은 "props 를 받았을 때 무엇을 그리는가"다. 실제로 나간
 * 요청·라우팅은 `pages/saved-places/ui/SavedPlacesPage.integration.test.tsx` 몫이다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 순번·행 구성·다섯 얼굴·부정 짝은 이 화면이 사는 한 유효하다.
 * **B. 이행 체크포인트 — 한시적.** 확정 문구(02a §2-5)를 리터럴로 고정한 T-8·T-10·T-11·T-13 은
 * 문구 교체에 red 를 낸다. **B 카운터 = 0.** 정당한 문구 변경이 2회 red 를 내면 testID 존재와
 * 콜백 배선만 남기고 문구 리터럴을 뗀다.
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

/** 4행 픽스처 — region null · tags 0개 · tags 2개 · imageUrl 있음/없음 · dataStatus 4값을
 * 한 목록에 흩어 둔다. 한 렌더에서 "없어도 행은 남는다"를 전부 재기 위한 배치다. */
const SAVED: SavedPlace[] = [
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
    place: makePlace('p2', {
      nameKo: '광안리 해변',
      category: '야경',
      region: '수영구',
      tags: ['야경', '산책'],
      imageUrl: 'https://cdn.example.com/p2.jpg',
      dataStatus: 'UNVERIFIED',
    }),
  },
  {
    savedPlaceId: 'sp-3',
    savedAt: '2026-08-01T03:00:00.000Z',
    place: makePlace('p3', {
      nameKo: '전포 카페거리',
      category: '카페',
      region: null,
      tags: [],
      dataStatus: 'CLOSED',
    }),
  },
  {
    savedPlaceId: 'sp-4',
    savedAt: '2026-08-01T04:00:00.000Z',
    place: makePlace('p4', {
      nameKo: '해동용궁사',
      region: '기장군',
      tags: ['사찰'],
      dataStatus: 'LOST',
    }),
  },
];

const onPressRemove = jest.fn();
const onPressRestore = jest.fn();
const onPressCreateTrip = jest.fn();
const onPressBrowse = jest.fn();
const onRetry = jest.fn();
const onPressLogin = jest.fn();
const onPressRemoveErrorAction = jest.fn();
const onBack = jest.fn();

beforeEach(() => {
  [
    onPressRemove,
    onPressRestore,
    onPressCreateTrip,
    onPressBrowse,
    onRetry,
    onPressLogin,
    onPressRemoveErrorAction,
    onBack,
  ].forEach((mock) => mock.mockClear());
});

function renderScreen(overrides: Partial<SavedPlaceListScreenProps> = {}) {
  render(
    <SavedPlaceListScreen
      savedPlaces={SAVED}
      onPressRemove={onPressRemove}
      onPressRestore={onPressRestore}
      onPressCreateTrip={onPressCreateTrip}
      onPressBrowse={onPressBrowse}
      onRetry={onRetry}
      onPressLogin={onPressLogin}
      onPressRemoveErrorAction={onPressRemoveErrorAction}
      onBack={onBack}
      {...overrides}
    />
  );
}

function itemTestIds(): string[] {
  return screen
    .queryAllByTestId(/^explore-saved-item-/)
    .map((node) => String(node.props.testID));
}

describe('T-1 · 순번 목록 (A-1)', () => {
  it('부제에 개수를 적고, 받은 순서 그대로 1..N 순번을 매긴다', () => {
    // 준비 — `state` 를 넘기지 않는다. 기본값이 `results` 라는 계약도 여기서 함께 잰다.
    renderScreen();

    // 단언 ① 부제. `getByText` 는 조각난 Text children 을 이어 붙이므로(실측), 구현이
    // `{n}곳 · …` 로 쓰든 템플릿 문자열로 쓰든 같은 단언이 통한다.
    expect(
      within(screen.getByTestId('explore-saved-subtitle')).getByText(
        '4곳 · 마음에 든 순서대로'
      )
    ).toBeOnTheScreen();

    // 단언 ② 행 순서 — 정렬은 페이지 몫이고, 화면은 받은 배열 순서를 그대로 그린다.
    expect(itemTestIds()).toEqual([
      'explore-saved-item-sp-1',
      'explore-saved-item-sp-2',
      'explore-saved-item-sp-3',
      'explore-saved-item-sp-4',
    ]);

    // 단언 ③ 순번 배지 — 이름·태그의 숫자와 섞이지 않게 전용 testID 로 잰다.
    SAVED.forEach((saved, index) => {
      expect(
        within(
          screen.getByTestId(`explore-saved-rank-${saved.savedPlaceId}`)
        ).getByText(String(index + 1))
      ).toBeOnTheScreen();
    });
  });
});

describe('T-2 · 행 구성 — 없는 정보가 행을 지우지 않는다 (A-3 · BR-U1-06)', () => {
  it('이름은 항상 나오고, region 이 null 이면 지역 줄만 빠진다', () => {
    renderScreen();

    // 긍정 — 네 행의 이름이 전부 그려진다.
    SAVED.forEach((saved) => {
      expect(screen.getByText(saved.place.nameKo)).toBeOnTheScreen();
    });

    // 긍정 — region 이 있는 행은 지역 줄이 실재하고 값이 맞다.
    expect(
      within(screen.getByTestId('explore-saved-region-sp-1')).getByText(
        '사하구'
      )
    ).toBeOnTheScreen();

    // 부정 짝 — region 이 null 인 sp-3 은 지역 줄이 없다. 그런데 **행 자체는 남아 있다**
    // (파생·부가 정보 부재가 카드를 숨기는 사유가 아니다 — BR-U1-06).
    expect(screen.queryByTestId('explore-saved-region-sp-3')).toBeNull();
    expect(screen.getByTestId('explore-saved-item-sp-3')).toBeOnTheScreen();
  });

  it('tags 가 빈 배열이면 칩만 빠지고 행은 남는다', () => {
    renderScreen();

    expect(
      within(screen.getByTestId('explore-saved-tag-sp-1')).getByText('골목')
    ).toBeOnTheScreen();

    expect(screen.queryByTestId('explore-saved-tag-sp-3')).toBeNull();
    expect(screen.getByTestId('explore-saved-item-sp-3')).toBeOnTheScreen();
  });
});

describe('T-3 · 태그 칩은 첫 1개만 (01b Seed Q10)', () => {
  it('tags 가 2개여도 칩은 하나이고 두 번째 태그는 화면에 없다', () => {
    renderScreen();

    const chips = screen.queryAllByTestId('explore-saved-tag-sp-2');
    expect(chips).toHaveLength(1);
    expect(within(chips[0]).getByText('야경')).toBeOnTheScreen();

    // 부정 짝 — 나머지 태그를 그리면 Figma 의 1줄 배치가 무너진다(미충족으로 기록된 결정).
    expect(screen.queryAllByText('산책')).toHaveLength(0);
  });
});

describe('T-4 · 썸네일 (A-4 · 계약 imageUrl nullable)', () => {
  it('imageUrl 이 있으면 사진을, 없으면 자리표시자만 두고 행은 유지한다', () => {
    renderScreen();

    // 긍정 — 계약이 준 값이 있으면 실제로 그린다.
    expect(screen.getByTestId('explore-saved-photo-sp-2')).toBeOnTheScreen();

    // 부정 짝 — NULL 이면 사진 노드가 아예 없다(클라가 URL 을 지어내면 INV-1 위반이다).
    expect(screen.queryByTestId('explore-saved-photo-sp-1')).toBeNull();
    expect(screen.getByTestId('explore-saved-item-sp-1')).toBeOnTheScreen();
  });
});

describe('T-5 · dataStatus 배지 (A-7 · 01b Seed Q8)', () => {
  it('CLOSED·UNVERIFIED·LOST 에 배지를 붙이되 항목을 숨기지 않는다', () => {
    renderScreen();

    expect(
      within(screen.getByTestId('explore-saved-badge-sp-3')).getByText('폐업')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('explore-saved-badge-sp-2')).getByText('미확인')
    ).toBeOnTheScreen();
    // LOST 는 계약이 담기 목록 포함을 말하지 않지만 enum 에 있다 — 문구를 발명하지 않고
    // UNVERIFIED 와 묶는다(01b Seed Q8).
    expect(
      within(screen.getByTestId('explore-saved-badge-sp-4')).getByText('미확인')
    ).toBeOnTheScreen();

    // 부정 짝 — ACTIVE 는 배지가 없다(전 행에 배지를 붙이는 구현을 잡는다).
    expect(screen.queryByTestId('explore-saved-badge-sp-1')).toBeNull();

    // ★ 규칙의 본체 — 배지가 붙은 행도 **전부 목록에 남아 있다**.
    expect(itemTestIds()).toHaveLength(4);
  });
});

describe('T-6 · 하트 해제 (A-5 — 화면 몫)', () => {
  it('누른 행을 그대로 올리고, 화면이 목록을 스스로 고치지 않는다', () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('explore-saved-remove-sp-2'));

    expect(onPressRemove.mock.calls).toEqual([[SAVED[1]]]);
    // 제거는 캐시(낙관 업데이트) 몫이다 — 화면이 자기 목록을 손대면 진실이 두 곳에 생긴다.
    expect(itemTestIds()).toHaveLength(4);
  });
});

describe('T-7 · 하단 CTA (A-6 · BR-U1-09 · US-SHELL-05)', () => {
  it('담은 곳이 1개 이상이면 CTA 를 노출하고 누르면 콜백이 오른다', () => {
    renderScreen();

    const cta = screen.getByTestId('explore-saved-createtrip');
    expect(within(cta).getByText('이 장소들로 여행 만들기')).toBeOnTheScreen();

    fireEvent.press(cta);

    expect(onPressCreateTrip).toHaveBeenCalledTimes(1);
  });
});

describe('T-8 · 빈 상태 (E-1·E-2·E-3 · 01b Seed Q4·Q5)', () => {
  it('안내와 둘러보기만 두고, 여행 만들기 CTA 도 부제도 그리지 않는다', () => {
    renderScreen({ savedPlaces: [], state: { kind: 'empty' } });

    const empty = screen.getByTestId('explore-saved-empty');
    // 제목·부제를 **각각** 완전 문자열로 잰다 — 한 덩어리 `toHaveTextContent` 는 완전
    // 일치라 서브트리에 버튼 라벨이 섞이는 순간 FAIL 이다(TRIP-222 ★4).
    expect(
      within(empty).getByText('마음에 드는 곳을 담아 보세요')
    ).toBeOnTheScreen();
    // TRIP-705: 서브카피가 명시 줄바꿈(\n) 2줄이다(Figma 1695:1183). 한 Text 안 \n 이라
    // getByText 는 \n 포함 정확 문자열로 잡는다. TRIP-1050: 지역 무관 문구로 바뀌었다(`부산 ` 제거).
    expect(
      within(empty).getByText(
        '인기 장소를 둘러보고 ♥로 담으면\n여기에 모여 바로 여행이 돼요'
      )
    ).toBeOnTheScreen();

    // 삽화 슬롯이 실제로 배선됐다(01b Seed Q4 ⓑ — 사진 3장 대신 벡터 콜라주).
    expect(
      within(empty).getByTestId('explore-saved-empty-art')
    ).toBeOnTheScreen();

    // CTA 는 돋보기 아이콘 + "장소 둘러보기"(Figma). 아이콘은 SVG 라 라벨로만 못 재고,
    // 버튼 서브트리에 SVG(Path) 가 실제로 있는지로 아이콘 배선을 잠근다.
    const browse = screen.getByTestId('explore-saved-browse');
    expect(within(browse).getByText('장소 둘러보기')).toBeOnTheScreen();
    expect(
      within(browse).getByTestId('explore-saved-browse-icon')
    ).toBeOnTheScreen();
    fireEvent.press(browse);
    expect(onPressBrowse).toHaveBeenCalledTimes(1);

    // 부정 짝 ① — BR-U1-09: 0개면 CTA 대신 안내다.
    expect(screen.queryByTestId('explore-saved-createtrip')).toBeNull();
    // 부정 짝 ② — 부제는 개수 파생이라 0곳에서는 그리지 않는다(Figma empty 실측).
    expect(screen.queryByTestId('explore-saved-subtitle')).toBeNull();
  });
});

describe('T-9 · 낙관 삽입 항목의 testID 에는 콜론이 섞인다 (01b Seed Q11)', () => {
  it('콜론이 든 testID 로 행과 하트를 실제로 잡는다', () => {
    const optimistic: SavedPlace = {
      savedPlaceId: optimisticSavedPlaceId('p9'),
      savedAt: '2026-08-01T05:00:00.000Z',
      place: makePlace('p9', { nameKo: '방금 담은 곳', region: '중구' }),
    };

    renderScreen({ savedPlaces: [SAVED[0], optimistic] });

    // `getByTestId(문자열)` 은 완전 일치라 콜론이 있어도 그대로 걸린다(실측: 접두를
    // 문자열로 주면 0건, 콜론 포함 전체를 주면 1건).
    expect(
      screen.getByTestId('explore-saved-item-optimistic:p9')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('explore-saved-remove-optimistic:p9'));
    expect(onPressRemove.mock.calls).toEqual([[optimistic]]);
  });

  it('배너 testID 가 하트 정규식에 물리지 않는다 (접두 충돌 자가검사)', () => {
    // 하트를 `/^explore-saved-remove-/` 로 세는 곳이 생기면, 배너를 `remove-error` 로
    // 지었을 때 개수가 조용히 부푼다(TRIP-182 F-15 · TRIP-222 ★9 와 같은 모양).
    const HEART = /^explore-saved-remove-/;

    expect(HEART.test('explore-saved-removeerror')).toBe(false);
    expect(HEART.test('explore-saved-removeerror-retry')).toBe(false);
    expect(HEART.test('explore-saved-removeerror-login')).toBe(false);
    // 긍정 짝 — 정규식이 정작 하트를 못 잡으면 위 false 3개는 공허하다.
    expect(HEART.test('explore-saved-remove-sp-1')).toBe(true);
    expect(HEART.test('explore-saved-remove-optimistic:p9')).toBe(true);
  });
});

describe('T-10 · loading 얼굴 (01b Seed Q6 · TRIP-705 Figma 3614:2032)', () => {
  it('스켈레톤 6행 + 앱바 서브텍스트 + 회색 disabled CTA, 다른 얼굴은 없다', () => {
    renderScreen({ savedPlaces: [], state: { kind: 'loading' } });

    expect(screen.getByTestId('explore-saved-loading')).toBeOnTheScreen();
    // TRIP-705: 4행 → 6행(Figma).
    expect(
      screen
        .queryAllByTestId(/^explore-saved-skeleton-/)
        .map((node) => String(node.props.testID))
    ).toEqual([
      'explore-saved-skeleton-0',
      'explore-saved-skeleton-1',
      'explore-saved-skeleton-2',
      'explore-saved-skeleton-3',
      'explore-saved-skeleton-4',
      'explore-saved-skeleton-5',
    ]);
    // 서브텍스트는 본문이 아니라 앱바로 이동했고 문구도 바뀌었다("담은 곳 불러오는 중").
    expect(
      within(screen.getByTestId('explore-saved-subtitle')).getByText(
        '담은 곳 불러오는 중'
      )
    ).toBeOnTheScreen();
    expect(screen.queryByText('담은 장소를 불러오는 중')).toBeNull();

    // CTA 는 자리를 지키되 비활성(누를 수 없다, Figma). accessibilityState.disabled 를 잠그고
    // (toBeDisabled) press 가 콜백을 안 올리는 것까지 확인한다 — RNTL 은 비활성 요소의 press 를
    // 삼킨다. (raw `disabled` prop 은 Pressable 이 host 노드에서 accessibilityState 로 흡수해
    // jest 로 직접 못 본다 — 실제 네이티브 제스처 차단은 viewOnly 계열 6-b 사각, code-critic 경고-2.)
    const cta = screen.getByTestId('explore-saved-createtrip');
    expect(cta).toBeDisabled();
    fireEvent.press(cta);
    expect(onPressCreateTrip).not.toHaveBeenCalled();

    // 부정 짝 — 두 얼굴을 동시에 보이면 사용자가 무엇이 참인지 모른다.
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
    expect(screen.queryByTestId('explore-saved-error')).toBeNull();
    expect(screen.queryByTestId('explore-saved-guest')).toBeNull();
    expect(itemTestIds()).toEqual([]);
  });
});

describe('T-11 · error 얼굴 (01b Seed Q6 · INV-4)', () => {
  it('못 불러온 것을 "담은 게 없다"로 위장하지 않는다', () => {
    renderScreen({ savedPlaces: [], state: { kind: 'error' } });

    const error = screen.getByTestId('explore-saved-error');
    expect(
      within(error).getByText('담은 장소를 불러올 수 없어요')
    ).toBeOnTheScreen();
    expect(
      within(error).getByText('잠시 후 다시 시도해 주세요')
    ).toBeOnTheScreen();

    const retry = screen.getByTestId('explore-saved-error-retry');
    expect(within(retry).getByText('다시 시도')).toBeOnTheScreen();
    fireEvent.press(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // ★ 이 부정 단언이 Seed Q6 의 본체다 — 조회 실패인데 "마음에 드는 곳을 담아 보세요"가
    // 뜨면 거짓말이고 INV-4 위반이다.
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
  });
});

describe('T-12 · 해제 실패 배너 (N-1·N-2 · 01b Seed Q9)', () => {
  const CASES = [
    {
      name: 'login 액션',
      notice: {
        message: '로그인이 풀렸어요. 다시 로그인해 주세요',
        action: 'login' as const,
      },
      actionTestId: 'explore-saved-removeerror-login',
      label: '로그인하기',
    },
    {
      name: 'retry 액션',
      notice: {
        message: '연결이 불안정해 해제하지 못했어요',
        action: 'retry' as const,
      },
      actionTestId: 'explore-saved-removeerror-retry',
      label: '다시 시도',
    },
  ];

  it.each(CASES)(
    '$name — 목록이 남아 있어도 배너가 보이고 버튼이 콜백을 올린다',
    ({ notice, actionTestId, label }) => {
      renderScreen({ removeError: notice });

      const banner = screen.getByTestId('explore-saved-removeerror');
      expect(within(banner).getByText(notice.message)).toBeOnTheScreen();

      // ★ N-2 의 본체 — 빈 목록 자리(ListEmptyComponent)에만 그리면 목록이 남아 있는 실패가
      // 화면에 아예 안 닿는다(TRIP-222 03b W-1 이 d04 에서 났던 자리).
      expect(itemTestIds()).toHaveLength(4);

      const action = screen.getByTestId(actionTestId);
      expect(within(action).getByText(label)).toBeOnTheScreen();
      fireEvent.press(action);
      expect(onPressRemoveErrorAction).toHaveBeenCalledTimes(1);
    }
  );

  it('action 이 null 이면 버튼을 그리지 않는다', () => {
    renderScreen({
      removeError: { message: '지금은 해제할 수 없는 장소예요', action: null },
    });

    // 긍정 짝 — 배너 자체는 떠 있다.
    expect(screen.getByTestId('explore-saved-removeerror')).toBeOnTheScreen();
    // 부정 — 다시 눌러도 결과가 같은 실패다. 버튼을 달면 아무 일도 안 하는 컨트롤이 된다.
    expect(screen.queryByTestId('explore-saved-removeerror-retry')).toBeNull();
    expect(screen.queryByTestId('explore-saved-removeerror-login')).toBeNull();
  });

  it('removeError 를 안 주면 배너가 없다', () => {
    renderScreen();

    expect(screen.queryByTestId('explore-saved-removeerror')).toBeNull();
    // 긍정 짝 — 화면이 죽어서 "없음"이 된 게 아니다.
    expect(itemTestIds()).toHaveLength(4);
  });
});

describe('T-13 · 미로그인 얼굴 (01b Seed Q7)', () => {
  it('게스트에게는 로딩도 빈 상태도 아닌 로그인 안내를 보인다', () => {
    // ★ `state` 를 `loading` 으로 준다. 이것이 게스트의 **실제** 상태이기 때문이다 —
    // 담은 목록 쿼리는 `enabled: isAuthed` 라, 미로그인이면 요청을 보내지 않으면서도
    // `isPending` 이 영원히 true 다(실측). 게스트 분기가 상태 판정을 이기지 않으면
    // 화면이 끝나지 않는 스켈레톤이 된다.
    renderScreen({
      isGuest: true,
      savedPlaces: [],
      state: { kind: 'loading' },
    });

    const guest = screen.getByTestId('explore-saved-guest');
    expect(
      within(guest).getByText('로그인하면 담은 장소를 볼 수 있어요')
    ).toBeOnTheScreen();
    expect(
      within(guest).getByText(
        '마음에 든 곳을 담아 두면 여행 만들기로 바로 이어져요'
      )
    ).toBeOnTheScreen();

    const login = screen.getByTestId('explore-saved-guest-login');
    expect(within(login).getByText('로그인하기')).toBeOnTheScreen();
    fireEvent.press(login);
    expect(onPressLogin).toHaveBeenCalledTimes(1);

    // 부정 짝 — 게스트는 "담은 게 없다"도 "불러오는 중"도 아니다.
    expect(screen.queryByTestId('explore-saved-loading')).toBeNull();
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
    expect(screen.queryByTestId('explore-saved-createtrip')).toBeNull();
    expect(itemTestIds()).toEqual([]);
  });
});

describe('T-14 · 소요 시간 미표시 (N-3 · INV-3)', () => {
  const FACES: {
    name: string;
    props: Partial<SavedPlaceListScreenProps>;
    anchor: string;
  }[] = [
    { name: 'results', props: {}, anchor: 'explore-saved-item-sp-1' },
    {
      name: 'empty',
      props: { savedPlaces: [], state: { kind: 'empty' } },
      anchor: 'explore-saved-empty',
    },
    {
      name: 'error',
      props: { savedPlaces: [], state: { kind: 'error' } },
      anchor: 'explore-saved-error',
    },
    {
      name: 'guest',
      props: { isGuest: true, savedPlaces: [] },
      anchor: 'explore-saved-guest',
    },
  ];

  it.each(FACES)('$name 얼굴에 시간 문자열이 없다', ({ props, anchor }) => {
    renderScreen(props);

    // 긍정 짝 — 그 얼굴이 실제로 그려졌다. 없으면 "0건"이 공허하게 통과한다.
    expect(screen.getByTestId(anchor)).toBeOnTheScreen();
    // 부정 — INV-3: 사용자에게 보이는 소요 시간은 솔버 검증값만 쓸 수 있고, 이 화면에는
    // 그 재료가 아예 없다.
    expect(screen.queryAllByText(/분|시간|소요/)).toHaveLength(0);
  });
});

/**
 * ── TRIP-394 신규 (AC-1·AC-2) ────────────────────────────────────────────
 * *(개념)* **released** — 이번 방문에서 하트를 눌러 "해제됨(빈 하트)"으로 바뀐 행.
 * 페이지가 `releasedPoiIds`(poiId 목록)로 내려 주면, 그 poiId 인 행만 빈 하트가 된다.
 *
 * *(개념)* 빈/찬 하트는 **색**(SVG fill)으로 안 잰다 — repo-trap: `*Glyphs.tsx` 의 색 변화는
 * 렌더로 안 잡혀 "저장됐다는 거짓말"이 통과한다. 대신 두 신호로 잰다:
 *   ① **컴포넌트 정체성** — 빈 하트는 `HeartOutlineGlyph`, 찬 하트는 `HeartFilledGlyph` 로
 *      **서로 다른 컴포넌트**다. 각자 다른 testID(`explore-saved-heart-outline-*` /
 *      `explore-saved-heart-filled-*`)를 달아 "어느 컴포넌트가 그려졌나"를 정체성으로 잰다.
 *   ② **accessibilityState.selected** — `toBeSelected()` 매처가 읽는 접근성 상태(담김=선택됨).
 *      d04 카드 하트가 이미 쓰는 신호를 그대로 옮긴다.
 * 하나만 맞고 하나만 틀린 구현(예: selected 는 false 인데 여전히 찬 하트를 그림)도 잡으려고
 * 둘 다 건다.
 */
describe('T-15 · released 행은 빈 하트로 남고, 아닌 행은 찬 하트다 (AC-1)', () => {
  it('빈/찬을 컴포넌트 정체성과 accessibilityState.selected 로 판별한다', () => {
    // 준비 — sp-1(p1)·sp-3(p3)만 해제(빈 하트), sp-2·sp-4 는 담김(찬 하트).
    renderScreen({ releasedPoiIds: ['p1', 'p3'] });

    // 단언 ① released 행(sp-1·sp-3): 빈 하트 컴포넌트가 있고 찬 하트는 없다 + selected=false
    ['sp-1', 'sp-3'].forEach((id) => {
      expect(
        screen.getByTestId(`explore-saved-heart-outline-${id}`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`explore-saved-heart-filled-${id}`)
      ).toBeNull();
      expect(
        screen.getByTestId(`explore-saved-remove-${id}`)
      ).not.toBeSelected();
      // ★ 규칙의 본체 — 해제됐어도 행 자체는 목록에 남는다(사라지지 않는다).
      expect(screen.getByTestId(`explore-saved-item-${id}`)).toBeOnTheScreen();
    });

    // 단언 ② 담김 행(sp-2·sp-4): 찬 하트 컴포넌트가 있고 빈 하트는 없다 + selected=true
    ['sp-2', 'sp-4'].forEach((id) => {
      expect(
        screen.getByTestId(`explore-saved-heart-filled-${id}`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`explore-saved-heart-outline-${id}`)
      ).toBeNull();
      expect(screen.getByTestId(`explore-saved-remove-${id}`)).toBeSelected();
    });
  });
});

describe('T-16 · 하트 방향이 안 섞인다 (AC-2)', () => {
  it('빈 하트는 되돌리기 콜백을, 찬 하트는 해제 콜백을 각각 한 번 올린다', () => {
    // 준비 — sp-1 만 해제(빈 하트), 나머지는 담김.
    renderScreen({ releasedPoiIds: ['p1'] });

    // 실행 ① 빈 하트(sp-1) press → 되돌리기 콜백만 오른다.
    fireEvent.press(screen.getByTestId('explore-saved-remove-sp-1'));
    expect(onPressRestore.mock.calls).toEqual([[SAVED[0]]]);
    expect(onPressRemove).not.toHaveBeenCalled();

    // 실행 ② 찬 하트(sp-2) press → 해제 콜백만 오른다(되돌리기는 안 늘어난다).
    fireEvent.press(screen.getByTestId('explore-saved-remove-sp-2'));
    expect(onPressRemove.mock.calls).toEqual([[SAVED[1]]]);
    expect(onPressRestore).toHaveBeenCalledTimes(1);
  });
});

/**
 * ── TRIP-394 신규 (AC-3 · 개수/CTA 파생) ──────────────────────────────────
 * released 행은 목록에 **남지만**, 담김이 풀린 항목이라 부제 `{N}곳` 개수와 "여행 만들기"
 * CTA 활성 판정에서는 **뺀다**(01b Seed Q1=a · BR-U1-09). 이 제외는 화면 로직이라 T-15/16
 * (하트 방향)이 못 본다 — 이 describe 가 그 파생을 직접 잠근다.
 */
describe('T-17 · released 는 목록에 남되 개수·CTA 에서 빠진다 (AC-3 파생)', () => {
  it('일부만 released 면 부제 개수가 그만큼 줄고, 행은 그대로 남는다', () => {
    // 준비 — 4곳 중 sp-2(p2) 하나만 해제. 남은 담김은 3곳.
    renderScreen({ releasedPoiIds: ['p2'] });

    // 단언 ① 부제는 released 를 뺀 3곳을 센다(제외를 지우면 '4곳'이 떠 red).
    expect(
      within(screen.getByTestId('explore-saved-subtitle')).getByText(
        '3곳 · 마음에 든 순서대로'
      )
    ).toBeOnTheScreen();
    // 단언 ② 그래도 released 행은 목록에서 사라지지 않는다(4행 그대로).
    expect(screen.getByTestId('explore-saved-item-sp-2')).toBeOnTheScreen();
    expect(itemTestIds()).toHaveLength(4);
    // 단언 ③ 아직 담김이 1곳 이상이라 CTA 는 살아 있다.
    expect(screen.getByTestId('explore-saved-createtrip')).toBeOnTheScreen();
  });

  it('전부 released 면 개수가 0 이 돼 부제·CTA 가 사라지되, 행 4개는 남는다', () => {
    // 준비 — 4곳 모두 해제. 담김 0곳.
    renderScreen({ releasedPoiIds: ['p1', 'p2', 'p3', 'p4'] });

    // 단언 ① 개수 0 → 부제 없음(제외를 지우면 '4곳'이 떠 red).
    expect(screen.queryByTestId('explore-saved-subtitle')).toBeNull();
    // 단언 ② 개수 0 → CTA 없음(담을 게 없으니 여행 만들기로 못 넘어간다).
    expect(screen.queryByTestId('explore-saved-createtrip')).toBeNull();
    // 단언 ③ 그래도 빈 상태가 아니라 4행이 빈 하트로 남는다(되돌리기 여지).
    expect(itemTestIds()).toHaveLength(4);
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
  });
});

/**
 * ── TRIP-1050 · 콜라주 빈 상태 공통 틀 (AC-1·AC-2·AC-8 · 01b Seed Q2) ─────────────
 * d02 빈 상태가 e04 와 같은 `@/shared/ui/CollageEmptyState` 로 그려진다. 틀의 세부 값은
 * `shared/ui/CollageEmptyState.test.tsx` 가 잰다 — 여기서는 d02 에 그 틀이 실제로 꽂혔는지와
 * d02 몫(문구·흰 돋보기·지역 0건 블록 무변경)만 잰다.
 */

// className 토큰 배열 — 부분 문자열 오탐을 막으려 원소로 잰다(stay 화면 테스트 헬퍼와 같은 모양).
function cls(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '').split(/\s+/);
}

// SVG 색은 host 노드(RNSVGPath·RNSVGCircle)의 `stroke.payload`(processColor 결과 정수)로 남는다.
// composite `Path` 요소의 stroke 는 원문 문자열이라 섞지 않도록 host(type 이 문자열)만 고른다.
function strokePayloads(
  node: ReturnType<typeof screen.getByTestId>
): unknown[] {
  return node
    .findAll((n) => typeof n.type === 'string' && n.props.stroke != null)
    .map((n) => n.props.stroke?.payload);
}

describe('T-18 · TRIP-1050 콜라주 빈 상태 공통 틀 (AC-1·AC-2·AC-8 · Seed Q2)', () => {
  it('d02 빈 상태가 공통 틀(위쪽 정렬 · 320 콜라주 사진 3장 · 제목 20 · CTA 52 r12)로 그려진다 (AC-1)', () => {
    renderScreen({ savedPlaces: [], state: { kind: 'empty' } });

    const root = cls(screen.getByTestId('explore-saved-empty'));
    expect(root).toContain('pt-[96px]');
    expect(root).not.toContain('justify-center');

    expect(cls(screen.getByTestId('explore-saved-empty-art'))).toContain(
      'w-[320px]'
    );
    // 공통 틀의 파생 testID — 옛 d02 콜라주(230 · rotate)에는 없던 노드다.
    expect(screen.getAllByTestId(/^explore-saved-empty-photo-/)).toHaveLength(
      3
    );
    expect(screen.getByTestId('explore-saved-empty-heart')).toBeOnTheScreen();

    expect(cls(screen.getByText('마음에 드는 곳을 담아 보세요'))).toContain(
      'text-[20px]'
    );

    const cta = cls(screen.getByTestId('explore-saved-browse'));
    expect(cta).toContain('h-[52px]');
    expect(cta).toContain('rounded-[12px]');
    expect(cta).not.toContain('rounded-[14px]');
    expect(cta).not.toContain('h-[48px]');
  });

  it('본문이 지역 무관 문구이고 `부산` 이 든 텍스트가 없다 (AC-2 · 사용자 결정)', () => {
    renderScreen({ savedPlaces: [], state: { kind: 'empty' } });

    // 긍정 — 새 본문(완전일치) · 제목 · CTA 라벨은 그대로.
    expect(
      screen.getByText(
        '인기 장소를 둘러보고 ♥로 담으면\n여기에 모여 바로 여행이 돼요'
      )
    ).toBeOnTheScreen();
    expect(screen.getByText('마음에 드는 곳을 담아 보세요')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('explore-saved-browse')).getByText(
        '장소 둘러보기'
      )
    ).toBeOnTheScreen();
    // 부정 — 정규식이라 부분 포함이다(문자열을 주면 완전일치라 공허해진다).
    expect(screen.queryAllByText(/부산/)).toHaveLength(0);
  });

  it('CTA 돋보기가 19 크기의 흰색이다 — 분홍 위 회색이 아니다 (Seed Q2 · Figma 1695:1183)', () => {
    renderScreen({ savedPlaces: [], state: { kind: 'empty' } });

    expect(screen.getByTestId('explore-saved-browse-icon').props.width).toBe(
      19
    );

    const payloads = strokePayloads(screen.getByTestId('explore-saved-browse'));
    // 긍정 짝 — stroke 노드가 하나도 없으면 "전부 흰색"이 빈 배열에서 공허 통과한다.
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    payloads.forEach((payload) => expect(payload).toBe(processColor('white')));
  });

  it('지역 필터 0건 블록은 이번 변경 전 그대로다 — 공통 틀이 새어 들지 않는다 (AC-8 · TRIP-1042 몫)', () => {
    renderScreen({
      savedPlaces: [],
      state: { kind: 'empty' },
      regionFilterEmpty: true,
    });

    const region = screen.getByTestId('explore-saved-region-empty');
    // 옛 콜라주(230 폭)를 그대로 쓴다 — 같은 art testID 를 두 블록이 공유한다(상호배타).
    expect(
      cls(within(region).getByTestId('explore-saved-empty-art'))
    ).toContain('w-[230px]');
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
    expect(screen.queryByTestId('explore-saved-empty-photo-0')).toBeNull();
  });
});

/**
 * ── 앱바 ── 옛 `SavedPlaceListScreen.appBar.test.tsx`(TRIP-1086 · AC-10·AC-11).
 * d02 앱바 위 여백을 e04 와 같은 8 로 맞춘다(결정 3(a)).
 *  - 🔴 AC-10: 어느 얼굴이든 앱바 컨테이너에 위 여백 8 이 있다. 아래 8 · 왼쪽 10 · 오른쪽 16 · 뒤로-제목
 *    간격 4 는 d02 Figma 그대로 유지(가로를 e04 로 옮기지 않는다).
 *  - AC-11: 뒤로를 누르면 onBack 이 1회.
 *
 * 볼 수 없는 몫(6-b 육안): 실제 앱바 높이와 d02·e04 빈 상태 콜라주·제목의 y 가 같은지.
 *
 * (개념) 앱바에는 testID 가 없다 — 뒤로 버튼과 제목 '담은 장소' 를 함께 품는 가장 가까운 host 상자를 앱바로 본다.
 */

/** 위·아래 8 을 뜻하는 토큰(tailwind spacing sm = 8px). `py-*` 는 위아래를 함께 준다. */
const TOP_8 = ['pt-sm', 'pt-[8px]', 'py-sm', 'py-[8px]'];
const BOTTOM_8 = ['pb-sm', 'pb-[8px]', 'py-sm', 'py-[8px]'];

function ancestorsOf(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  let cur = node.parent;
  while (cur) {
    out.push(cur);
    cur = cur.parent;
  }
  return out;
}

function nearestCommonHost(
  a: ReactTestInstance,
  b: ReactTestInstance
): ReactTestInstance {
  const ofB = new Set(ancestorsOf(b));
  const found = ancestorsOf(a).find(
    (n) => typeof n.type === 'string' && ofB.has(n)
  );
  if (!found) throw new Error('공통 host 조상이 없다');
  return found;
}

function appBar(): ReactTestInstance {
  return nearestCommonHost(
    screen.getByTestId('explore-saved-back'),
    screen.getByText('담은 장소')
  );
}

describe('앱바', () => {
  describe('🔴 AC-10 · d02 앱바 위 여백 8 (얼굴 공통)', () => {
    it.each<[string, Partial<SavedPlaceListScreenProps>]>([
      ['empty', { state: { kind: 'empty' } }],
      ['results', {}],
      ['loading', { state: { kind: 'loading' } }],
      ['error', { state: { kind: 'error' } }],
      ['guest', { isGuest: true }],
    ])('%s 얼굴', (_face, overrides) => {
      renderScreen({ savedPlaces: [], ...overrides });

      const bar = cls(appBar());
      const vertical = (prefix: RegExp) => bar.filter((t) => prefix.test(t));

      // 위 여백 — 8 계열 토큰이 있고, 다른 값의 위 여백 토큰은 섞이지 않는다.
      const top = vertical(/^(pt|py|p)-/);
      expect(top.length).toBeGreaterThan(0);
      expect(top.filter((t) => !TOP_8.includes(t))).toEqual([]);
      // 아래 여백 8 유지.
      const bottom = vertical(/^(pb|py|p)-/);
      expect(bottom.length).toBeGreaterThan(0);
      expect(bottom.filter((t) => !BOTTOM_8.includes(t))).toEqual([]);
      // 가로는 d02 Figma 그대로(e04 가로를 옮기지 않는다).
      expect(bar).toEqual(
        expect.arrayContaining(['pl-[10px]', 'pr-lg', 'gap-xs'])
      );
    });
  });

  describe('AC-11 · d02 뒤로 무회귀', () => {
    it('뒤로를 누르면 onBack 이 1회 불린다', () => {
      renderScreen({ savedPlaces: [], state: { kind: 'empty' } });

      fireEvent.press(screen.getByTestId('explore-saved-back'));

      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * ── 행 탭 ── 옛 `SavedPlaceListScreen.rowtap.test.tsx`(TRIP-456 · AC-3) — 행 press 버블링 갈림(화면 층).
 * 행을 `Pressable`로 만들어 d06으로 배선하되, **하트(해제) press가 행으로 새지 않는다**. d02 하트는
 * `disabled`가 없어 항상 활성이라, RNTL에서 활성 자식은 press를 잡아 부모로 안 샌다(Probe A) — d04와 달리
 * 대기 누수(Probe C) 위험이 없다. 그래도 양·음 짝으로 "행 탭은 이동, 하트 탭은 해제"의 갈림을 잠근다.
 * 최종 push 세그먼트(place.poiId)는 page 통합 `save › 행 탭` 몫이다.
 */
describe('행 탭', () => {
  it('C4 행 본문을 누르면 onPressRow(saved)가 그 행의 saved로 불린다', () => {
    // 준비 — 4행, onPressRow 스파이(행 키 sp-1 ≠ poiId p1).
    const onPressRow = jest.fn();
    renderScreen({ onPressRow });

    // 실행 — 행 루트(savedPlaceId testID)를 누른다.
    fireEvent.press(screen.getByTestId('explore-saved-item-sp-1'));

    // 단언 — 그 행의 saved가 올라간다. 해제 콜백은 안 불린다.
    expect(onPressRow).toHaveBeenCalledTimes(1);
    expect(onPressRow.mock.calls[0][0].savedPlaceId).toBe('sp-1');
    expect(onPressRemove).not.toHaveBeenCalled();
  });

  it('C5 활성 하트를 누르면 onPressRemove만 불리고 onPressRow로 안 샌다 (Probe A)', () => {
    // 준비 — d02 하트는 disabled 없음(항상 활성).
    const onPressRow = jest.fn();
    renderScreen({ onPressRow });

    // 실행 — 하트(해제)를 누른다.
    fireEvent.press(screen.getByTestId('explore-saved-remove-sp-1'));

    // 단언 — 해제만 반응, 행 이동으로 안 샌다.
    expect(onPressRemove).toHaveBeenCalledTimes(1);
    expect(onPressRemove.mock.calls[0][0].savedPlaceId).toBe('sp-1');
    expect(onPressRow).not.toHaveBeenCalled();
  });
});
