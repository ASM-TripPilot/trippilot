import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import {
  useGetStaysGeocode,
  useGetStaysReverseGeocode,
} from '@/shared/api/generated/stays/stays';
import type { MapCenter } from '@/shared/map';

import { StayRegisterPage } from './StayRegisterPage';

/**
 * IP-1~IP-4 (AC-5~AC-8 · 02a §4-E) — 핀 지정 **단일 경로**(TRIP-866 S4) 배선.
 *
 * 무엇을 보장하나(초심자용): 옛 흐름은 지도가 `onMapMessage(PIN_DROP/GEOCODE_OK/GEOCODE_FAIL)`로
 * 좌표와 주소를 한꺼번에 브리지로 밀어 넣었다. 새 흐름은 두 갈래가 **분리**된다 —
 *  ① `CenterPinPicker.onPick({lat,lng})` 가 중심 좌표만 올린다.
 *  ② 주소는 페이지가 `useGetStaysReverseGeocode` 훅으로 따로 얻는다.
 * 이 파일은 그 훅의 결과(주소 / null / 503)가 화면 상태로 **올바르게 매핑**되는지, 그리고 핀으로
 * 찍은 좌표가 `registerRoute:'PIN'` 으로 등록까지 가는지를 잰다.
 *
 * ★핵심(02a §4):
 *  - null vs 503: `{address:null}`(주소 없음, 장애 아님)은 "주소 미확인"으로만, 503(장애)은
 *    실패 칸+숙소명 직접 입력으로 갈린다 — 그리고 **둘 다 등록을 막지 않는다**(BR-U1-23).
 *
 * 훅 목 전략(02a §5): `@/shared/api/generated/stays/stays` 를 `jest.mock` 으로 통째 치환한다 —
 * 실 네트워크(MSW) 대신 `useGetStaysReverseGeocode` 의 반환({data}/{isError})을 직접 주입해
 * null·503 갈래를 결정론적으로 만든다. `usePostSavedStays` 도 목이라 QueryClientProvider·MSW 가
 * 없어도 되고, POST 본문은 `mutateAsync` 인자로 관측한다(그 인자가 곧 서버로 갈 본문이다).
 * 지도는 `mapViewMock`(CenterPinPicker 가 onPick 을 host 로 통과)으로 치환한다.
 *
 * 구현 전엔 페이지가 `onMapMessage` 브리지를 쓰고 CenterPinPicker 를 안 그리므로, 핀 좌표 발화
 * 지점(center-pin-picker)이 없어 이 suite 는 red 다.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// 검색·역지오코딩 두 훅을 함께 목킹한다(같은 모듈). 검색 훅은 핀 경로에서 안 쓰이므로 무해한
// 기본값을 돌려주고, 역지오코딩 훅은 케이스마다 반환을 갈아끼운다.
jest.mock('@/shared/api/generated/stays/stays', () => ({
  useGetStaysGeocode: jest.fn(),
  useGetStaysReverseGeocode: jest.fn(),
}));

// POST 는 목이라 mutateAsync 인자(=서버로 갈 본문)를 직접 관측한다.
const mockMutateAsync = jest.fn();
jest.mock('@/shared/api/generated/saved-stays/saved-stays', () => ({
  usePostSavedStays: jest.fn(() => ({ mutateAsync: mockMutateAsync })),
}));

const mockGeocode = useGetStaysGeocode as jest.Mock;
const mockReverse = useGetStaysReverseGeocode as jest.Mock;

const PIN: MapCenter = { lat: 35.1621, lng: 129.1688 };
const PIN_ADDRESS = '부산 해운대구 중동 1394';
const SAVED_STAY = { savedStayId: 'ss-1', name: '', registerRoute: 'PIN' };

const ENV_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_ENV: string | undefined;
ORIGINAL_ENV = process.env[ENV_KEY];

/** 역지오코딩 훅이 UseQueryResult 처럼 보이게 하는 최소 형태(실 훅 시그니처 확인: 02a §5). */
const REVERSE_SUCCESS = {
  data: { address: PIN_ADDRESS, lat: PIN.lat, lng: PIN.lng },
  isError: false,
  isPending: false,
  error: null,
};
const REVERSE_NULL = {
  data: { address: null, lat: PIN.lat, lng: PIN.lng },
  isError: false,
  isPending: false,
  error: null,
};
const REVERSE_503 = {
  data: undefined,
  isError: true,
  isPending: false,
  error: { status: 503 },
};
const REVERSE_IDLE = {
  data: undefined,
  isError: false,
  isPending: false,
  error: null,
};

beforeEach(() => {
  mockBack.mockClear();
  mockPush.mockClear();
  mockMutateAsync.mockReset();
  mockMutateAsync.mockResolvedValue(SAVED_STAY);
  mockGeocode.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
  });
  mockReverse.mockReturnValue(REVERSE_IDLE);
  // 좌표 확정 시트가 'open'(map-failed 아님) 얼굴을 쓰게 한다 — mapsheet-confirm 이 그 안에 있다.
  process.env[ENV_KEY] = 'test-js-key';
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV;
  }
});

function goToPinTab(): void {
  fireEvent.press(screen.getByTestId('stay-register-tab-pin'));
}

/** 지도를 움직여 멈춘 상황 — CenterPinPicker 가 중심 좌표를 보고했다고 흉내낸다(실 pan 은 6-b). */
function panTo(center: MapCenter): void {
  const picker = within(
    screen.getByTestId('stay-register-pin-map')
  ).getByTestId('center-pin-picker');
  act(() => {
    (picker.props as { onPick: (c: MapCenter) => void }).onPick(center);
  });
}

