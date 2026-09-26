import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { useReplanFormStore } from '@/features/planb/model/replanFormStore';
import type { ReplanOrigin } from '@/features/planb/model/replanOrigin';
import type {
  Itinerary,
  Trigger,
  TriggerList,
} from '@/shared/api/generated/schemas';

import { PlanbRequestPage } from './PlanbRequestPage';

/**
 * TRIP-750 · AC-6·7·8 — i04 배선: 진입 초기화·감지 트리거 시드 → 폼 → 조립 → POST, 그리고 닫기.
 *
 * 무엇을 보장하나:
 *  - 트리거로 진입하면(triggerId 가 활성·비MANUAL 트리거와 일치) 감지 칩이 **선택된 채로** 시작하고,
 *    문구는 slotKey 의 자기 날짜 슬롯으로 만든다. body 에 그 triggerId 가 실린다(BR-U4-31).
 *  - 트리거가 없거나·못 찾았거나·MANUAL 이면 감지 칩 0, 정적 날씨가 보이고 triggerId 는 null.
 *  - 진입마다 폼을 초기화하고 시드는 set 이다(이전 방문 값·토글 반전 없음, Q4). 시드는 한 번뿐이다.
 *  - 스크림·끌어 닫기 → back, 뒤로 갈 곳이 없으면 허브로 replace. POST 0(AC-8).
 *  - TRIP-752 AC-10: POST 가 성공하면 받은 세션 id 를 싣고 solving 으로 replace(push 아님). 성공 전엔 이동 0.
 *
 * seam 목(02a ★10): 페이지가 소비하는 래퍼 3개(`useStartReplan`·`useActiveTriggers`·`useLiveItinerary`)를
 * 목한다. 목 데이터는 같은 참조를 돌려준다(TanStack 구조 공유와 같다 — 새 객체면 가짜 루프).
 * jest.mock 팩토리는 `mock` 접두 변수만 볼 수 있다(호이스팅).
 *
 * TRIP-979: 제출은 이제 GPS origin 을 **먼저 읽고**(seam `useReplanGpsOrigin`, 목) 그 뒤에 POST 한다 —
 * 누른 직후가 아니라 한 박자 뒤에 mutate 가 불린다. 그래서 제출은 `await submit()`(누르고 mutate 가
 * 불릴 때까지 기다림)으로 쓴다. 기본 목은 origin 없음(undefined) → 기존 body(originKind:null) 그대로.
 */

let mockPhase: 'idle' | 'success' | 'conflict' | 'serverError' | 'network' =
  'idle';
// 시작 응답 = 열린 세션(서버 계약 ReplanSession, 응답 status 는 SOLVING) — 성공 콜백이 이 세션을 받는다.
const mockSession = { sessionId: 's9', tripId: 't1', status: 'SOLVING' };
// 실패 = axios 에러 모양(isNotFound 선례). 네트워크 오류는 응답 자체가 없다.
const mockHttpError = (status: number) => ({
  isAxiosError: true,
  response: { status },
});
const mockNetworkError = { isAxiosError: true, message: 'Network Error' };
type MockMutateOptions = {
  onSuccess?: (session: typeof mockSession) => void;
  onError?: (error: unknown) => void;
};
const mockMutate = jest.fn(
  (_variables: unknown, options?: MockMutateOptions) => {
    if (mockPhase === 'success') options?.onSuccess?.(mockSession);
    if (mockPhase === 'conflict') options?.onError?.(mockHttpError(409));
    if (mockPhase === 'serverError') options?.onError?.(mockHttpError(500));
    if (mockPhase === 'network') options?.onError?.(mockNetworkError);
  }
);

let mockTriggerData: TriggerList | undefined;
let mockItineraryData: Itinerary | undefined;

let mockCanGoBack = true;
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();

jest.mock('@/features/planb/model/useStartReplan', () => ({
  useStartReplan: () => ({
    mutate: mockMutate,
    isPending: false,
    isError: false,
  }),
}));

