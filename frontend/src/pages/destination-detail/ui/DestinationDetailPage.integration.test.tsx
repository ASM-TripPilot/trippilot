import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Region, StayItem } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';
import { stayKey } from '@/features/stay/model/stayKey';
import { regionPickerHref } from '@/features/explore/model/regionPickerPurpose';

import { DestinationDetailPage } from './DestinationDetailPage';

/**
 * U1 소급 백필(20260824) · d03 목적지 상세 배선 회귀 심판.
 *
 * 무엇을 보장하나: 이 페이지(`DestinationDetailPage`)는 URL 에 실린 **regionCode 하나**로
 * 숙소·장소 두 레인을 채운다. 커밋 7cda1f5(발표용 domo, 사이클 없이 들어옴)로 137줄이
 * 무심판이었다. 여기서 잠그는 두 위험:
 *
 *  1) **regionCode → 지역명 역인덱스 + enabled 게이팅** — 서버 파라미터(`region`)는 코드가
 *     아니라 *이름* 기반이라, 이름이 풀리기 전(useRegions 캐시 미도착·못 찾음)에는 두 조회를
 *     `enabled:false` 로 꺼 둬야 한다. 안 그러면 코드 문자열이 그대로 region 에 실려 아무 것도
 *     안 걸리는 조회가 나간다. 이 심판은 `useStaySearch`/`useGetPlaces` 목이 **받은 인자**를
 *     직접 검사해 역인덱스와 게이팅을 함께 증명한다.
 *  2) **라우팅 배선** — 검색바·탭·카드·모두보기가 각자 올바른 목적지로 push/replace 하는가.
 *
 * (개념) `jest.mock` 팩토리는 파일 최상단으로 호이스팅되므로, 팩토리가 참조하는 바깥 변수는
 * 이름이 `mock` 으로 시작해야 예외를 받는다(리포 확립 규칙, `RegionPickerPage.integration` ★9).
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: { region?: string } = {};

// 두 데이터 훅이 받은 인자를 캡처하는 스파이 — 게이팅·역인덱스 증명의 핵심.
const mockUseStaySearch = jest.fn();
const mockUseGetPlaces = jest.fn();
let mockToken: string | null = 'tkn';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => ({ ...mockParams }),
}));

jest.mock('@/features/explore/model/regions', () => ({
  ...jest.requireActual('@/features/explore/model/regions'),
  useRegions: () => mockRegionsResult,
}));

jest.mock('@/features/stay/model/useStaySearch', () => ({
  useStaySearch: (...args: unknown[]) => mockUseStaySearch(...args),
}));

jest.mock('@/shared/api/generated/places/places', () => ({
  useGetPlaces: (...args: unknown[]) => mockUseGetPlaces(...args),
}));

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => ({ savedPoiIds: ['poi-1', 'poi-2'] }),
}));

// TRIP-709 AC-8 — 페이지가 새로 무는 숙소 담기 훅. 목이 없으면 P1~P3(QueryClientProvider 없는
// 렌더)가 `No QueryClient` 로 크래시한다(traps-shell "새 훅이면 새 목"). 동시에 save/remove 실호출
// 관측 seam 을 준다(useState 토글이면 spy 0회 → red, 거짓말 방지). 목 팩토리 호이스팅 규약상
// 참조 변수는 `mock` 접두여야 한다.
const mockUseSavedStays = jest.fn();
const mockSave = jest.fn();
const mockRemove = jest.fn();
const mockIsSaved = jest.fn();
jest.mock('@/features/stay/model/savedStays', () => ({
  useSavedStays: (...args: unknown[]) => mockUseSavedStays(...args),
}));

jest.mock('@/shared/api/tokenManager', () => ({
  getAccessToken: () => mockToken,
}));

let mockRegionsResult: { data: Region[] | undefined };

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

const BUSAN = region({ regionCode: '26', name: '부산광역시' });

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockUseStaySearch.mockReset();
  mockUseGetPlaces.mockReset();
  mockParams = { region: '26' };
  mockToken = 'tkn';
  mockRegionsResult = { data: [BUSAN] };
  // 기본: 빈 목록·에러 없음(각 테스트가 필요 시 덮어쓴다).
  mockUseStaySearch.mockReturnValue({
    data: { items: [] },
    isError: false,
    refetch: jest.fn(),
  });
  mockUseGetPlaces.mockReturnValue({
    data: { items: [] },
    isError: false,
    refetch: jest.fn(),
  });
  // 숙소 담기 훅 기본값: 미담김·성공 응답(각 AC-8 케이스가 isSaved·savedKeys 만 덮어쓴다).
  mockSave.mockReset();
  mockRemove.mockReset();
  mockIsSaved.mockReset();
  mockIsSaved.mockReturnValue(false);
  mockSave.mockResolvedValue({ kind: 'saved' });
  mockRemove.mockResolvedValue({ kind: 'removed' });
  mockUseSavedStays.mockReset();
  mockUseSavedStays.mockReturnValue({
    isSaved: mockIsSaved,
    save: mockSave,
    remove: mockRemove,
    savedKeys: [],
  });
});

describe('P1 · regionCode → 이름 역인덱스 + enabled 게이팅', () => {
  it('캐시에서 코드로 이름을 찾으면 두 조회에 그 이름을 싣고 enabled=true 로 켠다', () => {
    render(<DestinationDetailPage />);

    // 숙소: 첫 인자 region 이 코드('26')가 아니라 이름('부산광역시'), 둘째 인자 enabled=true.
    expect(mockUseStaySearch).toHaveBeenCalledWith(
      { region: '부산광역시' },
      { enabled: true }
    );
    // 장소: 같은 이름 + limit, query.enabled=true.
    expect(mockUseGetPlaces).toHaveBeenCalledWith(
      expect.objectContaining({ region: '부산광역시' }),
      { query: { enabled: true } }
    );
  });

  it('캐시에서 코드를 못 찾으면(이름 미해결) 두 조회를 enabled=false 로 꺼 둔다', () => {
    // useRegions 캐시가 아직 비어 코드를 이름으로 못 바꾼다.
    mockRegionsResult = { data: undefined };
    render(<DestinationDetailPage />);

    // region 은 undefined, enabled=false — 코드 문자열이 region 으로 새지 않는다.
    expect(mockUseStaySearch).toHaveBeenCalledWith(
      { region: undefined },
      { enabled: false }
    );
    expect(mockUseGetPlaces).toHaveBeenCalledWith(
      expect.objectContaining({ region: undefined }),
      { query: { enabled: false } }
    );
    // 이름을 못 찾으면 헤딩은 코드를 그대로 보인다(displayName 폴백). 이 리포의
    // toHaveTextContent 는 평문=정확일치라 부분 매칭은 정규식으로 준다.
    expect(screen.getByTestId('destination-detail-heading')).toHaveTextContent(
      /26/
    );
  });
});

describe('P2 · 라우팅 배선', () => {
  it('검색바 press → 지역 선택(purpose=explore)으로 정확히 1회 간다 (TRIP-985)', () => {
    render(<DestinationDetailPage />);
    fireEvent.press(screen.getByTestId('destination-detail-search'));
    // trip 은 위저드 전용 — 다른 지역을 다시 고르면 결과 화면이 그 지역으로 바뀌어야 한다.
    expect(mockPush.mock.calls).toEqual([[regionPickerHref('explore')]]);
  });

  it('탭 press → replace(스택에 안 쌓는다)', () => {
    render(<DestinationDetailPage />);
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));
    // home 은 파일 규약상 '/(tabs)'.
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('장소 카드 press → 그 poiId 의 d06 상세로 push', () => {
    mockUseGetPlaces.mockReturnValue({
      data: {
        items: [
          {
            poiId: 'poi-9',
            nameKo: '광안리',
            region: '수영구',
            imageUrl: null,
          },
        ],
      },
      isError: false,
      refetch: jest.fn(),
    });
    render(<DestinationDetailPage />);

    fireEvent.press(screen.getByTestId('destination-detail-place-card-poi-9'));
    expect(mockPush).toHaveBeenCalledWith('/explore/places/poi-9');
  });
});

describe('P3 · 레인 에러 → 재시도가 refetch 를 부른다', () => {
  it('숙소 조회 에러면 재시도 press 가 그 쿼리의 refetch 를 부른다', () => {
    const refetch = jest.fn();
    mockUseStaySearch.mockReturnValue({
      data: undefined,
      isError: true,
      refetch,
    });
    render(<DestinationDetailPage />);

    fireEvent.press(screen.getByTestId('destination-detail-stay-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

/**
 * ── TRIP-709 AC-8 · 숙소 하트 실배선(거짓말 방지) — 게이트① 동결: 위 P1~P3 는 무수정, 아래만
 * 추가한다. 담김/미담김 표식(색 fill)만으로는 "저장됐다"를 거짓 통과시킬 수 있으므로(repo-trap
 * §글리프), 페이지가 `useSavedStays.save`/`remove` 를 **실제로** 부르는지 spy 로 관측한다. 게스트는
 * 서버를 안 부르고 로그인으로 보낸다(`(tabs)/explore.tsx` SavableStayLane 선례).
 */

