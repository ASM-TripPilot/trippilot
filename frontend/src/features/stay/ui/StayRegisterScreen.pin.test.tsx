import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { GeocodeCandidate } from '@/shared/api/generated/schemas';
import type { MapCenter } from '@/shared/map';

import type { StayRegisterFlow } from '../model/stayRegisterForm';
import { StayRegisterScreen } from './StayRegisterScreen';

/**
 * P-1~P-8 (AC-5~AC-8 · 02a §4-C) — 핀 지정 탭의 **새 계약**(TRIP-866 S4) 렌더 심판.
 *
 * 무엇이 바뀌나(초심자용): 옛 흐름은 지도를 길게 눌러 `onMapMessage(PIN_DROP/GEOCODE_OK/…)`로
 * 좌표·주소를 한꺼번에 브리지로 받았다. 새 흐름은 **중앙 고정 핀**이다 —
 *  - 사용자가 지도를 움직여 멈추면 `CenterPinPicker` 가 `onPick({lat,lng})` 으로 중심 좌표만 올린다.
 *  - 주소는 화면이 아니라 페이지가 `useGetStaysReverseGeocode` 훅으로 따로 얻는다(단일 경로).
 * 이 파일은 **화면 층**만 본다 — flow(VM)를 주입해 각 pinAddressStatus 가 무엇을 그리는지,
 * onPick 이 위로 배선됐는지, 좌표 확정 게이트가 등록을 여닫는지를 잰다. 훅 호출·상태 매핑은
 * `StayRegisterPage.pin.integration.test.tsx` 가 진다.
 *
 * ★핵심 심판(02a §4):
 *  - null≠503 분리: 주소 없음(null·'ok')은 `pin-address` 에 "주소 미확인", 장애(503·'error')는
 *    `pin-addressfail` 로 갈린다(같은 문구라도 testID 가 다르다).
 *  - 503 등록 비차단: pinAddressStatus='error' 여도, 좌표가 확정되고 이름이 있으면 「등록하기」는
 *    `not.toBeDisabled()` 다(BR-U1-23 — 비차단이 헤드라인, `toBeDisabled` 뮤턴트를 잡는다).
 *
 * 지도는 목으로 바꾼다: `@/shared/map` 을 `mapViewMock` 으로 치환하면 실물 CenterPinPicker 대신
 * `center-pin-picker`(onPick 을 host 로 통과) 목이 뜬다. 인라인 팩토리는 NativeWind babel 의
 * `_ReactNativeCSSInterop` 호이스트 함정에 걸리므로 모듈을 require 한다(리포 관례).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const PIN_COORDS: MapCenter = { lat: 35.1621, lng: 129.1688 };
const PIN_ADDRESS = '부산 해운대구 중동 1394';

const IDLE_FLOW: StayRegisterFlow = {
  activeTab: 'mapsearch',
  query: '',
  name: '',
  searchStatus: 'idle',
  candidates: [],
  selectedCandidate: null,
  coordSource: 'MAP_SEARCH',
  pinAddressStatus: 'idle',
  coordConfirmed: false,
  mapSheetState: 'closed',
  checkIn: null,
  checkOut: null,
  dateSheetOpen: false,
  submitStatus: 'idle',
};

/** 핀 탭에서 좌표를 이미 찍고 확정까지 된 상태 — 케이스마다 한 축(pinAddressStatus·address 등)만
 * 무너뜨린다. `name` 이 채워져 있어야 이름 게이트가 열려, 503/null 이 등록을 막는지를 격리해 잰다. */
function pinFlow(overrides: Partial<StayRegisterFlow>): StayRegisterFlow {
  const candidate: GeocodeCandidate = {
    name: '',
    address: PIN_ADDRESS,
    lat: PIN_COORDS.lat,
    lng: PIN_COORDS.lng,
  };
  return {
    ...IDLE_FLOW,
    activeTab: 'pin',
    name: '내가 예약한 숙소',
    selectedCandidate: candidate,
    coordSource: 'PIN',
    coordConfirmed: true,
    pinAddressStatus: 'ok',
    ...overrides,
  };
}

type Handlers = ReturnType<typeof makeHandlers>;

