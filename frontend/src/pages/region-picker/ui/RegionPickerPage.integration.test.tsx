import { http, HttpResponse } from 'msw';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { RegionPickerPage } from './RegionPickerPage';

/**
 * TRIP-183 — e00 진입 배선. 화면이 올려보낸 선택을 **실제 목적지**로 잇는지 본다.
 *
 * 프레젠테이션(카피·카드·고지 문구)은 `RegionPickerScreen.test.tsx`가 이미 본다. 여기서
 * 보는 것은 그 밖의 것 — 권한 요청 → 좌표 해석 → `GET /saved-stays` 대체 → 라우팅 파라미터.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 최상단으로 호이스팅된다 — 팩토리가 참조하는 바깥 변수는 이름이 `mock`으로
// 시작해야 예외를 받는다(TRIP-182 §5 ★10과 같은 규칙). 이 이름을 바꾸지 마라.
const mockPush = jest.fn();
let mockParams: { purpose?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({ ...mockParams }),
}));

let mockPermission: 'granted' | 'denied' = 'granted';
let mockPositionFails = false;

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => ({ status: mockPermission }),
  getCurrentPositionAsync: async () => {
    if (mockPositionFails) throw new Error('위치 확인 실패');
    return { coords: { latitude: 33.4996, longitude: 126.5312 } };
  },
}));

const BASE = 'http://localhost:8080/api/v1';

/** `GET /saved-stays` 응답 고정 — SavedStay 계약의 필수 필드만 담는다. */
type SavedStayFixture = Record<string, string | number | boolean | null>;

function savedStays(body: SavedStayFixture[]) {
  server.use(http.get(`${BASE}/saved-stays`, () => HttpResponse.json(body)));
}

// MSW 수명은 파일마다 직접 관리한다(전역 setup이 없다 — 리포 관례, StaySearchPage 통합테스트와 동일).
// onUnhandledRequest: 'error' 라 핸들러 없는 요청은 조용히 통과하지 않고 즉시 드러난다.
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

beforeEach(() => {
  mockPush.mockClear();
  mockParams = {};
  mockPermission = 'granted';
  mockPositionFails = false;
});

describe('지역 선택 → 숙소 검색 결과 (US-STAY-01 정상)', () => {
  it('카드를 누르면 지역명을 쿼리에 실어 /stays로 간다', () => {
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-jeju'));

    // 서버 `region`은 자유 문자열 계약이라 한글 이름을 그대로 보낸다(코드가 아니다).
    expect(mockPush).toHaveBeenCalledWith('/stays?region=%EC%A0%9C%EC%A3%BC');
  });

  it('검색으로 좁힌 뒤에도 같은 목적지로 간다', () => {
    render(<RegionPickerPage />);

    fireEvent.changeText(screen.getByTestId('explore-region-search'), '부산');
    fireEvent.press(screen.getByTestId('explore-region-busan'));

    expect(mockPush).toHaveBeenCalledWith('/stays?region=%EB%B6%80%EC%82%B0');
    // 좁혀졌는지도 함께 본다 — 필터가 안 걸리면 이 단언이 무의미해진다
    expect(screen.queryByTestId('explore-region-jeju')).toBeNull();
  });
});

describe('BR-U1-07 · 목적 분기 — 다음 목적지가 다르다', () => {
  it("purpose='trip'이면 여행지 상세로 간다", () => {
    mockParams = { purpose: 'trip' };
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-jeju'));

    expect(mockPush).toHaveBeenCalledWith('/explore/destination/jeju');
  });

  it('알 수 없는 purpose는 stay로 떨어진다 — URL은 신뢰 경계다', () => {
    mockParams = { purpose: '이상한값' };
    render(<RegionPickerPage />);

    expect(screen.getByText('어디서 묵을까요?')).toBeTruthy();
  });
});

describe("'내 주변' — 권한 허용 (US-STAY-01 정상)", () => {
  it('현재 좌표를 쿼리에 실어 /stays로 간다', async () => {
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-nearby'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/stays?lat=33.4996&lng=126.5312');
    });
  });

  it('radiusKm을 보내지 않는다 — 반경 정책은 서버가 갖는다', async () => {
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-nearby'));

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    // 클라이언트가 정책값을 복사하면 서버 기본값이 바뀔 때 조용히 갈라진다.
    expect(String(mockPush.mock.calls[0][0])).not.toContain('radiusKm');
  });
});

