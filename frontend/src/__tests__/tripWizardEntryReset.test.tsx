import { render, screen } from '@testing-library/react-native';

import TripWizardLayout from '@/app/trips/new/_layout';
import type { MustVisitSeedItem } from '@/features/trip/model/mustVisitSeed';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { TripNewStep1Page } from '@/pages/trip-new-step1';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

/**
 * TRIP-288 AC-1 → 사용자 결정으로 재정의 — '꼭 갈 곳' 시드의 **수명이 어디서 시작하는가**.
 *
 * 무엇을 보장하나: 위저드 셸(`src/app/trips/new/_layout.tsx`)이 마운트되면 드래프트의 시드·채움
 * 플래그·"뺀 곳" 기억이 **전부 초기값으로** 돌아간다. ⚠️ **담은 곳(하트) 자동 재시드는 폐지됐다**
 * (사용자 결정) — 예전엔 초기화 뒤 지금 담은 목록으로 다시 채워졌으나(TRIP-288), 이제는 채우는
 * 경로 자체가 없어(`TripNewStep1Page.tsx`의 마운트 효과 삭제) 새 진입마다 "꼭 갈 곳"은 항상
 * 0곳이다. 이전 여행의 시드가 새 여행에 그대로 등록되던 문제(TRIP-288 증상 A)는 여전히 막힌다
 * (초기화 자체는 그대로 있으므로) — 다만 그 자리를 "지금 담은 곳으로 재세팅"이 아니라 "항상
 * 빈 상태"로 메운다는 점이 바뀌었다.
 *
 * 왜 셸인가: 위저드 전체를 감싸는 자리라 step1 ↔ step2 왕복이나 더 담기 왕복으로는 다시 실행되지
 * 않는다(01b D1 · 제약 9). "진입"의 경계를 넓게 잡으면 사용자가 x 로 뺀 편집이 왕복마다 날아간다.
 *
 * ⚠️ **이 파일이 못 보는 것**: jest 는 `expo-router` 를 통째로 목킹하므로 "실제로 셸이 다시
 * 마운트되지 않는다"를 증명할 수 없다. 여기서 잠그는 것은 **초기화가 마운트에만 걸려 있는가**
 * 까지고(FW-3), 실제 라우터 동작은 [검증] 6-b 실기 스모크가 답한다(01b D4).
 *
 * ⚠️ `jest.mock` 팩토리는 파일 최상단으로 끌어올려지고, 그 안에서 react-native 엘리먼트를 만들면
 * NativeWind babel 이 주입한 모듈 스코프 변수를 참조해 호이스트 규칙을 위반한다 — 그래서 `Stack`
 * 목은 모듈로 분리된 `@/test-support/expoRouterStackMock` 을 `require` 로 끌어온다(리포 관례).
 * 팩토리가 참조하는 바깥 변수 이름은 `mock` 으로 시작해야 한다.
 *
 * 3동작 뼈대: 준비=이전 여행이 남긴 드래프트 만들기 → 실행=셸(+화면) 렌더 → 단언=스토어 시드.
 *
 * ── 졸업 조건 ── **A. 영구 규칙 — 유지한다.** "시드는 진입마다 비운다"는 드래프트가 사는 한
 * 유효하고, 담는 항목이 늘어도 갱신이 필요 없다.
 */

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const stackMock = require('@/test-support/expoRouterStackMock');
  const push = jest.fn();
  const back = jest.fn();
  const replace = jest.fn();
  return {
    __esModule: true,
    ...stackMock,
    useRouter: () => ({ push, back, replace }),
    router: { push, back, replace },
  };
});

jest.mock('@/features/trip/model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({ data: undefined }),
}));

