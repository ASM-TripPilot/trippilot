import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Place, SavedPlace } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-209 g01 '꼭 갈 곳' 배선 — 담은 장소 조회 ↔ 시드 ↔ 화면 ↔ 라우터를 잇는다.
 *
 * 무엇을 보장하나:
 *  - **AC-1 · D8** 조회 결과가 썸네일과 `담은 곳 N곳` 캡션까지 이어지고, 캡션의 N 은
 *    **서버 담은 장소 개수**라 시드를 빼도 줄지 않는다.
 *  - **AC-5** `x` 가 그 항목만 시드에서 빼고 **담기 해제를 부르지 않는다**(BR-U1-37 복사 · INV-U1-04).
 *  - **D6** 게스트는 0곳 얼굴을 본다 — 끝나지 않는 스켈레톤이 아니다.
 *  - **D5** 조회 실패 얼굴이 0곳 얼굴과 구분되고 재시도가 진짜 재조회를 부른다.
 *  - **INV-U1-04(양방향)** 담은 목록이 줄어도 이미 복사된 시드는 지워지지 않는다.
 *  - **AC-6** 점선 박스(0곳 얼굴)는 **담은 곳이 있으면** 담은 장소 화면(d02)으로, 없으면
 *    장소 탐색(d04)으로 보낸다(TRIP-367 이후 조건 분기 — 분기 키는 `savedPlaceList.length`).
 *
 * 왜 node 버킷인가: 심판 대상이 "조회 **상태 조합**이 어떤 얼굴·어떤 스토어 변화로 이어지는가"다.
 * 게스트/로딩/실패/잔존을 손으로 갈아 끼워야 하므로 훅을 모듈째 목킹한다
 * (`TripNewStep1Page.test.tsx`·`…stayImport.test.tsx` 와 같은 형태). **실제 HTTP 와 등록 요청**은
 * `TripNewStep1Page.mustVisit.integration.test.tsx` 가 따로 본다 — 이 파일은 제출을 태우지 않는다.
 *
 * ⚠️ 게스트의 `isPending` 은 **영원히 true** 다(`enabled: isAuthed` 라 요청 자체가 없다,
 * 02a §5-4 실측). 그 값을 그대로 얼굴 판정에 태우면 게스트가 끝나지 않는 스켈레톤을 본다 —
 * 배선은 `loading = isAuthed && isPending` 으로 접어야 한다. N4-3 이 그 심판이다.
 *
 * ⚠️ `jest.mock` 팩토리는 파일 최상단으로 끌어올려진다. 팩토리가 참조하는 바깥 변수는 이름이
 * `mock` 으로 시작해야 예외를 받는다 — **아래 변수 이름을 바꾸지 마라**(리포 확립 규칙).
 *
 * 3동작 뼈대: 준비=조회 상태·토큰 지정 → 실행=render(+press) → 단언=보이는 것 / 스토어 / 라우터.
 */

jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, back, replace }),
    router: { push, back, replace },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
};

jest.mock('@/features/trip/model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({ data: undefined }),
}));

/** 이름 있는 목으로 끌어올린다 — N4-8 이 "눌러도 여행 만들기가 안 불린다"를 셀 창구다
 * (`TripNewStep1Page.budget.test.tsx:60-68` 과 동형). 값은 종전과 같다. */
const mockMutateAsync = jest.fn();

jest.mock('@/features/trip/model/useCreateTrip', () => ({
  useCreateTrip: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    reset: jest.fn(),
  }),
}));

jest.mock('@/features/trip/model/useSavedStays', () => ({
  useSavedStays: () => ({
    data: undefined,
    isPending: true,
    isError: false,
    refetch: jest.fn(),
  }),
}));

/** 조회 상태를 테스트가 손으로 갈아 끼우는 창구. 이 배선이 실제로 읽는 것만 흉내낸다. */
const mockRefetch = jest.fn();
const mockRemove = jest.fn();
let mockSavedPlaces: {
  savedPlaces: SavedPlace[];
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
  remove: jest.Mock;
};

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => mockSavedPlaces,
}));

