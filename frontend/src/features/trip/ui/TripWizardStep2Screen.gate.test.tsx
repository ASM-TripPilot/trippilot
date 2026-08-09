import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  TripWizardStep2Screen,
  type TripWizardStep2ScreenProps,
} from './TripWizardStep2Screen';

/**
 * TRIP-226 g02 후보 카드의 **전제 게이트 표면**. 동결된 `TripWizardStep2Screen.test.tsx`
 * (225 · 24케이스)를 열지 않으려고 형제 파일로 뺐다 — 리포 선례
 * `KakaoMapView.messages.test.tsx` / `StaySearchScreen.states.test.tsx` 분할과 같은 형태다.
 *
 * 무엇을 보장하나 — 전부 **카드 표면**이고 판정은 배선이 한다:
 *  - **D7** 좌표 사유가 **기존 슬롯**(`trip-base-assign-blocked-{id}`)에 들어간다. 새 testID를
 *    신설하면 슬롯이 둘로 갈리고, 티켓이 지정한 `trip-base-blocked-{id}`는 커버리지 안내행
 *    3종(`-notice`·`-days`·`-more`)과 접두사가 충돌한다.
 *  - **AC-5** 사유 옆에 **고치러 갈 길**이 있다. 225는 사유만 있고 길이 없어 막다른 길이었다
 *    (225 인수인계 B-1).
 *  - **★19 경계 · AC-9 vs D17** 기간 밖은 **거르지 않되(D17) 경고한다(AC-9)**. 셋을 한
 *    케이스에서 같이 재야 그 경계가 문서가 아니라 심판으로 남는다.
 *  - **★8** 보완 시트는 **열렸을 때만 마운트된다**. 상시 마운트하면 동결 82케이스 전부가
 *    매 렌더 WebView를 태운다 — 성능이 아니라 **심판 오염**이 문제다.
 *
 * ⚠️ 모든 "막힌다"는 `toBeDisabled()` + 실제 `press` + 핸들러 0회 **3단**이다(★12) — 매처는
 * 접근성 상태만 읽어서 회색이기만 하고 실제로는 눌리는 버튼을 통과시킨다(실측).
 * ⚠️ `toHaveTextContent(문자열)`은 **완전 일치**다 → 컨테이너는 정규식, 단일 `Text`는 문자열.
 */

function candidate(
  over: Partial<TripWizardStep2ScreenProps['candidates'][number]> = {}
): TripWizardStep2ScreenProps['candidates'][number] {
  return {
    savedStayId: 'stay-a',
    name: '해운대 오션 호텔',
    isBase: false,
    assignPending: false,
    ...over,
  };
}

const handlers = {
  onBack: jest.fn(),
  onAssign: jest.fn(),
  onRetryAssign: jest.fn(),
  onChange: jest.fn(),
  onRetryChange: jest.fn(),
  onGenerate: jest.fn(),
  onNoStayStart: jest.fn(),
  onExploreStays: jest.fn(),
  onRetryAll: jest.fn(),
  onRestart: jest.fn(),
  onRetryCoverage: jest.fn(),
  onFix: jest.fn(),
  onExtendConfirm: jest.fn(),
  onExtendCancel: jest.fn(),
};

function props(
  over: Partial<TripWizardStep2ScreenProps> = {}
): TripWizardStep2ScreenProps {
  return {
    variant: 'default',
    subtitle: '6월 10일–13일',
    sections: [],
    candidates: [candidate()],
    generateDisabled: false,
    coverageFailed: false,
    ...handlers,
    ...over,
  };
}

beforeEach(() => {
  Object.values(handlers).forEach((fn) => fn.mockClear());
});

describe('AC-1 · D7 — 좌표 사유는 기존 차단 슬롯에 들어간다', () => {
  it('🟢선제 BR-U1-22 원문이 `trip-base-assign-blocked-{id}`에 뜨고 실제로 눌리지 않는다', () => {
    // 문구는 이 칸의 발명이 아니다 — BR-U1-22 원문이자 e05 conflict 프레임(`1358:1578`)의
    // 실측 문자열이다. g02의 다른 문구가 전부 발명인 것과 대조된다.
    //
    // 🟢 **선제 green이다**(작성 시점 실행 확인). 225가 이미 `blockedReason`을 이 슬롯에
    // 그리므로 문구만 갈아 끼우면 통과한다. 값은 **D7 회귀 가드**에 있다 — 구현자가 좌표용
    // testID를 따로 만들면 여기서 red가 난다.
    render(
      <TripWizardStep2Screen
        {...props({
          candidates: [
            candidate({
              savedStayId: 'stay-b',
              blockedReason: '지도에서 위치를 확인해 주세요',
            }),
          ],
        })}
      />
    );

    // 단일 Text 노드라 완전 일치. 새 testID를 신설하면 여기서 red가 난다(D7 회귀 가드).
    expect(
      screen.getByTestId('trip-base-assign-blocked-stay-b')
    ).toHaveTextContent('지도에서 위치를 확인해 주세요');

    const button = screen.getByTestId('trip-base-assign-stay-b');
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(handlers.onAssign).not.toHaveBeenCalled();
  });
});

