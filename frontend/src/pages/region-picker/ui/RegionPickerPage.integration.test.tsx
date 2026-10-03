import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';
import { regionPickerHref } from '@/features/explore/model/regionPickerPurpose';
import type * as TripWizardStoreModule from '@/features/create-trip/model/tripWizardStore';

import { RegionPickerPage } from './RegionPickerPage';

/**
 * TRIP-597 — e00·d1b 지역 선택 배선(표면 A 드릴다운). 페이지는 전체 카탈로그를 화면에 내리고
 * (6개 상한 `limitRegionsWhenEmpty` 제거 → 그룹 접기가 대체), 화면이 시/도→구/군 드릴다운으로
 * 접는다. 선택은 **실제 목적지 라우팅**으로 잇고, 조회 실패를 실패 얼굴로 그린다.
 *
 * 무엇이 바뀌었나(현행 TRIP-499 대비):
 *  · 빈 검색어 초기 뷰가 "앞 6개 카드"가 아니라 **시/도 행(그룹)**이다 — 6-cap 테스트를 그룹핑
 *    테스트로 교체했다(02a §1). 라우팅은 초기 카드 press 가 아니라 **검색 경로·드릴다운 경로**로 한다.
 *
 * ⚠️ `jest.mock` 팩토리는 최상단으로 호이스팅된다 — 팩토리가 참조하는 바깥 변수는 이름이 `mock`으로
 * 시작해야 예외를 받는다(리포 확립 규칙). 이 이름을 바꾸지 마라(★9). `useRegions`만 갈아끼우고
 * `filterRegions`·`regionTint`·`groupRegionsBySido`는 requireActual 실물을 쓴다(순수라 안전, ★1).
 *
 * 한 파일로 합친 기록(TRIP-1147): 옛 `RegionPickerPage.nightsSync.test.tsx`(node 버킷, **실제** 위저드
 * 스토어)를 아래 `실제 스토어에 담긴 결과` describe 로 옮겼다. 두 관점은 같은 스토어 모듈을 다르게 다룬다
 * — 위쪽은 목으로 바꿔 `addDestination` 호출 **인자**를 보고, 아래쪽은 실물 스토어에 **담긴 결과**를
 * 읽는다. `jest.mock` 은 파일 전체에 걸리므로(describe 마다 다르게 못 건다) 목 하나에 관점 스위치
 * `mockUseRealWizardStore` 를 두고, 목이 **불릴 때** 그 값을 읽어 실물로 넘길지 정한다(1146 로그인 통합
 * 선례). 스위치를 빼면 아래쪽 케이스가 전부 red 다(실측 — 목이 실물을 대신한 채 green 이 되지 않는다).
 */

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockDismissTo = jest.fn();
const mockRefetch = jest.fn();
const mockAddDestination = jest.fn();
let mockParams: { purpose?: string; tab?: string } = {};
// 관점 스위치 — true 면 위저드 스토어 목이 실물로 넘긴다(`실제 스토어에 담긴 결과` describe 만 켠다).
// 리셋은 파일 최상위 afterEach(모듈 싱글턴 규칙 — describe 안에서만 끄면 다음 관점으로 샌다).
let mockUseRealWizardStore = false;
let mockRegionsResult: {
  data: Region[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
};

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    dismissTo: mockDismissTo,
  }),
  useLocalSearchParams: () => ({ ...mockParams }),
}));

jest.mock('@/features/explore/model/regions', () => ({
  ...jest.requireActual('@/features/explore/model/regions'),
  useRegions: () => mockRegionsResult,
}));