/**
 * TRIP-445 (검증 n=1) — 위 세 목과 **같은 이유**: 페이지가 `useRegions`(→ `useQuery`)를 물어
 * provider 없는 이 node 버킷에서 render 가 던진다. 승인 `TripNewStep1Page.test.tsx` 목과 같은
 * 형태로 `useRegions` 만 갈아끼우고 `filterRegions` 는 requireActual 실물을 쓴다. 슬러그 6코드
 * 동기 반환이라 기존 `-busan` 등 testID 와 `addDestination` 이 그대로 작동한다. 단언 무변경.
 */
jest.mock('@/features/explore/model/regions', () => {
  const region = (regionCode: string, name: string) => ({
    regionCode,
    name,
    sidoName: name,
    level: 'SIDO',
    selectable: true,
    poiCount: 5,
  });
  return {
    ...jest.requireActual('@/features/explore/model/regions'),
    useRegions: () => ({
      data: [
        region('busan', '부산'),
        region('gyeongju', '경주'),
        region('seoul', '서울'),
        region('jeju', '제주'),
        region('gangneung', '강릉'),
        region('yeosu', '여수'),
      ],
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    }),
  };
});

/** 기준일 고정 — 실행일이 바뀌어도 날짜 단언이 흔들리지 않는다(TRIP-205 D5). */
const BASE = '2026-06-10';

/** 계약 `Place.required` 를 그대로 채운다(상상해서 만들지 않는다). */
function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '수영구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

function savedPlace(poiId: string, nameKo: string): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace(poiId, nameKo),
  };
}

const THREE: SavedPlace[] = [
  savedPlace('poi-1', '감천마을'),
  savedPlace('poi-2', '광안리'),
  savedPlace('poi-3', '전포'),
];

function loaded(places: SavedPlace[]) {
  return {
    savedPlaces: places,
    isPending: false,
    isError: false,
    refetch: mockRefetch,
    remove: mockRemove,
  };
}