jest.mock('@/features/trip/model/useCreateTrip', () => ({
  useCreateTrip: () => ({
    mutateAsync: jest.fn(),
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

/** 담은 목록 조회를 손으로 갈아 끼우는 창구(동결 `…mustVisit.test.tsx` 와 같은 형태). */
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
 * TRIP-445 (검증 n=1) — 위 세 목과 **같은 이유**: 레이아웃이 간접 렌더하는 `TripNewStep1Page`가
 * `useRegions`(→ `useQuery`)를 물어 provider 없는 이 node 버킷에서 render 가 던진다. 승인
 * `TripNewStep1Page.test.tsx` 목과 같은 형태로 `useRegions` 만 갈아끼우고 `filterRegions` 는
 * requireActual 실물을 쓴다. 슬러그 6코드 동기 반환이라 기존 testID 가 그대로 산다. 단언 무변경.
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

/** 기준일 고정 — 실행일이 바뀌어도 단언이 흔들리지 않는다. */
const BASE = '2026-06-10';

const store = () => useTripWizardStore.getState();
const seedIds = () => store().mustVisits.map((one) => one.sourcePoiId);

function seed(sourcePoiId: string): MustVisitSeedItem {
  return { sourcePoiId, name: `장소-${sourcePoiId}`, imageUrl: null };
}

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

function loaded(places: SavedPlace[]) {
  return {
    savedPlaces: places,
    isPending: false,
    isError: false,
    refetch: mockRefetch,
    remove: mockRemove,
  };
}

beforeEach(() => {
  // 모듈 싱글턴이라 앞 테스트가 남긴 드래프트가 뒤 테스트로 샌다.
  store().reset();
  mockRefetch.mockClear();
  mockRemove.mockClear();
  setAccessToken('valid-access');
  mockSavedPlaces = loaded([]);
});

afterEach(() => clearAccessToken());

describe('FW · 위저드 셸 진입이 시드를 초기화한다 (AC-1 · 01b D1)', () => {
  it('🔴 FW-1 셸이 마운트되면 이전 여행의 시드와 채움 플래그가 초기값으로 돌아간다', () => {
    // 준비 — 여행을 한 번 만든 뒤의 드래프트. 앱을 끄지 않았으므로 이 값이 그대로 살아 있다.
    store().initMustVisits([seed('poi-old-1'), seed('poi-old-2')]);
    expect(seedIds()).toEqual(['poi-old-1', 'poi-old-2']);

    // 실행 — 바깥에서 위저드에 새로 들어온다.
    render(<TripWizardLayout />);

    expect({
      mustVisits: store().mustVisits,
      initialized: store().mustVisitsInitialized,
    }).toEqual({ mustVisits: [], initialized: false });

    // 짝(긍정) — 셸은 여전히 제 일(자식 스택 그리기)을 한다. 초기화만 하는 컴포넌트로
    // 변질되면 위저드 화면이 아예 안 뜬다.
    expect(screen.getByTestId('gate-stack')).toBeOnTheScreen();
  });

  it('FW-2 새 진입 뒤 지금 담은 목록이 있어도 "꼭 갈 곳"은 다시 채워지지 않는다', () => {
    // 준비 — 이전 여행의 시드 하나 + 그때 사용자가 x 로 뺀 기억 하나.
    store().initMustVisits([seed('poi-old-1'), seed('poi-2')]);
    store().removeMustVisit('poi-2');
    expect(seedIds()).toEqual(['poi-old-1']);

    // 지금 담은 목록은 이전 여행과 전혀 다르다 — 그래도 이제는 반영되지 않는다(자동 재시드
    // 폐지, 위 파일 헤더 참고).
    mockSavedPlaces = loaded([
      savedPlace('poi-1', '감천마을'),
      savedPlace('poi-2', '광안리'),
    ]);

    // 실행 — 담은 목록을 실제로 조회하는 화면을 셸과 함께 마운트해도(더 강한 조건) 아무것도
    // 새어 들어오지 않는지를 본다.
    render(
      <>
        <TripNewStep1Page baseDate={BASE} />
        <TripWizardLayout />
      </>
    );

    // 단언 — 이전 여행의 `poi-old-1` 을 물려받지 않고(증상 A 방지는 그대로 유효),
    // 지금 담은 목록으로 다시 채워지지도 않는다(자동 시드 폐지) — 항상 빈 상태다.
    expect(seedIds()).toEqual([]);
  });

  it('FW-3 리렌더는 진입이 아니다 — 사용자가 x 로 뺀 편집이 살아남는다', () => {
    // 준비 — 이미 진입해 시드를 받고, 한 곳을 뺐다.
    render(<TripWizardLayout />);
    store().initMustVisits([seed('poi-1'), seed('poi-2'), seed('poi-3')]);
    store().removeMustVisit('poi-2');
    expect(seedIds()).toEqual(['poi-1', 'poi-3']);

    // 실행 — 셸이 다시 그려진다(마운트가 아니라 리렌더다).
    screen.rerender(<TripWizardLayout />);

    // 단언 — 초기화를 렌더 본문이나 의존성 있는 효과에 걸면 여기서 편집이 날아간다.
    // step1 ↔ step2 왕복과 더 담기 왕복이 실제로 밟는 자리가 이것이다(01b D1 의 경계).
    expect(seedIds()).toEqual(['poi-1', 'poi-3']);
  });

  it('🔴 FW-4 초기화는 시드 3필드만 비운다 — 사용자가 손으로 채운 드래프트는 살아남는다', () => {
    // 준비 ① — 사용자가 위저드에서 **직접 채운** 것들. 액션을 부른 순서가 그대로
    // `touched` 배열의 순서가 된다(스토어는 건드린 축을 뒤에 이어 붙인다).
    store().addDestination('부산', 2);
    store().setPeriod('3n4d', '2026-06-10', '2026-06-13');
    store().setParty(3);
    store().selectCompanion('가족');
    store().setBudgetText('1,200,000');

    // 준비 ② — 앱을 끄지 않고 **이전 여행을 하나 만든 뒤**의 흔적: 시드 2건과, 그중 한 곳을
    // x 로 뺀 기억.
    // ⚠️ `createdTripId` 는 일부러 **단언하지 않는다** — 사용자가 친 값이 아니라 "직전에 만든
    // 여행의 id"라, 새 진입에서 남아야 하는지 비워져야 하는지 정본(01b AC-1 · D1)에 답이 없다.
    // 여기서 채우는 것은 재현 상태를 실제와 같게 만들기 위해서고, 남기든 지우든 이 케이스는
    // 통과한다(판정 근거는 02a §9).
    store().setCreatedTripId('trip-1');
    store().initMustVisits([seed('poi-old-1'), seed('poi-old-2')]);
    store().removeMustVisit('poi-old-2');
    expect(seedIds()).toEqual(['poi-old-1']);

    // 실행 — 바깥에서 위저드에 새로 들어온다.
    render(<TripWizardLayout />);

    // 단언 ① (긍정) — 사용자가 친 것은 **한 글자도** 사라지지 않는다. AC-1 이 초기화를 요구한
    // 것은 시드 3개뿐이고, 나머지가 재진입에도 남는 것은 이 모듈이 스스로 적어 둔 계약이다
    // (BR-U1-33 — `tripWizardStore.ts` 머리말). 드래프트를 통째로 되씌우는 초기화는 여기서 죽는다.
    expect({
      destinations: store().destinations,
      startDate: store().startDate,
      endDate: store().endDate,
      presetCode: store().presetCode,
      party: store().party,
      companionType: store().companionType,
      budgetText: store().budgetText,
      touched: store().touched,
    }).toEqual({
      destinations: [{ seq: 1, region: '부산', nights: 2 }],
      startDate: '2026-06-10',
      endDate: '2026-06-13',
      presetCode: '3n4d',
      party: 3,
      companionType: '가족',
      budgetText: '1,200,000',
      touched: ['destinations', 'period', 'party', 'companion', 'budget'],
    });

    // 단언 ② (부정 짝) — 그렇다고 초기화를 **아예 안 하는** 구현이 통과하면 안 된다.
    // 시드와 채움 플래그는 비어 있다.
    expect({
      mustVisits: store().mustVisits,
      initialized: store().mustVisitsInitialized,
    }).toEqual({ mustVisits: [], initialized: false });

    // 단언 ③ (부정 짝 · **동작으로**) — "뺀 곳 기억"도 함께 비워졌다. 필드 이름을 부르지 않고
    // 재시드를 한 번 태워 확인한다: 기억이 남아 있으면 `poi-old-2` 가 걸러져 빈 목록이 된다
    // (실측 02a §9 P-C). 이름 대신 동작으로 물어야 구현자가 저장 형태를 고를 수 있다.
    store().addMustVisits([seed('poi-old-2')]);
    expect(seedIds()).toEqual(['poi-old-2']);
  });
});

/**
 * TRIP-601 가드 c — 새 여행이 옛 `createdTripId` 를 재사용하는 것을 막는다.
 *
 * 무엇을 보장하나: 위저드 셸이 **진짜 신규로 마운트**되면 직전 여행이 남긴 `createdTripId` 가
 * `undefined` 로 비워진다(정본 공백을 자율 세션 가정으로 메움 — 01b §4 결정 2, 개발로그 명시 몫).
 * 그래야 새 여행이 옛 tripId 를 물고 그 일정을 이어받는 오염("기존 일정을 새로 만들겠다는 표시")이
 * 사라진다.
 *
 * ★ 심판 0건 위에 처음 세우는 red 다(`createdTripId`·`setCreatedTripId` 는 TRIP-206 신규, structure.md:80).
 * ★ 클리어는 `resetMustVisits` **안이 아니라 셸에서 별도로** — d02 시드 경로(`preserveMustVisitsOnce`)는
 *   `resetMustVisits` 를 건너뛰므로, 그 안에 넣으면 d02(=새 여행)에서 안 비워진다(GC-3 가 이 위치를 잡는다).
 * ★ 마운트에만 — step1↔step2 왕복(리렌더, 재마운트 없음)은 진행 중 만든 id 를 보존해야 한다(GC-4 freeze).
 *
 * ⚠️ jest 가 못 보는 것(01b D4 · 6-b 실기 몫): (1) step1↔step2 가 실제로 셸을 재마운트 안 하는가,
 * (2) 소비자 `TripNewStep1Page.tsx:516` 재사용 경로가 pendingMustVisits>0 상태에서 실제로 안 타는가.
 * 여기서 잠그는 건 **store 필드 전이**(마운트=비움 / 리렌더=보존)까지다.
 */
describe('GC · 위저드 셸 진입이 옛 createdTripId 를 비운다 (TRIP-601 가드 c · 01b 결정 2)', () => {
  it('🔴 GC-1 신규 진입(셸 마운트)이면 직전 여행의 createdTripId 가 undefined 로 비워진다', () => {
    // 준비 — 직전 여행이 남긴 id. 앱을 끄지 않았으므로 이 값이 그대로 살아 있다.
    store().setCreatedTripId('trip-A');
    expect(store().createdTripId).toBe('trip-A');

    // 실행 — 바깥에서 위저드에 새로 들어온다(셸 마운트).
    render(<TripWizardLayout />);

    // 단언 ① — 옛 id 가 비워진다(새 여행은 옛 tripId 를 물지 않는다).
    expect(store().createdTripId).toBeUndefined();
    // 단언 ② (짝) — 셸은 여전히 제 일(자식 스택 그리기)을 한다.
    expect(screen.getByTestId('gate-stack')).toBeOnTheScreen();
  });

  it('🔴 GC-2 소비자 페이지가 함께 떠도 신규 진입은 옛 createdTripId 를 비운다(재사용 기제 차단)', () => {
    // 준비 — 옛 id 가 남은 채, 소비자(step1)가 그 필드를 읽는 상황을 합성으로 만든다.
    store().setCreatedTripId('trip-A');

    // 실행 — 소비자 페이지와 셸을 함께 마운트(FW-2 와 같은 합성). 소비자 `TripNewStep1Page.tsx:516`
    // 의 재사용 조기경로는 `createdTripId !== undefined` 를 선행조건으로 읽는다.
    render(
      <>
        <TripNewStep1Page baseDate={BASE} />
        <TripWizardLayout />
      </>
    );

    // 단언 — 셸이 그 필드를 비우므로 재사용 선행조건이 깨진다(옛 A 로 등록하는 경로 불성립).
    // ⚠️ pendingMustVisits>0 에서 [다음] 눌러 실제 재사용이 발화하는 end-to-end 는 6-b 실기 몫이다
    // (그 상태는 직전 등록 실패로만 만들어지는 페이지 지역 state — jest 재현이 무겁고 거짓 green 위험).
    expect(store().createdTripId).toBeUndefined();
  });

  it('🔴 GC-3 d02 시드 경로에서도 createdTripId 는 비워진다 — 단 d02 시드 자체는 보존된다(★c-2 우회)', () => {
    // 준비 — d02 "이 장소들로 여행 만들기" 가 시드를 심고 preserveMustVisitsOnce 를 켠 상태 + 옛 id.
    store().seedMustVisitsFromD02([seed('poi-1')]);
    store().setCreatedTripId('trip-A');
    expect(store().createdTripId).toBe('trip-A');

    // 실행 — 셸 마운트. 이 경로는 resetMustVisits 를 **건너뛴다**(preserveMustVisitsOnce).
    render(<TripWizardLayout />);

    // 단언 ① — 그래도 createdTripId 는 비워진다. 클리어를 resetMustVisits 안이나 조기 반환 뒤에 두면
    // 이 경로가 건너뛰어 'trip-A' 로 남는다 → 여기서 red 로 잡힌다.
    expect(store().createdTripId).toBeUndefined();
    // 단언 ② (짝) — d02 가 방금 심은 시드는 살아남는다(preserve 경로 유효 · 과잉 삭제 방지).
    expect(seedIds()).toEqual(['poi-1']);
  });

  it('🟢 GC-4 리렌더는 진입이 아니다 — 진행 중 만든 createdTripId 는 살아남는다(재개 보존 · freeze)', () => {
    // 준비 — 이미 진입해 셸이 마운트된 뒤(이 시점 createdTripId 는 undefined), step1 제출이 여행을
    // 만들어 id 를 세팅한 상황.
    render(<TripWizardLayout />);
    store().setCreatedTripId('trip-new');
    expect(store().createdTripId).toBe('trip-new');

    // 실행 — 셸이 다시 그려진다(step1↔step2 왕복 = 리렌더, 마운트 아님).
    screen.rerender(<TripWizardLayout />);

    // 단언 — 클리어를 렌더 본문이나 의존성 있는 효과에 걸면 여기서 진행 중 id 가 날아간다(재개 파손).
    // 마운트에만 걸려 있어야 이 값이 산다(FW-3 와 동형의 경계).
    expect(store().createdTripId).toBe('trip-new');
  });
});