// TRIP-979 seam — 동의·권한·측위는 이 훅 뒤에 숨는다(그 판정은 useReplanGpsOrigin.test 가 잠근다).
// 기본은 origin 없음. 테스트가 GPS 조각·보류(deferred)로 바꿔 끼운다.
const mockReadOrigin = jest.fn((): Promise<ReplanOrigin | undefined> =>
  Promise.resolve(undefined)
);
jest.mock('@/features/planb/model/useReplanGpsOrigin', () => ({
  useReplanGpsOrigin: () => () => mockReadOrigin(),
}));

jest.mock('@/features/planb/model/useActiveTriggers', () => ({
  useActiveTriggers: () => ({
    data: mockTriggerData,
    isLoading: mockTriggerData === undefined,
    isSuccess: mockTriggerData !== undefined,
  }),
}));

jest.mock('@/features/execution/model/useLiveItinerary', () => ({
  useLiveItinerary: () => ({
    data: mockItineraryData,
    isLoading: mockItineraryData === undefined,
    isSuccess: mockItineraryData !== undefined,
  }),
}));

jest.mock('expo-router', () => {
  const routerMock = {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    back: (...args: unknown[]) => mockBack(...args),
    canGoBack: () => mockCanGoBack,
  };
  return { useRouter: () => routerMock, router: routerMock };
});

const TRIP_ID = 't1';
const TODAY = '2026-08-20';
const TOMORROW = '2026-08-21';
const TRIGGER_CHIP = 'planb-request-trigger-chip';
const DELETED_IDS = ['detected', 'out-of-scope', 'manual', 'suppress'].map(
  (suffix) => ['planb', 'request', suffix].join('-')
);

const baseSlot = {
  endAt: '18:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  distanceRange: null,
  tags: [],
  category: null,
  openingHours: null,
};

const ITINERARY = {
  itineraryId: 'it1',
  tripId: TRIP_ID,
  status: 'PLANNED',
  solveMode: 'FULL',
  generationMode: 'AI',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [
    {
      date: TODAY,
      slots: [
        {
          ...baseSlot,
          poiId: 'p0',
          startAt: '09:30:00',
          nameKo: '감천문화마을',
        },
        {
          ...baseSlot,
          poiId: 'p1',
          startAt: '17:00:00',
          nameKo: '해운대 해변',
        },
      ],
    },
    {
      date: TOMORROW,
      slots: [
        { ...baseSlot, poiId: 'p9', startAt: '10:00:00', nameKo: '태종대' },
      ],
    },
  ],
} as unknown as Itinerary;

const mkTrigger = (over: Partial<Trigger> = {}): Trigger =>
  ({
    triggerId: 'trg-1',
    kind: 'WEATHER',
    affectedDate: TODAY,
    slotKey: `${TODAY}#p1`,
    reason: '17시 이후 비 예보 70%',
    scope: 'PARTIAL_SLOTS',
    detectedAt: '2026-08-20T09:00:00Z',
    ...over,
  }) as Trigger;

const triggerList = (...triggers: Trigger[]): TriggerList => ({ triggers });

beforeEach(() => {
  mockPhase = 'idle';
  mockMutate.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockNavigate.mockClear();
  mockBack.mockClear();
  mockCanGoBack = true;
  mockTriggerData = triggerList();
  mockItineraryData = ITINERARY;
  useReplanFormStore.getState().reset();
  mockReadOrigin
    .mockReset()
    .mockImplementation(() => Promise.resolve(undefined));
});

/** [AI가 다시 짜기]를 누르고, mutate 가 누적 `calls` 회 불릴 때까지 기다린다(GPS 읽기 뒤 POST). */
async function submit(calls = 1): Promise<void> {
  fireEvent.press(screen.getByTestId('planb-request-submit'));
  await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(calls));
}

