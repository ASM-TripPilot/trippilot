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
 * R-1~R-15 (동결 AC-2·3·4·6·7 · 01b Seed §3-1~§3-6) — e05 등록 화면의 렌더 계약.
 *
 * 무엇을 보장하나: 화면이 `flow` prop 하나로 받은 6축 상태(검색·후보·좌표확정·지도시트·
 * 날짜·제출)를 각각의 얼굴로 그리고, **좌표가 확정되기 전에는 등록 콜백이 아예 불리지
 * 않는다**(AC-3 — 서버 400에 의존하면 위반). 화면은 무상태라 상태를 직접 주입할 수 있어,
 * 실제 조작으로는 도달하기 어려운 조합(역전 날짜)도 여기서 만든다.
 *
 * 렌더로 못 보는 소스 층(FSD 경계·raw hex·testID 존재)은 `stayRegisterStructure.test.ts`가
 * 맡는다 — 이 파일은 렌더 결과만 본다(선례 `StaySearchScreen.states.test.tsx` 계승).
 *
 * 지도는 목으로 바꾼다(02a ★5·★6): 실제 `KakaoMapView`는 jest 환경에 카카오 JS 키가 없어
 * 항상 실패 표면으로 떨어지므로 `center`가 어디로도 흐르지 않는다. 목이 좌표를 텍스트로
 * 노출해 "고른 후보의 좌표가 지도로 갔다"를 관찰 가능하게 만든다.
 * 인라인 팩토리로 두면 NativeWind babel의 `_ReactNativeCSSInterop` 참조가 호이스트 규칙을
 * 위반한다 — 이 사이클에서 실제로 재현했다. 그래서 모듈 스코프 파일을 require 한다.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

/** 픽스처는 파일마다 각자 갖는 것이 리포 관례다(02a ★15). Figma multi-candidate 실측 데이터. */
const CANDIDATE_A: GeocodeCandidate = {
  name: '해운대 그랜드 호텔',
  address: '부산 해운대구 우동 1407',
  lat: 35.1587,
  lng: 129.1604,
};

const CANDIDATE_B: GeocodeCandidate = {
  name: '해운대 그랜드 레지던스',
  address: '부산 해운대구 중동 1124',
  lat: 35.1601,
  lng: 129.1652,
};

const IDLE_FLOW: StayRegisterFlow = {
  query: '',
  searchStatus: 'idle',
  candidates: [],
  selectedCandidate: null,
  coordConfirmed: false,
  mapSheetState: 'closed',
  checkIn: null,
  checkOut: null,
  dateSheetOpen: false,
  submitStatus: 'idle',
};

/** 좌표까지 확정된 "등록 직전" 상태 — 케이스마다 한 축만 무너뜨린다. */
const READY_FLOW: StayRegisterFlow = {
  ...IDLE_FLOW,
  query: '해운대',
  searchStatus: 'success',
  candidates: [CANDIDATE_A],
  selectedCandidate: CANDIDATE_A,
  coordConfirmed: true,
};

type Handlers = ReturnType<typeof makeHandlers>;

function makeHandlers() {
  return {
    onChangeQuery: jest.fn(),
    onSubmitQuery: jest.fn(),
    onRetrySearch: jest.fn(),
    onSelectCandidate: jest.fn(),
    onOpenMapSheet: jest.fn(),
    onConfirmCoord: jest.fn(),
    onCloseMapSheet: jest.fn(),
    onOpenDateSheet: jest.fn(),
    onPickDate: jest.fn(),
    onCloseDateSheet: jest.fn(),
    onSubmit: jest.fn(),
  };
}

/** 기본 today 고정 — 과거 날짜 비활성(§3-4)이 실행 날짜에 따라 흔들리지 않게 한다. */
const TODAY = '2026-06-15';

function renderScreen(
  flow: StayRegisterFlow,
  handlers: Handlers = makeHandlers(),
  today: string = TODAY
) {
  render(<StayRegisterScreen flow={flow} today={today} {...handlers} />);
  return handlers;
}

