import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { StayRegisterPage } from './StayRegisterPage';

/**
 * IP-1~IP-5 (AC-2 · AC-3 · AC-4 · AC-7 · AC-8 · D2 · D3 · D4 · 02a §4-E) — 핀 경로 배선.
 *
 * 무엇을 보장하나: 핀 탭에서 일어난 조작이 **실제 HTTP 요청**으로 이어진다 —
 *  - 찍은 좌표가 `POST /saved-stays`에 `registerRoute: 'PIN'`으로 실린다
 *  - 지도 검색 실패의 "핀으로 직접 지정"이 **실제로 핀 탭에 도착한다**(BR-U1-23의 목적지)
 *  - **탭 전환은 좌표·확정을 건드리지 않고, 재핀은 확정을 푼다**(D4, 이 사이클의 무결성 축)
 *
 * 왜 별도 파일인가: 동결 `StayRegisterPage.integration.test.tsx`(I-1~I-7)에
 * `jest.mock('@/shared/map')`을 주입하면 그 파일의 I-6(카카오 키 유무로 시트 얼굴이 갈리는
 * env 규율)과 섞인다. 새 파일로 분리해 동결 파일을 손대지 않는다(02a ★16).
 *
 * 왜 통합 버킷인가: 요청 본문은 axios 어댑터 **안에서** 직렬화되므로 msw만 관찰할 수 있다
 * (선례 `StaySearchPage.integration.test.tsx`).
 *
 * jest 사정거리: 여기서도 "실제 롱프레스"는 증명되지 않는다. WebView 안 자바스크립트가
 * 실행되지 않으므로, 지도가 **보냈다고 치는** 메시지를 목의 콜백으로 직접 발화시킨다.
 * 그 메시지가 실기에서 진짜 나오는지는 6-b 스모크 몫이다(02a §2).
 */

// authedClient가 @/shared/storage를 정적으로 물고 있다 — expo-secure-store 실물 로드를
// 피하려면 목킹해야 한다(동결 통합 파일 36~44행과 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — 이름이 `mock`으로
// 시작하는 변수만 예외다. 여기서는 엘리먼트를 만들지 않으므로 인라인 팩토리로 충분하다.
const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

// 지도는 목으로 바꾼다 — 실제 KakaoMapView는 WebView를 타므로 메시지를 밖에서 발화시킬
// 창구가 없다. 인라인 팩토리는 NativeWind babel 호이스트 규칙에 걸리므로 모듈을 require 한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

const BASE = 'http://localhost:8080/api/v1';

const ENV_KEY = 'EXPO_PUBLIC_KAKAO_MAP_JS_KEY';
// computed 접근이 선언과 한 문장이면 eslint-plugin-expo의 no-dynamic-env-var에 걸린다.
let ORIGINAL_ENV: string | undefined;
ORIGINAL_ENV = process.env[ENV_KEY];

const BUSAN_CANDIDATE = {
  name: '해운대 그랜드 호텔',
  address: '부산 해운대구 우동 1407',
  lat: 35.1587,
  lng: 129.1604,
};