function postedBody(): unknown {
  expect(mockMutate).toHaveBeenCalledTimes(1);
  const vars = mockMutate.mock.calls[0][0] as { tripId: string; data: unknown };
  expect(vars.tripId).toBe(TRIP_ID);
  return vars.data;
}

function hrefString(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  const obj = (arg ?? {}) as { pathname?: string };
  return obj.pathname ?? JSON.stringify(arg);
}

function forwardDestinations(): string[] {
  return [mockPush, mockReplace, mockNavigate]
    .flatMap((fn) => fn.mock.calls)
    .map((call) => hrefString(call[0]));
}

// i05 로 **갈아 끼운다**(replace) — i04 는 허브 위 투명 모달이라 push 로 쌓으면 ‹ 가 요청 시트로 돌아간다.
const SOLVING_HREF = {
  pathname: '/trips/[tripId]/planb/solving',
  params: { tripId: TRIP_ID, sessionId: 's9' },
};

const body = (over: Record<string, unknown> = {}) => ({
  scope: 'PARTIAL_SLOTS',
  originKind: null,
  reasons: [],
  directives: [],
  freeText: null,
  excludedPoiIds: [],
  triggerId: null,
  ...over,
});

describe('I1·I2 · 수동 진입 제출 (AC-6 · BR-U4-10·12)', () => {
  it('🔴 I1 정적 날씨 + 자유텍스트를 조립해 POST(triggerId null)하고, 성공하면 받은 세션 id 로 solving 에 replace 한다 (TRIP-752 AC-10)', async () => {
    mockPhase = 'success';
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    fireEvent.press(screen.getByTestId('planb-request-reason-WEATHER'));
    fireEvent.changeText(
      screen.getByTestId('planb-request-freetext'),
      '광안리 야경'
    );
    await submit();

    expect(postedBody()).toEqual(
      body({ reasons: ['WEATHER'], freeText: '광안리 야경' })
    );
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(SOLVING_HREF);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('🔴 I1b 제출 직후에는 아무 데도 가지 않고, 성공 콜백이 불린 뒤에만 solving 으로 간다 (TRIP-752 AC-10 · 751 차단-1)', async () => {
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    await submit();

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(forwardDestinations()).toEqual([]);
    expect(mockBack).not.toHaveBeenCalled();

    const options = mockMutate.mock.calls[0][1];
    expect(typeof options?.onSuccess).toBe('function');
    act(() => options?.onSuccess?.(mockSession));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(SOLVING_HREF);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('I2 아무것도 안 골라도 빈 배열·freeText null 로 POST 된다', async () => {
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    await submit();

    expect(postedBody()).toEqual(body());
  });
});

describe('🔴 I3 · 트리거 진입 — 감지 칩 시드 + 새 카탈로그 body (AC-6 완료 조건 · AC-7)', () => {
  it('감지 칩이 선택된 채 시작하고, 새 방향 key 와 triggerId 가 body 로 나간다', async () => {
    mockTriggerData = triggerList(mkTrigger());
    render(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    // 제안까지만 — 진입만으로 POST 가 나가지 않는다(BR-U4-09).
    expect(mockMutate).not.toHaveBeenCalled();

    const chip = screen.getByTestId(TRIGGER_CHIP);
    expect(chip).toHaveTextContent('비 예보 · 해운대 해변 17시');
    expect(chip).toBeSelected();
    expect(screen.queryByTestId('planb-request-reason-WEATHER')).toBeNull();
    DELETED_IDS.forEach((id) => expect(screen.queryByTestId(id)).toBeNull());

    fireEvent.press(
      screen.getByTestId('planb-request-directive-END_NEAR_STAY')
    );
    fireEvent.press(
      screen.getByTestId('planb-request-directive-AVOID_OUTDOOR')
    );
    await submit();

    expect(postedBody()).toEqual(
      body({
        reasons: ['WEATHER'],
        directives: ['END_NEAR_STAY', 'AVOID_OUTDOOR'],
        triggerId: 'trg-1',
      })
    );
  });
});

describe('🔴 I4 · 감지 칩 문구는 slotKey 의 자기 날짜 슬롯으로 만든다 (AC-7 · 02a ★14)', () => {
  it('내일 슬롯을 가리키는 트리거면 내일 슬롯 이름·시로 문구를 만든다', () => {
    mockTriggerData = triggerList(
      mkTrigger({ affectedDate: TOMORROW, slotKey: `${TOMORROW}#p9` })
    );
    render(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    expect(screen.getByTestId(TRIGGER_CHIP)).toHaveTextContent(
      '비 예보 · 태종대 10시'
    );
  });
});

describe('🔴 I5 · CLOSURE·DELAY 트리거 — 매핑 key 로 시드·숨김·전송 (AC-2c · Q2)', () => {
  it.each([
    ['CLOSURE', '휴무 · 해운대 해변 주변 시설', 'TEMP_CLOSED'],
    ['DELAY', '이동 지연 · 해운대 해변 방면', 'SLOW_MOVE'],
  ] as const)(
    '%s 면 감지 칩 "%s" 가 %s 로 선택되고 정적 날씨·그 key 칩이 숨는다',
    async (kind, copy, reasonKey) => {
      mockTriggerData = triggerList(mkTrigger({ kind }));
      render(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

      const chip = screen.getByTestId(TRIGGER_CHIP);
      expect(chip).toHaveTextContent(copy);
      expect(chip).toBeSelected();
      expect(screen.queryByTestId('planb-request-reason-WEATHER')).toBeNull();
      expect(
        screen.queryByTestId(`planb-request-reason-${reasonKey}`)
      ).toBeNull();

      await submit();
      expect(postedBody()).toEqual(
        body({ reasons: [reasonKey], triggerId: 'trg-1' })
      );
    }
  );
});

describe('I6 · 감지 트리거가 성립하지 않는 진입 — 칩 0 · 정적 날씨 (AC-7)', () => {
  it('I6a triggerId 가 활성 목록에 없으면 칩이 없고 triggerId 는 null 이다', async () => {
    mockTriggerData = triggerList(mkTrigger());
    render(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-x" />);

    expect(screen.queryByTestId(TRIGGER_CHIP)).toBeNull();
    expect(
      screen.getByTestId('planb-request-reason-WEATHER')
    ).toBeOnTheScreen();

    await submit();
    expect(postedBody()).toEqual(body());
  });

  it('I6b 일치하는 트리거가 MANUAL 이면 칩이 없고 정적 날씨가 보인다', () => {
    mockTriggerData = triggerList(mkTrigger({ kind: 'MANUAL' }));
    render(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    expect(screen.queryByTestId(TRIGGER_CHIP)).toBeNull();
    expect(
      screen.getByTestId('planb-request-reason-WEATHER')
    ).toBeOnTheScreen();
  });

  it('I6c triggerId 없이 들어오면 활성 트리거가 있어도 칩이 없고 triggerId 는 null 이다(02a ★13)', async () => {
    mockTriggerData = triggerList(mkTrigger());
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    expect(screen.queryByTestId(TRIGGER_CHIP)).toBeNull();
    expect(
      screen.getByTestId('planb-request-reason-WEATHER')
    ).toBeOnTheScreen();

    await submit();
    expect(postedBody()).toEqual(body());
  });
});

describe('🔴 I7 · 트리거 조회 중엔 정적 날씨, 도착하면 감지 칩 (Q9)', () => {
  it('로딩 중엔 칩 없이 그리다가 데이터가 오면 선택된 감지 칩으로 바뀐다', () => {
    mockTriggerData = undefined;
    const { rerender } = render(
      <PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />
    );

    expect(screen.queryByTestId(TRIGGER_CHIP)).toBeNull();
    expect(
      screen.getByTestId('planb-request-reason-WEATHER')
    ).toBeOnTheScreen();

    mockTriggerData = triggerList(mkTrigger());
    rerender(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    expect(screen.getByTestId(TRIGGER_CHIP)).toBeSelected();
    expect(screen.queryByTestId('planb-request-reason-WEATHER')).toBeNull();
  });
});

describe('🔴 I8 · 진입 초기화 후 set 시드 (Q4 · 02a ★11)', () => {
  it('이전 방문의 선택이 남지 않고, 이미 켜져 있던 WEATHER 도 꺼지지 않는다', async () => {
    const store = useReplanFormStore.getState();
    store.setScope('FULL_DAY');
    store.toggleReason('LOW_ENERGY');
    store.toggleReason('WEATHER');
    store.toggleDirective('RELAX');
    store.setFreeText('이전 입력');

    mockTriggerData = triggerList(mkTrigger());
    render(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    expect(
      screen.getByTestId('planb-request-scope-PARTIAL_SLOTS')
    ).toBeSelected();
    expect(
      screen.getByTestId('planb-request-reason-LOW_ENERGY')
    ).not.toBeSelected();
    expect(
      screen.getByTestId('planb-request-directive-RELAX')
    ).not.toBeSelected();
    expect(screen.getByTestId('planb-request-freetext').props.value).toBe('');
    expect(screen.getByTestId(TRIGGER_CHIP)).toBeSelected();

    await submit();
    expect(postedBody()).toEqual(
      body({ reasons: ['WEATHER'], triggerId: 'trg-1' })
    );
  });
});

describe('I9 · URL scope 시드 (TRIP-561 결정 3 · 02a ★9)', () => {
  it('🔴 scope=FULL_DAY 면 오늘 전체로 시작해 그 범위로 제출된다', async () => {
    render(<PlanbRequestPage tripId={TRIP_ID} scope="FULL_DAY" />);

    expect(screen.getByTestId('planb-request-scope-FULL_DAY')).toBeSelected();
    await submit();
    expect(postedBody()).toEqual(body({ scope: 'FULL_DAY' }));
  });

  it('모르는 scope 값이면 기본(지금 이후)을 유지한다', () => {
    render(<PlanbRequestPage tripId={TRIP_ID} scope="TOMORROW" />);

    expect(
      screen.getByTestId('planb-request-scope-PARTIAL_SLOTS')
    ).toBeSelected();
  });
});

describe('🔴 I10 · 감지 칩을 끄면 다시 켜지지 않는다 (AC-2c · 02a ★12)', () => {
  it('칩을 끄고 입력을 이어가도 꺼진 채이고, triggerId 는 선택과 무관하게 실린다(Q3)', async () => {
    mockTriggerData = triggerList(mkTrigger());
    render(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    fireEvent.press(screen.getByTestId(TRIGGER_CHIP));
    expect(screen.getByTestId(TRIGGER_CHIP)).not.toBeSelected();

    fireEvent.changeText(screen.getByTestId('planb-request-freetext'), '실내');
    expect(screen.getByTestId(TRIGGER_CHIP)).not.toBeSelected();

    await submit();
    expect(postedBody()).toEqual(
      body({ freeText: '실내', triggerId: 'trg-1' })
    );
  });
});

describe('🔴 I11·I12 · 닫기 = 라우트 이탈 (AC-8 · Q8)', () => {
  it('I11a 스크림을 누르면 뒤로 간다(POST 0 · replace 0)', () => {
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    fireEvent.press(screen.getByTestId('planb-request-scrim'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('I11b 뒤로 갈 곳이 없으면(딥링크·푸시 착지) 허브로 replace 한다', () => {
    mockCanGoBack = false;
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    fireEvent.press(screen.getByTestId('planb-request-scrim'));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(hrefString(mockReplace.mock.calls[0][0])).toBe(
      `/trips/${TRIP_ID}/live`
    );
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('I12 시트를 끌어 닫아도(BottomSheet onClose) 뒤로 간다', () => {
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    const pannable = screen.UNSAFE_root.findAll(
      (node) => node.props.enablePanDownToClose === true
    );
    expect(pannable.length).toBeGreaterThan(0);
    act(() => {
      pannable[0].props.onClose();
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 I13 · 로딩 중 켠 사유 위에 도착한 시드는 set 이다 (Q4 · 02a ★11 · 5-b 경고-1)', () => {
  it('로딩 중 정적 날씨를 켠 뒤 WEATHER 트리거가 도착해도 감지 칩은 켜진 채다', async () => {
    mockTriggerData = undefined;
    const { rerender } = render(
      <PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />
    );
    fireEvent.press(screen.getByTestId('planb-request-reason-WEATHER'));

    mockTriggerData = triggerList(mkTrigger());
    rerender(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    expect(screen.getByTestId(TRIGGER_CHIP)).toBeSelected();
    await submit();
    expect(postedBody()).toEqual(
      body({ reasons: ['WEATHER'], triggerId: 'trg-1' })
    );
  });
});

describe('🔴 I14 · 트리거가 목록에서 빠졌다 돌아와도 다시 시드하지 않는다 (02a ★12 · 5-b 참고-1)', () => {
  it('감지 칩을 끈 뒤 트리거가 잠깐 사라졌다 돌아와도 칩은 꺼진 채다', async () => {
    mockTriggerData = triggerList(mkTrigger());
    const { rerender } = render(
      <PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />
    );
    fireEvent.press(screen.getByTestId(TRIGGER_CHIP));

    mockTriggerData = triggerList();
    rerender(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);
    mockTriggerData = triggerList(mkTrigger());
    rerender(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    expect(screen.getByTestId(TRIGGER_CHIP)).not.toBeSelected();
    await submit();
    expect(postedBody()).toEqual(body({ triggerId: 'trg-1' }));
  });
});

describe('🔴 I15 · 감지 칩이 정적 칩을 숨기면 숨긴 칩의 선택도 풀린다 (Q2 · 5-b 경고-2)', () => {
  const sortedReasons = (): string[] =>
    [...(postedBody() as { reasons: string[] }).reasons].sort();

  it.each([
    ['CLOSURE', 'TEMP_CLOSED'],
    ['DELAY', 'SLOW_MOVE'],
  ] as const)(
    'I15a 로딩 중 날씨·체력 저하를 켠 뒤 %s 트리거가 오면 숨은 날씨만 빠지고 %s 가 켜진다',
    async (kind, reasonKey) => {
      mockTriggerData = undefined;
      const { rerender } = render(
        <PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />
      );
      fireEvent.press(screen.getByTestId('planb-request-reason-WEATHER'));
      fireEvent.press(screen.getByTestId('planb-request-reason-LOW_ENERGY'));

      mockTriggerData = triggerList(mkTrigger({ kind }));
      rerender(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

      expect(screen.queryByTestId('planb-request-reason-WEATHER')).toBeNull();
      expect(
        screen.getByTestId('planb-request-reason-LOW_ENERGY')
      ).toBeSelected();
      expect(screen.getByTestId(TRIGGER_CHIP)).toBeSelected();

      await submit();
      expect(sortedReasons()).toEqual(['LOW_ENERGY', reasonKey].sort());
    }
  );

  it('I15b 로딩 중 켠 정적 칩이 감지 칩 자신의 key 면 선택이 남는다', async () => {
    mockTriggerData = undefined;
    const { rerender } = render(
      <PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />
    );
    fireEvent.press(screen.getByTestId('planb-request-reason-TEMP_CLOSED'));

    mockTriggerData = triggerList(mkTrigger({ kind: 'CLOSURE' }));
    rerender(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    expect(screen.getByTestId(TRIGGER_CHIP)).toBeSelected();
    await submit();
    expect(postedBody()).toEqual(
      body({ reasons: ['TEMP_CLOSED'], triggerId: 'trg-1' })
    );
  });
});

describe('🔴 I16 · 닫기는 한 번만 일어난다 (AC-8 · Q8 · 5-b 경고-3)', () => {
  it('I16a 스크림을 연달아 두 번 눌러도 뒤로는 1회다', () => {
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    fireEvent.press(screen.getByTestId('planb-request-scrim'));
    fireEvent.press(screen.getByTestId('planb-request-scrim'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('I16b 끌어 닫는 중에 스크림을 눌러도 뒤로는 1회다', () => {
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    const pannable = screen.UNSAFE_root.findAll(
      (node) => node.props.enablePanDownToClose === true
    );
    act(() => {
      pannable[0].props.onClose();
    });
    fireEvent.press(screen.getByTestId('planb-request-scrim'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 P-E · 시작 실패는 시트 안에 안내하고 이동하지 않는다 (03b 경고-1 · INV-4)', () => {
  const ERROR = 'planb-request-error';
  const CONFLICT_TEXT = '여행 기간에만 AI에게 맡길 수 있어요';
  const GENERIC_TEXT =
    '다시 짜기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요';

  function expectNoMove(): void {
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  }

  it('P-E1 409(여행 기간 밖)면 기간 안내를 띄우고 아무 데도 가지 않는다', async () => {
    mockPhase = 'conflict';
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    await submit();

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(ERROR)).toHaveTextContent(CONFLICT_TEXT);
    expectNoMove();
  });

  it.each([
    ['5xx', 'serverError'],
    ['네트워크 오류', 'network'],
  ] as const)(
    'P-E2 %s 면 일반 실패 안내를 띄우고 아무 데도 가지 않는다',
    async (_label, phase) => {
      mockPhase = phase;
      render(<PlanbRequestPage tripId={TRIP_ID} />);

      await submit();

      expect(screen.getByTestId(ERROR)).toHaveTextContent(GENERIC_TEXT);
      expectNoMove();
    }
  );

  it('P-E3 다시 누르면 안내를 먼저 지우고, 새 실패는 안내 하나로 교체된다', async () => {
    mockPhase = 'conflict';
    render(<PlanbRequestPage tripId={TRIP_ID} />);
    await submit();
    expect(screen.getByTestId(ERROR)).toHaveTextContent(CONFLICT_TEXT);

    // 응답이 아직 안 온 재시도 — 이때 안내가 남아 있으면 안 된다.
    mockPhase = 'idle';
    await submit(2);
    expect(mockMutate).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId(ERROR)).toBeNull();

    const retry = mockMutate.mock.calls[1][1];
    expect(typeof retry?.onError).toBe('function');
    act(() => retry?.onError?.(mockHttpError(500)));

    expect(screen.getAllByTestId(ERROR)).toHaveLength(1);
    expect(screen.getByTestId(ERROR)).toHaveTextContent(GENERIC_TEXT);
    expectNoMove();
  });
});

describe('🔴 P-G · TRIP-979 제출 직전 GPS origin 을 읽어 싣는다 (AC-A1·A3·A5 · BR-U4-17·19)', () => {
  // lat ≠ lng — 축이 뒤바뀌면 드러난다.
  const GPS_ORIGIN: ReplanOrigin = {
    originKind: 'GPS',
    originLat: 37.5512,
    originLng: 126.9882,
  };

  /** 끝나지 않은 채 기다리는 origin 읽기 — 테스트가 resolve 를 쥔다(GPS 대기 중 상황). */
  function deferOrigin(): (value: ReplanOrigin | undefined) => void {
    let resolve!: (value: ReplanOrigin | undefined) => void;
    mockReadOrigin.mockImplementation(
      () =>
        new Promise<ReplanOrigin | undefined>((r) => {
          resolve = r;
        })
    );
    return (value) => resolve(value);
  }

  it('P-G1 읽기가 GPS 조각을 주면 body 에 originKind GPS 와 좌표가 실린다', async () => {
    mockReadOrigin.mockResolvedValue(GPS_ORIGIN);
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    await submit();

    expect(mockReadOrigin).toHaveBeenCalledTimes(1);
    expect(postedBody()).toStrictEqual(
      body({ originKind: 'GPS', originLat: 37.5512, originLng: 126.9882 })
    );
  });

  it('P-G2 위치를 다 읽기 전에는 POST 하지 않고, 읽기가 끝나면 그 origin 으로 POST 한다', async () => {
    const finishRead = deferOrigin();
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    fireEvent.press(screen.getByTestId('planb-request-submit'));
    // 대기 중 — 마이크로태스크를 흘려도 아직 POST 0.
    await act(async () => {});
    expect(mockReadOrigin).toHaveBeenCalledTimes(1);
    expect(mockMutate).not.toHaveBeenCalled();

    await act(async () => finishRead(GPS_ORIGIN));

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(postedBody()).toStrictEqual(
      body({ originKind: 'GPS', originLat: 37.5512, originLng: 126.9882 })
    );
  });

  it('P-G3 읽기가 origin 을 못 주면(동의 OFF·권한 없음·실패·5초 초과) 막지 않고 기존 body 로 POST, 위치 입력 화면으로 새지 않는다', async () => {
    mockPhase = 'success';
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    await submit();

    expect(mockReadOrigin).toHaveBeenCalledTimes(1);
    const data = postedBody();
    // 키 부재가 정본 — toStrictEqual 은 "값 undefined 인 키"도 다르다고 본다.
    expect(data).toStrictEqual(body());
    expect(data).not.toHaveProperty('originLat');
    expect(data).not.toHaveProperty('originLng');
    // 이동은 solving 한 곳뿐 — live/location 우회 0(결정1).
    expect(forwardDestinations()).toEqual(['/trips/[tripId]/planb/solving']);
  });

  it('P-G4 GPS 를 기다리는 동안 두 번 눌러도 위치 읽기·POST 는 각각 1회다', async () => {
    const finishRead = deferOrigin();
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    fireEvent.press(screen.getByTestId('planb-request-submit'));
    fireEvent.press(screen.getByTestId('planb-request-submit'));
    expect(mockReadOrigin).toHaveBeenCalledTimes(1);

    await act(async () => finishRead(GPS_ORIGIN));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    // 두 번째 누름이 뒤늦게 줄 서서 나가지도 않는다.
    await act(async () => {});
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockReadOrigin).toHaveBeenCalledTimes(1);
  });

  // 03b 경고-1 — 화면이 사라진 뒤 POST 가 나가면 서버는 기존 열린 세션을 취소하고 아무도 안 보는 새
  // 세션을 연다. 실제 TanStack 은 언마운트 뒤 호출별 콜백을 부르지 않아 이동·안내도 없다.
  // 스크림을 거치지 않는 언마운트(안드로이드 뒤로 버튼·제스처)도 같은 계약이다.
  it.each([
    ['스크림을 누른 뒤 언마운트', true],
    ['스크림 없이 곧바로 언마운트', false],
  ])(
    'P-G5 GPS 를 기다리는 동안 화면이 사라지면(%s) 읽기가 끝나도 POST 하지 않는다',
    async (_label, pressScrim) => {
      mockPhase = 'success';
      const finishRead = deferOrigin();
      const { unmount } = render(<PlanbRequestPage tripId={TRIP_ID} />);

      fireEvent.press(screen.getByTestId('planb-request-submit'));
      await act(async () => {});
      expect(mockReadOrigin).toHaveBeenCalledTimes(1);
      if (pressScrim)
        fireEvent.press(screen.getByTestId('planb-request-scrim'));
      unmount();

      await act(async () => finishRead(GPS_ORIGIN));
      await act(async () => {});

      expect(mockMutate).not.toHaveBeenCalled();
      expect(forwardDestinations()).toEqual([]);
    }
  );
});
