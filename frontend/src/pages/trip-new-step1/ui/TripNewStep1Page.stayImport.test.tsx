import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { SavedStay } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-208 g01 등록 숙소 날짜 연계 배선 — 조회 결과 ↔ 얼굴 ↔ 스토어 ↔ 라우터를 잇는다.
 *
 * 무엇을 보장하나:
 *  - **AC-1** 조회 결과가 얼굴 A의 부제(`{숙소명} · {기간}`)까지 이어진다.
 *  - **AC-3 · D10** `가져오기`가 실제로 여행 기간을 채우고, **어떤 프리셋 칩도 선택되지
 *    않으며**, 그 뒤에도 칩·날짜 카드로 다시 바꿀 수 있다(US-TRIP-05 "수정 가능").
 *  - **AC-3b** 가져온 날짜도 `validateTripDraft`(BR-U1-36)를 그대로 통과해야 `[다음]`이 열린다.
 *  - **AC-4** 기간이 이미 있으면 버튼이 **실제로** 안 눌리고 값이 바뀌지 않는다(BR-U1-41).
 *  - **AC-8** 조회가 실패해도 **잔존 목록으로 판정한 얼굴이 그대로 남는다**(D4).
 *  - **AC-10** `숙소 등록`이 `/stays/register`로 간다(D3 — 그 화면은 실재한다).
 *
 * 왜 node 버킷인가: 심판 대상이 "조회 **결과**가 어떤 얼굴·어떤 스토어 변화로 이어지는가"다.
 * 조회 상태 조합(로딩 · 성공 · 잔존+실패 · 실패)을 손으로 갈아 끼워야 하므로 훅을 모듈째
 * 목킹한다(`TripNewStep1Page.test.tsx`·`…budget.test.tsx`와 같은 형태). **실제 HTTP와
 * TanStack의 잔존 거동**은 `TripNewStep1Page.stayImport.integration.test.tsx`가 따로 본다 —
 * 이 파일은 그 거동을 *가정하고* 배선만 심판한다.
 *
 * 커버하지 않는 것: 표면 세부(문구 배치·testID 구조)는 `TripWizardStep1Screen.stayImport.test.tsx`,
 * 판정 규칙 자체는 `stayDateImport.test.ts` 몫이다.
 *
 * ⚠️ `jest.mock` 팩토리는 파일 최상단으로 끌어올려진다. 팩토리가 참조하는 바깥 변수는 이름이
 * `mock`으로 시작해야 예외를 받는다 — **아래 변수 이름을 바꾸지 마라**(리포 확립 규칙).
 */

jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  const replace = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, back, replace }),
    router: { push, back, replace },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  push: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
};

jest.mock('@/features/trip/model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({ data: undefined }),
}));

jest.mock('@/features/trip/model/useCreateTrip', () => ({
  useCreateTrip: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
    reset: jest.fn(),
  }),
}));

/** 조회 상태를 테스트가 손으로 갈아 끼우는 창구. TanStack이 돌려주는 것 중 이 배선이
 * 실제로 읽는 네 가지만 흉내낸다. */
const mockRefetch = jest.fn();
let mockSavedStays: {
  data?: SavedStay[];
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
};

jest.mock('@/features/trip/model/useSavedStays', () => ({
  useSavedStays: () => mockSavedStays,
}));

/**
 * TRIP-209 — **이 사이클이 이 파일에 더한 유일한 변경이다. 단언은 한 줄도 안 고쳤다.**
 *
 * TRIP-209가 페이지에 `useSavedPlaces`(→ `useQuery`·`useQueryClient`)를 붙이는 순간
 * provider 없는 이 버킷에서 render가 던진다(02a §5-4 실행 확인). 로딩 상태를 돌려주므로
 * '꼭 갈 곳' 섹션은 **글자 없는 자리표시**가 되어 이 파일의 등록 숙소 심판은 그대로 유효하다.
 */
jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: () => ({
    savedPlaces: [],
    isPending: true,
    isError: false,
    refetch: jest.fn(),
    remove: jest.fn(),
  }),
}));

/** 기준일 고정 — 실행일이 바뀌어도 날짜 단언이 흔들리지 않는다(TRIP-205 D5). */
const BASE = '2026-06-10';

const REASON_PERIOD_FILLED = '이미 입력한 기간이 있어요';

