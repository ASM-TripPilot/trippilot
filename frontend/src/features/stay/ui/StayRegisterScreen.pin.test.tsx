import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { GeocodeCandidate } from '@/shared/api/generated/schemas';

import type { StayRegisterFlow } from '../model/stayRegisterForm';
import { StayRegisterScreen } from './StayRegisterScreen';

/**
 * P-1~P-13 (AC-1~AC-6 · AC-9 · D1 · D6 · D7 · S-5 · 02a §4-C) — 핀 지정 탭의 렌더 계약.
 *
 * 무엇을 보장하나: 핀 탭이 **실제로 열리고**(눌리기만 하는 것이 아니라 표면이 바뀐다),
 * 그 안에 롱프레스할 지도가 떠 있고, 역지오코딩 성공·실패·조회중이 각각 다른 얼굴을 가지며,
 * 핀으로 찍은 좌표도 **확정 전에는 등록이 잠긴다**.
 *
 * 무엇을 보장하지 **못**하나: "실제로 롱프레스가 먹는가"는 여기서 증명되지 않는다. jest는
 * WebView 안 자바스크립트를 실행하지 않으므로, 이 파일이 잴 수 있는 것은 **지도로 가는
 * 메시지 통로가 배선돼 있는가**(P-5)까지다. 실제 제스처는 6-b 실기 스모크 몫이다(02a §2).
 *
 * 동결 `StayRegisterScreen.test.tsx`(R-1~R-15)는 지도 검색 탭을 담당한다. 이 파일은 핀 탭과
 * 3탭 셸의 새 계약만 더한다 — 동결 파일이 이미 잠근 것을 다시 적지 않는다.
 *
 * 지도는 목으로 바꾼다(02a ★6·★7): 인라인 팩토리로 두면 NativeWind babel의
 * `_ReactNativeCSSInterop` 참조가 jest 호이스트 규칙을 위반하므로 모듈 스코프 파일을 require 한다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

/** 픽스처는 파일마다 각자 갖는 것이 리포 관례다. */
const CANDIDATE_A: GeocodeCandidate = {
  name: '해운대 그랜드 호텔',
  address: '부산 해운대구 우동 1407',
  lat: 35.1587,
  lng: 129.1604,
};

/** 핀을 찍고 역지오코딩이 성공한 결과. */
const PIN_RESULT: GeocodeCandidate = {
  name: '해운대 아르떼 빌딩',
  address: '부산 해운대구 중동 1394',
  lat: 35.1621,
  lng: 129.1688,
};

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

/** 핀 탭에 들어와 핀까지 찍은 상태 — 케이스마다 한 축만 무너뜨린다. */
const PIN_FLOW: StayRegisterFlow = {
  ...IDLE_FLOW,
  activeTab: 'pin',
  selectedCandidate: PIN_RESULT,
  coordSource: 'PIN',
  pinAddressStatus: 'ok',
};

type Handlers = ReturnType<typeof makeHandlers>;

function makeHandlers() {
  return {
    onSelectTab: jest.fn(),
    onChangeQuery: jest.fn(),
    onChangeName: jest.fn(),
    onSubmitQuery: jest.fn(),
    onRetrySearch: jest.fn(),
    onSelectCandidate: jest.fn(),
    onPinMessage: jest.fn(),
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

describe('P-1 · 핀 탭이 실제로 열린다 (AC-1 · BR-U1-21)', () => {
  it('핀 탭을 누르면 그 탭을 고르라는 신호가 정확히 한 번, 인자까지 올라간다', () => {
    const handlers = renderScreen(IDLE_FLOW);

    const pinTab = screen.getByTestId('stay-register-tab-pin');
    // `toBeEnabled()` 하나로는 부족하다 — 그 매처는 accessibilityState.disabled만 보므로
    // 아무 상태도 없는 <View>도 통과한다(02a ★3). 그래서 "눌렀을 때 무슨 일이 나는가"와
    // 짝을 지어야 활성이 증명된다.
    expect(pinTab).toBeEnabled();

    fireEvent.press(pinTab);
    expect(handlers.onSelectTab).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectTab).toHaveBeenCalledWith('pin');
  });

  it('짝: 지도 검색 탭으로도 돌아갈 수 있다 (한 방향 문이 아니다)', () => {
    const handlers = renderScreen({ ...IDLE_FLOW, activeTab: 'pin' });

    fireEvent.press(screen.getByTestId('stay-register-tab-mapsearch'));
    expect(handlers.onSelectTab).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectTab).toHaveBeenCalledWith('mapsearch');
  });
});