describe('AC-5 · ★20 — 사유 옆에 고치러 갈 길이 있다', () => {
  it('🔴 보완 진입이 그 숙소 id로 시트를 연다 — 라벨이 사유에 따라 갈린다', () => {
    // 225는 `날짜가 없어 지정할 수 없어요`를 보여 주고 **끝**이었다(인수인계 B-1 — 막다른 길).
    // 226이 더하는 것은 정확히 이 한 버튼이다.
    //
    // 버튼을 **하나만** 두는 이유(Seed 문면과의 의도적 차이): D2가 "좌표와 날짜를 한 시트에서"로
    // 정했으므로 `-fixdates`/`-fixcoord` 두 버튼의 목적지가 같다. 같은 곳으로 가는 버튼이
    // 둘이면 사용자는 차이가 있다고 오해한다 → 라벨만 갈린다.
    render(
      <TripWizardStep2Screen
        {...props({
          candidates: [
            candidate({
              savedStayId: 'stay-b',
              blockedReason: '지도에서 위치를 확인해 주세요',
              fixLabel: '지도에서 위치 확인',
            }),
            candidate({ savedStayId: 'stay-c', name: '감천 게스트하우스' }),
          ],
        })}
      />
    );

    const fix = screen.getByTestId('trip-base-fix-stay-b');
    expect(fix).toHaveTextContent('지도에서 위치 확인');
    fireEvent.press(fix);
    expect(handlers.onFix).toHaveBeenCalledTimes(1);
    expect(handlers.onFix).toHaveBeenCalledWith('stay-b');

    // 짝 — 막히지 않은 카드에는 그 버튼이 없다. 없으면 "모든 카드에 고치기를 다는" 구현이
    // 통과하고, 멀쩡한 숙소에도 뭔가 잘못된 듯한 버튼이 붙는다.
    expect(screen.queryByTestId('trip-base-fix-stay-c')).toBeNull();
    // 루트 존재 앵커(★17) — 위 `null`이 렌더 실패로 통과한 것이 아니다.
    expect(screen.getByTestId('trip-base-candidate-stay-c')).toBeOnTheScreen();
  });
});

describe('★19 경계 · AC-9 — 기간 밖은 거르지 않되(D17) 경고한다', () => {
  it('🔴 카드가 목록에 남고 · 경고가 상주하고 · 지정은 그대로 눌린다', () => {
    // ⚠️ **이 케이스가 D17과 AC-9의 경계를 문서가 아니라 심판으로 고정한다.**
    // 225 ★19(D17)는 *"여행 기간 밖 배정도 거르지 않고 그대로 그린다"*를 잠갔고, 그 논거는
    // *"거르는 것은 판정이고 판정은 서버 몫 — 숨기면 그 이상이 조용해진다"*였다.
    // 226은 "거르지는 않되 경고는 한다"로 갈라야 한다. 셋을 따로 재면 다음 사람이 D17을
    // "기간 밖은 손대지 마라"로 읽거나, 반대로 경고를 차단으로 격상시킨다.
    render(
      <TripWizardStep2Screen
        {...props({
          candidates: [
            candidate({
              savedStayId: 'stay-b',
              outOfPeriodNote: '여행 기간을 벗어나요',
            }),
          ],
        })}
      />
    );

    // ① 거르지 않는다 — 카드가 목록에 그대로 있다(D17).
    expect(screen.getByTestId('trip-base-candidate-stay-b')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^trip-base-candidate-/)).toHaveLength(1);

    // ② 침묵하지도 않는다 — 경고가 카드에 상주한다(AC-9 · D8 "카드 렌더 시점부터").
    expect(
      screen.getByTestId('trip-base-outofperiod-stay-b')
    ).toHaveTextContent('여행 기간을 벗어나요');

    // ③ 그렇다고 막지도 않는다 — 지정 버튼은 활성이고 실제로 눌린다. 이 세 번째가 없으면
    //    "경고 = 차단"으로 구현해도 위 둘이 통과한다.
    const assign = screen.getByTestId('trip-base-assign-stay-b');
    expect(assign).toBeEnabled();
    fireEvent.press(assign);
    expect(handlers.onAssign).toHaveBeenCalledTimes(1);
    expect(handlers.onAssign).toHaveBeenCalledWith('stay-b');
  });

  it('🟢선제 짝 — 기간 안 숙소에는 경고가 상주하지 않는다', () => {
    // 없으면 "언제나 경고를 그리는" 구현이 통과하고, 정상 숙소마다 거짓 경고가 붙는다.
    // 🟢 지금은 경고를 그리는 코드가 없어 공짜로 통과한다 — 짝의 숙명이다. 값은 구현이
    // 붙은 **뒤**에 생긴다(그때 red가 되면 과잉 경고를 잡은 것이다).
    render(<TripWizardStep2Screen {...props()} />);

    expect(screen.queryAllByTestId(/^trip-base-outofperiod-/)).toHaveLength(0);
    expect(screen.getByTestId('trip-base-candidate-stay-a')).toBeOnTheScreen();
  });
});