// TRIP-683 AC-1 — trip 분기가 스토어에 담는다. 셀렉터 형태(`useTripWizardStore((s)=>s.addDestination)`)를
// 그대로 받아 스파이를 돌려준다(호출 관측). 변수명은 팩토리 호이스팅 예외라 `mock`으로 시작해야 한다(★9).
// TRIP-1010(Q1): 첫 여행지를 담을 때 페이지가 기간·기존 여행지 수를 읽게 된다. 목 상태를 "여행지 0곳 ·
// 기간 없음"(= 1박으로 담는 옛 동작)으로 넓혀, 셀렉터로 읽든 `getState()` 로 읽든 크래시 없이 돈다.
// 이 파일의 단언(`('…', 1)`)은 그 상태에서 그대로 유효하다. 담긴 결과(박수·끝 날짜·코드)는 아래
// `실제 스토어에 담긴 결과` describe 가 스위치를 켜고 실물 스토어에서 읽는다.
jest.mock('@/features/create-trip/model/tripWizardStore', () => {
  const actual = jest.requireActual<typeof TripWizardStoreModule>(
    '@/features/create-trip/model/tripWizardStore'
  );
  const mockWizardState = () => ({
    addDestination: mockAddDestination,
    destinations: [],
    startDate: undefined,
    endDate: undefined,
  });
  // 스위치는 렌더·getState 가 **불리는 순간** 읽는다 — 팩토리 실행 시점(파일 맨 위)에 읽으면 늘 false 다.
  const useMockOrRealStore = (
    selector: (s: ReturnType<typeof mockWizardState>) => unknown
  ) =>
    mockUseRealWizardStore
      ? actual.useTripWizardStore(selector as never)
      : selector(mockWizardState());
  return {
    ...actual,
    useTripWizardStore: Object.assign(useMockOrRealStore, {
      getState: () =>
        mockUseRealWizardStore
          ? actual.useTripWizardStore.getState()
          : mockWizardState(),
    }),
  };
});

/** 실물 스토어 — 목을 거치지 않고 직접 읽고 리셋한다(목 팩토리의 requireActual 과 같은 인스턴스). */
const { useTripWizardStore: realWizardStore } = jest.requireActual<
  typeof TripWizardStoreModule
>('@/features/create-trip/model/tripWizardStore');

/** 서버 `Region` 표본 도우미. */
function region(
  over: Partial<Region> & Pick<Region, 'regionCode' | 'name'>
): Region {
  return {
    sidoName: over.sidoName ?? '',
    level: over.level ?? RegionLevel.SIGUNGU,
    selectable: over.selectable ?? true,
    poiCount: over.poiCount ?? 5,
    ...over,
  };
}

// 시도·시군구 혼재 카탈로그(법정동 앞자리 현실값). 인천 28(시도) / 미추홀 28177 / 연수 28185 /
// 강원 51(시도) / 춘천 51110. 1단이 인천·강원 두 시/도로 접혀야 한다.
//
// ⚠️ 크기·순서 계약(TRIP-597 심판 무결성): 이 티켓의 헤드라인은 페이지가 빈 검색어 6개 상한
// (`limitRegionsWhenEmpty`, 기본 limit=6)을 **걷고 전체 카탈로그를 내리는 것**이다. 그 상한이
// 실수로 되살아나면 `slice(0, 6)`가 앞 6개만 남긴다 — 이를 심판이 잡으려면 **테스트가 실제로
// 누르는 시군구가 flat 인덱스 6 이상**에 있어야 한다(5개짜리 카탈로그에선 `slice(0, 6)`가 항등이라
// 상한 회귀를 구분조차 못 한다 — 옛 `SEVEN_REGIONS`가 7개였던 이유, code-critic 03b 차단-1).
// 그래서 시/도 행 5개로 앞자리를 채우고 인천의 시군구(미추홀 28177·연수 28185)를 **꼬리(인덱스
// 6·7)**로 밀었다. 상한이 되살면 두 시군구가 잘려 AC-3 드릴다운-stay(미추홀구 press)가 red 가 된다.
const INCHEON = region({
  regionCode: '28',
  name: '인천광역시',
  level: RegionLevel.SIDO,
  sidoName: '인천광역시',
  selectable: true,
  poiCount: 50,
});
const SEOUL = region({
  regionCode: '11',
  name: '서울특별시',
  level: RegionLevel.SIDO,
  sidoName: '서울특별시',
  selectable: true,
  poiCount: 120,
});
const BUSAN = region({
  regionCode: '26',
  name: '부산광역시',
  level: RegionLevel.SIDO,
  sidoName: '부산광역시',
  selectable: true,
  poiCount: 80,
});
const DAEGU = region({
  regionCode: '27',
  name: '대구광역시',
  level: RegionLevel.SIDO,
  sidoName: '대구광역시',
  selectable: true,
  poiCount: 40,
});
const GANGWON = region({
  regionCode: '51',
  name: '강원특별자치도',
  level: RegionLevel.SIDO,
  sidoName: '강원특별자치도',
  selectable: false,
  poiCount: 30,
});
const CHUNCHEON = region({
  regionCode: '51110',
  name: '춘천시',
  level: RegionLevel.SIGUNGU,
  sidoName: '강원특별자치도',
  poiCount: 12,
});
const MICHUHOL = region({
  regionCode: '28177',
  name: '미추홀구',
  level: RegionLevel.SIGUNGU,
  sidoName: '인천광역시',
  poiCount: 8,
});
const YEONSU = region({
  regionCode: '28185',
  name: '연수구',
  level: RegionLevel.SIGUNGU,
  sidoName: '인천광역시',
  poiCount: 5,
});