describe('P-2 · 잠긴 탭은 잠겼다고 글자로 말한다 (AC-9 · D6 · INV-4)', () => {
  it('링크 붙여넣기 탭이 비활성이고 라벨에 "준비 중"이 있으며, 눌러도 아무 일이 없다', () => {
    const handlers = renderScreen(IDLE_FLOW);

    const linkTab = screen.getByTestId('stay-register-tab-linkpaste');
    expect(linkTab).toBeDisabled();
    // 정규식으로 본다 — toHaveTextContent에 문자열을 주면 완전 일치라(02a ★2) 라벨 전문을
    // 잠그게 된다. 여기서 잠글 것은 "준비 중이라는 사실이 글자로 있다"뿐이다.
    expect(linkTab).toHaveTextContent(/준비 중/);

    // 반응 없는 버튼은 INV-4 위반이다. 그리고 fireEvent.press는 대상이 비활성이면 조상으로
    // 타고 올라가 다른 핸들러를 부르므로(02a ★17), 이 단언은 배치 실수까지 잡는다.
    fireEvent.press(linkTab);
    Object.values(handlers).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });
});

describe('P-3 · 핀 탭 표면이 지도 검색 표면을 대체한다 (AC-1)', () => {
  it('핀 패널과 지도가 뜨고, 검색 입력·후보 목록은 사라지되 탭 3개는 남는다', () => {
    renderScreen({
      ...PIN_FLOW,
      // 후보가 상태에 남아 있는데도 안 보여야 한다 — 상태를 지우는 것과 안 그리는 것은 다르다.
      searchStatus: 'success',
      candidates: [CANDIDATE_A],
    });

    // 긍정 앵커 — 핀 표면이 실제로 그려졌다. 이게 없으면 아래 "0건"이 공허하다.
    expect(screen.getByTestId('stay-register-pin-panel')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-register-pin-map')).toBeOnTheScreen();

    // 본체 — 지도 검색 탭의 표면이 물러난다.
    expect(screen.queryAllByTestId('stay-register-search-input')).toHaveLength(
      0
    );
    expect(
      screen.queryAllByTestId(/^stay-register-candidate-\d+$/)
    ).toHaveLength(0);

    // BR-U1-21 — 탭을 바꿔도 등록 경로가 3가지임은 화면에서 사라지지 않는다.
    expect(screen.getByTestId('stay-register-tab-mapsearch')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-register-tab-linkpaste')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-register-tab-pin')).toBeOnTheScreen();
  });
});

describe('P-4 · ★ 핀을 찍기 전에도 지도가 떠 있다 (D1)', () => {
  it('아직 아무 좌표도 없는 핀 탭에 지도가 렌더된다', () => {
    renderScreen({
      ...PIN_FLOW,
      selectedCandidate: null,
      pinAddressStatus: 'idle',
    });

    // 지도를 "핀을 찍은 뒤에" 그리는 구현이면 사용자는 롱프레스할 대상이 없어 영원히
    // 핀을 찍을 수 없다 — 이 칸 전체가 막다른 길이 된다.
    const map = screen.getByTestId('stay-register-pin-map');
    expect(within(map).getByTestId('map-root')).toBeOnTheScreen();
  });
});

describe('P-5 · 지도에서 온 메시지가 위로 통한다 (AC-3 — 사정거리는 여기까지)', () => {
  it('지도가 발화한 핀 메시지가 그대로 콜백으로 올라간다', () => {
    const handlers = renderScreen({
      ...PIN_FLOW,
      selectedCandidate: null,
      pinAddressStatus: 'idle',
    });

    const mapRoot = within(
      screen.getByTestId('stay-register-pin-map')
    ).getByTestId('map-root');
    // 배선 여부를 먼저 본다 — 통로가 없으면 아래 호출이 TypeError로 죽어 "무엇이 없는가"가
    // 안 읽힌다.
    expect(mapRoot).toHaveProp('onMapMessage', expect.any(Function));

    const message = { type: 'PIN_DROP', lat: 35.1621, lng: 129.1688 };
    act(() => {
      (mapRoot.props as { onMapMessage: (m: unknown) => void }).onMapMessage(
        message
      );
    });

    // 화면은 무상태다(G-2) — 해석하지 않고 그대로 위로 넘긴다.
    expect(handlers.onPinMessage).toHaveBeenCalledTimes(1);
    expect(handlers.onPinMessage).toHaveBeenCalledWith(message);
  });
});