function block() {
  return screen.getByTestId('trip-wizard-mustvisit-block');
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

/** 조회 중 상태(로그인·게스트 공통으로 갈아 끼우는 모양). */
function pending() {
  return {
    savedPlaces: [],
    isPending: true,
    isError: false,
    refetch: mockRefetch,
    remove: mockRemove,
  };
}

/** 도시 추가 시트를 열어 지역 하나를 N박으로 확정하는 3동작 묶음(승인 파일과 같은 형태). */
function addDestination(regionCode: string, nights: number): void {
  fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
  fireEvent.press(
    screen.getByTestId(`trip-wizard-destination-region-${regionCode}`)
  );
  // 시트의 박수 기본값은 1이다.
  for (let i = 1; i < nights; i += 1) {
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc'));
  }
  fireEvent.press(screen.getByTestId('trip-wizard-destination-confirm'));
}

/** `[다음]` 이 열리는 최소 상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
function fillValidDraft(): void {
  addDestination('busan', 3);
  fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));
}

beforeEach(() => {
  // 모듈 싱글턴 스토어를 되돌린다 — 안 하면 앞 테스트가 남긴 시드가 뒤 테스트를 뒤집는다.
  useTripWizardStore.getState().reset();
  routerMock.push.mockClear();
  mockRefetch.mockClear();
  mockRemove.mockClear();
  mockMutateAsync.mockReset();
  mockMutateAsync.mockResolvedValue(undefined);
  // 기본은 로그인 상태. 게스트 케이스만 따로 지운다.
  setAccessToken('valid-access');
  mockSavedPlaces = loaded(THREE);
});

afterEach(() => clearAccessToken());

describe('N4 · 담은 장소가 시드로 이어진다 (AC-1 · 01b D8)', () => {
  it('N4-1 썸네일과 「담은 곳 N곳」 캡션이 함께 선다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    ['poi-1', 'poi-2', 'poi-3'].forEach((poiId) => {
      expect(
        screen.getByTestId(`trip-wizard-mustvisit-${poiId}`)
      ).toBeOnTheScreen();
    });
    expect(
      within(screen.getByTestId('trip-wizard-saved-place-count')).getByText(
        '담은 곳 3곳'
      )
    ).toBeOnTheScreen();
  });

  it('🔴 N4-2 x 는 그 항목만 빼고, 담기 해제는 부르지 않으며, 캡션은 줄지 않는다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-remove-poi-2'));

    // ① 그 항목만 사라진다(긍정 짝이 함께 있어야 "다 사라진" 구현이 안 통과한다).
    expect(screen.queryByTestId('trip-wizard-mustvisit-poi-2')).toBeNull();
    expect(screen.getByTestId('trip-wizard-mustvisit-poi-1')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-wizard-mustvisit-poi-3')).toBeOnTheScreen();

    // ② 원본 담기는 건드리지 않는다 — 시드는 **복사본**이다(BR-U1-37 · INV-U1-04).
    //    담기가 함께 풀리면 사용자는 탐색 화면의 ♥ 까지 잃는다.
    expect(mockRemove).not.toHaveBeenCalled();

    // ③ 캡션의 N 은 **서버 담은 장소 개수**다(01b D8) — 시드를 뺐다고 줄지 않는다.
    expect(
      within(screen.getByTestId('trip-wizard-saved-place-count')).getByText(
        '담은 곳 3곳'
      )
    ).toBeOnTheScreen();
  });

  it('🔴 N4-6 담은 목록이 줄어도 이미 복사된 시드는 남는다 (INV-U1-04 · 양방향 독립)', () => {
    render(<TripNewStep1Page baseDate={BASE} />);
    expect(screen.getByTestId('trip-wizard-mustvisit-poi-3')).toBeOnTheScreen();

    // 실행 — 사용자가 d04 에서 한 곳의 담기를 풀고 돌아왔다(목록이 줄어든 채로 다시 그려진다).
    mockSavedPlaces = loaded([savedPlace('poi-1', '감천마을')]);
    screen.rerender(<TripNewStep1Page baseDate={BASE} />);

    // 단언 — 시드는 이미 **복사**된 것이라 원본이 줄어도 지워지지 않는다. 매 렌더 쿼리
    // 결과에서 시드를 다시 만드는 구현은 여기서 죽는다.
    ['poi-1', 'poi-2', 'poi-3'].forEach((poiId) => {
      expect(
        screen.getByTestId(`trip-wizard-mustvisit-${poiId}`)
      ).toBeOnTheScreen();
    });
  });
});

describe('N4 · 조회 상태별 얼굴 (01b D5 · D6)', () => {
  it('🔴 N4-3 게스트는 0곳 얼굴을 본다 — 끝나지 않는 스켈레톤이 아니다', () => {
    // ⚠️ 게스트는 `enabled: isAuthed` 라 요청이 안 나가고, 그래서 `isPending` 이 **영원히
    // true** 다(02a §5-4 실측 · 훅 주석의 경고). 그 값을 그대로 태우면 위저드를 딥링크로 연
    // 게스트가 영원히 도는 자리표시를 본다 — `trips/new/**` 는 `Stack.Protected` 밖이라
    // 실제로 열린다(docs/structure.md 경고).
    clearAccessToken();
    mockSavedPlaces = {
      savedPlaces: [],
      isPending: true,
      isError: false,
      refetch: mockRefetch,
      remove: mockRemove,
    };
    render(<TripNewStep1Page baseDate={BASE} />);

    // 게스트는 담기 자체가 불가라(BR-U1-03) "담은 게 없다"가 **참**이다 — 전용 얼굴을
    // 새로 만들지 않는다(D6).
    expect(screen.getByTestId('trip-wizard-mustvisit-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-mustvisit-retry')).toBeNull();
  });

  it('N4-4 로그인 + 조회 중에는 자리만 잡는다', () => {
    mockSavedPlaces = {
      savedPlaces: [],
      isPending: true,
      isError: false,
      refetch: mockRefetch,
      remove: mockRemove,
    };
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(block()).toBeOnTheScreen();
    // 도착 전에 "담은 곳이 없어요" 를 그리면 담아 둔 사용자에게 한 순간 거짓말을 한다.
    expect(block()).not.toHaveTextContent(/[가-힣]/);

    // 짝(긍정) — 화면 나머지는 정상이다.
    expect(screen.getByTestId('trip-wizard-step1-root')).toHaveTextContent(
      /언제 가세요\?/
    );
  });

  it('🔴 N4-5 조회 실패는 0곳과 다른 얼굴이고, 재시도가 진짜 재조회를 부른다', () => {
    mockSavedPlaces = {
      savedPlaces: [],
      isPending: false,
      isError: true,
      refetch: mockRefetch,
      remove: mockRemove,
    };
    render(<TripNewStep1Page baseDate={BASE} />);

    const retry = screen.getByTestId('trip-wizard-mustvisit-retry');
    expect(retry).toBeOnTheScreen();
    // ★ 0곳으로 떨어뜨리면 "담은 게 없다"는 거짓말이다(실제로는 못 불러온 것 · 01b D5).
    expect(screen.queryByTestId('trip-wizard-mustvisit-empty')).toBeNull();
    // 캡션도 그리지 않는다 — 개수를 모르기 때문이다.
    expect(screen.queryByTestId('trip-wizard-saved-place-count')).toBeNull();

    fireEvent.press(retry);

    // 표시만 하고 아무 일도 안 하면 위반이다(`StayImportRow` I-3 과 같은 규약).
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

describe('N4 · 더 담기는 담은 곳이 있으면 담은 장소 화면으로 (TRIP-367 · AC-6)', () => {
  it('N4-7 담은 곳이 있으면 담은 장소 화면(d02)으로 간다', () => {
    // beforeEach 가 loaded(THREE) — 담은 곳 3곳.
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-more'));

    // 이미 담아둔 것을 모아 고르는 자리가 담은 장소 화면이다 — 탐색으로 보내면 다시 찾아야 한다.
    expect(routerMock.push).toHaveBeenCalledWith('/explore/saved-places');
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });

  it('N4-7b 담은 곳이 0곳이면 지금처럼 장소 탐색으로 간다 — 담을 게 없을 땐 탐색이 맞다', () => {
    mockSavedPlaces = loaded([]);
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-empty'));

    expect(routerMock.push).toHaveBeenCalledWith('/explore/places');
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });

  it('🔴 N4-7c 담은 곳 3·시드 0(x로 전부 뺀 상태)이면 empty 얼굴도 담은 장소 화면(d02)으로 간다', () => {
    // 왜 이 케이스인가: N4-7·N4-7b 는 savedPlaceList 와 mustVisits(시드)를 **항상 같은 값**으로만
    // 줘서, 분기 키를 `savedPlaceList.length` → `mustVisits.length` 로 바꿔도 둘이 늘 함께 0/양수라
    // 뮤테이션이 살아남았다(TRIP-375). 두 길이를 갈라놓아야 분기 키를 잠근다.
    // beforeEach = loaded(THREE). 시드 3장을 x 로 전부 뺀다 → mustVisits 0, 담은 곳은 여전히 3.
    render(<TripNewStep1Page baseDate={BASE} />);
    ['poi-1', 'poi-2', 'poi-3'].forEach((poiId) => {
      fireEvent.press(
        screen.getByTestId(`trip-wizard-mustvisit-remove-${poiId}`)
      );
    });

    // 시드가 비었으니 0곳 얼굴(empty)이 뜬다 — 담은 곳은 3곳 그대로다.
    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-empty'));

    // 담은 곳이 있으므로 담은 장소 화면으로 가야 한다. 분기 키가 `mustVisits.length`(=0)로
    // 뒤바뀌면 /explore/places 로 새 red 를 낸다.
    expect(routerMock.push).toHaveBeenCalledWith('/explore/saved-places');
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});

/**
 * ─── 게이트①-2 추가분 (N4-8 · N4-9) ────────────────────────────────────────────
 *
 * 무엇을 보는가: **담은 목록이 아직 도착하기 전에 `[다음]`을 누를 수 있나.**
 * 회선이 느리면 진입 직후 이 섹션은 글자 없는 회색 칸이다. 그 칸이 무엇인지 모르는 사용자가
 * 여행지·기간만 채우고(수 초면 된다) `[다음]`을 누르면, 시드가 아직 비어 있어 꼭 갈 곳이
 * **한 건도 등록되지 않은 채** 다음 화면으로 넘어간다. 담아 둔 5곳이 이 여행에 하나도 안
 * 들어갔고, 사용자는 그 사실을 알 방법이 없다(침묵 실패).
 *
 * 핵심은 **"아직 모른다"와 "정말 0곳이다"는 다른 상태**라는 것이다. 0곳은 계속 통과시키고
 * (`N3-12`·`I-3` 이 그것을 잠그고 있다), 모르는 동안만 잠깐 막는다.
 *
 * ⚠️ 가장 큰 함정은 **게스트**다. 게스트는 담은 목록 요청 자체가 안 나가서 "조회 중"이
 * **영원히 참**이다(02a ★7 · §5-4 실측). 그 값에 그냥 잠금을 걸면 위저드를 딥링크로 연
 * 게스트가 `[다음]`에 **영구히 갇힌다** — `trips/new/**` 는 `Stack.Protected` 밖이라 실제로
 * 열린다. N4-9 가 그 축의 심판이다.
 */

describe('🔴 N4 · 담은 목록이 아직 도착 전이면 [다음]을 잠깐 막는다 (03b W-5)', () => {
  it('N4-8 조회 중에는 잠기고, 도착하면 열린다', () => {
    mockSavedPlaces = pending();
    render(<TripNewStep1Page baseDate={BASE} />);
    fillValidDraft();

    // ① 여행지·기간이 다 찼는데도 아직 못 누른다 — 지금 제출하면 담아 둔 곳이 통째로
    //    빠진 여행이 만들어지고, 그 사실이 화면 어디에도 안 나타난다.
    expect(next()).toBeDisabled();

    // 짝 — `toBeDisabled()` 는 접근성 상태만 읽는다. 회색이기만 하고 실제로는 눌리는 버튼이
    // 이 매처를 통과한 이력이 리포에 있다(`…budget.test.tsx:330-334` 와 같은 규약).
    fireEvent.press(next());
    expect(mockMutateAsync).not.toHaveBeenCalled();

    // ② 짝(긍정) — 도착하면 열린다. 이 줄이 없으면 "영원히 잠그는" 구현도 통과한다.
    mockSavedPlaces = loaded(THREE);
    screen.rerender(<TripNewStep1Page baseDate={BASE} />);

    expect(next()).toBeEnabled();
  });

  it('🔴 N4-9 게스트는 잠기지 않는다 — 조회 중이 영원히 참이기 때문', () => {
    // 게스트는 담기 자체가 불가라(BR-U1-03) 기다릴 목록이 없다. `isPending` 을 그대로
    // 잠금에 태우면 이 사용자는 여행을 **영영 만들 수 없다**. 배선이 이미 게스트를 접어
    // 두었으므로(`loading = isAuthed && isPending`) 그 접기를 그대로 쓰면 공짜로 지나간다.
    clearAccessToken();
    mockSavedPlaces = pending();
    render(<TripNewStep1Page baseDate={BASE} />);
    fillValidDraft();

    expect(next()).toBeEnabled();
  });
});

/**
 * ─── TRIP-288 추가분 (N4-10 ~ N4-13) ───────────────────────────────────────────
 *
 * 여기서 보는 것은 **재시드가 화면까지 이어지는가**다. 지금은 시드가 세션당 한 번만 채워져,
 * 더 담기로 새로 담고 돌아와도 썸네일이 그대로다 — 캡션의 숫자(서버 개수)만 늘어나 한 화면 안에서
 * 숫자와 그림이 서로 다른 말을 한다(TRIP-288 증상 B).
 *
 * ⚠️ **썸네일 상한 3**(동결 N1-6·N1-7)이 이 칸의 설계를 좁힌다 — 시드가 4건이면 4번째는 `+1` 로
 * 접혀 화면에 testID 가 아예 없다. 그래서 아래 두 케이스는 **최종 시드를 정확히 3건**으로 맞췄다.
 * 안 그러면 "안 들어왔다"와 "접혀서 안 보인다"를 구별하지 못해 거짓 red 가 난다(02a ★6).
 *
 * ⚠️ 재시드는 `mustVisitsInitialized` 가드를 **푸는** 변경이라, 그 순간 게스트·미도착에서
 * `savedPlaces.savedPlaces` 가 **매 렌더 새 빈 배열**을 내는 성질이 살아난다. N4-12 가 그 축의
 * 심판이고, 목을 **게터**로 만들어 실물 훅과 같은 모양을 재현한다(02a ★3).
 */

/** 매 렌더 **새** 빈 배열을 주는 게스트 목 — 실물 `useSavedPlaces` 와 같은 모양(02a ★3). */
function guestFreshEmpty() {
  return {
    get savedPlaces(): SavedPlace[] {
      return [];
    },
    isPending: true,
    isError: false,
    refetch: mockRefetch,
    remove: mockRemove,
  };
}

/** 화면에 실제로 그려진 썸네일을 **화면 순서대로** 모은다(02a §5 P1 — pre-order 실측).
 * `remove-`·`image-` 변종은 `\d+$` 앵커에 안 걸린다. */
function thumbnailIds(): string[] {
  return screen
    .queryAllByTestId(/^trip-wizard-mustvisit-poi-\d+$/)
    .map((node) => String(node.props.testID));
}

describe('🔴 N4 · 더 담기 복귀 재시드 (TRIP-288 AC-2 · AC-4)', () => {
  it('N4-10 새로 담은 곳이 기존 시드 뒤에 붙고, 담은 목록 순서로 재정렬하지 않는다', () => {
    // 준비 — 시드를 담은 목록과 **다른 순서**로 만들어 둔다(2 → 1).
    mockSavedPlaces = loaded([
      savedPlace('poi-2', '광안리'),
      savedPlace('poi-1', '감천마을'),
    ]);
    render(<TripNewStep1Page baseDate={BASE} />);

    // 앵커 — 재시드 전 순서. 없으면 아래 결과가 원래부터 그랬는지 구별이 안 된다.
    expect(thumbnailIds()).toEqual([
      'trip-wizard-mustvisit-poi-2',
      'trip-wizard-mustvisit-poi-1',
    ]);

    // 실행 — 더 담기로 한 곳을 새로 담고 돌아왔다(서버 목록 순서는 1 → 2 → 3).
    mockSavedPlaces = loaded([
      savedPlace('poi-1', '감천마을'),
      savedPlace('poi-2', '광안리'),
      savedPlace('poi-3', '전포'),
    ]);
    screen.rerender(<TripNewStep1Page baseDate={BASE} />);

    // 단언 — 새 것은 **맨 뒤**, 기존 둘은 순서 그대로. 담은 목록 순서로 다시 세우는 구현은
    // 여기서 죽는다(01b D11).
    expect(thumbnailIds()).toEqual([
      'trip-wizard-mustvisit-poi-2',
      'trip-wizard-mustvisit-poi-1',
      'trip-wizard-mustvisit-poi-3',
    ]);
    // 캡션의 N 은 **서버 담은 장소 개수**라는 기존 계약(동결 N4-2 ③)이 그대로다.
    expect(
      within(screen.getByTestId('trip-wizard-saved-place-count')).getByText(
        '담은 곳 3곳'
      )
    ).toBeOnTheScreen();
  });

  it('N4-11 x 로 뺀 곳은 재시드로 되살아나지 않고, 함께 온 새 곳은 들어온다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    // 준비 — 사용자가 한 곳을 뺐다. 그 장소는 **여전히 담은 목록에 있다**(담기와 시드는 독립).
    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-remove-poi-2'));
    expect(thumbnailIds()).toEqual([
      'trip-wizard-mustvisit-poi-1',
      'trip-wizard-mustvisit-poi-3',
    ]);

    // 실행 — 더 담기로 한 곳을 새로 담고 돌아왔다.
    mockSavedPlaces = loaded([...THREE, savedPlace('poi-4', '해운대')]);
    screen.rerender(<TripNewStep1Page baseDate={BASE} />);

    // 부정 — 뺀 곳이 되돌아오면 사용자는 자기가 뺀 곳이 여행에 등록되는 것을 보게 된다.
    expect(screen.queryByTestId('trip-wizard-mustvisit-poi-2')).toBeNull();
    // 긍정 짝 — 그렇다고 아무것도 안 더하는 것은 아니다. 둘을 한 케이스에서 같이 본다.
    expect(thumbnailIds()).toEqual([
      'trip-wizard-mustvisit-poi-1',
      'trip-wizard-mustvisit-poi-3',
      'trip-wizard-mustvisit-poi-4',
    ]);
    expect(
      within(screen.getByTestId('trip-wizard-saved-place-count')).getByText(
        '담은 곳 4곳'
      )
    ).toBeOnTheScreen();
  });
});