const SAVED_STAY = {
  savedStayId: 'ss-1',
  name: '해운대 아르떼 빌딩',
  lat: 35.1621,
  lng: 129.1688,
  coordConfirmed: true,
  registerRoute: 'PIN',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

/** 사용자가 지도를 길게 눌러 찍은 지점(6-b에서만 실제로 발생한다). */
const PIN = { lat: 35.1621, lng: 129.1688 };
const PIN_ADDRESS = '부산 해운대구 중동 1394';
const PIN_BUILDING = '해운대 아르떼 빌딩';

let postedBodies: Record<string, unknown>[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  postedBodies = [];
  mockBack.mockClear();
  mockPush.mockClear();
  // 키를 세운다 — 좌표 확정 시트가 D5의 "이 위치로 확인" 얼굴을 쓰게 한다.
  process.env[ENV_KEY] = 'test-js-key';

  server.use(
    http.get(`${BASE}/stays/geocode`, () =>
      HttpResponse.json([BUSAN_CANDIDATE])
    ),
    http.post(`${BASE}/saved-stays`, async ({ request }) => {
      postedBodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(SAVED_STAY, { status: 201 });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  if (ORIGINAL_ENV === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV;
  }
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

/** 지도가 메시지를 올려보낸 상황을 만든다 — 실제 롱프레스의 자리에 서는 대역이다. */
function sendFromMap(message: Record<string, unknown>): void {
  const mapRoot = within(
    screen.getByTestId('stay-register-pin-map')
  ).getByTestId('map-root');
  act(() => {
    (mapRoot.props as { onMapMessage: (m: unknown) => void }).onMapMessage(
      message
    );
  });
}

/** 핀을 찍고 역지오코딩까지 성공한 상태를 만든다. */
function dropPinWithAddress(): void {
  sendFromMap({ type: 'PIN_DROP', ...PIN });
  sendFromMap({
    type: 'GEOCODE_OK',
    address: PIN_ADDRESS,
    buildingName: PIN_BUILDING,
  });
}

/** bottom-sheet를 거쳐 좌표를 확정한다 — D5가 정한 단일 경로다. */
function confirmCoord(): void {
  fireEvent.press(screen.getByTestId('stay-register-mapconfirm'));
  fireEvent.press(screen.getByTestId('stay-register-mapsheet-confirm'));
}

function goToPinTab(): void {
  fireEvent.press(screen.getByTestId('stay-register-tab-pin'));
}

/** 검색어를 넣고 키보드 '검색' 키를 누른다 — 이것만이 검색 트리거다. */
function searchFor(text: string): void {
  const input = screen.getByTestId('stay-register-search-input');
  fireEvent.changeText(input, text);
  fireEvent(input, 'submitEditing', { nativeEvent: { text } });
}

describe('IP-1 · 핀으로 찍어 등록한다 (AC-3 · AC-4 · AC-7)', () => {
  it('핀 탭에서 지점을 찍고 확정하면 PIN 경로로 등록된다', async () => {
    render(<StayRegisterPage />, { wrapper: createWrapper() });

    goToPinTab();
    dropPinWithAddress();

    // AC-4 — 찍은 지점의 주소가 화면에 나온다(표시용 사본).
    expect(
      within(screen.getByTestId('stay-register-pin-address')).getByText(
        PIN_ADDRESS
      )
    ).toBeOnTheScreen();

    confirmCoord();
    fireEvent.press(screen.getByTestId('stay-register-submit'));

    await waitFor(() => expect(postedBodies).toHaveLength(1));

    // AC-7 본체 — 'MAP_SEARCH'로 나가면 위반이다.
    expect(postedBodies[0]).toMatchObject({
      name: PIN_BUILDING,
      registerRoute: 'PIN',
      lat: PIN.lat,
      lng: PIN.lng,
      coordConfirmed: true,
    });

    // 201 후 이전 화면으로 돌아간다(기존 계약).
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });
});

describe('IP-2 · 폴백의 목적지가 실재한다 (AC-2 · BR-U1-23 · US-STAY-08 예외)', () => {
  it('지도 검색이 죽은 화면에서 "핀으로 직접 지정"을 누르면 핀 탭에 도착한다', async () => {
    server.use(
      http.get(
        `${BASE}/stays/geocode`,
        () => new HttpResponse(null, { status: 500 })
      )
    );

    render(<StayRegisterPage />, { wrapper: createWrapper() });
    searchFor('busan');

    await waitFor(() =>
      expect(screen.getByTestId('stay-register-searchfail')).toBeOnTheScreen()
    );

    // 도달 앵커 — 누르기 전에는 핀 표면이 없었다(전이가 실제로 일어났음을 증명).
    expect(screen.queryAllByTestId('stay-register-pin-panel')).toHaveLength(0);

    fireEvent.press(screen.getByTestId('stay-register-pinfallback'));

    // 본체 — TRIP-198이 "준비 중"으로 잠가 둔 버튼이 이제 실제 목적지를 갖는다.
    expect(screen.getByTestId('stay-register-pin-panel')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-register-pin-map')).toBeOnTheScreen();
  });
});

describe('IP-3 · ★ 탭 전환은 좌표를 건드리지 않고, 재핀은 확정을 푼다 (D4 · AC-8, 가중치 1.0)', () => {
  it('지도 검색으로 확정한 뒤 핀 탭에 가도 확정이 유지되고 경로는 MAP_SEARCH다', async () => {
    render(<StayRegisterPage />, { wrapper: createWrapper() });

    searchFor('busan');
    fireEvent.press(await screen.findByTestId('stay-register-candidate-0'));
    confirmCoord();
    await waitFor(() =>
      expect(screen.getByTestId('stay-register-submit')).toBeEnabled()
    );

    goToPinTab();

    // 도달 앵커 — **실제로 핀 탭에 왔다.** 이게 없으면 "탭 전환이 아무 일도 안 하는"
    // 구현(=지금 상태)에서 아래 단언이 전부 공허하게 통과한다.
    expect(screen.getByTestId('stay-register-pin-panel')).toBeOnTheScreen();

    // 본체 ① — 탭을 옮겼다고 확정이 풀리면, 사용자는 방금 한 일을 다시 해야 한다.
    // (재검색·후보변경·재핀은 풀지만 탭 전환은 그 사건에서 제외된다 — D4)
    expect(screen.getByTestId('stay-register-submit')).toBeEnabled();
    expect(screen.queryAllByTestId('stay-register-coordnotice')).toHaveLength(
      0
    );

    // 본체 ② — 좌표의 출처가 경로를 정한다. 핀 탭에 서 있다고 PIN으로 나가면 위반이다.
    fireEvent.press(screen.getByTestId('stay-register-submit'));
    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).toMatchObject({
      registerRoute: 'MAP_SEARCH',
      lat: BUSAN_CANDIDATE.lat,
      lng: BUSAN_CANDIDATE.lng,
    });
  });

  it('그 상태에서 핀을 새로 찍으면 좌표가 갈리고 확정이 풀리며 경로가 PIN으로 바뀐다', async () => {
    render(<StayRegisterPage />, { wrapper: createWrapper() });

    searchFor('busan');
    fireEvent.press(await screen.findByTestId('stay-register-candidate-0'));
    confirmCoord();
    goToPinTab();
    await waitFor(() =>
      expect(screen.getByTestId('stay-register-submit')).toBeEnabled()
    );

    dropPinWithAddress();

    // 본체 ① — 새 좌표가 들어왔으니 확정은 풀린다. 안 풀면 '검색 좌표로 확인했는데 핀
    // 좌표가 저장되는' 불일치가 만들어진다(TRIP-198 가중치 1.0 규칙의 핀 판).
    expect(screen.getByTestId('stay-register-submit')).toBeDisabled();
    expect(
      within(screen.getByTestId('stay-register-coordnotice')).getByText(
        '지도에서 위치를 확인해 주세요'
      )
    ).toBeOnTheScreen();

    // 본체 ② — 다시 확정하면 이제 핀 좌표가, 핀 경로로 나간다.
    confirmCoord();
    fireEvent.press(screen.getByTestId('stay-register-submit'));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).toMatchObject({
      registerRoute: 'PIN',
      lat: PIN.lat,
      lng: PIN.lng,
      coordConfirmed: true,
    });
  });
});

describe('IP-4 · 사용자가 친 이름은 핀이 덮어쓰지 않는다 (D2 · S-2 · S-5)', () => {
  it('실패 화면에서 친 숙소명이 핀 탭까지 살아남고 그 이름으로 등록된다', async () => {
    server.use(
      http.get(
        `${BASE}/stays/geocode`,
        () => new HttpResponse(null, { status: 500 })
      )
    );

    render(<StayRegisterPage />, { wrapper: createWrapper() });
    searchFor('busan');

    await waitFor(() =>
      expect(screen.getByTestId('stay-register-searchfail')).toBeOnTheScreen()
    );

    // D7 — 지도가 죽었으니 사람이 이름을 직접 친다.
    fireEvent.changeText(
      screen.getByTestId('stay-register-name-input'),
      '내가 예약한 숙소'
    );

    fireEvent.press(screen.getByTestId('stay-register-pinfallback'));

    // S-5 — 탭이 바뀌어도 친 값이 남는다.
    expect(screen.getByTestId('stay-register-name-input')).toHaveDisplayValue(
      '내가 예약한 숙소'
    );

    // D2 — 역지오코딩이 건물명을 줘도 이미 값이 있으면 덮지 않는다.
    dropPinWithAddress();
    expect(screen.getByTestId('stay-register-name-input')).toHaveDisplayValue(
      '내가 예약한 숙소'
    );

    confirmCoord();
    fireEvent.press(screen.getByTestId('stay-register-submit'));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).toMatchObject({
      name: '내가 예약한 숙소',
      registerRoute: 'PIN',
    });
  });
});

describe('IP-5 · 역지오코딩이 실패해도 막다른 길이 아니다 (D3 · INV-4 · BR-U1-55)', () => {
  it('실패를 드러내고, 숙소명을 직접 받아 좌표만으로 등록까지 간다', async () => {
    render(<StayRegisterPage />, { wrapper: createWrapper() });

    goToPinTab();
    sendFromMap({ type: 'PIN_DROP', ...PIN });
    sendFromMap({ type: 'GEOCODE_FAIL' });

    // 침묵 실패 금지 — 아무 표시 없이 빈 주소로 두면 위반이다.
    expect(
      screen.getByTestId('stay-register-pin-addressfail')
    ).toHaveTextContent(/\S/);

    fireEvent.changeText(
      screen.getByTestId('stay-register-name-input'),
      '이름만 아는 숙소'
    );

    confirmCoord();
    fireEvent.press(screen.getByTestId('stay-register-submit'));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    // 저장 정본은 좌표다 — 주소를 못 받았다고 등록을 막을 근거가 없다(D3).
    expect(postedBodies[0]).toMatchObject({
      name: '이름만 아는 숙소',
      registerRoute: 'PIN',
      lat: PIN.lat,
      lng: PIN.lng,
      coordConfirmed: true,
    });
  });
});