describe('P-6 · 찍은 좌표가 지도 중심에 반영된다 (AC-3)', () => {
  it('핀 좌표가 지도로 전달된다', () => {
    renderScreen(PIN_FLOW);

    const map = screen.getByTestId('stay-register-pin-map');
    expect(within(map).getByTestId('map-root')).toHaveTextContent(
      '35.1621,129.1688'
    );
  });
});

describe('P-7 · 역지오코딩 주소가 표시된다 (AC-4)', () => {
  it('찍은 지점의 주소가 화면에 나오고 실패 문구는 없다', () => {
    renderScreen(PIN_FLOW);

    const address = screen.getByTestId('stay-register-pin-address');
    expect(
      within(address).getByText('부산 해운대구 중동 1394')
    ).toBeOnTheScreen();

    // 저장 정본은 좌표이고 주소는 표시용 사본이다(확정 3) — 표시가 됐다고 확정이 되진 않는다.
    expect(
      screen.queryAllByTestId('stay-register-pin-addressfail')
    ).toHaveLength(0);
  });
});

describe('P-8 · 역지오코딩 실패가 드러나고 다음 행동이 있다 (AC-5 · D3 · INV-4)', () => {
  it('실패 문구가 뜨고 숙소명을 직접 칠 자리가 있으며, 주소 칸은 비어 있지 않고 아예 없다', () => {
    renderScreen({
      ...PIN_FLOW,
      selectedCandidate: { ...PIN_RESULT, name: '', address: '' },
      pinAddressStatus: 'error',
    });

    // 침묵 실패 금지(BR-U1-55) — 문구 자체는 잠그지 않는다. 핀 탭은 Figma에 프레임이 없어
    // 대조할 카피 정본이 없다(02a ★13-c). "비어 있지 않다"만 본다.
    expect(
      screen.getByTestId('stay-register-pin-addressfail')
    ).toHaveTextContent(/\S/);

    // 다음 행동 — 주소를 못 받았으니 사람이 이름을 친다(D3 · Figma "숙소명 직접 입력").
    expect(screen.getByTestId('stay-register-name-input')).toBeOnTheScreen();

    // 빈 주소 칸을 남겨 두면 "조회 중인가 실패인가"를 구분할 수 없다.
    expect(screen.queryAllByTestId('stay-register-pin-address')).toHaveLength(
      0
    );
  });
});

describe('P-9 · 조회 중에는 실패라고 말하지 않는다 (AC-5 짝)', () => {
  it('역지오코딩이 진행 중이면 주소도 실패 문구도 뜨지 않는다', () => {
    renderScreen({ ...PIN_FLOW, pinAddressStatus: 'loading' });

    // 앵커 — 핀 표면 자체는 살아 있다.
    expect(screen.getByTestId('stay-register-pin-panel')).toBeOnTheScreen();

    // 본체 — 이 짝이 없으면 "실패 문구를 항상 띄우는" 구현이 P-8만으로 통과하고,
    // 사용자는 핀을 찍을 때마다 실패 문구가 번쩍이는 화면을 본다.
    expect(
      screen.queryAllByTestId('stay-register-pin-addressfail')
    ).toHaveLength(0);
    expect(screen.queryAllByTestId('stay-register-pin-address')).toHaveLength(
      0
    );
  });
});

