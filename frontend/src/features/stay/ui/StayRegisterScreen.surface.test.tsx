import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { GeocodeCandidate } from '@/shared/api/generated/schemas';

import type { StayRegisterFlow } from '../model/stayRegisterForm';
import { StayRegisterScreen } from './StayRegisterScreen';

/**
 * SR-1~SR-4 (TRIP-369 · AC-1·4·5·6 · 02a §3) — e05 등록 화면의 세 표면 결함 계약.
 *
 * 무엇을 보장하나: (c) 헤더 뒤로가기 컨트롤이 실제로 있고 누르면 `onBack`이 위로 오른다,
 * (b) 핀 지정 탭에서 핀을 찍기 전에는 조작 안내가 뜨고 찍은 뒤에는 사라진다, (함께 볼 것)
 * 핀을 찍어도 좌표 확정 전에는 기존 게이트 안내가 그대로 남는다(additive — 안 지운다).
 *
 * 무엇을 보장하지 **못**하나: 세그먼트 높이·앱바 픽셀 정합·핀 롱프레스 동작은 여기서
 * 증명되지 않는다 — 렌더 트리에 물리 형상값이 없고 지도는 목이다(02a §7, 6-b 실기 스모크).
 *
 * 프리즈 `StayRegisterScreen.test.tsx`(R-1~R-15)·`.pin.test.tsx`(P-1~P-13)는 한 줄도
 * 건드리지 않는다(게이트① 해시 동결). 이 파일은 이번 칸이 새로 여는 계약만 더한다(02a ★A).
 *
 * 지도는 목으로 바꾼다(02a ★D): 인라인 팩토리로 두면 NativeWind babel의
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

/** 핀 탭에 막 들어와 아직 아무 좌표도 없는 상태(핀 찍기 전). */
const PIN_IDLE_FLOW: StayRegisterFlow = {
  ...IDLE_FLOW,
  activeTab: 'pin',
  selectedCandidate: null,
  coordSource: 'PIN',
  pinAddressStatus: 'idle',
};

/** 핀을 찍어 역지오코딩까지 끝난 상태(pinAddressStatus는 'success'가 아니라 'ok'다 — 02a ★C). */
const PIN_OK_FLOW: StayRegisterFlow = {
  ...IDLE_FLOW,
  activeTab: 'pin',
  selectedCandidate: PIN_RESULT,
  coordSource: 'PIN',
  pinAddressStatus: 'ok',
};

type Handlers = ReturnType<typeof makeHandlers>;

/** 프리즈 `makeHandlers`와 달리 `onBack`을 포함한다(02a ★B) — 화면이 그것을 필수로 요구하면
 * onBack 없이 부르는 프리즈 28건이 깨지므로, 여기서만 넘겨 press를 잰다. */
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
    onBack: jest.fn(),
  };
}

/** 기본 today 고정 — 화면이 실행 날짜에 흔들리지 않게 한다(프리즈 파일과 동형). */
const TODAY = '2026-06-15';

function renderScreen(
  flow: StayRegisterFlow,
  handlers: Handlers = makeHandlers()
): Handlers {
  render(<StayRegisterScreen flow={flow} today={TODAY} {...handlers} />);
  return handlers;
}

describe('SR-1 · 헤더에 뒤로가기 컨트롤이 있고 누르면 위로 알린다 (AC-1)', () => {
  it('뒤로가기 버튼이 role=button·접근성 라벨을 갖고, 누르면 onBack이 정확히 한 번 불린다', () => {
    // 준비 — 화면을 연다.
    const handlers = renderScreen(IDLE_FLOW);

    // 실행/단언 ① — 헤더에 뒤로가기 컨트롤이 있다(없으면 getByTestId가 throw).
    const back = screen.getByTestId('stay-register-back');
    // 스크린리더가 "버튼"으로 읽고(탭이 아니다), 아이콘만 있는 컨트롤에 이름을 준다(01b 계약).
    expect(back).toHaveProp('accessibilityRole', 'button');
    expect(back).toHaveProp('accessibilityLabel', '뒤로 가기');

    // 실행 ② → 단언 — 누르면 뒤로가기 의도가 위(페이지)로 정확히 한 번 오른다. 화면은 라우팅을
    // 모르므로 여기서 잴 수 있는 것은 "콜백이 불렸나"까지고, router.back()은 SB-1(페이지)이 잰다.
    // 정확히 1회 — AppBar가 겹쳐 두 번 발화하는 배치 실수까지 막는다(02a ★G).
    fireEvent.press(back);
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });
});

describe('SR-2 · 핀을 찍기 전에는 조작 안내가 보인다 (AC-4)', () => {
  it('핀 지정 탭·아직 핀 없음(idle)이면 길게 눌러 지정하라는 안내가 뜬다', () => {
    // 준비 — 핀 탭에 들어왔고 아직 아무 좌표도 없다(pinAddressStatus='idle').
    renderScreen(PIN_IDLE_FLOW);

    // 실행/단언 — 롱프레스로 핀을 찍는 조작법이 화면에 있다. 없으면 사용자는 빈 지도 앞에서
    // 무엇을 해야 할지 모른 채 폴백 경로가 막힌다(BR-U1-23).
    const hint = screen.getByTestId('stay-register-pin-hint');
    // 정규식 = 부분 포함(node_modules 실측 02a §6: matches()가 regex면 test(), string이면
    // 완전 일치). 카피 전문이 아니라 "길게 눌러"라는 조작 지시가 살아 있는지만 잠근다 — 핀 탭은
    // Figma 프레임이 없어 대조할 카피 정본이 없다(프리즈 P-8과 같은 사정거리).
    expect(hint).toHaveTextContent(/길게 눌러/);
  });
});

describe('SR-3 · 핀을 찍은 뒤에는 조작 안내가 사라진다 (AC-5 · SR-2의 짝)', () => {
  // idle이 아닌 세 상태 전부에서 안내가 없어야 한다 — "항상 띄우는" 구현을 SR-2와 짝지어 막는다.
  // 부재 단언은 구현 전 자명하게 참이라(선제 green) SR-2 없이는 공허하다(02a ★H·★I).
  it.each(['loading', 'ok', 'error'] as const)(
    'pinAddressStatus=%s 이면 조작 안내가 없다',
    (pinAddressStatus) => {
      // 안내 부재는 상태 하나로만 갈리므로 후보값은 자유다(02a ★J).
      renderScreen({ ...PIN_OK_FLOW, pinAddressStatus });

      expect(screen.queryAllByTestId('stay-register-pin-hint')).toHaveLength(0);
    }
  );
});

describe('SR-4 · 핀을 찍어도 좌표 확정 전에는 게이트 안내가 그대로 뜬다 (AC-6 · 회귀·additive)', () => {
  it('핀 좌표가 있으나 coordConfirmed=false면 좌표 안내와 지도 확인 버튼이 유지된다', () => {
    // 준비 — 핀을 찍어 좌표는 있으나 아직 확정하지 않았다.
    renderScreen({ ...PIN_OK_FLOW, coordConfirmed: false });

    // 단언 — 프리즈 문자열 그대로. 이번 칸의 additive 변경(핀 안내 추가)이 이 안내를 지우면
    // 안 된다. 이 문자열을 바꾸면 동결 3파일이 red가 된다(브리프 함정).
    expect(
      within(screen.getByTestId('stay-register-coordnotice')).getByText(
        '지도에서 위치를 확인해 주세요'
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId('stay-register-mapconfirm')).toBeOnTheScreen();
  });
});