function makeHandlers() {
  return {
    onSelectTab: jest.fn(),
    onChangeQuery: jest.fn(),
    onChangeName: jest.fn(),
    onSubmitQuery: jest.fn(),
    onRetrySearch: jest.fn(),
    onSelectCandidate: jest.fn(),
    onPickCoord: jest.fn(),
    onOpenMapSheet: jest.fn(),
    onConfirmCoord: jest.fn(),
    onCloseMapSheet: jest.fn(),
    onOpenDateSheet: jest.fn(),
    onPickDate: jest.fn(),
    onCloseDateSheet: jest.fn(),
    onSubmit: jest.fn(),
  };
}

const TODAY = '2026-06-15';

function renderScreen(
  flow: StayRegisterFlow,
  handlers: Handlers = makeHandlers()
): Handlers {
  render(<StayRegisterScreen flow={flow} today={TODAY} {...handlers} />);
  return handlers;
}

describe('P-1 · 핀 탭 표면 — CenterPinPicker 와 중앙 고정 핀이 뜬다 (AC-5)', () => {
  it('핀 탭에 center-pin-picker(지도)와 map-center-pin(고정 핀)이 있고, 검색 입력은 없다', () => {
    renderScreen(
      pinFlow({ selectedCandidate: null, pinAddressStatus: 'idle' })
    );

    const panel = screen.getByTestId('stay-register-pin-panel');
    const picker = within(panel).getByTestId('center-pin-picker');
    expect(picker).toBeOnTheScreen();
    expect(within(picker).getByTestId('map-center-pin')).toBeOnTheScreen();

    // 옛 지도 검색 표면은 핀 탭에서 물러난다.
    expect(screen.queryAllByTestId('stay-register-search-input')).toHaveLength(
      0
    );
  });
});

describe('P-2 · onPick 이 좌표를 그대로 위로 올린다 (AC-5 — 배선)', () => {
  it('CenterPinPicker 의 onPick 을 발화하면 onPickCoord 가 같은 {lat,lng} 로 호출된다', () => {
    const handlers = renderScreen(
      pinFlow({ selectedCandidate: null, pinAddressStatus: 'idle' })
    );

    const picker = within(
      screen.getByTestId('stay-register-pin-panel')
    ).getByTestId('center-pin-picker');
    // 배선 앵커 — 통로가 없으면 아래 발화가 TypeError 로 죽어 "무엇이 없는가"가 안 읽힌다.
    expect(picker).toHaveProp('onPick', expect.any(Function));

    // 화면은 무상태(G-2) — 해석하지 않고 좌표를 그대로 넘긴다.
    (picker.props as { onPick: (c: MapCenter) => void }).onPick(PIN_COORDS);
    expect(handlers.onPickCoord).toHaveBeenCalledTimes(1);
    expect(handlers.onPickCoord).toHaveBeenCalledWith(PIN_COORDS);
  });
});

describe('P-3 · 정상: 역지오코딩 주소가 표시된다 (AC-5)', () => {
  it('pinAddressStatus="ok" + 주소 문자열이면 pin-address 에 그 주소가 나오고 실패 칸은 없다', () => {
    renderScreen(pinFlow({ pinAddressStatus: 'ok' }));

    const address = screen.getByTestId('stay-register-pin-address');
    expect(within(address).getByText(PIN_ADDRESS)).toBeOnTheScreen();

    // 짝(null≠503) — 정상 주소는 실패 칸을 쓰지 않는다.
    expect(
      screen.queryAllByTestId('stay-register-pin-addressfail')
    ).toHaveLength(0);
  });
});

describe('P-4 · 주소 없음(null): "주소 미확인"이고 등록은 막히지 않는다 (AC-6)', () => {
  it('address 가 빈 값이면 pin-address 에 "주소 미확인", 실패 칸 없음, 등록 not.toBeDisabled()', () => {
    // null 은 그 좌표에 주소가 없다는 *사실*이지 장애가 아니다 → pinAddressStatus 는 여전히 'ok'.
    renderScreen(
      pinFlow({
        pinAddressStatus: 'ok',
        selectedCandidate: {
          name: '',
          address: '',
          lat: PIN_COORDS.lat,
          lng: PIN_COORDS.lng,
        },
      })
    );

    const address = screen.getByTestId('stay-register-pin-address');
    // 부분일치 정규식 — 문자열 matcher 는 완전일치라(RNTL toHaveTextContent) 카피 전문을 잠근다.
    expect(within(address).getByText(/주소 미확인/)).toBeOnTheScreen();

    // null 은 'error' 갈래(실패 칸)로 새지 않는다.
    expect(
      screen.queryAllByTestId('stay-register-pin-addressfail')
    ).toHaveLength(0);

    // 등록은 좌표+이름이 있으면 열린다 — 주소 없음이 등록을 막지 않는다(BR-U1-22).
    expect(screen.getByTestId('stay-register-submit')).not.toBeDisabled();
  });
});

