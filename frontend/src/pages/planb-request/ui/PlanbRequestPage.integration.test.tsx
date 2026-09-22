import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { useReplanFormStore } from '@/features/planb/model/replanFormStore';
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
 *
 * seam 목(02a ★10): 페이지가 소비하는 래퍼 3개(`useStartReplan`·`useActiveTriggers`·`useLiveItinerary`)를
 * 목한다. 목 데이터는 같은 참조를 돌려준다(TanStack 구조 공유와 같다 — 새 객체면 가짜 루프).
 * jest.mock 팩토리는 `mock` 접두 변수만 볼 수 있다(호이스팅).
 */

let mockPhase: 'idle' | 'success' = 'idle';
const mockMutate = jest.fn(
  (_variables: unknown, options?: { onSuccess?: () => void }) => {
    if (mockPhase === 'success') options?.onSuccess?.();
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
});

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
  it('I1 정적 날씨 + 자유텍스트를 조립해 POST(triggerId null)하고 성공하면 solving 으로 간다', () => {
    mockPhase = 'success';
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    fireEvent.press(screen.getByTestId('planb-request-reason-WEATHER'));
    fireEvent.changeText(
      screen.getByTestId('planb-request-freetext'),
      '광안리 야경'
    );
    fireEvent.press(screen.getByTestId('planb-request-submit'));

    expect(postedBody()).toEqual(
      body({ reasons: ['WEATHER'], freeText: '광안리 야경' })
    );
    const destinations = forwardDestinations();
    expect(destinations.some((d) => d.includes('solving'))).toBe(true);
    expect(destinations.some((d) => d.includes(TRIP_ID))).toBe(true);
  });

  it('I2 아무것도 안 골라도 빈 배열·freeText null 로 POST 된다', () => {
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    fireEvent.press(screen.getByTestId('planb-request-submit'));

    expect(postedBody()).toEqual(body());
  });
});

describe('🔴 I3 · 트리거 진입 — 감지 칩 시드 + 새 카탈로그 body (AC-6 완료 조건 · AC-7)', () => {
  it('감지 칩이 선택된 채 시작하고, 새 방향 key 와 triggerId 가 body 로 나간다', () => {
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
    fireEvent.press(screen.getByTestId('planb-request-submit'));

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
    (kind, copy, reasonKey) => {
      mockTriggerData = triggerList(mkTrigger({ kind }));
      render(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

      const chip = screen.getByTestId(TRIGGER_CHIP);
      expect(chip).toHaveTextContent(copy);
      expect(chip).toBeSelected();
      expect(screen.queryByTestId('planb-request-reason-WEATHER')).toBeNull();
      expect(
        screen.queryByTestId(`planb-request-reason-${reasonKey}`)
      ).toBeNull();

      fireEvent.press(screen.getByTestId('planb-request-submit'));
      expect(postedBody()).toEqual(
        body({ reasons: [reasonKey], triggerId: 'trg-1' })
      );
    }
  );
});

describe('I6 · 감지 트리거가 성립하지 않는 진입 — 칩 0 · 정적 날씨 (AC-7)', () => {
  it('I6a triggerId 가 활성 목록에 없으면 칩이 없고 triggerId 는 null 이다', () => {
    mockTriggerData = triggerList(mkTrigger());
    render(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-x" />);

    expect(screen.queryByTestId(TRIGGER_CHIP)).toBeNull();
    expect(
      screen.getByTestId('planb-request-reason-WEATHER')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('planb-request-submit'));
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

  it('I6c triggerId 없이 들어오면 활성 트리거가 있어도 칩이 없고 triggerId 는 null 이다(02a ★13)', () => {
    mockTriggerData = triggerList(mkTrigger());
    render(<PlanbRequestPage tripId={TRIP_ID} />);

    expect(screen.queryByTestId(TRIGGER_CHIP)).toBeNull();
    expect(
      screen.getByTestId('planb-request-reason-WEATHER')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('planb-request-submit'));
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
  it('이전 방문의 선택이 남지 않고, 이미 켜져 있던 WEATHER 도 꺼지지 않는다', () => {
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

    fireEvent.press(screen.getByTestId('planb-request-submit'));
    expect(postedBody()).toEqual(
      body({ reasons: ['WEATHER'], triggerId: 'trg-1' })
    );
  });
});

describe('I9 · URL scope 시드 (TRIP-561 결정 3 · 02a ★9)', () => {
  it('🔴 scope=FULL_DAY 면 오늘 전체로 시작해 그 범위로 제출된다', () => {
    render(<PlanbRequestPage tripId={TRIP_ID} scope="FULL_DAY" />);

    expect(screen.getByTestId('planb-request-scope-FULL_DAY')).toBeSelected();
    fireEvent.press(screen.getByTestId('planb-request-submit'));
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
  it('칩을 끄고 입력을 이어가도 꺼진 채이고, triggerId 는 선택과 무관하게 실린다(Q3)', () => {
    mockTriggerData = triggerList(mkTrigger());
    render(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    fireEvent.press(screen.getByTestId(TRIGGER_CHIP));
    expect(screen.getByTestId(TRIGGER_CHIP)).not.toBeSelected();

    fireEvent.changeText(screen.getByTestId('planb-request-freetext'), '실내');
    expect(screen.getByTestId(TRIGGER_CHIP)).not.toBeSelected();

    fireEvent.press(screen.getByTestId('planb-request-submit'));
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
  it('로딩 중 정적 날씨를 켠 뒤 WEATHER 트리거가 도착해도 감지 칩은 켜진 채다', () => {
    mockTriggerData = undefined;
    const { rerender } = render(
      <PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />
    );
    fireEvent.press(screen.getByTestId('planb-request-reason-WEATHER'));

    mockTriggerData = triggerList(mkTrigger());
    rerender(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    expect(screen.getByTestId(TRIGGER_CHIP)).toBeSelected();
    fireEvent.press(screen.getByTestId('planb-request-submit'));
    expect(postedBody()).toEqual(
      body({ reasons: ['WEATHER'], triggerId: 'trg-1' })
    );
  });
});

describe('🔴 I14 · 트리거가 목록에서 빠졌다 돌아와도 다시 시드하지 않는다 (02a ★12 · 5-b 참고-1)', () => {
  it('감지 칩을 끈 뒤 트리거가 잠깐 사라졌다 돌아와도 칩은 꺼진 채다', () => {
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
    fireEvent.press(screen.getByTestId('planb-request-submit'));
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
    (kind, reasonKey) => {
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

      fireEvent.press(screen.getByTestId('planb-request-submit'));
      expect(sortedReasons()).toEqual(['LOW_ENERGY', reasonKey].sort());
    }
  );

  it('I15b 로딩 중 켠 정적 칩이 감지 칩 자신의 key 면 선택이 남는다', () => {
    mockTriggerData = undefined;
    const { rerender } = render(
      <PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />
    );
    fireEvent.press(screen.getByTestId('planb-request-reason-TEMP_CLOSED'));

    mockTriggerData = triggerList(mkTrigger({ kind: 'CLOSURE' }));
    rerender(<PlanbRequestPage tripId={TRIP_ID} triggerId="trg-1" />);

    expect(screen.getByTestId(TRIGGER_CHIP)).toBeSelected();
    fireEvent.press(screen.getByTestId('planb-request-submit'));
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