function stay(over: Partial<SavedStay> = {}): SavedStay {
  return {
    savedStayId: '00000000-0000-0000-0000-000000000001',
    name: '해운대 호텔',
    coordConfirmed: true,
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

/** 기준일과 같은 3박 범위(06-10 ~ 06-13) — 프리셋 `3박 4일`이 만드는 것과 같은 값이다. */
function datedStay(over: Partial<SavedStay> = {}): SavedStay {
  return stay({ checkIn: '2026-06-10', checkOut: '2026-06-13', ...over });
}

function loaded(stays: SavedStay[]) {
  return {
    data: stays,
    isPending: false,
    isError: false,
    refetch: mockRefetch,
  };
}

function fetchButton() {
  return screen.getByTestId('trip-wizard-fetch-staydates');
}

function dateField() {
  return screen.getByTestId('trip-wizard-date-field');
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

/** 도시 추가 시트를 열어 지역 하나를 N박으로 확정하는 3동작 묶음(승인 파일과 같은 형태). */
function addDestination(regionCode: string, nights: number): void {
  fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
  fireEvent.press(
    screen.getByTestId(`trip-wizard-destination-region-${regionCode}`)
  );
  for (let i = 1; i < nights; i += 1) {
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc'));
  }
  fireEvent.press(screen.getByTestId('trip-wizard-destination-confirm'));
}

const PRESET_CODES = ['this-weekend', 'next-weekend', '1n2d', '3n4d'];

beforeEach(() => {
  // 모듈 싱글턴 스토어를 되돌린다 — 안 하면 앞 테스트가 남긴 기간이 얼굴 판정을 뒤집어
  // 뒤 테스트가 거짓 red를 낸다.
  useTripWizardStore.getState().reset();
  routerMock.push.mockClear();
  mockRefetch.mockClear();
  mockSavedStays = loaded([datedStay()]);
});

describe('AC-1 · 조회 결과가 얼굴 A까지 이어진다', () => {
  it('숙소명과 기간을 이어 붙인 부제가 보인다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(
      within(screen.getByTestId('trip-wizard-stayimport-block')).getByText(
        '등록 숙소에서 날짜 가져오기'
      )
    ).toBeOnTheScreen();
    // 이 행의 기간 표기는 점·물결(`6.10~6.13`)이다 — 아래 날짜 카드의 en dash 표기와
    // 문자가 다르다(02a ★5).
    expect(
      within(screen.getByTestId('trip-wizard-stayimport-note')).getByText(
        '해운대 호텔 · 6.10~6.13'
      )
    ).toBeOnTheScreen();
  });
});

describe('AC-3 · 가져오기가 실제로 여행 기간을 채운다 (BR-U1-41 · D10)', () => {
  it('날짜 카드와 스토어가 숙소 날짜로 함께 바뀐다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    // 앵커 — 누르기 전에는 비어 있다. 없으면 "원래부터 채워져 있던" 것을 가져오기 성과로
    // 오독한다.
    expect(dateField()).toHaveTextContent(/날짜를 선택해 주세요/);

    fireEvent.press(fetchButton());

    // 날짜 **카드**의 서식은 en dash(U+2013)다 — 행 부제(`6.10~6.13`)와 다르다.
    expect(dateField()).toHaveTextContent(/6월 10일 – 6월 13일/);
    expect(useTripWizardStore.getState().startDate).toBe('2026-06-10');
    expect(useTripWizardStore.getState().endDate).toBe('2026-06-13');
  });

  it('⚠️ 어떤 프리셋 칩도 선택 표시되지 않는다 (D10 — 새 코드값을 만들지 않는다)', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(fetchButton());

    // 가져온 날짜는 프리셋에서 온 것이 아니다. 편의상 아무 프리셋 코드나 넣으면
    // **칩 하나가 켜져서** 사용자에게 "이번 주말을 골랐다"고 거짓말을 한다.
    PRESET_CODES.forEach((code) => {
      expect(
        screen.getByTestId(`trip-wizard-period-preset-${code}`)
      ).not.toBeSelected();
    });
    expect(useTripWizardStore.getState().presetCode).toBeUndefined();
  });

  it('짝 — 가져온 뒤에도 프리셋으로 다시 바꿀 수 있다 (US-TRIP-05 "수정 가능")', () => {
    // 이게 없으면 "가져오면 기간이 잠기는" 구현도 위 두 it을 통과한다. BR-U1-36은
    // 자동 채움이 **직접 수정 가능**해야 한다고 못박는다.
    render(<TripNewStep1Page baseDate={BASE} />);
    fireEvent.press(fetchButton());

    fireEvent.press(screen.getByTestId('trip-wizard-period-preset-1n2d'));

    expect(dateField()).toHaveTextContent(/6월 10일 – 6월 11일/);
    expect(screen.getByTestId('trip-wizard-period-preset-1n2d')).toBeSelected();
  });

  it('가져온 뒤에는 행이 사유 ①로 잠긴다 — 판정이 살아 있는 상태를 본다는 증거다', () => {
    // 가져오기가 성공하면 그 순간부터 "기간이 이미 입력됨"이 참이 된다(D2·D6 ①).
    // 얼굴이 그대로 활성이면 판정이 **렌더 시점의 스냅숏**에 묶여 있다는 뜻이고,
    // 그러면 두 번째 누르기가 조용히 덮어쓴다.
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(fetchButton());

    expect(
      within(screen.getByTestId('trip-wizard-stayimport-note')).getByText(
        REASON_PERIOD_FILLED
      )
    ).toBeOnTheScreen();
    expect(fetchButton()).toBeDisabled();
  });
});