describe('R-1 · 3탭 셸과 몰입 화면 (AC-7 · 브리프 AC-11)', () => {
  it('탭 3개가 모두 존재하되 지도 검색만 활성이고, 하단 탭바는 없다', () => {
    const handlers = renderScreen(IDLE_FLOW);

    // 긍정 — 등록 경로가 3가지임이 화면에서 사라지지 않는다(BR-U1-21).
    expect(screen.getByTestId('stay-register-tab-mapsearch')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-register-tab-linkpaste')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-register-tab-pin')).toBeOnTheScreen();

    // 본체 — 이 칸의 범위는 지도 검색 탭뿐이므로 나머지 둘은 비활성이다.
    expect(screen.getByTestId('stay-register-tab-mapsearch')).toBeEnabled();
    expect(screen.getByTestId('stay-register-tab-linkpaste')).toBeDisabled();
    expect(screen.getByTestId('stay-register-tab-pin')).toBeDisabled();

    // 비활성 탭을 눌러도 아무 일이 없다 — "보이기만 하는 탭"이 아니라 진짜로 잠겼다.
    fireEvent.press(screen.getByTestId('stay-register-tab-linkpaste'));
    fireEvent.press(screen.getByTestId('stay-register-tab-pin'));
    Object.values(handlers).forEach((fn) => expect(fn).not.toHaveBeenCalled());

    // 몰입 화면 — 하단 탭바를 숨긴다(브리프 AC-11 · U0 BR-U0-29 상속).
    expect(screen.queryAllByTestId('shell-tabbar-root')).toHaveLength(0);
    expect(screen.getByTestId('stay-register-root')).toBeOnTheScreen();
  });
});

describe('R-2 · 검색은 키보드 검색 키로만 (§3-1)', () => {
  it('타이핑만으로는 검색이 나가지 않고, 검색 키를 눌러야 나간다', () => {
    const handlers = renderScreen(IDLE_FLOW);
    const input = screen.getByTestId('stay-register-search-input');

    // 키보드 오른쪽 아래 키가 '검색'으로 보여야 사용자가 그 키를 찾는다.
    expect(input).toHaveProp('returnKeyType', 'search');

    // 타이핑 — 값은 올라가지만 검색은 나가지 않는다(자동 검색 없음).
    fireEvent.changeText(input, '해운대');
    expect(handlers.onChangeQuery).toHaveBeenCalledTimes(1);
    expect(handlers.onChangeQuery).toHaveBeenCalledWith('해운대');
    expect(handlers.onSubmitQuery).not.toHaveBeenCalled();

    // 검색 키 — 이때만 나간다.
    fireEvent(input, 'submitEditing', { nativeEvent: { text: '해운대' } });
    expect(handlers.onSubmitQuery).toHaveBeenCalledTimes(1);
  });

  it('검색 중에는 검색 키를 다시 눌러도 무시한다 (중복 요청 방지)', () => {
    const handlers = renderScreen({
      ...IDLE_FLOW,
      query: '해운대',
      searchStatus: 'loading',
    });

    fireEvent(
      screen.getByTestId('stay-register-search-input'),
      'submitEditing',
      {
        nativeEvent: { text: '해운대' },
      }
    );
    expect(handlers.onSubmitQuery).not.toHaveBeenCalled();
  });
});