// 인덱스: 0 인천 · 1 서울 · 2 부산 · 3 대구 · 4 강원 · 5 춘천 · 6 미추홀구 · 7 연수구.
// 인천 시군구(미추홀·연수)가 인덱스 6·7 — 상한(6) 되살면 이 둘이 잘려 인천 드릴다운이 빈다.
const CATALOG: Region[] = [
  INCHEON,
  SEOUL,
  BUSAN,
  DAEGU,
  GANGWON,
  CHUNCHEON,
  MICHUHOL,
  YEONSU,
];

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockDismissTo.mockClear();
  mockRefetch.mockClear();
  mockAddDestination.mockClear();
  mockParams = {};
  mockRegionsResult = {
    data: CATALOG,
    isPending: false,
    isError: false,
    refetch: mockRefetch,
  };
});

afterEach(() => {
  mockUseRealWizardStore = false;
  realWizardStore.getState().reset();
});

describe('AC-1 · 페이지가 전체 카탈로그를 내리고 화면이 시/도로 접는다 (6-cap 아님)', () => {
  it('빈 검색어 초기 뷰는 시/도 행이고, 구/군(미추홀구)은 접혀 부재다', () => {
    render(<RegionPickerPage />);

    // 시/도 행이 보인다 — 페이지가 6개로 자르지 않고 전량을 내려 화면이 접었다.
    expect(screen.getByTestId('explore-region-sido-28')).toBeTruthy();
    expect(screen.getByTestId('explore-region-sido-51')).toBeTruthy();
    // 구/군은 시/도 안으로 접힘 — 1단에 없다(그룹 접기가 6-cap 을 대체).
    expect(screen.queryByTestId('explore-region-28177')).toBeNull();
  });
});

describe('AC-6 · 검색 경로 → 원본 카탈로그 이름으로 라우팅 (TRIP-387 성질 · TRIP-989 F-1)', () => {
  it('검색으로 좁힌 뒤 구/군 카드를 누르면 그 지역명을 쿼리에 실어 /stays로 되감는다 (purpose 없음 = stay)', () => {
    // 준비: purpose 없이 진입 — URL 신뢰 경계가 stay 로 떨어뜨리는 폴백 경로도 dismissTo 로 가야 한다(02a ★9).
    render(<RegionPickerPage />);

    // 검색 — '춘천'으로 좁히면 평면 카드(드릴다운 우회).
    fireEvent.changeText(screen.getByTestId('explore-region-search'), '춘천');
    fireEvent.press(screen.getByTestId('explore-region-51110'));

    // 서버 `region`은 자유 문자열 계약이라 원본 카탈로그의 한글 이름을 그대로 보낸다(코드 아님).
    // TRIP-989 F(D16) — push 가 아니라 dismissTo: 스택 아래 결과 화면으로 되감아 지역만 바꾼다(화면이 안 쌓인다).
    expect(mockDismissTo.mock.calls).toEqual([
      [`/stays?region=${encodeURIComponent('춘천시')}`],
    ]);
    expect(mockPush).not.toHaveBeenCalled();
    // 좁혀졌는지도 함께 본다 — 필터가 안 걸리면 이 단언이 무의미해진다.
    expect(screen.queryByTestId('explore-region-28177')).toBeNull();
  });
});