describe("'내 주변' — 권한 거부 (BR-U1-11 대체 조회)", () => {
  it('등록 숙소 좌표로 대체 조회하고 그 사실을 고지한다', async () => {
    mockPermission = 'denied';
    savedStays([
      {
        savedStayId: '11111111-1111-1111-1111-111111111111',
        name: '부산 숙소',
        lat: 35.1796,
        lng: 129.0756,
        coordConfirmed: true,
        registerRoute: 'MAP_SEARCH',
        createdAt: '2026-07-30T00:00:00Z',
        updatedAt: '2026-07-30T00:00:00Z',
      },
    ]);
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-nearby'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/stays?lat=35.1796&lng=129.0756');
    });
    // 침묵 금지(INV-4) — 대체했다는 사실이 화면에 남는다
    expect(
      screen.getByText('현재 위치 대신 등록 숙소를 기준으로 찾았어요')
    ).toBeTruthy();
  });

  it('좌표 미확정 숙소는 건너뛴다 (INV-U1-08)', async () => {
    mockPermission = 'denied';
    savedStays([
      {
        savedStayId: '22222222-2222-2222-2222-222222222222',
        name: '좌표 미확정',
        lat: 37.5,
        lng: 127.0,
        coordConfirmed: false,
        registerRoute: 'LINK_PASTE',
        createdAt: '2026-07-30T00:00:00Z',
        updatedAt: '2026-07-30T00:00:00Z',
      },
      {
        savedStayId: '33333333-3333-3333-3333-333333333333',
        name: '좌표 확정',
        lat: 35.1796,
        lng: 129.0756,
        coordConfirmed: true,
        registerRoute: 'MAP_SEARCH',
        createdAt: '2026-07-30T00:00:00Z',
        updatedAt: '2026-07-30T00:00:00Z',
      },
    ]);
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-nearby'));

    // 확정되지 않은 좌표를 검색 중심으로 쓰면 엉뚱한 곳의 숙소를 '내 주변'이라고 부른다.
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/stays?lat=35.1796&lng=129.0756');
    });
  });

  it('등록 숙소가 없으면 이동하지 않고 안내한다', async () => {
    mockPermission = 'denied';
    savedStays([]);
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-nearby'));

    await waitFor(() => {
      expect(
        screen.getByText(
          '위치 권한이 꺼져 있고 등록한 숙소도 없어요. 지역을 골라 주세요'
        )
      ).toBeTruthy();
    });
    // 좌표 없이 '내 주변'을 흉내내면 전국 목록을 주변이라고 부르게 된다
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("'내 주변' — 측위 실패", () => {
  it('권한은 있지만 좌표를 못 얻으면 등록 숙소로 대체한다', async () => {
    mockPositionFails = true;
    savedStays([
      {
        savedStayId: '44444444-4444-4444-4444-444444444444',
        name: '부산 숙소',
        lat: 35.1796,
        lng: 129.0756,
        coordConfirmed: true,
        registerRoute: 'MAP_SEARCH',
        createdAt: '2026-07-30T00:00:00Z',
        updatedAt: '2026-07-30T00:00:00Z',
      },
    ]);
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-nearby'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/stays?lat=35.1796&lng=129.0756');
    });
  });

  it('대체도 없으면 권한 거부와 다른 안내를 낸다', async () => {
    mockPositionFails = true;
    savedStays([]);
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-nearby'));

    await waitFor(() => {
      expect(
        screen.getByText('현재 위치를 확인하지 못했어요. 지역을 골라 주세요')
      ).toBeTruthy();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('서버가 500이어도 던지지 않고 안내로 접는다', async () => {
    mockPermission = 'denied';
    server.use(
      http.get(
        `${BASE}/saved-stays`,
        () => new HttpResponse(null, { status: 500 })
      )
    );
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-nearby'));

    await waitFor(() => {
      expect(
        screen.getByText(
          '위치 권한이 꺼져 있고 등록한 숙소도 없어요. 지역을 골라 주세요'
        )
      ).toBeTruthy();
    });
  });
});