describe('N4 · 재시드가 켜져도 무해해야 하는 축 (TRIP-288 AC-5 · AC-6)', () => {
  it('N4-12 비회원은 빈 시드로 열리고, 재계산이 화면을 무한 루프로 몰지 않는다', () => {
    // 준비 — 게스트는 요청 자체가 안 나가 `isPending` 이 **영원히 true** 이고, 담은 목록은
    // **매 렌더 새 빈 배열**이다. 재시드가 그 빈 배열을 매번 새 상태로 갈아 끼우면 렌더 →
    // 효과 → 갈아끼움 → 렌더의 무한 루프가 된다.
    clearAccessToken();
    mockSavedPlaces = guestFreshEmpty();

    // 실행 — 루프가 나면 `render()` 자체가 `Maximum update depth exceeded` 로 **던진다**
    // (02a §5 P3 실측). 즉 이 케이스는 통과하는 것만으로 루프 없음을 증명한다.
    render(<TripNewStep1Page baseDate={BASE} />);
    screen.rerender(<TripNewStep1Page baseDate={BASE} />);

    // 단언 — 비회원은 담기 자체가 불가라(BR-U1-03) "담은 게 없다"가 참이다. 전용 안내를
    // 새로 만들지 않는다(01b D10 · 제약 7).
    expect(screen.getByTestId('trip-wizard-mustvisit-empty')).toBeOnTheScreen();
    expect(thumbnailIds()).toEqual([]);
    expect(useTripWizardStore.getState().mustVisits).toEqual([]);
  });

  it('N4-13 담은 목록 조회가 실패해도 [다음] 이 열리고, 눌렀을 때 여행 생성이 실제로 나간다', async () => {
    // 조회 실패는 재시도가 성공할 때까지 계속 참이다 — 그 상태로 잠그면 서버가 아픈 동안
    // 사용자가 여행을 **아예** 못 만든다. 잠금이 과하게 걸리는 것도 사용자에게는 조용한
    // 차단이다(BR-U1-55 취지 · TRIP-209 게이트①-2 결정의 반대편 경계).
    mockSavedPlaces = {
      savedPlaces: [],
      isPending: false,
      isError: true,
      refetch: mockRefetch,
      remove: mockRemove,
    };
    mockMutateAsync.mockResolvedValue({ tripId: 'trip-1' });
    render(<TripNewStep1Page baseDate={BASE} />);
    fillValidDraft();

    expect(next()).toBeEnabled();

    // ⚠️ `toBeEnabled()` 는 접근성 상태만 읽는다 — 회색이기만 하고 실제로는 눌리는 버튼이
    // 이 매처를 통과한 이력이 리포에 있다. **눌러서 요청이 나가는 것까지** 본다
    // (동결 N4-8 이 반대 방향으로 같은 규약).
    await act(async () => {
      fireEvent.press(next());
    });

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(routerMock.push).toHaveBeenCalledWith('/trips/new/step2');
  });
});