describe('AC-1 · 여행지 담기 재배선 (trip 분기 — TRIP-683)', () => {
  it("purpose='trip' 에서 지역을 고르면 addDestination(name,1)+router.back, /explore/destination push 0회", () => {
    // 준비: trip 목적으로 진입해 인천을 드릴인(기존 파일의 검증된 경로).
    mockParams = { purpose: 'trip' };
    render(<RegionPickerPage />);
    fireEvent.press(screen.getByTestId('explore-region-sido-28')); // 인천 드릴인

    // 실행: '인천 전체' 행 press = trip 목적 지역 선택.
    fireEvent.press(screen.getByTestId('explore-region-28'));

    // 단언: 지역 '이름'으로 1박 담고(★5 — 화면은 이름을 그린다), 코드도 함께 넘기며(TRIP-1042 AC-12 —
    // 꼭 갈 곳 지역 판정·생성 요청이 코드를 쓴다), 위저드로 복귀하고, d03(탐색)로 이탈하지 않는다.
    expect(mockAddDestination).toHaveBeenCalledTimes(1);
    expect(mockAddDestination).toHaveBeenCalledWith('인천광역시', 1, '28');
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalledWith(
      expect.stringContaining('/explore/destination')
    );
  });
});

describe('AC-4 · stay 분기 (드릴다운 → /stays 되감기, TRIP-989 F-1 · D16)', () => {
  it('드릴다운 안 구/군 카드를 누르면 그 구/군 이름으로 /stays 까지 dismissTo 한다 (헬퍼 철자 stay)', () => {
    // 준비: 호출자(StaySearchPage)와 같은 헬퍼 철자로 진입한다 — 철자 사슬의 stay 고리(02a ★9).
    mockParams = { purpose: purposeParamOf(regionPickerHref('stay')) };
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-sido-28')); // 인천 드릴인
    fireEvent.press(screen.getByTestId('explore-region-28177')); // 미추홀구

    expect(mockDismissTo.mock.calls).toEqual([
      [`/stays?region=${encodeURIComponent('미추홀구')}`],
    ]);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockAddDestination).not.toHaveBeenCalled();
  });
});

