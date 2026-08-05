import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

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
const onPressCreateTrip = jest.fn();
const onPressBrowse = jest.fn();
const onRetry = jest.fn();
const onPressLogin = jest.fn();
const onPressRemoveErrorAction = jest.fn();
const onBack = jest.fn();

beforeEach(() => {
  [
    onPressRemove,
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
    expect(
      within(empty).getByText(
        '부산 인기 장소를 둘러보고 ♥로 담으면 여기에 모여 바로 여행이 돼요'
      )
    ).toBeOnTheScreen();

    // 삽화 슬롯이 실제로 배선됐다(01b Seed Q4 ⓑ — 사진 3장 대신 벡터 콜라주).
    expect(
      within(empty).getByTestId('explore-saved-empty-art')
    ).toBeOnTheScreen();

    const browse = screen.getByTestId('explore-saved-browse');
    expect(within(browse).getByText('장소 둘러보기')).toBeOnTheScreen();
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

describe('T-10 · loading 얼굴 (01b Seed Q6)', () => {
  it('스켈레톤 4장이 뜨고 다른 얼굴은 나오지 않는다', () => {
    renderScreen({ savedPlaces: [], state: { kind: 'loading' } });

    expect(screen.getByTestId('explore-saved-loading')).toBeOnTheScreen();
    expect(
      screen
        .queryAllByTestId(/^explore-saved-skeleton-/)
        .map((node) => String(node.props.testID))
    ).toEqual([
      'explore-saved-skeleton-0',
      'explore-saved-skeleton-1',
      'explore-saved-skeleton-2',
      'explore-saved-skeleton-3',
    ]);
    expect(screen.getByText('담은 장소를 불러오는 중')).toBeOnTheScreen();

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