// 숙소 검색 카드 1건(key 'NAVER:s1'). 하트 testID = destination-detail-stay-save-{key}.
const STAY_ITEM: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 그랜드 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: [],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
};
const STAY_ITEM_KEY = stayKey(STAY_ITEM); // 'NAVER:s1'

/** 검색 결과에 숙소 1건을 실어 하트가 그려지게 한다. */
function withStayItem(): void {
  mockUseStaySearch.mockReturnValue({
    data: { items: [STAY_ITEM] },
    isError: false,
    refetch: jest.fn(),
  });
}

describe('AC-8 · 하트 실배선 (거짓말 방지)', () => {
  it('로그인·미담김 → 하트 press 가 useSavedStays.save 를 실제로 부른다(remove 0)', () => {
    mockToken = 'tkn';
    mockIsSaved.mockReturnValue(false);
    withStayItem();
    render(<DestinationDetailPage />);

    fireEvent.press(
      screen.getByTestId(`destination-detail-stay-save-${STAY_ITEM_KEY}`)
    );

    // useState 토글이 아니라 서버 훅 실호출 — spy 가 켜져야 한다.
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('로그인·담김 → 하트 press 가 useSavedStays.remove 를 실제로 부른다(save 0)', () => {
    mockToken = 'tkn';
    mockIsSaved.mockReturnValue(true);
    mockUseSavedStays.mockReturnValue({
      isSaved: mockIsSaved,
      save: mockSave,
      remove: mockRemove,
      savedKeys: [STAY_ITEM_KEY],
    });
    withStayItem();
    render(<DestinationDetailPage />);

    fireEvent.press(
      screen.getByTestId(`destination-detail-stay-save-${STAY_ITEM_KEY}`)
    );

    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('게스트 → 하트 press 는 /(auth)/login 으로 push 하고 서버 저장은 0건이다', () => {
    mockToken = null;
    withStayItem();
    render(<DestinationDetailPage />);

    fireEvent.press(
      screen.getByTestId(`destination-detail-stay-save-${STAY_ITEM_KEY}`)
    );

    expect(mockPush).toHaveBeenCalledWith('/(auth)/login');
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

/**
 * ── TRIP-985 5-b 경고-1 · 같은 화면을 다른 지역으로 되돌려 써도 이전 지역의 상태가 안 남는다.
 * 위 케이스는 무수정, 아래만 추가한다.
 *
 * 피커가 `router.dismissTo`로 돌아오면 스택 밑의 이 화면은 새로 만들어지지 않고 `region`
 * 파라미터만 바뀐다(재마운트 없음). 그 재사용을 jest 에서는 "파라미터 목을 바꾸고 같은 트리에
 * `rerender`"로 흉내 낸다 — 같은 컴포넌트를 같은 자리에 다시 그리면 React 는 인스턴스(와 그
 * `useState`)를 그대로 쓴다. 그래서 이 심판은 페이지 **안**에서의 초기화만 본다(라우트 파일에
 * `key`를 주는 식의 수정은 이 렌더 경로 밖이라 red 가 안 풀린다).
 */
const MICHUHOL = region({
  regionCode: '28177',
  name: '미추홀구',
  sidoName: '인천광역시',
});

/** dismissTo 재현 — 같은 렌더 트리에서 region 파라미터만 바꿔 다시 그린다. */
function switchRegionTo(
  code: string,
  rerender: (el: React.ReactElement) => void
): void {
  mockParams = { region: code };
  rerender(<DestinationDetailPage />);
}

describe('R · 지역이 바뀌어 재사용돼도 이전 지역의 로컬 상태가 안 남는다 (TRIP-985 경고-1)', () => {
  beforeEach(() => {
    mockRegionsResult = { data: [BUSAN, MICHUHOL] };
  });

  it('R-1 부산에서 뜬 저장 실패 배너는 미추홀구로 바뀐 뒤엔 없다', async () => {
    mockSave.mockResolvedValue({ kind: 'failed' });
    withStayItem();
    const { rerender } = render(<DestinationDetailPage />);

    fireEvent.press(
      screen.getByTestId(`destination-detail-stay-save-${STAY_ITEM_KEY}`)
    );
    // 전제: 부산 화면에 실패 배너가 떴다.
    expect(
      await screen.findByTestId('destination-detail-stay-save-error')
    ).toBeOnTheScreen();

    switchRegionTo(MICHUHOL.regionCode, rerender);

    // 전제: 정말 미추홀구 화면으로 바뀌었다(헤딩이 새 이름).
    expect(screen.getByTestId('destination-detail-heading')).toHaveTextContent(
      /미추홀구/
    );
    // 본 단언: 사용자가 미추홀구에서 아무것도 안 했으니 배너가 없어야 한다.
    expect(
      screen.queryByTestId('destination-detail-stay-save-error')
    ).toBeNull();
  });

  it('R-2 부산에서 저장 대기 중이던 하트 표식(pending)이 미추홀구로 넘어오지 않는다', () => {
    // 저장 요청을 끝나지 않게 붙잡아 대기 상태를 만든다.
    mockSave.mockReturnValue(new Promise(() => {}));
    // 숙소 목은 지역과 무관하게 같은 1건을 돌려준다 — 같은 키의 하트가 새 지역에도 그려져야
    // "대기 표식이 따라왔나"를 볼 수 있다.
    withStayItem();
    const { rerender } = render(<DestinationDetailPage />);
    const heartId = `destination-detail-stay-save-${STAY_ITEM_KEY}`;

    fireEvent.press(screen.getByTestId(heartId));
    // 전제: 부산에서 그 하트가 대기 중(연타 가드 disabled)이다.
    expect(screen.getByTestId(heartId)).toBeDisabled();

    switchRegionTo(MICHUHOL.regionCode, rerender);

    expect(screen.getByTestId('destination-detail-heading')).toHaveTextContent(
      /미추홀구/
    );
    expect(screen.getByTestId(heartId)).not.toBeDisabled();
  });

  it('R-3 부산의 저장 요청이 지역을 바꾼 뒤에 늦게 실패해도 미추홀구에 배너가 안 뜬다', async () => {
    let finishSave!: (outcome: { kind: 'failed' }) => void;
    mockSave.mockReturnValue(
      new Promise((resolve) => {
        finishSave = resolve;
      })
    );
    withStayItem();
    const { rerender } = render(<DestinationDetailPage />);

    fireEvent.press(
      screen.getByTestId(`destination-detail-stay-save-${STAY_ITEM_KEY}`)
    );
    switchRegionTo(MICHUHOL.regionCode, rerender);

    // 부산에서 보낸 요청이 이제야 실패로 끝난다.
    await act(async () => {
      finishSave({ kind: 'failed' });
    });

    expect(screen.getByTestId('destination-detail-heading')).toHaveTextContent(
      /미추홀구/
    );
    expect(
      screen.queryByTestId('destination-detail-stay-save-error')
    ).toBeNull();
  });
});
