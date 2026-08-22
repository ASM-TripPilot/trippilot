import { act, fireEvent, render, screen } from '@testing-library/react-native';

import {
  TripBaseFixSheet,
  type TripBaseFixSheetProps,
} from './TripBaseFixSheet';

/**
 * TRIP-226 보완 시트 — **상태를 하나도 갖지 않는 순수 시트**(01b D1·D2·D3).
 * 좌표(지도)와 날짜를 한 자리에서 고치고, 저장에 성공하면 그 숙소는 **즉시 지정 가능**해진다.
 *
 * 무엇을 보장하나:
 *  - **AC-6 · D3** 저장 게이트 3분기 — 날짜 반쪽 · 역전 · 좌표 미확정 각각에서 저장이 막히고
 *    **왜 막혔는지**가 화면에 남는다(BR-U1-55 침묵 실패 금지).
 *  - **AC-7** 지도 핀 → 좌표 확정까지 실제로 걸어갈 수 있다.
 *  - **★7** 지도를 못 띄우면 그 사실을 말하고, 저장은 **여전히** 막힌다. 반대로 좌표가 이미
 *    확정된 숙소에는 지도를 **아예 안 띄운다**(날짜만 고치러 온 사람에게 WebView를 얹지 않는다).
 *  - **AC-8** 저장이 실패해도 시트가 닫히지 않는다 — 닫으면 방금 입력한 것을 전부 잃는다.
 *
 * ⚠️ **env 규율(실검증 §2-a).** `KakaoMapView`는 `EXPO_PUBLIC_KAKAO_MAP_JS_KEY`가 없으면
 * WebView 대신 `map-failure`를 그린다 — 키를 안 세우면 `map-webview` 조회가 throw해서
 * **AC-7이 원리적으로 못 돈다.** `KakaoMapView.messages.test.tsx:30-45`의 규율을 그대로 쓴다.
 *
 * ⚠️ **매처 규약(02a §2-e).** `toHaveTextContent(문자열)`은 **완전 일치**이고 형제 `<Text>`는
 * 구분자 없이 붙는다 → 컨테이너에는 정규식, 단일 `Text`에는 문자열.
 * 모든 "막힌다"는 `toBeDisabled()` + 실제 `press` + **핸들러 0회** 3단이다 — 매처는 접근성
 * 상태만 읽어서 회색이기만 하고 실제로는 눌리는 버튼을 통과시킨다(실측).
 */

const ENV_KEY = 'EXPO_PUBLIC_KAKAO_MAP_JS_KEY';
// computed 접근이 선언과 한 문장이면 eslint-plugin-expo의 no-dynamic-env-var에 걸린다 —
// 선언과 대입을 분리한다(KakaoMapView.test.tsx:38-40 선례).
let ORIGINAL_ENV: string | undefined;
ORIGINAL_ENV = process.env[ENV_KEY];

/** 소요 시간 표기(INV-3). 숫자를 앞에 두어 `충분`·`시간표` 같은 낱말에 오탐하지 않는다. */
const DURATION_PATTERNS = [/\d+\s*분/, /\d+\s*시간/, /소요/, /duration/i];

const DAY_OPTIONS = [
  { date: '2026-06-10', label: '6/10' },
  { date: '2026-06-11', label: '6/11' },
  { date: '2026-06-12', label: '6/12' },
  { date: '2026-06-13', label: '6/13' },
];

const handlers = {
  onPinDrop: jest.fn(),
  onConfirmCoord: jest.fn(),
  onPickDay: jest.fn(),
  onSave: jest.fn(),
  onRetrySave: jest.fn(),
  onClose: jest.fn(),
};

function props(
  over: Partial<TripBaseFixSheetProps> = {}
): TripBaseFixSheetProps {
  return {
    savedStayId: 'stay-b',
    stayName: '광안리 뷰 호텔',
    center: { lat: 35.1587, lng: 129.1604 },
    coordConfirmed: false,
    pinDropped: false,
    mapUnavailable: false,
    dayOptions: DAY_OPTIONS,
    checkIn: null,
    checkOut: null,
    saveDisabled: true,
    saving: false,
    ...handlers,
    ...over,
  };
}