describe('AC-10 · 확장 여부 질의 (BR-U1-27 — 임의 확장 금지)', () => {
  it('🔴 확인·취소 두 버튼이 각자 제 핸들러를 부른다', () => {
    // BR-U1-27 원문이 *"경고하고 여행 기간 자동 확장 **여부를 묻는다**(임의 확장 금지)"*다.
    // 묻는다는 것은 **거절할 길이 있다**는 뜻이라, 취소 버튼이 없으면 질의가 아니라 통보다.
    render(
      <TripWizardStep2Screen
        {...props({
          candidates: [
            candidate({
              savedStayId: 'stay-b',
              outOfPeriodNote: '여행 기간을 벗어나요',
              extendPrompt: '여행 기간을 늘려서 지정할까요?',
            }),
          ],
        })}
      />
    );

    const notice = screen.getByTestId('trip-base-extendtrip-notice-stay-b');
    expect(notice).toHaveTextContent(/여행 기간을 늘려서 지정할까요\?/);
    // 두 버튼이 그 안내 안에 함께 있다 — 확인만 있고 취소가 화면 저 멀리 있으면 질의가 아니다.
    expect(
      within(notice).getByTestId('trip-base-extendtrip-confirm')
    ).toBeOnTheScreen();
    expect(
      within(notice).getByTestId('trip-base-extendtrip-cancel')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('trip-base-extendtrip-confirm'));
    expect(handlers.onExtendConfirm).toHaveBeenCalledTimes(1);
    expect(handlers.onExtendConfirm).toHaveBeenCalledWith('stay-b');
    // 교차 호출 0 — 확인이 취소를 겸하거나 그 반대이면 사용자가 거절할 수 없다.
    expect(handlers.onExtendCancel).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('trip-base-extendtrip-cancel'));
    expect(handlers.onExtendCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onExtendConfirm).toHaveBeenCalledTimes(1);
  });

  it('🔴 짝 — 묻는 중이 아니면 확인 버튼이 화면에 없다', () => {
    // 상시 렌더하면 사용자가 아무 때나 여행 기간을 늘릴 수 있다.
    render(
      <TripWizardStep2Screen
        {...props({
          candidates: [
            candidate({
              savedStayId: 'stay-b',
              outOfPeriodNote: '여행 기간을 벗어나요',
            }),
          ],
        })}
      />
    );

    expect(screen.queryByTestId('trip-base-extendtrip-confirm')).toBeNull();
    // 경고는 있고 질의만 없다 — 루트가 아니라 **이웃 노드**로 앵커를 잡는다.
    expect(
      screen.getByTestId('trip-base-outofperiod-stay-b')
    ).toBeOnTheScreen();
  });
});

describe('★8 · 보완 시트는 열렸을 때만 마운트된다', () => {
  it('🟢선제 fixSheet가 없으면 시트가 트리에 아예 없다', () => {
    // 상시 마운트하면 동결 82케이스 전부가 매 렌더 `KakaoMapView`(WebView)를 태운다.
    // 성능이 아니라 **심판 오염**이 문제다 — 기존 케이스의 렌더 트리에 이 칸의 부품이
    // 상주하게 되고, env 키 유무 같은 이 칸의 사정이 남의 케이스로 새어 나간다.
    render(<TripWizardStep2Screen {...props()} />);

    expect(screen.queryByTestId('trip-base-fixsheet')).toBeNull();
    // 루트 존재 앵커(★17) — `null`이 렌더 실패로 통과한 것이 아니다.
    expect(screen.getByTestId('trip-base-step2-root')).toBeOnTheScreen();
  });

  it('🔴 짝 — 주면 뜬다 (안 뜨면 위 케이스가 "언제나 없다"로 공허해진다)', () => {
    render(
      <TripWizardStep2Screen
        {...props({
          fixSheet: {
            savedStayId: 'stay-b',
            stayName: '광안리 뷰 호텔',
            center: { lat: 35.1587, lng: 129.1604 },
            // 좌표가 이미 확정된 숙소라 시트가 지도를 안 띄운다(★7 짝) — 이 파일이
            // env 키를 세우지 않아도 되는 이유다.
            coordConfirmed: true,
            pinDropped: false,
            mapUnavailable: false,
            dayOptions: [{ date: '2026-06-10', label: '6/10' }],
            checkIn: null,
            checkOut: null,
            saveDisabled: true,
            saving: false,
            onPinDrop: jest.fn(),
            onConfirmCoord: jest.fn(),
            onPickDay: jest.fn(),
            onSave: jest.fn(),
            onRetrySave: jest.fn(),
            onClose: jest.fn(),
          },
        })}
      />
    );

    expect(screen.getByTestId('trip-base-fixsheet')).toBeOnTheScreen();
    // 시트가 떠도 목록은 그대로다 — 얼굴을 갈아 끼우지 않는다.
    expect(screen.getByTestId('trip-base-candidate-stay-a')).toBeOnTheScreen();
  });
});