describe('INV-4 · 조회 실패 (이월 유지)', () => {
  it('isError면 실패 얼굴을 그리고 "검색 결과가 없어요"로 뭉개지 않으며, 재시도는 refetch를 부른다', () => {
    mockRegionsResult = {
      data: undefined,
      isPending: false,
      isError: true,
      refetch: mockRefetch,
    };
    render(<RegionPickerPage />);

    expect(screen.getByTestId('explore-region-error')).toBeTruthy();
    expect(screen.queryByText('검색 결과가 없어요')).toBeNull();

    fireEvent.press(screen.getByTestId('explore-region-error-retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("AC · '내 주변' 배선이 렌더에 없다 (이월 유지)", () => {
  it("purpose='stay'에서도 '내 주변' 진입이 없다", () => {
    render(<RegionPickerPage />);

    expect(screen.queryByTestId('explore-region-nearby')).toBeNull();
    expect(screen.queryByText('내 주변')).toBeNull();
  });
});

// ── TRIP-985 · purpose 분리 (explore → 목적지 결과, places → d04 지역 교체) ──────────────
//
// 새 케이스의 purpose 는 리터럴로 쓰지 않고 **공유 헬퍼가 만든 URL 에서 꺼낸다**. 호출자 테스트도
// 같은 헬퍼 출력을 기대값으로 쓰므로, 피커의 해석부가 다른 철자를 비교하면 stay 로 떨어져 여기가
// red 가 된다(철자 사슬, 02a ★1).
function purposeParamOf(href: string): string {
  const match = /[?&]purpose=([^&#]*)/.exec(href);
  if (!match) throw new Error(`purpose 쿼리가 없다: ${href}`);
  return match[1];
}

// TRIP-1105 — 결과 화면이 목적지 상세(`/explore/destination/{code}`)에서 탐색 탭 d01 지역 필터
// (`/explore?region={code}`)로 바뀌었다(결정 1 = A). 주소 모양(문자열/객체)은 구현 몫이라 아래
// `targetOf` 로 "경로 + 파라미터"로 펴서 본다. 코드를 싣는 계약(이름 아님)은 그대로다.
describe('985 · 1105 · explore → 탐색 탭 d01 을 **코드**로 부른다 (US-EXPL-02 · D11)', () => {
  it('검색으로 부산광역시를 고르면 dismissTo(/explore, region=26) 1회, 담기·push·back 0회', () => {
    mockParams = { purpose: purposeParamOf(regionPickerHref('explore')) };
    render(<RegionPickerPage />);
    fireEvent.changeText(screen.getByTestId('explore-region-search'), '부산');

    fireEvent.press(screen.getByTestId('explore-region-26'));

    // 이름('부산광역시')을 보내면 d01 칩은 멀쩡한데 레인이 조용히 빈다 — 그래서 코드 완전 일치.
    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(targetOf(mockDismissTo.mock.calls[0][0])).toEqual({
      path: '/explore',
      params: { region: '26' },
    });
    expect(mockAddDestination).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('드릴다운으로 구/군(미추홀구)을 골라도 이름이 아니라 코드 28177 로 부른다', () => {
    mockParams = { purpose: purposeParamOf(regionPickerHref('explore')) };
    render(<RegionPickerPage />);
    fireEvent.press(screen.getByTestId('explore-region-sido-28')); // 인천 드릴인

    fireEvent.press(screen.getByTestId('explore-region-28177'));

    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(targetOf(mockDismissTo.mock.calls[0][0])).toEqual({
      path: '/explore',
      params: { region: '28177' },
    });
    expect(mockAddDestination).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('985 · places → d04 로 돌아가며 지역 **이름**을 교체한다 (D11)', () => {
  it('부산광역시를 고르면 dismissTo({ /explore/places, region: 부산광역시 }) 1회, 담기·push·back 0회', () => {
    mockParams = { purpose: purposeParamOf(regionPickerHref('places')) };
    render(<RegionPickerPage />);
    fireEvent.changeText(screen.getByTestId('explore-region-search'), '부산');

    fireEvent.press(screen.getByTestId('explore-region-26'));

    // d04 는 결과 화면과 반대로 이름을 받는다(`PlaceExplorePage` 의 region 파라미터).
    expect(mockDismissTo.mock.calls).toEqual([
      [{ pathname: '/explore/places', params: { region: '부산광역시' } }],
    ]);
    expect(mockAddDestination).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('985 · 새 purpose 의 카피는 여행지 선택(trip) 카피다 (라이브 1834:2283)', () => {
  it.each(['explore', 'places'] as const)(
    '%s 는 "어디로 떠날까요?" 를 그린다',
    (purpose) => {
      mockParams = { purpose: purposeParamOf(regionPickerHref(purpose)) };
      render(<RegionPickerPage />);

      expect(screen.getByText('여행지 선택')).toBeTruthy();
      expect(screen.getByText('어디로 떠날까요?')).toBeTruthy();
      expect(screen.queryByText('어디서 묵을까요?')).toBeNull();
    }
  );
});

describe('985 · 회귀 — 헬퍼 철자의 trip 도 위저드 담기 그대로 (TRIP-683 AC-1)', () => {
  it('부산광역시를 고르면 addDestination(이름,1)+back 1회이고 dismissTo·push 는 0회', () => {
    mockParams = { purpose: purposeParamOf(regionPickerHref('trip')) };
    render(<RegionPickerPage />);
    fireEvent.changeText(screen.getByTestId('explore-region-search'), '부산');

    fireEvent.press(screen.getByTestId('explore-region-26'));

    expect(mockAddDestination.mock.calls).toEqual([['부산광역시', 1, '26']]);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('985 · URL 신뢰 경계 — 헬퍼에 없는 철자는 stay 로 떨어진다', () => {
  it("'explorer'(explore 오타)는 숙소 카피를 그리고, 골라도 위저드에 담지 않는다", () => {
    // 이 케이스만 리터럴이다 — "헬퍼에 없는 철자"가 목적이다. 이동은 단언하지 않는다(stay 분기는 989 소관).
    mockParams = { purpose: 'explorer' };
    render(<RegionPickerPage />);

    expect(screen.getByText('어디서 묵을까요?')).toBeTruthy();
    expect(screen.queryByText('어디로 떠날까요?')).toBeNull();

    fireEvent.changeText(screen.getByTestId('explore-region-search'), '부산');
    fireEvent.press(screen.getByTestId('explore-region-26'));

    expect(mockAddDestination).not.toHaveBeenCalled();
  });
});

// ── TRIP-1105 · 진입 탭 신호(TRIP-1015 E) 폐기 ────────────────────────────────────────────
// 결과가 진짜 탭바를 쓰는 탐색 탭 d01 로 가므로 탭바는 진입 경로와 상관없이 늘 '탐색'이다. 그래서
// 피커는 `tab` 을 되싣지 않는다. 옛 URL(`&tab=home`)이 캐시·딥링크로 남아 들어와도 결과 주소에 새지
// 않아야 한다 — 헬퍼는 더 이상 tab 을 만들지 못하므로 그 파라미터를 손으로 준다.

/** dismissTo 인자(문자열 또는 {pathname, params})를 "경로 + 파라미터"로 편다(02a ★16). */
function targetOf(arg: unknown): {
  path: string;
  params: Record<string, string>;
} {
  if (typeof arg === 'string') {
    const [path, query = ''] = arg.split('?');
    const params: Record<string, string> = {};
    for (const pair of query.split('&')) {
      const [k, v] = pair.split('=');
      if (k) params[k] = decodeURIComponent(v ?? '');
    }
    return { path, params };
  }
  const { pathname, params = {} } = arg as {
    pathname: string;
    params?: Record<string, unknown>;
  };
  return {
    path: pathname,
    params: Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ),
  };
}

describe('🔴 1105 · 옛 진입 탭(tab=home)이 들어와도 결과 주소에 싣지 않는다 (1015-E 반전)', () => {
  it('purpose=explore&tab=home 피커에서 부산을 고르면 /explore 로 region=26 만 실어 1회 간다', () => {
    // 준비 — 옛 홈 검색 URL 그대로의 파라미터(헬퍼가 더는 못 만들어 손으로 준다).
    mockParams = { purpose: 'explore', tab: 'home' };
    render(<RegionPickerPage />);
    fireEvent.changeText(screen.getByTestId('explore-region-search'), '부산');

    // 실행
    fireEvent.press(screen.getByTestId('explore-region-26'));

    // 단언 — tab 없이 region 하나만.
    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(targetOf(mockDismissTo.mock.calls[0][0])).toEqual({
      path: '/explore',
      params: { region: '26' },
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ── 실제 스토어에 담긴 결과 (옛 `RegionPickerPage.nightsSync.test.tsx`, TRIP-1010 · TRIP-1027 · TRIP-1042) ──
// 위저드(purpose=trip)에서 지역을 고르면 스토어 기간과 상관없이 늘 1박으로 담긴다 — 한때 "기간이 있고
// 첫 여행지면 박수 = 기간"으로 담았다가 기간 → 서울 → 부산 순서에서 합이 기간 + 1 이 되어 '다음'이
// 막혔다(03b 경고-1)라 되돌렸다. TRIP-1027 부터는 반대로 기간이 박수를 따라간다(시작 날짜가 있으면 끝이
// 1박만큼 는다). 순서 사슬(담기·시작·박수 → 1/4 다음)은 `src/__tests__/tripNightsPeriodOrder.test.tsx`.
// 3동작: 준비(스토어 선상태 + 카탈로그) → 실행(검색 '서울' → 카드 press) → 단언(스토어 destinations).
// ⚠️ 모듈 싱글턴 — 리셋은 이 describe 의 beforeEach(선상태 비우기)와 파일 최상위 afterEach(스위치·스토어).
describe('실제 스토어에 담긴 결과', () => {
  const SEOUL: Region = {
    regionCode: '11',
    name: '서울특별시',
    level: RegionLevel.SIDO,
    sidoName: '서울특별시',
    selectable: true,
    poiCount: 120,
  };

  function store() {
    return realWizardStore.getState();
  }

  /** 검색으로 좁혀 서울 카드를 누른다(검색 경로는 드릴다운 없이 평면 카드 — 위쪽 AC-6 선례). */
  function pickSeoul(): void {
    fireEvent.changeText(screen.getByTestId('explore-region-search'), '서울');
    fireEvent.press(screen.getByTestId('explore-region-11'));
  }

  beforeEach(() => {
    mockUseRealWizardStore = true;
    store().reset();
    mockParams = { purpose: 'trip' };
    mockRegionsResult = {
      data: [SEOUL],
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    };
  });

  describe('TRIP-1010 · 지역 선택은 기간과 상관없이 1박으로 담는다 (Q1 동기화 철회)', () => {
    it('기간 2박(6/10–6/12) · 여행지 0곳에서 서울을 고르면 서울 1박으로 담기고 위저드로 돌아간다', () => {
      // 준비 — 기간 먼저. "아직 0곳" 앵커로 앞 테스트 누수가 아님을 확인한다.
      store().setPeriod(undefined, '2026-06-10', '2026-06-12');
      expect(store().destinations).toHaveLength(0);
      render(<RegionPickerPage />);

      // 실행
      pickSeoul();

      // 단언 — 필드를 하나씩(객체 통째 비교 금지, 02a ★4).
      const [seoul] = store().destinations;
      expect(store().destinations).toHaveLength(1);
      expect(seoul.region).toBe('서울특별시');
      // 기간(2박)을 따라가지 않는다 — 박수는 늘 1박으로 담긴다.
      expect(seoul.nights).toBe(1);
      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    it('이미 여행지가 1곳 있으면 두 번째 여행지는 1박으로 담기고, 첫 여행지 박수도 그대로다', () => {
      // 준비 — 부산 1박 + 기간 3박.
      store().addDestination('부산', 1);
      store().setPeriod(undefined, '2026-06-10', '2026-06-13');
      render(<RegionPickerPage />);

      pickSeoul();

      expect(store().destinations).toHaveLength(2);
      expect(store().destinations[0].region).toBe('부산');
      expect(store().destinations[0].nights).toBe(1);
      expect(store().destinations[1].region).toBe('서울특별시');
      expect(store().destinations[1].nights).toBe(1);
    });

    it('기간이 아직 없으면 첫 여행지도 1박으로 담긴다 (옛 동작 유지)', () => {
      expect(store().destinations).toHaveLength(0);
      render(<RegionPickerPage />);

      pickSeoul();

      expect(store().destinations).toHaveLength(1);
      expect(store().destinations[0].nights).toBe(1);
    });
  });

  describe('TRIP-1027 AC-3 · 시작 날짜가 있으면 담는 순간 끝 날짜가 늘어난다', () => {
    it('당일(6/10–6/10) · 여행지 0곳에서 서울을 고르면 서울 1박으로 담기고 끝이 6/11 이 된다', () => {
      // 준비 — 1/4 에서 여행지 없이 시작만 고른 상태(끝 = 시작). "아직 0곳" 앵커.
      store().setPeriod(undefined, '2026-06-10', '2026-06-10');
      expect(store().destinations).toHaveLength(0);
      render(<RegionPickerPage />);

      // 실행
      pickSeoul();

      // 단언 — 박수는 1박, 시작은 그대로, 끝은 시작 + 1.
      expect(store().destinations).toHaveLength(1);
      expect(store().destinations[0].nights).toBe(1);
      expect(store().startDate).toBe('2026-06-10');
      expect(store().endDate).toBe('2026-06-11');
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔴 TRIP-1042 AC-12 · 지역 피커가 쥔 코드가 스토어 목적지에 담긴다 (맹점 ①)', () => {
    it('서울(11)을 고르면 목적지에 이름과 함께 regionCode 11 이 담긴다', () => {
      expect(store().destinations).toHaveLength(0);
      render(<RegionPickerPage />);

      pickSeoul();

      const [seoul] = store().destinations;
      expect(seoul.region).toBe('서울특별시');
      expect(seoul.regionCode).toBe('11');
    });
  });
});