/** WebView가 문자열 하나를 보낸 상황을 만든다. `fireEvent`가 아니라 props 직접 호출 + `act`가
 * 리포 정본이다 — `'message'` → `onMessage` 이름 변환이 검증되지 않았다
 * (`KakaoMapView.messages.test.tsx:47-58`의 같은 판단). */
function sendFromWebView(data: unknown): void {
  const webview = screen.getByTestId('map-webview');
  act(() => {
    webview.props.onMessage({ nativeEvent: { data } });
  });
}

beforeEach(() => {
  process.env[ENV_KEY] = 'test-js-key';
  Object.values(handlers).forEach((fn) => fn.mockClear());
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV;
  }
});

describe('골격 — 시트가 서고 빠져나갈 길이 있다', () => {
  it('🔴 숙소 이름·닫기·저장이 한 시트에 서고, 닫기가 배선을 부른다', () => {
    render(<TripBaseFixSheet {...props()} />);

    const sheet = screen.getByTestId('trip-base-fixsheet');
    expect(sheet).toBeOnTheScreen();
    // 컨테이너라 정규식(형제 Text가 구분자 없이 붙는다).
    expect(sheet).toHaveTextContent(/광안리 뷰 호텔/);
    expect(screen.getByTestId('trip-base-fixsheet-save')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('trip-base-fixsheet-close'));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    // 짝 — 닫기가 저장을 대신 부르지 않는다.
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it('🔴 ★6 · INV-3 — 카드가 그려진 것을 확인한 뒤, 소요 시간이 0건임을 본다', () => {
    // 긍정 앵커를 먼저 세운다 — 부정 단언만 두면 **아무것도 안 그리는** 구현이 공짜로
    // 통과한다. 이 시트는 `features/trip/ui`라 `pagesLayerStructure`의 duration 스캔 밖이다.
    render(
      <TripBaseFixSheet
        {...props({ checkIn: '2026-06-11', checkOut: '2026-06-13' })}
      />
    );

    const sheet = screen.getByTestId('trip-base-fixsheet');
    expect(sheet).toHaveTextContent(/광안리 뷰 호텔/);
    expect(
      screen.getByTestId('trip-base-fixsheet-day-2026-06-11')
    ).toBeOnTheScreen();

    DURATION_PATTERNS.forEach((pattern) => {
      expect(sheet).not.toHaveTextContent(pattern);
    });
  });
});

describe('AC-6 · 저장 게이트 3분기 (01b D3)', () => {
  it('🔴 ① 날짜를 한쪽만 채우면 저장이 막히고 사유가 남는다', () => {
    render(
      <TripBaseFixSheet
        {...props({
          coordConfirmed: true,
          checkIn: '2026-06-11',
          checkOut: null,
          saveDisabled: true,
          saveBlockedReason: '날짜를 모두 선택해 주세요',
        })}
      />
    );

    // 단일 Text 노드라 문자열 완전 일치를 쓴다.
    expect(screen.getByTestId('trip-base-fixsheet-blocked')).toHaveTextContent(
      '날짜를 모두 선택해 주세요'
    );

    // 3단 차단 — 매처만으로는 "안 눌린다"가 증명되지 않는다.
    const save = screen.getByTestId('trip-base-fixsheet-save');
    expect(save).toBeDisabled();
    fireEvent.press(save);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it('🔴 ② 체크아웃이 체크인보다 빠르면 막힌다 — 짝으로 정상 범위는 열린다', () => {
    // 이 상태에 **도달할 수 있어야** 이 케이스가 의미를 갖는다. 날짜 칩이 두 탭을 정렬하면
    // 도달 불가가 되고 이 AC는 통과 불가능한 AC가 된다(baseGate.test.ts ★9가 그것을 막는다).
    render(
      <TripBaseFixSheet
        {...props({
          coordConfirmed: true,
          checkIn: '2026-06-13',
          checkOut: '2026-06-11',
          saveDisabled: true,
          saveBlockedReason: '체크아웃이 체크인보다 빨라요',
        })}
      />
    );

    expect(screen.getByTestId('trip-base-fixsheet-blocked')).toHaveTextContent(
      '체크아웃이 체크인보다 빨라요'
    );
    const blocked = screen.getByTestId('trip-base-fixsheet-save');
    expect(blocked).toBeDisabled();
    fireEvent.press(blocked);
    expect(handlers.onSave).not.toHaveBeenCalled();

    // 짝 — 셋이 다 갖춰지면 실제로 눌리고 배선을 부른다. 이게 없으면 "언제나 막는" 시트가
    // 위 케이스들을 전부 통과하고, 사용자는 아무것도 고칠 수 없다.
    screen.rerender(
      <TripBaseFixSheet
        {...props({
          coordConfirmed: true,
          checkIn: '2026-06-11',
          checkOut: '2026-06-13',
          saveDisabled: false,
        })}
      />
    );
    const open = screen.getByTestId('trip-base-fixsheet-save');
    expect(open).toBeEnabled();
    fireEvent.press(open);
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    // 사유가 없으면 사유 줄을 안 그린다 — 막히지도 않은 시트에 경고가 상주하면 거짓말이다.
    expect(screen.queryByTestId('trip-base-fixsheet-blocked')).toBeNull();
  });

  it('🔴 ③ 좌표가 미확정이면 날짜가 다 차도 막힌다 (INV-U1-08)', () => {
    // 계약이 요구하는 도장은 `coordConfirmed` 하나다. 날짜만 보고 저장을 여는 구현은
    // 저장에 성공한 뒤에도 카드가 잠긴 상태를 만든다 — D3가 없애려던 바로 그 증상이다.
    render(
      <TripBaseFixSheet
        {...props({
          coordConfirmed: false,
          checkIn: '2026-06-11',
          checkOut: '2026-06-13',
          saveDisabled: true,
          saveBlockedReason: '지도에서 위치를 확인해 주세요',
        })}
      />
    );

    expect(screen.getByTestId('trip-base-fixsheet-blocked')).toHaveTextContent(
      '지도에서 위치를 확인해 주세요'
    );
    const save = screen.getByTestId('trip-base-fixsheet-save');
    expect(save).toBeDisabled();
    fireEvent.press(save);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });
});

describe('AC-7 · 지도에서 좌표를 확정한다', () => {
  it('🔴 핀을 찍으면 좌표가 위로 올라가고, 그제서야 확인 버튼이 열린다', () => {
    render(<TripBaseFixSheet {...props()} />);

    // 앵커 ① — 지도가 실제로 떴다(env 키가 세워졌다는 증거이기도 하다).
    expect(screen.getByTestId('map-webview')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-failure')).toBeNull();

    // 앵커 ② — 핀을 찍기 전에는 확정이 3단으로 막힌다. 확인할 좌표가 없는데 눌리면
    // 반응 없는 버튼이 된다(INV-4).
    const before = screen.getByTestId('trip-base-fixsheet-confirmcoord');
    expect(before).toBeDisabled();
    fireEvent.press(before);
    expect(handlers.onConfirmCoord).not.toHaveBeenCalled();

    // 실행 — 지도가 핀 좌표를 보냈다.
    sendFromWebView(
      JSON.stringify({ type: 'PIN_DROP', lat: 35.1587, lng: 129.1604 })
    );

    expect(handlers.onPinDrop).toHaveBeenCalledTimes(1);
    expect(handlers.onPinDrop).toHaveBeenCalledWith(35.1587, 129.1604);

    // 배선이 그 좌표를 쥐고 `pinDropped`를 세워 돌려준다 — 그때 확정이 열린다.
    screen.rerender(<TripBaseFixSheet {...props({ pinDropped: true })} />);
    const after = screen.getByTestId('trip-base-fixsheet-confirmcoord');
    expect(after).toBeEnabled();
    fireEvent.press(after);
    expect(handlers.onConfirmCoord).toHaveBeenCalledTimes(1);
  });
});

describe('★7 · 지도가 없는 두 갈래', () => {
  it('🔴 지도를 못 띄우면 그 사실을 말하고, 저장은 여전히 막힌다', () => {
    // 실측(02a §2-a): env 키가 없으면 `KakaoMapView`가 `map-failure`로 떨어져 **핀을 찍을
    // 방법 자체가 사라진다** → `coordConfirmed`를 참으로 만들 길이 없다. 이건 버그가 아니라
    // 사용자가 실제로 만나는 상태이고, 침묵하면 회색 저장 버튼만 남는다(BR-U1-55 · INV-4).
    render(
      <TripBaseFixSheet
        {...props({
          mapUnavailable: true,
          checkIn: '2026-06-11',
          checkOut: '2026-06-13',
          saveDisabled: true,
          saveBlockedReason: '지도에서 위치를 확인해 주세요',
        })}
      />
    );

    expect(screen.getByTestId('trip-base-fixsheet-mapfail')).toBeOnTheScreen();
    // 루트 존재 앵커(★17 규약) — 아래 `null`이 렌더가 통째로 죽어서 통과한 것이 아니다.
    expect(screen.getByTestId('trip-base-fixsheet')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-webview')).toBeNull();

    const save = screen.getByTestId('trip-base-fixsheet-save');
    expect(save).toBeDisabled();
    fireEvent.press(save);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it('🔴 짝 — 좌표가 이미 확정된 숙소에는 지도를 아예 안 띄운다', () => {
    // 날짜만 고치러 온 사용자에게 WebView를 얹지 않는다. 이 짝이 없으면 "언제나 지도를
    // 띄우는" 시트가 통과하고, 좌표가 멀쩡한 숙소에서도 지도 실패가 저장을 막을 수 있다.
    render(
      <TripBaseFixSheet
        {...props({ coordConfirmed: true, checkIn: '2026-06-11' })}
      />
    );

    expect(screen.queryByTestId('map-root')).toBeNull();
    expect(screen.queryByTestId('trip-base-fixsheet-confirmcoord')).toBeNull();
    // 앵커 — 시트와 날짜 칩은 멀쩡히 있다(지도만 빠진 것이지 시트가 죽은 것이 아니다).
    expect(screen.getByTestId('trip-base-fixsheet')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-base-fixsheet-day-2026-06-11')
    ).toBeOnTheScreen();
  });
});

describe('날짜 칩 — 여행 기간 안에서 고른다', () => {
  it('🔴 기간의 날 수만큼 칩이 서고, 누르면 그 날짜로 배선을 부른다', () => {
    render(<TripBaseFixSheet {...props({ coordConfirmed: true })} />);

    expect(screen.getAllByTestId(/^trip-base-fixsheet-day-/)).toHaveLength(4);

    fireEvent.press(screen.getByTestId('trip-base-fixsheet-day-2026-06-12'));
    expect(handlers.onPickDay).toHaveBeenCalledTimes(1);
    expect(handlers.onPickDay).toHaveBeenCalledWith('2026-06-12');
  });
});

describe('AC-8 · 저장 실패', () => {
  it('🔴 시트가 닫히지 않고 인라인 오류 + 다시 시도가 붙는다', () => {
    // 얼굴을 갈아 끼우거나 시트를 닫으면 방금 찍은 핀과 고른 날짜를 전부 잃는다
    // (선례: 01b D13 · TRIP-208 `StayImportRow`).
    render(
      <TripBaseFixSheet
        {...props({
          coordConfirmed: true,
          checkIn: '2026-06-11',
          checkOut: '2026-06-13',
          saveDisabled: false,
          errorText: '저장하지 못했어요',
        })}
      />
    );

    expect(screen.getByTestId('trip-base-fixsheet-error')).toHaveTextContent(
      '저장하지 못했어요'
    );
    // 입력이 살아 있다 — 시트가 초기화되지 않았다.
    expect(screen.getByTestId('trip-base-fixsheet')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-base-fixsheet-day-2026-06-11')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('trip-base-fixsheet-retry'));
    expect(handlers.onRetrySave).toHaveBeenCalledTimes(1);
  });

  it('🔴 저장 중에는 저장 버튼이 잠긴다 (연타 방지 겉겹)', () => {
    render(
      <TripBaseFixSheet
        {...props({
          coordConfirmed: true,
          checkIn: '2026-06-11',
          checkOut: '2026-06-13',
          saveDisabled: true,
          saving: true,
        })}
      />
    );

    const save = screen.getByTestId('trip-base-fixsheet-save');
    expect(save).toBeDisabled();
    fireEvent.press(save);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });
});

describe('TRIP-455 · 롱프레스 안내 (버그2)', () => {
  // 버그2 근본 원인(바텀시트 제스처가 WebView 롱프레스를 삼킴)은 **네이티브 제스처**라
  // jest가 원리적으로 못 본다 — gorhom 바텀시트 목이 통과 컴포넌트라 `enableContentPanning
  // Gesture={false}`를 주든 안 주든 렌더가 같다(02a ★G). 그 근본 수정은 6-b 실기 몫이고,
  // 여기서 잠그는 것은 병행 결함(디스커버러빌리티): "왜 회색 버튼인지"를 말하는 롱프레스 안내
  // 존재/부재다(BR-U1-55 침묵 실패 금지). StayRegister의 `stay-register-pin-hint`와 동형.

  it('🔴 P1 · 지도가 뜬 상태(좌표 미확정)에서 롱프레스 안내가 보인다', () => {
    // (준비) 좌표 미확정 + 지도 표시 가능 — props() 기본이 이 상태다. beforeEach가 env 키를
    // 세워 실물 지도가 뜬다(02a ★E, AC-7과 같은 규율).
    render(
      <TripBaseFixSheet
        {...props({ coordConfirmed: false, mapUnavailable: false })}
      />
    );

    // (단언) 앵커 — 지도가 실제로 떴다(안내가 "지도 있음" 상태에 올바로 붙었다는 전제이자
    // env 키가 세워졌다는 증거). 이게 없으면 아래 안내 단언이 무엇 위에 서는지 알 수 없다.
    expect(screen.getByTestId('map-webview')).toBeOnTheScreen();

    // 핵심 — 오늘은 이 안내가 없어 RED. `toBeOnTheScreen`=화면에 그 요소가 붙어 있나.
    expect(screen.getByTestId('trip-base-fixsheet-pin-hint')).toBeOnTheScreen();
    // 문구는 컨테이너 View라 정규식으로 부분 포함을 본다(문자열이면 완전 일치라
    // 마크업/공백에 취약, 02a ★M).
    expect(screen.getByTestId('trip-base-fixsheet-pin-hint')).toHaveTextContent(
      /길게 눌러/
    );
  });

  it('🔴 P2 · 좌표가 이미 확정된 숙소에는 안내가 없다 (지도 자체 미표시)', () => {
    // 날짜만 고치러 온 사용자에겐 지도를 아예 안 띄우므로(★7 짝), 롱프레스 안내도 없어야 한다.
    render(
      <TripBaseFixSheet
        {...props({ coordConfirmed: true, checkIn: '2026-06-11' })}
      />
    );

    // 앵커 — 시트·날짜 칩은 멀쩡하다(지도만 빠진 것이지 시트가 죽은 게 아니다, ★17 규약).
    expect(screen.getByTestId('trip-base-fixsheet')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-base-fixsheet-day-2026-06-11')
    ).toBeOnTheScreen();

    // 안내 부재. `queryByTestId`=없으면 null을 돌려준다(getByTestId는 throw).
    expect(screen.queryByTestId('trip-base-fixsheet-pin-hint')).toBeNull();
  });

  it('🔴 P3 · 지도를 못 띄우는 상태(mapUnavailable)에도 안내가 없다', () => {
    // 강화 잠금 — 안내는 "좌표 미확정"이 아니라 "지도가 실제로 뜬 상태"에만 붙어야 한다.
    // 이 케이스가 없으면 "좌표 미확정이면 무조건 안내"라는 가짜 구현이 살아남아, 길게 누를
    // 지도가 없는 실패 얼굴에도 "지도를 길게 누르라"는 거짓 안내를 띄운다(02a P3 근거).
    render(
      <TripBaseFixSheet
        {...props({ coordConfirmed: false, mapUnavailable: true })}
      />
    );

    // 앵커 — 지도 실패 얼굴이 떴고(길게 누를 지도 자체가 없다), 실물 지도는 없다.
    expect(screen.getByTestId('trip-base-fixsheet-mapfail')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-webview')).toBeNull();

    // 안내 부재.
    expect(screen.queryByTestId('trip-base-fixsheet-pin-hint')).toBeNull();
  });
});