describe('R-3 · 다중 후보는 라디오로 (AC-2)', () => {
  it('후보 2건이 라디오로 제시되고, 고르기 전에는 등록이 진행되지 않는다', () => {
    const handlers = renderScreen({
      ...IDLE_FLOW,
      query: '해운대',
      searchStatus: 'success',
      candidates: [CANDIDATE_A, CANDIDATE_B],
      selectedCandidate: null,
    });

    // 긍정 — 안내문과 두 후보가 실제로 그려진다(Figma multi-candidate 실측 문구).
    expect(
      within(screen.getByTestId('stay-register-candidate-hint')).getByText(
        '여러 숙소가 검색됐어요. 정확한 곳을 선택하세요'
      )
    ).toBeOnTheScreen();

    const first = screen.getByTestId('stay-register-candidate-0');
    const second = screen.getByTestId('stay-register-candidate-1');
    expect(within(first).getByText('해운대 그랜드 호텔')).toBeOnTheScreen();
    expect(
      within(first).getByText('부산 해운대구 우동 1407')
    ).toBeOnTheScreen();
    expect(
      within(second).getByText('해운대 그랜드 레지던스')
    ).toBeOnTheScreen();
    expect(
      within(second).getByText('부산 해운대구 중동 1124')
    ).toBeOnTheScreen();

    // 라디오 = 하나만 고를 수 있는 선택지. 아직 아무것도 안 골랐다.
    expect(first).toHaveProp('accessibilityRole', 'radio');
    expect(second).toHaveProp('accessibilityRole', 'radio');
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();

    // 본체 — 고르기 전에는 등록이 진행되지 않는다.
    expect(screen.getByTestId('stay-register-submit')).toBeDisabled();
    fireEvent.press(screen.getByTestId('stay-register-submit'));
    expect(handlers.onSubmit).not.toHaveBeenCalled();

    // 짝 — 행을 누르면 그 후보가 실제로 위로 올라간다(선택이 스텁이 아니다).
    fireEvent.press(second);
    expect(handlers.onSelectCandidate).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectCandidate).toHaveBeenCalledWith(CANDIDATE_B);
  });

  it('고른 후보만 체크 표시가 된다', () => {
    renderScreen({
      ...IDLE_FLOW,
      searchStatus: 'success',
      candidates: [CANDIDATE_A, CANDIDATE_B],
      selectedCandidate: CANDIDATE_B,
    });

    expect(screen.getByTestId('stay-register-candidate-0')).not.toBeChecked();
    expect(screen.getByTestId('stay-register-candidate-1')).toBeChecked();
  });
});

