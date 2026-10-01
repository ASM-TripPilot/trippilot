import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { GeocodeCandidate } from '@/shared/api/generated/schemas';
import type { StayRegisterFlow } from '../model/stayRegisterForm';
import { StayRegisterScreen } from './StayRegisterScreen';
import type { MapCenter } from '@/shared/map';

/**
 * e05 숙소 등록 — StayRegisterScreen(props 만 받는 뷰) 단위 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1148): 옛 `StayRegisterScreen.test.tsx`·`.pin.test.tsx`·`.surface.test.tsx` 를 각자의
 * 바깥 describe 로 옮겼다. 셋 다 같은 지도 목을 썼으므로 목은 하나다. 값이 다를 수 있는 동명 헬퍼
 * (`IDLE_FLOW`·`makeHandlers`·`renderScreen`)는 그 describe 안에 갇혀 있다.
 */

// 지도는 목으로 바꾼다 — 실물 CenterPinPicker 대신 `center-pin-picker`(onPick 을 host 로 통과) 목이 뜬다.
// 인라인 팩토리는 NativeWind babel 의 `_ReactNativeCSSInterop` 호이스트 함정에 걸리므로 모듈을 require 한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// 옛 StayRegisterScreen.test — R-1~R-16
describe('탭·검색·후보·제출 (옛 본 파일)', () => {
  /**
   * R-1~R-15 (동결 AC-2·3·4·6·7 · 01b Seed §3-1~§3-6) — e05 등록 화면의 렌더 계약.
   *
   * 무엇을 보장하나: 화면이 `flow` prop 하나로 받은 5축 상태(검색·후보·좌표확정·지도시트·
   * 제출)를 각각의 얼굴로 그리고, **좌표가 확정되기 전에는 등록 콜백이 아예 불리지
   * 않는다**(AC-3 — 서버 400에 의존하면 위반). 화면은 무상태라 상태를 직접 주입할 수 있어,
   * 실제 조작으로는 도달하기 어려운 조합도 여기서 만든다. 날짜 입력은 TRIP-1052에서 사라졌다(R-13).
   *
   * 렌더로 못 보는 소스 층(FSD 경계·raw hex·testID 존재)을 보던 `stayRegisterStructure`는
   * TRIP-1145 로 지웠다 — 이 파일은 렌더 결과만 본다(선례 `StaySearchScreen.states.test.tsx` 계승).
   *
   * 지도는 목으로 바꾼다(02a ★5·★6): 실제 `KakaoMapView`는 jest 환경에 카카오 JS 키가 없어
   * 항상 실패 표면으로 떨어지므로 `center`가 어디로도 흐르지 않는다. 목이 좌표를 텍스트로
   * 노출해 "고른 후보의 좌표가 지도로 갔다"를 관찰 가능하게 만든다.
   * 인라인 팩토리로 두면 NativeWind babel의 `_ReactNativeCSSInterop` 참조가 호이스트 규칙을
   * 위반한다 — 이 사이클에서 실제로 재현했다. 그래서 모듈 스코프 파일을 require 한다.
   */

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
    // TRIP-199 신규 4축(activeTab·name·coordSource·pinAddressStatus)은 required라 여기서
    // 채워야 한다 — 옵셔널로 두면 계약 변경이 사람 눈에 안 보인다(02a ★9).
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
      onSelectTab: jest.fn(),
      onChangeName: jest.fn(),
      onPickCoord: jest.fn(),
      onChangeQuery: jest.fn(),
      onSubmitQuery: jest.fn(),
      onRetrySearch: jest.fn(),
      onSelectCandidate: jest.fn(),
      onOpenMapSheet: jest.fn(),
      onConfirmCoord: jest.fn(),
      onCloseMapSheet: jest.fn(),
      onSubmit: jest.fn(),
    };
  }

  function renderScreen(
    flow: StayRegisterFlow,
    handlers: Handlers = makeHandlers()
  ) {
    render(<StayRegisterScreen flow={flow} {...handlers} />);
    return handlers;
  }

  describe('R-1 · 3탭 셸과 몰입 화면 (AC-7 · 브리프 AC-11)', () => {
    it('탭 3개가 모두 존재하되 링크 붙여넣기는 잠겨 있고, 하단 탭바는 없다', () => {
      const handlers = renderScreen(IDLE_FLOW);

      // 긍정 — 등록 경로가 3가지임이 화면에서 사라지지 않는다(BR-U1-21).
      expect(
        screen.getByTestId('stay-register-tab-mapsearch')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('stay-register-tab-linkpaste')
      ).toBeOnTheScreen();
      expect(screen.getByTestId('stay-register-tab-pin')).toBeOnTheScreen();

      // TRIP-199 계약 변경: 핀 탭의 `toBeDisabled()`를 뺀다 — 이번 티켓이 그 탭을 여는 것
      // 자체다(AC-1 · BR-U1-23). 핀 탭이 실제로 열린다는 증명은
      // `StayRegisterScreen.pin.test.tsx` P-1이 진다. 링크 붙여넣기는 계약 미존재라
      // 그대로 잠긴다(확정 2 · D6).
      expect(screen.getByTestId('stay-register-tab-mapsearch')).toBeEnabled();
      expect(screen.getByTestId('stay-register-tab-linkpaste')).toBeDisabled();

      // 잠긴 탭을 눌러도 아무 일이 없다 — "보이기만 하는 탭"이 아니라 진짜로 잠겼다.
      fireEvent.press(screen.getByTestId('stay-register-tab-linkpaste'));
      Object.values(handlers).forEach((fn) =>
        expect(fn).not.toHaveBeenCalled()
      );

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
      expect(screen.queryAllByTestId('stay-register-searchfail')).toHaveLength(
        0
      );
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

      // TRIP-199 계약 변경: 폴백 버튼의 `toBeDisabled()`와 `/준비 중/`을 뒤집는다 —
      // **이번 티켓이 이 버튼의 목적지를 만드는 일**이다(BR-U1-23 · US-STAY-08 예외).
      // 목적지가 생겼는데 "준비 중"이라고 적혀 있으면 그것이 거짓말이 된다.
      // 눌렀을 때 핀 탭으로 간다는 증명은 `StayRegisterScreen.pin.test.tsx` P-11이 진다.
      const pin = screen.getByTestId('stay-register-pinfallback');
      expect(within(pin).getByText('핀으로 직접 지정')).toBeOnTheScreen();
      expect(pin).toBeEnabled();
      expect(pin).not.toHaveTextContent(/준비 중/);

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
      expect(screen.queryAllByTestId('stay-register-searchfail')).toHaveLength(
        0
      );
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
      const confirm = within(sheet).getByTestId(
        'stay-register-mapsheet-confirm'
      );
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

  describe('R-11 · 인라인 지도는 항상 뜨고, 고른 후보의 좌표를 본다 (§3-3 · AC-S6)', () => {
    it('선택한 후보의 lat·lng가 지도로 전달된다', () => {
      renderScreen({ ...READY_FLOW, selectedCandidate: CANDIDATE_B });

      const preview = screen.getByTestId('stay-register-map-preview');
      expect(within(preview).getByTestId('map-root')).toHaveTextContent(
        '35.1601,129.1652'
      );
    });

    // TRIP-730 계약 변경: 지도는 세그먼트 바로 아래 **항상** 뜬다(Figma default·multi 실측) —
    // 옛 계약("후보를 고른 뒤에만 표시")을 뒤집는다. 숨기는 것은 error 뿐이고, 그 짝은 R-6이 진다.
    it('짝: 고른 후보가 없어도(선택 전) 지도 미리보기가 뜬다 — 항상 표시', () => {
      renderScreen({
        ...IDLE_FLOW,
        searchStatus: 'success',
        candidates: [CANDIDATE_A, CANDIDATE_B],
        selectedCandidate: null,
      });

      expect(screen.getByTestId('stay-register-map-preview')).toBeOnTheScreen();
    });

    it('검색 전 idle 상태에서도 지도는 이미 떠 있다(기본 center)', () => {
      renderScreen(IDLE_FLOW);

      expect(screen.getByTestId('stay-register-map-preview')).toBeOnTheScreen();
    });
  });

  // TRIP-989 D — 지도가 좌표를 가운데로 옮기기만 하고 "여기"를 표시하지 않았다. Figma e05 미니맵
  // (1703:1201·4520:2350)은 분홍 침대 마커 1개다 → `kind:'stay'`(01b Q3). `number` 는 타입상 필수라 1.
  // 목은 pins 를 host prop 으로 통과시킬 뿐이라 "넘겼다"까지만 본다 — 실제 마커가 찍히는지는 6-b.
  describe('R-19 · 고른 후보 좌표에 침대 핀 1개 (TRIP-989 D · US-STAY-08 · BR-U1-21)', () => {
    it('인라인 지도 미리보기에 고른 후보 좌표의 stay 핀 하나를 넘긴다', () => {
      renderScreen({ ...READY_FLOW, selectedCandidate: CANDIDATE_B });

      const preview = screen.getByTestId('stay-register-map-preview');
      expect(within(preview).getByTestId('map-root').props.pins).toEqual([
        { number: 1, lat: CANDIDATE_B.lat, lng: CANDIDATE_B.lng, kind: 'stay' },
      ]);
    });

    it('지도 시트(open)의 지도에도 같은 후보 좌표의 stay 핀 하나를 넘긴다', () => {
      renderScreen({
        ...READY_FLOW,
        coordConfirmed: false,
        mapSheetState: 'open',
      });

      const sheet = screen.getByTestId('stay-register-mapsheet');
      expect(within(sheet).getByTestId('map-root').props.pins).toEqual([
        { number: 1, lat: CANDIDATE_A.lat, lng: CANDIDATE_A.lng, kind: 'stay' },
      ]);
    });

    it('짝: 후보를 고르기 전에는 지도는 떠 있어도 핀이 없다', () => {
      renderScreen({
        ...IDLE_FLOW,
        searchStatus: 'success',
        candidates: [CANDIDATE_A, CANDIDATE_B],
        selectedCandidate: null,
      });

      const map = within(
        screen.getByTestId('stay-register-map-preview')
      ).getByTestId('map-root');
      // 핀을 안 넘기든(undefined) 빈 배열을 넘기든 "핀 없음"이다(02a ★12).
      expect(map.props.pins ?? []).toHaveLength(0);
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
      const confirm = within(sheet).getByTestId(
        'stay-register-mapsheet-confirm'
      );
      expect(within(confirm).getByText('이 주소로 확인')).toBeOnTheScreen();
      expect(within(sheet).queryByText('이 위치로 확인')).toBeNull();

      fireEvent.press(confirm);
      expect(handlers.onConfirmCoord).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔴 R-13 · 날짜 입력이 없다 — 좌표만 확정하면 등록된다 (TRIP-1052 AC-1 · US-STAY-08)', () => {
    it('날짜 필드·요약·오류·달력 시트·날짜 칸이 하나도 없고 "체크인·체크아웃" 문구도 없으며, 등록이 열린다', () => {
      // 준비 — 후보를 고르고 좌표까지 확정한 "등록 직전" 상태. 날짜 축은 flow에 아예 없다.
      const handlers = renderScreen(READY_FLOW);

      // 단언 ① — 부재. 접두 정규식 하나가 -date-field·-date-summary·-date-error·-datesheet·
      // -date-cell-* 다섯 갈래를 전부 덮는다(`^`가 있어 candidate 류는 안 걸린다).
      expect(screen.queryAllByTestId(/^stay-register-date/)).toHaveLength(0);
      expect(screen.queryByText(/체크인|체크아웃/)).toBeNull();

      // 단언 ② — 짝. 화면이 통째로 비어서 ①이 참이 된 게 아니다: 루트가 있고, 좌표 확정만으로
      // 등록 버튼이 열려 실제로 제출된다(날짜를 요구하면 위반).
      expect(screen.getByTestId('stay-register-root')).toBeOnTheScreen();
      const submit = screen.getByTestId('stay-register-submit');
      expect(submit).toBeEnabled();
      fireEvent.press(submit);
      expect(handlers.onSubmit).toHaveBeenCalledTimes(1);
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
      expect(
        screen.getByTestId('stay-register-search-input')
      ).toHaveDisplayValue('해운대');
      expect(screen.getByTestId('stay-register-candidate-0')).toBeChecked();
    });
  });

  describe('R-16 · CTA 텍스트가 상태별로 갈린다 (AC-S4 · 01b §3)', () => {
    it('좌표 확정 상태에서는 "이 숙소 등록"이고 "등록하기"가 아니다', () => {
      // READY_FLOW = coordConfirmed:true → 확정 콘텐츠 얼굴. CTA 앞의 ✓ 는 SVG 글리프라
      // 텍스트에 안 잡힌다(02a ★6) — 텍스트 노드는 "이 숙소 등록"이라 regex 로 잰다.
      renderScreen(READY_FLOW);

      const submit = screen.getByTestId('stay-register-submit');
      expect(within(submit).getByText(/이 숙소 등록/)).toBeOnTheScreen();
      expect(within(submit).queryByText('등록하기')).toBeNull();
    });

    it('좌표 미확정(다중 후보)에서는 "등록하기"이고 "이 숙소 등록"이 아니다', () => {
      renderScreen({
        ...IDLE_FLOW,
        searchStatus: 'success',
        candidates: [CANDIDATE_A, CANDIDATE_B],
        selectedCandidate: null,
      });

      const submit = screen.getByTestId('stay-register-submit');
      expect(within(submit).getByText('등록하기')).toBeOnTheScreen();
      expect(within(submit).queryByText(/이 숙소 등록/)).toBeNull();
    });

    // 제출 중 "등록 중…"은 R-14(동결·READY_FLOW+submitting)가 이미 잠근다 — submitting 이
    // coordConfirmed 보다 우선함을 그 테스트가 강제한다(Seed 공식 순서 오기 정정, 02a ★5).
  });

  describe('🔴 R-17 · 다중 후보 행에 "📍 지도 ›" 링크 모양이 없다 (TRIP-935 Q8)', () => {
    it('각 후보 행에 "지도 ›" 글자가 없고 이름·주소는 그대로다 (라디오 checked 판정은 R-3 유지)', () => {
      renderScreen({
        ...IDLE_FLOW,
        searchStatus: 'success',
        candidates: [CANDIDATE_A, CANDIDATE_B],
        selectedCandidate: null,
      });

      // 구 R-17 은 링크 존재를 잠갔지만 핸들러가 없어 누르면 행 선택으로 흡수되는 무반응 어포던스였다
      // (심사 2.1) — TRIP-935 Q8 로 부재를 잰다. 앵커로 각 행의 숙소 이름을 함께 본다.
      const first = screen.getByTestId('stay-register-candidate-0');
      const second = screen.getByTestId('stay-register-candidate-1');
      expect(within(first).getByText(CANDIDATE_A.name)).toBeOnTheScreen();
      expect(within(second).getByText(CANDIDATE_B.name)).toBeOnTheScreen();
      expect(within(first).queryAllByText(/지도 ›/)).toHaveLength(0);
      expect(within(second).queryAllByText(/지도 ›/)).toHaveLength(0);
    });
  });

  describe('R-18 · 확정 콘텐츠 선택 숙소 카드 (AC-S4 · 5-c 경고-1)', () => {
    it('좌표 확정 시 선택 카드가 뜨고 그 안에 고른 숙소 이름·주소가 렌더된다', () => {
      // READY_FLOW = coordConfirmed:true · selectedCandidate:CANDIDATE_A · mapSheetState:'closed'
      // → 확정 콘텐츠(default 1703 얼굴). 이 카드 블록을 통째로 지워도 R-16(CTA 텍스트만 봄)은
      // green이라, 이 사이클의 핵심 신규 콘텐츠인 선택 카드에 심판이 0개였다(5-c code-critic 경고-1).
      renderScreen(READY_FLOW);

      // 캡션(카드의 형제) — 확정 콘텐츠 표면 보호. getByText(문자열)은 완전일치라 문구를 잠근다.
      expect(
        screen.getByText('📍 지도에서 핀 위치를 확인하세요')
      ).toBeOnTheScreen();

      // 선택 카드 존재 + 그 안에 고른 숙소 이름·주소(픽스처 CANDIDATE_A). within 으로 카드 안을 본다
      // — 카드 블록이 사라지면 getByTestId 가 던져 red 다(무심판 봉합).
      const card = screen.getByTestId('stay-register-selected-card');
      expect(within(card).getByText('해운대 그랜드 호텔')).toBeOnTheScreen();
      expect(
        within(card).getByText('부산 해운대구 우동 1407')
      ).toBeOnTheScreen();
    });
  });
});

// 옛 StayRegisterScreen.pin — TRIP-866 S4 (P-*)
describe('핀 지정 탭 (옛 .pin)', () => {
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
      onSubmit: jest.fn(),
    };
  }

  function renderScreen(
    flow: StayRegisterFlow,
    handlers: Handlers = makeHandlers()
  ): Handlers {
    render(<StayRegisterScreen flow={flow} {...handlers} />);
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
      expect(
        screen.queryAllByTestId('stay-register-search-input')
      ).toHaveLength(0);
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

  describe('P-7 · 잠긴 탭은 잠긴 채이되 "준비 중"은 사라진다 (TRIP-730 · INV-4)', () => {
    it('링크 붙여넣기 탭은 비활성 유지이나 "준비 중" 캡션은 없고, 핀 탭은 눌러 고를 수 있다', () => {
      const handlers = renderScreen(IDLE_FLOW);

      const linkTab = screen.getByTestId('stay-register-tab-linkpaste');
      // disabled 는 그대로 유지(계약 미존재 · Seed §1) — 개봉 안 함.
      expect(linkTab).toBeDisabled();
      // TRIP-730 — 정지 화면을 Figma 와 맞춰 "준비 중" 캡션을 제거한다(무음 disabled 셀 자체가
      // INV-4 신호). regex 부분포함이라 캡션이 남아 있으면 red 다.
      expect(linkTab).not.toHaveTextContent(/준비 중/);

      fireEvent.press(screen.getByTestId('stay-register-tab-pin'));
      expect(handlers.onSelectTab).toHaveBeenCalledTimes(1);
      expect(handlers.onSelectTab).toHaveBeenCalledWith('pin');
    });
  });
});

// 옛 StayRegisterScreen.surface — SR-*
describe('표면 정합 (옛 .surface)', () => {
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
      onPickCoord: jest.fn(),
      onOpenMapSheet: jest.fn(),
      onConfirmCoord: jest.fn(),
      onCloseMapSheet: jest.fn(),
      onSubmit: jest.fn(),
      onBack: jest.fn(),
    };
  }

  function renderScreen(
    flow: StayRegisterFlow,
    handlers: Handlers = makeHandlers()
  ): Handlers {
    render(<StayRegisterScreen flow={flow} {...handlers} />);
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
    it('핀 지정 탭·아직 핀 없음(idle)이면 지도를 움직여 맞추라는 안내가 뜬다', () => {
      // 준비 — 핀 탭에 들어왔고 아직 아무 좌표도 없다(pinAddressStatus='idle').
      renderScreen(PIN_IDLE_FLOW);

      // 실행/단언 — 중앙 고정 핀 조작법(지도를 움직여 맞춘다)이 화면에 있다. 없으면 사용자는
      // 빈 지도 앞에서 무엇을 해야 할지 모른 채 폴백 경로가 막힌다(BR-U1-23).
      const hint = screen.getByTestId('stay-register-pin-hint');
      // 정규식 = 부분 포함(node_modules 실측 02a §6: matches()가 regex면 test(), string이면
      // 완전 일치). 카피 전문이 아니라 "움직여"라는 중앙 고정 핀 조작 지시가 살아 있는지만 잠근다 —
      // TRIP-866(S4) 롱프레스 소멸로 "길게 눌러"→"움직여" 전환(중앙 고정 핀엔 롱프레스가 없다).
      // 핀 탭은 Figma 프레임이 없어 대조할 카피 정본이 없다(프리즈 P-8과 같은 사정거리).
      expect(hint).toHaveTextContent(/움직여/);
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

        expect(screen.queryAllByTestId('stay-register-pin-hint')).toHaveLength(
          0
        );
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
});