describe('P-5 · ★ 장애(503): 실패를 드러내고 이름을 직접 받되 등록은 막지 않는다 (AC-7 · BR-U1-23)', () => {
  it('pinAddressStatus="error"면 실패 칸("주소 미확인")+숙소명 입력이 뜨고, 등록은 not.toBeDisabled()', () => {
    renderScreen(pinFlow({ pinAddressStatus: 'error' }));

    // 침묵 실패 금지 — 실패를 글자로 드러내고, 그 자리에 "주소 미확인"이 있다(AC-7 카피).
    const fail = screen.getByTestId('stay-register-pin-addressfail');
    expect(within(fail).getByText(/주소 미확인/)).toBeOnTheScreen();

    // 다음 행동 — 주소를 못 받았으니 숙소명을 직접 친다(직접 입력 유도).
    expect(screen.getByTestId('stay-register-name-input')).toBeOnTheScreen();

    // 짝(null≠503) — 장애는 정상 주소 칸을 쓰지 않는다.
    expect(screen.queryAllByTestId('stay-register-pin-address')).toHaveLength(
      0
    );

    // ★ 헤드라인 — 좌표 확정 + 이름이 있으면 503 이어도 등록은 잠기지 않는다. `disabled` 를
    // pinAddressStatus==='error' 에 묶는 뮤턴트를 이 단언이 red 로 잡는다(BR-U1-23 · INV-4).
    expect(screen.getByTestId('stay-register-submit')).not.toBeDisabled();
  });
});

describe('P-6 · 좌표 미확정: 핀을 아직 안 맞췄으면 등록이 잠긴다 (AC-8 · BR-U1-22)', () => {
  it('좌표가 없으면 안내("지도에서 위치를 확인해 주세요")가 뜨고 등록은 disabled 다', () => {
    const handlers = renderScreen(
      pinFlow({
        selectedCandidate: null,
        coordConfirmed: false,
        pinAddressStatus: 'idle',
        name: '',
      })
    );

    // 화면이 다음 걸음을 글자로 말한다(BR-U1-22 문구 그대로 — 완전일치로 잠근다).
    expect(
      within(screen.getByTestId('stay-register-coordnotice')).getByText(
        '지도에서 위치를 확인해 주세요'
      )
    ).toBeOnTheScreen();

    // 본체 — 잠그는 것만으로는 부족하고, 눌러도 제출 콜백이 불리지 않아야 한다.
    const submit = screen.getByTestId('stay-register-submit');
    expect(submit).toBeDisabled();
    fireEvent.press(submit);
    expect(handlers.onSubmit).not.toHaveBeenCalled();

    // 막다른 길이 아니다 — 좌표를 맞출 지도는 이미 떠 있다(핀 찍기 전에도).
    expect(
      within(screen.getByTestId('stay-register-pin-panel')).getByTestId(
        'center-pin-picker'
      )
    ).toBeOnTheScreen();
  });
});

describe('P-7 · 잠긴 탭은 잠겼다고 글자로 말한다 (회귀 앵커 · INV-4)', () => {
  it('링크 붙여넣기 탭은 비활성이고 "준비 중"이 보이며, 핀 탭은 눌러 고를 수 있다', () => {
    const handlers = renderScreen(IDLE_FLOW);

    const linkTab = screen.getByTestId('stay-register-tab-linkpaste');
    expect(linkTab).toBeDisabled();
    expect(linkTab).toHaveTextContent(/준비 중/);

    fireEvent.press(screen.getByTestId('stay-register-tab-pin'));
    expect(handlers.onSelectTab).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectTab).toHaveBeenCalledWith('pin');
  });
});