/** 좌표 확정(D5 단일 경로) — 핀 좌표를 시트에서 「이 위치로 확인」한다(기존 배선 재사용). */
function confirmCoord(): void {
  fireEvent.press(screen.getByTestId('stay-register-mapconfirm'));
  fireEvent.press(screen.getByTestId('stay-register-mapsheet-confirm'));
}

function typeName(text: string): void {
  fireEvent.changeText(screen.getByTestId('stay-register-name-input'), text);
}

describe('IP-1 · 핀으로 찍어 등록한다 (AC-5 정상 · registerRoute=PIN)', () => {
  it('핀을 맞춰 주소가 뜨고, 이름을 넣고 확정하면 PIN 경로로 등록된다', async () => {
    mockReverse.mockReturnValue(REVERSE_SUCCESS);
    render(<StayRegisterPage />);

    goToPinTab();
    panTo(PIN);

    // AC-5 — 찍은 지점의 주소가 화면에 뜬다(표시용 사본, 저장 정본은 좌표다).
    await waitFor(() =>
      expect(
        within(screen.getByTestId('stay-register-pin-address')).getByText(
          PIN_ADDRESS
        )
      ).toBeOnTheScreen()
    );

    typeName('해운대 아르떼 빌딩');
    confirmCoord();
    fireEvent.press(screen.getByTestId('stay-register-submit'));

    // 본체 — 좌표의 출처(PIN)가 registerRoute 를 정한다. 'MAP_SEARCH'로 나가면 위반이다(AC-7 계약).
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '해운대 아르떼 빌딩',
        registerRoute: 'PIN',
        lat: PIN.lat,
        lng: PIN.lng,
        coordConfirmed: true,
      }),
    });

    // 201 후 이전 화면으로 돌아간다(기존 계약).
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });
});

describe('IP-2 · 주소 없음(null): "주소 미확인"이고 실패 칸은 아니다 (AC-6)', () => {
  it('reverse-geocode 가 address=null 이면 pin-address 에 "주소 미확인", 실패 칸은 없다', async () => {
    mockReverse.mockReturnValue(REVERSE_NULL);
    render(<StayRegisterPage />);

    goToPinTab();
    panTo(PIN);

    // null 은 그 좌표에 주소가 없다는 사실이지 장애가 아니다 → 'ok' 갈래(pin-address)로만 표시.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('stay-register-pin-address')).getByText(
          /주소 미확인/
        )
      ).toBeOnTheScreen()
    );

    // ★ null≠503 — 장애 칸으로 새지 않는다.
    expect(
      screen.queryAllByTestId('stay-register-pin-addressfail')
    ).toHaveLength(0);
  });
});

describe('IP-3 · ★ 장애(503): 실패해도 좌표만으로 등록까지 간다 (AC-7 · BR-U1-23 · INV-4)', () => {
  it('reverse-geocode 503 이면 실패 칸+숙소명 입력이 뜨고, 이름을 넣어 PIN 으로 등록된다', async () => {
    mockReverse.mockReturnValue(REVERSE_503);
    render(<StayRegisterPage />);

    goToPinTab();
    panTo(PIN);

    // 침묵 실패 금지 — 실패를 드러낸다(★ null≠503: 정상 주소 칸이 아니라 실패 칸이다).
    await waitFor(() =>
      expect(
        screen.getByTestId('stay-register-pin-addressfail')
      ).toHaveTextContent(/주소 미확인/)
    );
    expect(screen.queryAllByTestId('stay-register-pin-address')).toHaveLength(
      0
    );

    // 다음 행동 — 주소를 못 받았으니 사람이 이름을 직접 친다.
    typeName('이름만 아는 숙소');
    confirmCoord();
    fireEvent.press(screen.getByTestId('stay-register-submit'));

    // ★ 헤드라인 — 503 은 등록을 막지 않는다(저장 정본은 좌표다). POST 가 실제로 나가야 증명된다.
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '이름만 아는 숙소',
        registerRoute: 'PIN',
        lat: PIN.lat,
        lng: PIN.lng,
        coordConfirmed: true,
      }),
    });
  });
});

describe('IP-4 · 좌표 미확정: 핀을 맞추기 전에는 등록이 잠긴다 (AC-8 · BR-U1-22)', () => {
  it('핀 탭에 막 들어와 아직 안 움직였으면 안내가 뜨고 등록은 잠기며 눌러도 POST 가 없다', () => {
    render(<StayRegisterPage />);

    goToPinTab();

    // 좌표가 없으니 다음 걸음을 글자로 안내한다(BR-U1-22, 완전일치).
    expect(
      within(screen.getByTestId('stay-register-coordnotice')).getByText(
        '지도에서 위치를 확인해 주세요'
      )
    ).toBeOnTheScreen();

    // 잠금 + 눌러도 무반응(disabled 만으로는 부족 — 실제 POST 0을 함께 잠근다).
    const submit = screen.getByTestId('stay-register-submit');
    expect(submit).toBeDisabled();
    fireEvent.press(submit);
    expect(mockMutateAsync).not.toHaveBeenCalled();

    // 막다른 길이 아니다 — 좌표를 맞출 지도는 이미 떠 있다.
    expect(
      within(screen.getByTestId('stay-register-pin-map')).getByTestId(
        'center-pin-picker'
      )
    ).toBeOnTheScreen();
  });
});