describe('R-4 · 좌표 확정 게이트 (AC-3 · §3-2)', () => {
  it('coordConfirmed=false면 안내가 뜨고 등록 버튼이 잠기며, 눌러도 제출 콜백이 불리지 않는다', () => {
    const handlers = renderScreen({ ...READY_FLOW, coordConfirmed: false });

    // 긍정 — 무엇을 해야 하는지 화면이 말한다(BR-U1-22 문구 그대로).
    expect(
      within(screen.getByTestId('stay-register-coordnotice')).getByText(
        '지도에서 위치를 확인해 주세요'
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-register-mapconfirm')).getByText(
        '지도에서 위치 확인'
      )
    ).toBeOnTheScreen();

    // 본체 — 버튼이 잠겼고, **눌러도 제출이 시도되지 않는다**. 후자가 AC-3의 실질이다
    // (활성인 채로 두고 서버 400에 기대면 위반). 라디오 선택만으로는 확정이 아니라는
    // §3-2 결정이 여기서 기계로 강제된다 — selectedCandidate는 이미 채워져 있다.
    const submit = screen.getByTestId('stay-register-submit');
    expect(submit).toBeDisabled();
    fireEvent.press(submit);
    expect(handlers.onSubmit).not.toHaveBeenCalled();

    // 지도 확인 버튼은 살아 있다 — 막다른 길이 아니다(INV-4).
    fireEvent.press(screen.getByTestId('stay-register-mapconfirm'));
    expect(handlers.onOpenMapSheet).toHaveBeenCalledTimes(1);
  });

  it('짝: 좌표가 확정되면 안내가 사라지고 등록이 열린다', () => {
    const handlers = renderScreen(READY_FLOW);

    expect(screen.queryAllByTestId('stay-register-coordnotice')).toHaveLength(
      0
    );

    const submit = screen.getByTestId('stay-register-submit');
    expect(submit).toBeEnabled();
    fireEvent.press(submit);
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('R-5 · 검색 중 (§3-1)', () => {
  it('후보 자리에 전용 스켈레톤 카드 2장이 뜨고, 후보와 실패 배너는 없다', () => {
    renderScreen({ ...IDLE_FLOW, query: '해운대', searchStatus: 'loading' });

    expect(
      screen.queryAllByTestId(/^stay-register-candidate-skeleton-/)
    ).toHaveLength(2);
    expect(
      screen.queryAllByTestId(/^stay-register-candidate-\d+$/)
    ).toHaveLength(0);
    expect(screen.queryAllByTestId('stay-register-searchfail')).toHaveLength(0);
    expect(
      screen.queryAllByTestId('stay-register-candidate-empty')
    ).toHaveLength(0);
  });
});

describe('R-6 · 지도·검색 실패 (AC-6 · §3-6)', () => {
  it('실패를 문구로 드러내고 재시도가 실배선되며, 지도 자리는 배너가 대신한다', () => {
    const handlers = renderScreen({
      ...IDLE_FLOW,
      query: '해운대',
      searchStatus: 'error',
    });

    // 본체 — 침묵 실패 금지(INV-4 · BR-U1-55). Figma error-mapapi 실측 문구.
    const banner = screen.getByTestId('stay-register-searchfail');
    expect(
      within(banner).getByText('지도 검색을 사용할 수 없어요')
    ).toBeOnTheScreen();
    expect(
      within(banner).getByText('핀으로 직접 지정해 주세요')
    ).toBeOnTheScreen();

    // 재시도는 스텁이 아니라 실배선이다.
    const retry = screen.getByTestId('stay-register-searchfail-retry');
    expect(within(retry).getByText('다시 시도')).toBeOnTheScreen();
    fireEvent.press(retry);
    expect(handlers.onRetrySearch).toHaveBeenCalledTimes(1);

    // 폴백 버튼은 보이되 목적지가 다음 칸이라 잠겨 있다 — 반응 없는 버튼은 INV-4 위반이라
    // "준비 중"임을 글자로 말한다(§3-6).
    const pin = screen.getByTestId('stay-register-pinfallback');
    expect(within(pin).getByText('핀으로 직접 지정')).toBeOnTheScreen();
    expect(pin).toBeDisabled();
    expect(pin).toHaveTextContent(/준비 중/);

    // 실패 시에는 지도 캔버스 자체가 없다(Figma error-mapapi — 지도 자리를 배너가 대체).
    expect(screen.queryAllByTestId('stay-register-map-preview')).toHaveLength(
      0
    );
  });
});

describe('R-7 · 검색 결과 0건 (§3-1)', () => {
  it('문구만 보여주고 등록은 좌표 게이트가 이미 막는다', () => {
    renderScreen({ ...IDLE_FLOW, query: '없는숙소', searchStatus: 'empty' });

    expect(
      within(screen.getByTestId('stay-register-candidate-empty')).getByText(
        '검색 결과가 없어요'
      )
    ).toBeOnTheScreen();

    // 0건을 따로 막지 않는다 — 좌표를 못 받아 coordConfirmed=false라 AC-3이 이미 잠근다.
    expect(screen.getByTestId('stay-register-submit')).toBeDisabled();
    expect(screen.queryAllByTestId('stay-register-searchfail')).toHaveLength(0);
  });
});

describe('R-8 · 날짜 역전은 인라인 오류로 막는다 (AC-4)', () => {
  it('체크아웃이 체크인보다 빠르면 필드 안에 오류가 뜨고 저장이 막힌다', () => {
    const handlers = renderScreen({
      ...READY_FLOW,
      checkIn: '2026-06-12',
      checkOut: '2026-06-10',
    });

    // 오류가 **날짜 필드 안**에 있다 — 전역 토스트가 아니라 누락 항목 옆에 붙는다
    // (US-STAY-06 예외 "누락 항목을 인라인 표시").
    const field = screen.getByTestId('stay-register-date-field');
    expect(
      within(field).getByTestId('stay-register-date-error')
    ).toBeOnTheScreen();

    const submit = screen.getByTestId('stay-register-submit');
    expect(submit).toBeDisabled();
    fireEvent.press(submit);
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it('같은 날도 막는다 (INV-U1-09 — 체크아웃은 체크인보다 뒤여야 한다)', () => {
    const handlers = renderScreen({
      ...READY_FLOW,
      checkIn: '2026-06-10',
      checkOut: '2026-06-10',
    });

    expect(screen.getByTestId('stay-register-date-error')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('stay-register-submit'));
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  it('짝: 정상 범위면 오류가 없고 저장이 열린다', () => {
    renderScreen({
      ...READY_FLOW,
      checkIn: '2026-06-10',
      checkOut: '2026-06-12',
    });

    expect(screen.queryAllByTestId('stay-register-date-error')).toHaveLength(0);
    expect(screen.getByTestId('stay-register-submit')).toBeEnabled();
  });
});

describe('R-9 · 지도 시트에서만 좌표가 확정된다 (§3-2)', () => {
  it('"이 위치로 확인"을 눌러야 확정 콜백이 불린다', () => {
    const handlers = renderScreen({
      ...READY_FLOW,
      coordConfirmed: false,
      mapSheetState: 'open',
    });

    const sheet = screen.getByTestId('stay-register-mapsheet');
    const confirm = within(sheet).getByTestId('stay-register-mapsheet-confirm');
    expect(within(confirm).getByText('이 위치로 확인')).toBeOnTheScreen();

    fireEvent.press(confirm);
    expect(handlers.onConfirmCoord).toHaveBeenCalledTimes(1);
    // 확인은 닫기와 다른 사건이다 — 닫기 콜백을 대신 부르면 확정이 새어 나간다.
    expect(handlers.onCloseMapSheet).not.toHaveBeenCalled();
  });
});

describe('R-10 · 시트를 닫는 것은 확인이 아니다 (§3-2 · §3-3)', () => {
  it('닫기를 눌러도 좌표 확정 콜백은 불리지 않는다', () => {
    const handlers = renderScreen({
      ...READY_FLOW,
      coordConfirmed: false,
      mapSheetState: 'open',
    });

    fireEvent.press(screen.getByTestId('stay-register-mapsheet-close'));
    expect(handlers.onCloseMapSheet).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirmCoord).not.toHaveBeenCalled();
  });

  it('닫힌 시트는 아예 마운트되지 않는다 (WebView 동시 마운트 방지)', () => {
    renderScreen({ ...READY_FLOW, mapSheetState: 'closed' });

    // 시트 목(@gorhom/bottom-sheet)은 children을 항상 그리므로, "닫힘"은 조건부 렌더로만
    // 성립한다(02a ★10). 그래서 존재 자체가 0건이어야 한다.
    expect(screen.queryAllByTestId('stay-register-mapsheet')).toHaveLength(0);
    expect(
      screen.queryAllByTestId('stay-register-mapsheet-confirm')
    ).toHaveLength(0);
  });
});

describe('R-11 · 인라인 지도는 고른 후보의 좌표를 본다 (§3-3)', () => {
  it('선택한 후보의 lat·lng가 지도로 전달된다', () => {
    renderScreen({ ...READY_FLOW, selectedCandidate: CANDIDATE_B });

    const preview = screen.getByTestId('stay-register-map-preview');
    expect(within(preview).getByTestId('map-root')).toHaveTextContent(
      '35.1601,129.1652'
    );
  });

  it('짝: 고른 후보가 없으면 지도 미리보기 자체가 없다', () => {
    renderScreen({
      ...IDLE_FLOW,
      searchStatus: 'success',
      candidates: [CANDIDATE_A, CANDIDATE_B],
      selectedCandidate: null,
    });

    expect(screen.queryAllByTestId('stay-register-map-preview')).toHaveLength(
      0
    );
  });
});

describe('R-12 · 시트 지도가 실패해도 막다른 길이 아니다 (§3-3 · INV-4)', () => {
  it('이름·주소를 대신 보여주고 "이 주소로 확인"으로 확정할 수 있다', () => {
    const handlers = renderScreen({
      ...READY_FLOW,
      coordConfirmed: false,
      mapSheetState: 'open-map-failed',
    });

    const sheet = screen.getByTestId('stay-register-mapsheet');
    expect(
      within(sheet).getByText('지도를 불러오지 못했어요')
    ).toBeOnTheScreen();

    // 사람이 무엇을 보고 확인했는지가 화면에 남는다 — INV-U1-08의 취지를 유지한다.
    expect(within(sheet).getByText('해운대 그랜드 호텔')).toBeOnTheScreen();
    expect(
      within(sheet).getByText('부산 해운대구 우동 1407')
    ).toBeOnTheScreen();

    // 버튼 문구가 바뀐다 — 지도를 못 봤으니 "위치"가 아니라 "주소"로 확인한 것이다.
    const confirm = within(sheet).getByTestId('stay-register-mapsheet-confirm');
    expect(within(confirm).getByText('이 주소로 확인')).toBeOnTheScreen();
    expect(within(sheet).queryByText('이 위치로 확인')).toBeNull();

    fireEvent.press(confirm);
    expect(handlers.onConfirmCoord).toHaveBeenCalledTimes(1);
  });
});

describe('R-13 · 날짜 필드와 달력 (§3-4)', () => {
  it('날짜가 비어 있으면 N박 표기가 없고, 필드를 누르면 달력이 열린다', () => {
    const handlers = renderScreen(READY_FLOW);

    expect(
      screen.getByTestId('stay-register-date-summary')
    ).not.toHaveTextContent(/박/);

    fireEvent.press(screen.getByTestId('stay-register-date-field'));
    expect(handlers.onOpenDateSheet).toHaveBeenCalledTimes(1);
  });

  it('범위가 정해지면 "2박 · 나중에 바꿀 수 있어요"가 그대로 나온다', () => {
    renderScreen({
      ...READY_FLOW,
      checkIn: '2026-06-10',
      checkOut: '2026-06-12',
    });

    // toHaveTextContent(문자열)은 완전 일치다(02a ★7) — 이 한 줄이 문구 전체를 잠근다.
    expect(screen.getByTestId('stay-register-date-summary')).toHaveTextContent(
      '2박 · 나중에 바꿀 수 있어요'
    );
  });

  it('달력에서 오늘 이전은 잠기고, 오늘 이후를 누르면 그 날짜가 올라간다', () => {
    const handlers = renderScreen(
      { ...READY_FLOW, dateSheetOpen: true },
      makeHandlers(),
      '2026-06-15'
    );

    const sheet = screen.getByTestId('stay-register-datesheet');
    expect(sheet).toBeOnTheScreen();

    // 과거는 회색 비활성(§3-4 사용자 결정) — 오늘은 포함이다.
    expect(
      screen.getByTestId('stay-register-date-cell-2026-06-14')
    ).toBeDisabled();
    expect(
      screen.getByTestId('stay-register-date-cell-2026-06-15')
    ).toBeEnabled();

    const future = screen.getByTestId('stay-register-date-cell-2026-06-16');
    expect(future).toBeEnabled();
    fireEvent.press(future);
    expect(handlers.onPickDate).toHaveBeenCalledTimes(1);
    expect(handlers.onPickDate).toHaveBeenCalledWith('2026-06-16');
  });

  it('짝: 달력이 닫혀 있으면 날짜 칸이 하나도 없다', () => {
    renderScreen(READY_FLOW);

    expect(screen.queryAllByTestId('stay-register-datesheet')).toHaveLength(0);
    expect(screen.queryAllByTestId(/^stay-register-date-cell-/)).toHaveLength(
      0
    );
  });
});

describe('R-14 · 제출 중에는 버튼이 잠긴다 (§3-5)', () => {
  it('"등록 중…"으로 바뀌고 다시 눌러도 제출되지 않는다', () => {
    const handlers = renderScreen({
      ...READY_FLOW,
      submitStatus: 'submitting',
    });

    const submit = screen.getByTestId('stay-register-submit');
    expect(within(submit).getByText('등록 중…')).toBeOnTheScreen();
    expect(submit).toBeDisabled();

    fireEvent.press(submit);
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });
});

describe('R-15 · 제출 실패는 화면에 드러나고 입력이 보존된다 (§3-5 · INV-4)', () => {
  it('실패 문구와 다시 시도가 뜨고, 검색어·후보 선택이 그대로 남는다', () => {
    const handlers = renderScreen({
      ...READY_FLOW,
      candidates: [CANDIDATE_A, CANDIDATE_B],
      submitStatus: 'error',
    });

    const fail = screen.getByTestId('stay-register-submitfail');
    expect(within(fail).getByText('등록에 실패했어요')).toBeOnTheScreen();

    const retry = screen.getByTestId('stay-register-submitfail-retry');
    expect(within(retry).getByText('다시 시도')).toBeOnTheScreen();
    fireEvent.press(retry);
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1);

    // 입력 보존 — 실패했다고 화면을 비우지 않는다(다시 처음부터 검색하게 만들면 위반).
    expect(screen.getByTestId('stay-register-search-input')).toHaveDisplayValue(
      '해운대'
    );
    expect(screen.getByTestId('stay-register-candidate-0')).toBeChecked();
  });
});