describe('AC-3b · 가져온 날짜도 검증을 그대로 통과해야 한다 (BR-U1-36)', () => {
  it('여행지와 함께 채우면 [다음]이 열린다', () => {
    render(<TripNewStep1Page baseDate={BASE} />);

    // 부산 3박 + 가져온 3박(06-10~06-13) → 박수 합 3 ≤ 기간 3 → 위반 없음.
    addDestination('busan', 3);
    fireEvent.press(fetchButton());

    expect(next()).toBeEnabled();
  });

  it('짝 — 박수가 가져온 기간을 넘으면 닫힌 채로 남는다', () => {
    // 가져오기가 검증을 우회하는 뒷문이 되면 안 된다 — `validateTripDraft`(TRIP-204,
    // 동결)를 그대로 다시 탄다.
    render(<TripNewStep1Page baseDate={BASE} />);

    addDestination('busan', 5);
    fireEvent.press(fetchButton());

    expect(next()).toBeDisabled();
    fireEvent.press(next());
    expect(routerMock.push).not.toHaveBeenCalled();
  });
});

describe('AC-4 · 기간이 이미 있으면 덮어쓰지 않는다 (BR-U1-41)', () => {
  it('🔴 비활성 + 사유 ①이고, 눌러도 값이 그대로다', () => {
    // 준비 — 숙소 날짜를 **일부러 다른 범위**로 둔다. 프리셋이 만드는 값과 같으면
    // "안 바뀌었다"와 "바뀌었는데 우연히 같다"를 구별할 수 없다.
    mockSavedStays = loaded([
      datedStay({ checkIn: '2026-07-01', checkOut: '2026-07-05' }),
    ]);
    render(<TripNewStep1Page baseDate={BASE} />);

    // 실행 ① — 사용자가 먼저 기간을 골랐다(1박 2일 = 06-10 ~ 06-11).
    fireEvent.press(screen.getByTestId('trip-wizard-period-preset-1n2d'));

    expect(
      within(screen.getByTestId('trip-wizard-stayimport-note')).getByText(
        REASON_PERIOD_FILLED
      )
    ).toBeOnTheScreen();

    // 실행 ② + 단언 — 매처와 실제 동작을 **둘 다** 본다. `toBeDisabled()`는 접근성
    // 상태만 읽으므로, 회색이기만 하고 실제로는 눌리는 버튼이 매처를 통과한다(02a ★3).
    // 그 틈으로 BR-U1-41의 "임의 덮어쓰기 금지"가 조용히 깨진다.
    expect(fetchButton()).toBeDisabled();
    fireEvent.press(fetchButton());

    expect(useTripWizardStore.getState().startDate).toBe('2026-06-10');
    expect(useTripWizardStore.getState().endDate).toBe('2026-06-11');
    expect(dateField()).toHaveTextContent(/6월 10일 – 6월 11일/);
  });
});

