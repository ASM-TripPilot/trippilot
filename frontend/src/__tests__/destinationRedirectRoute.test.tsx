import { render, screen } from '@testing-library/react-native';

import DestinationRoute from '@/app/explore/destination/[region]';

/**
 * TRIP-1105 AC-18 — 옛 목적지 상세 딥링크(`/explore/destination/{code}`)는 화면을 그리지 않고
 * 탐색 탭 d01 의 지역 필터(`/explore?region={code}`)로 넘기기만 한다(결정 1 = A · 얇은 리다이렉트).
 *
 * 무엇을 보장하나: 옛 주소로 들어와도 빈 화면·404 가 아니라 같은 지역으로 좁힌 d01 에 닿는다.
 * 리다이렉트 라우트는 조회도 마크업도 없다 — 조회 훅이 한 번이라도 불리면 목적지 상세를 그대로
 * 그리고 있는 것이다.
 *
 * 왜 이렇게 테스트하나: expo-router 의 `Redirect` 를 "받은 href 를 기록하고 아무것도 안 그리는" 목으로
 * 바꾼다. href 모양(문자열/객체)은 구현 몫이라 "경로 + 파라미터"로 펴서 본다(02a ★16).
 * 라우트 파일 테스트는 `src/app` 밖에 둔다(expo-router 가 `.test.tsx` 를 라우트로 등록한다).
 */

const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ region: '26' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  Redirect: (props: { href: unknown }) => {
    mockRedirect(props.href);
    return null;
  },
}));

// 조회 훅 — 리다이렉트 라우트라면 한 번도 불리지 않아야 한다. 옛 페이지가 남아 있으면 불린다.
const mockUseStaySearch = jest.fn(() => ({
  data: { items: [] },
  isPending: false,
  isError: false,
  refetch: jest.fn(),
}));
const mockUseGetPlaces = jest.fn(() => ({
  data: { items: [] },
  isPending: false,
  isError: false,
  refetch: jest.fn(),
}));
const mockUseRegions = jest.fn(() => ({
  data: [],
  isPending: false,
  isError: false,
  refetch: jest.fn(),
}));
jest.mock('@/features/stay/model/useStaySearch', () => ({
  useStaySearch: () => mockUseStaySearch(),
}));
jest.mock('@/shared/api/generated/places/places', () => ({
  useGetPlaces: () => mockUseGetPlaces(),
}));
jest.mock('@/features/explore/model/regions', () => ({
  ...jest.requireActual('@/features/explore/model/regions'),
  useRegions: () => mockUseRegions(),
}));
jest.mock('@/features/save-place/model/savedPlaces', () => ({
  useSavedPlaces: () => ({ savedPoiIds: [] }),
}));
jest.mock('@/features/stay/model/savedStays', () => ({
  useSavedStays: () => ({
    isSaved: () => false,
    save: jest.fn(),
    remove: jest.fn(),
    savedKeys: [],
  }),
}));
jest.mock('@/shared/api/tokenManager', () => ({
  getAccessToken: () => null,
}));

/** href(문자열 · {pathname, params})를 "경로 + 파라미터"로 편다. */
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
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ),
  };
}

describe('🔴 AC-18 · 옛 딥링크 /explore/destination/{code} → d01 지역 필터로 리다이렉트', () => {
  it('RD1 · 코드를 그대로 실어 /explore 로 한 번 넘기고, 조회·마크업은 0이다', () => {
    render(<DestinationRoute />);

    expect(mockRedirect).toHaveBeenCalledTimes(1);
    // 코드('26')를 그대로 싣는다 — 이름 역인덱스는 도착한 d01 이 한다.
    expect(targetOf(mockRedirect.mock.calls[0][0])).toEqual({
      path: '/explore',
      params: { region: '26' },
    });
    // 조회 0 — 목적지 상세를 그리고 있으면 여기서 불린다.
    expect(mockUseStaySearch).not.toHaveBeenCalled();
    expect(mockUseGetPlaces).not.toHaveBeenCalled();
    expect(mockUseRegions).not.toHaveBeenCalled();
    // 마크업 0 — Redirect 목이 null 을 그리므로 트리 전체가 비어야 한다.
    expect(screen.toJSON() === null).toBe(true);
  });
});