describe('P-10 · 핀도 좌표 확정 게이트를 통과해야 한다 (AC-6 · BR-U1-22 · INV-U1-08 · D5)', () => {
  it('핀만 찍은 상태에서는 등록이 잠기고, 눌러도 제출 콜백이 불리지 않는다', () => {
    const handlers = renderScreen({ ...PIN_FLOW, coordConfirmed: false });

    // 화면이 무엇을 해야 하는지 말한다(BR-U1-22 문구 그대로).
    expect(
      within(screen.getByTestId('stay-register-coordnotice')).getByText(
        '지도에서 위치를 확인해 주세요'
      )
    ).toBeOnTheScreen();

    // 본체 — "핀은 사람이 직접 찍었으니 확정으로 쳐 주자"는 지름길을 막는다(D5 — 확정은
    // bottom-sheet 단일 경로). 잠그는 것만으로는 부족하고 콜백이 안 불려야 한다.
    const submit = screen.getByTestId('stay-register-submit');
    expect(submit).toBeDisabled();
    fireEvent.press(submit);
    expect(handlers.onSubmit).not.toHaveBeenCalled();

    // 막다른 길이 아니다 — 확정하러 가는 문이 열려 있다(INV-4).
    fireEvent.press(screen.getByTestId('stay-register-mapconfirm'));
    expect(handlers.onOpenMapSheet).toHaveBeenCalledTimes(1);
  });

  it('짝: 확정되면 안내가 사라지고 등록이 열린다', () => {
    const handlers = renderScreen({ ...PIN_FLOW, coordConfirmed: true });

    expect(screen.queryAllByTestId('stay-register-coordnotice')).toHaveLength(
      0
    );

    const submit = screen.getByTestId('stay-register-submit');
    expect(submit).toBeEnabled();
    fireEvent.press(submit);
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('P-11 · 폴백 버튼의 목적지가 생겼다 (AC-2 · BR-U1-23 · US-STAY-08 예외)', () => {
  it('"핀으로 직접 지정"이 눌리고, 누르면 핀 탭으로 가며, "준비 중"은 사라졌다', () => {
    const handlers = renderScreen({
      ...IDLE_FLOW,
      query: '해운대',
      searchStatus: 'error',
    });

    const fallback = screen.getByTestId('stay-register-pinfallback');
    expect(within(fallback).getByText('핀으로 직접 지정')).toBeOnTheScreen();

    // 동결 R-6이 잠가 두었던 두 단언을 뒤집는다 — 이번 칸이 이 버튼의 목적지다.
    expect(fallback).toBeEnabled();
    expect(fallback).not.toHaveTextContent(/준비 중/);

    fireEvent.press(fallback);
    expect(handlers.onSelectTab).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectTab).toHaveBeenCalledWith('pin');
  });
});

describe('P-12 · 지도가 안 될 때는 숙소명을 직접 친다 (D7 · Figma 1359:1546)', () => {
  it('검색 실패 화면에서 검색 입력이 숙소명 입력으로 바뀌고, 친 값이 위로 올라간다', () => {
    const handlers = renderScreen({
      ...IDLE_FLOW,
      query: '해운대',
      searchStatus: 'error',
    });

    // 지도로 이름을 못 찾으니 사람이 직접 친다 — Figma error-mapapi의 실측 배치다.
    expect(screen.queryAllByTestId('stay-register-search-input')).toHaveLength(
      0
    );
    const nameInput = screen.getByTestId('stay-register-name-input');
    expect(nameInput).toBeOnTheScreen();

    fireEvent.changeText(nameInput, '내가 예약한 숙소');
    expect(handlers.onChangeName).toHaveBeenCalledTimes(1);
    expect(handlers.onChangeName).toHaveBeenCalledWith('내가 예약한 숙소');
  });

  it('짝: 검색이 멀쩡할 때는 검색 입력이 그대로고 숙소명 입력은 없다', () => {
    // 이 짝이 교체 조건을 "검색 실패일 때"로 못박는다. 조건이 넓어지면 검색 입력 testID를
    // 쓰는 동결 4건(R-2·R-15·I-4·I-7)이 깨진다(02a ★18).
    renderScreen({
      ...IDLE_FLOW,
      query: '해운대',
      searchStatus: 'success',
      candidates: [CANDIDATE_A],
    });

    expect(screen.getByTestId('stay-register-search-input')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('stay-register-name-input')).toHaveLength(0);
  });
});

describe('P-13 · 친 이름이 탭을 넘어 살아남는다 (S-5 · D7)', () => {
  it('핀 탭에도 숙소명 입력이 있고 이미 친 값이 그대로 보인다', () => {
    renderScreen({ ...PIN_FLOW, name: '내가 예약한 숙소' });

    // 폴백으로 넘어오면서 입력이 사라지면, 사용자는 같은 것을 두 번 친다.
    expect(screen.getByTestId('stay-register-name-input')).toHaveDisplayValue(
      '내가 예약한 숙소'
    );
  });

  it('핀 탭과 검색 실패가 겹쳐도 숙소명 입력은 정확히 하나다', () => {
    // 폴백 버튼으로 넘어오면 이 조합이 실제로 만들어진다(searchStatus는 error인 채로 남고
    // activeTab만 pin이 된다). 두 탭이 각자 숙소명 입력을 그리면 testID가 둘이 되어
    // `getByTestId`가 "multiple matches"로 던지고, 이 파일과 통합 스위트가 통째로 죽는다.
    renderScreen({
      ...PIN_FLOW,
      query: '해운대',
      searchStatus: 'error',
      name: '내가 예약한 숙소',
    });

    expect(screen.queryAllByTestId('stay-register-name-input')).toHaveLength(1);
    // 짝 — 보이는 것이 핀 탭 표면이다(지도 검색 실패 화면이 겹쳐 그려진 것이 아니다).
    expect(screen.getByTestId('stay-register-pin-panel')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('stay-register-searchfail')).toHaveLength(0);
  });
});