describe('AC-2 · AC-10 · 등록 숙소가 0개면 대안으로 간다 (D3 · D8)', () => {
  it('숙소 등록을 누르면 실재하는 등록 화면으로 이동한다', () => {
    mockSavedStays = loaded([]);
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-register-stay'));

    // 티켓은 "화면이 없으니 자리만 라우트"라고 적었지만 `src/app/stays/register.tsx`가
    // 실재한다(TRIP-198·199) — 그 전제가 뒤집혀 D3이 실제 이동으로 정했다.
    expect(routerMock.push).toHaveBeenCalledWith('/stays/register');
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });

  it('기간을 이미 골랐어도 대안 얼굴은 그대로다 (AC-2)', () => {
    mockSavedStays = loaded([]);
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));

    // 얼굴 C에는 `가져오기`가 아예 없으므로 "기간 이미 입력"과 교차할 이유가 없다.
    // 여기서 사유 ①로 새면 등록 숙소가 없는 사용자가 대안 버튼을 영영 못 본다.
    expect(screen.getByText('등록한 숙소가 없어요')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-fetch-staydates')).toBeNull();
  });
});

describe('AC-8 · 조회 실패가 잔존 목록을 지우지 않는다 (D4 · INV-4)', () => {
  it('🔴 잔존 목록이 있으면 그 얼굴을 유지하고 재시도 행만 덧붙인다', () => {
    // ⚠️ 미해결 문제로그 `2026-08-04 화면 얼굴 전환이 잔존 목록을 지운다`(TRIP-222·223에서
    // 2회 반복)의 재발 방지 심판이다. 성공 경로만 태우는 테스트는 이 결함을 **원리적으로
    // 못 본다** — 실패 플래그가 켜진 상태를 따로 태워야만 보인다.
    mockSavedStays = {
      data: [datedStay()],
      isPending: false,
      isError: true,
      refetch: mockRefetch,
    };
    render(<TripNewStep1Page baseDate={BASE} />);

    // 잔존 데이터로 판정한 얼굴 A가 **그대로** 있다.
    expect(
      within(screen.getByTestId('trip-wizard-stayimport-note')).getByText(
        '해운대 호텔 · 6.10~6.13'
      )
    ).toBeOnTheScreen();
    expect(fetchButton()).toBeEnabled();
    // 그리고 실패를 숨기지도 않는다(BR-U1-55 침묵 실패 금지).
    expect(
      screen.getByTestId('trip-wizard-stayimport-retry')
    ).toBeOnTheScreen();
  });

  it('잔존이 아예 없으면 대안으로 떨어진다 — 스켈레톤에 갇히지 않는다', () => {
    // 첫 조회부터 실패한 상태(02a §5-3 실측: data는 undefined, isPending은 false).
    // 여기서 로딩을 계속 그리면 사용자가 할 수 있는 일이 하나도 없다.
    mockSavedStays = {
      data: undefined,
      isPending: false,
      isError: true,
      refetch: mockRefetch,
    };
    render(<TripNewStep1Page baseDate={BASE} />);

    expect(screen.getByText('등록한 숙소가 없어요')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-stayimport-retry')
    ).toBeOnTheScreen();
  });

  it('다시 시도가 실제로 재조회를 부른다', () => {
    mockSavedStays = {
      data: [datedStay()],
      isPending: false,
      isError: true,
      refetch: mockRefetch,
    };
    render(<TripNewStep1Page baseDate={BASE} />);

    fireEvent.press(screen.getByTestId('trip-wizard-stayimport-retry'));

    // 표시만 하고 아무 일도 안 하면 위반이다(`StayRegisterPage` I-3과 같은 규약).
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

describe('AC-9 · 조회 중에는 자리만 잡는다 (D5)', () => {
  it('행은 있고 어떤 얼굴 문구도 없다', () => {
    mockSavedStays = {
      data: undefined,
      isPending: true,
      isError: false,
      refetch: mockRefetch,
    };
    render(<TripNewStep1Page baseDate={BASE} />);

    const block = screen.getByTestId('trip-wizard-stayimport-block');
    expect(block).toBeOnTheScreen();
    expect(block).not.toHaveTextContent(/가져오기/);
    expect(block).not.toHaveTextContent(/등록한 숙소가 없어요/);

    // 짝(긍정) — 화면 자체는 정상이다. 없으면 아무것도 안 그리는 구현이 공짜로 통과한다.
    expect(screen.getByTestId('trip-wizard-step1-root')).toHaveTextContent(
      /언제 가세요\?/
    );
  });
});
