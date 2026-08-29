import { fireEvent, render, screen } from '@testing-library/react-native';

import { useTriggerWatchlist } from '@/features/planb/model/useTriggerWatchlist';
import type { Trigger, TriggerList } from '@/shared/api/generated/schemas';

import { PlanbTriggersPage } from './PlanbTriggersPage';

/**
 * TRIP-562 · AC-2·AC-5 배선 — 감시 목록 페이지가 조회 결과를 사영해 화면에 내리고, 두 CTA 를
 * **라우팅으로만** 잇는다(쓰기 0, BR-U4-09).
 *
 * 무엇을 보장하나:
 *  - 🔴 발화 트리거가 있으면 활성 CTA press → `/trips/{id}/planb?scope=..&triggerId=..`(AC-2).
 *    scope 는 foldScope(FULL_DAY 통과 / NONE→PARTIAL_SLOTS)로 접혀 실린다.
 *  - 🔴 발화 없으면 활성 배너 CTA 부재 + 3행 정상(AC-2 부재).
 *  - 🔴 하단 수동 CTA press → `/trips/{id}/planb`(triggerId 없이, AC-5 — i10 미착수라 경로만).
 *
 * ★ 데이터 훅(`useTriggerWatchlist`)만 목으로 치환 → 사영(`triggerWatchlist`)·접기(`foldScope`)·
 *   화면(`TriggerWatchlistScreen`)은 실물로 태운다(판정을 목으로 가리면 그 조합이 가정이 된다).
 * ★ 통과형 목 사각(★9): router.push 는 "불렸다·이 인자로"까지만.
 */

jest.mock('@/features/planb/model/useTriggerWatchlist', () => ({
  useTriggerWatchlist: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const mockedUseTriggerWatchlist = useTriggerWatchlist as jest.Mock;

/** 훅이 돌려줄 react-query 결과 흉내 — 케이스는 triggers 목록만 바꾼다. */
const withTriggers = (triggers: Trigger[]) => ({
  data: { triggers } as TriggerList,
  isPending: false,
  isError: false,
});

const mk = (over: Partial<Trigger> = {}): Trigger =>
  ({
    triggerId: 'trg-1',
    kind: 'WEATHER',
    affectedDate: '2026-08-20',
    slotKey: null,
    reason: '비 예보 70%',
    scope: 'PARTIAL_SLOTS',
    detectedAt: '2026-08-20T09:00:00Z',
    ...over,
  }) as Trigger;

/** router.push 인자를 문자열로 정규화 — 문자열/객체 두 형태를 모두 받아 경로·쿼리만 잰다(★9). */
function hrefString(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  const obj = (arg ?? {}) as {
    pathname?: string;
    params?: Record<string, unknown>;
  };
  const qs = Object.entries(obj.params ?? {})
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return qs ? `${obj.pathname ?? ''}?${qs}` : (obj.pathname ?? '');
}

beforeEach(() => {
  mockedUseTriggerWatchlist.mockReset();
  mockedUseTriggerWatchlist.mockReturnValue(withTriggers([]));
  mockPush.mockClear();
});

describe('🔴 PlanbTriggersPage · 배선', () => {
  it('I1 활성 CTA → planb 세션(scope=FULL_DAY·triggerId 실림, 쓰기0) (AC-2 pass-through)', () => {
    mockedUseTriggerWatchlist.mockReturnValue(
      withTriggers([
        mk({ kind: 'WEATHER', scope: 'FULL_DAY', triggerId: 'trg-1' }),
      ])
    );

    render(<PlanbTriggersPage tripId="trip-1" />);

    fireEvent.press(screen.getByTestId('planb-triggers-active-cta'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    const href = hrefString(mockPush.mock.calls[0][0]);
    expect(href).toContain('/trips/trip-1/planb');
    expect(href).toContain('scope=FULL_DAY');
    expect(href).toContain('triggerId=trg-1');
  });

  it('I2 scope=NONE 이면 기본값 PARTIAL_SLOTS 로 접혀 실린다 (AC-2 기본값)', () => {
    mockedUseTriggerWatchlist.mockReturnValue(
      withTriggers([mk({ scope: 'NONE' })])
    );

    render(<PlanbTriggersPage tripId="trip-1" />);

    fireEvent.press(screen.getByTestId('planb-triggers-active-cta'));

    const href = hrefString(mockPush.mock.calls[0][0]);
    expect(href).toContain('/trips/trip-1/planb');
    expect(href).toContain('scope=PARTIAL_SLOTS');
  });

  it('I3 발화 없음 → 활성 배너 CTA 부재 + 3행 정상 (AC-2 부재 · INV-U4-01)', () => {
    mockedUseTriggerWatchlist.mockReturnValue(withTriggers([]));

    render(<PlanbTriggersPage tripId="trip-1" />);

    expect(screen.queryByTestId('planb-triggers-active-cta')).toBeNull();
    for (const kind of ['weather', 'delay', 'closure']) {
      expect(screen.getByTestId(`planb-triggers-item-${kind}`)).toBeTruthy();
      // 배지는 leaf testID 로(부제·배지가 둘 다 '정상' 이라 getByText 는 충돌).
      expect(
        screen.getByTestId(`planb-triggers-badge-${kind}`)
      ).toHaveTextContent('정상');
    }
  });

  it('I4 하단 수동 CTA → /trips/{id}/planb (triggerId 없이) (AC-5)', () => {
    render(<PlanbTriggersPage tripId="trip-1" />);

    fireEvent.press(screen.getByTestId('planb-triggers-manual-cta'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    // 완전일치 → 쿼리·triggerId 가 붙지 않음을 자동 보장(수동 진입, BR-U4-10).
    expect(hrefString(mockPush.mock.calls[0][0])).toBe('/trips/trip-1/planb');
  });
});

/**
 * honest-rendering-on-error 회귀 그물(code-critic 경고-2 봉합) — 구현이 이미 오류/로딩을 StateNotice 로
 * 처리해 red 단계가 없다(선재 green). 심판이 실제로 무는지는 02(뮤테이션 실측)로 증명한다.
 *
 * 왜 의미 하중이 있나: '정상' 배지는 "건강검사 성공" 주장이다(BR-U4-05 — 외부 API 실패=무발화·관측만).
 * "확인 불가"는 이 티켓 범위 밖(3-a 확정)이라, 조회 실패 시 화면이 할 수 있는 정직한 행동은
 * **3행을 지어내지 않고 오류 얼굴을 내는 것**뿐이다. 실패를 '정상 3행'으로 칠하면 거짓 안심을 준다.
 *
 * ★ GET /triggers 500 = react-query `isError:true`(훅 목이 그 상태를 그대로 세운다 — 이 페이지는
 *   `useTriggerWatchlist`를 목킹하는 구조라 msw 대신 상태 주입으로 같은 분기를 태운다).
 */
describe('🟢 PlanbTriggersPage · honest-rendering-on-error (선재 green · 뮤테이션 실측 대상)', () => {
  it('I5 조회 실패(500) → 오류 얼굴 present + 3행을 정상으로 지어내지 않는다 (BR-U4-05)', () => {
    mockedUseTriggerWatchlist.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    });

    render(<PlanbTriggersPage tripId="trip-1" />);

    // 오류 얼굴(StateNotice)이 뜬다.
    expect(screen.getByTestId('planb-triggers-error')).toBeTruthy();
    // 핵심 단언: 조회 실패 시 감시 3행·정상 배지·화면 자체를 지어내지 않는다.
    expect(screen.queryByTestId('planb-triggers-screen')).toBeNull();
    for (const kind of ['weather', 'delay', 'closure']) {
      expect(screen.queryByTestId(`planb-triggers-item-${kind}`)).toBeNull();
      expect(screen.queryByTestId(`planb-triggers-badge-${kind}`)).toBeNull();
    }
  });

  it('I6 조회 중(pending) → 로딩 얼굴 present (얇게)', () => {
    mockedUseTriggerWatchlist.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });

    render(<PlanbTriggersPage tripId="trip-1" />);

    expect(screen.getByTestId('planb-triggers-loading')).toBeTruthy();
    // 로딩 중에도 3행을 미리 지어내지 않는다.
    expect(screen.queryByTestId('planb-triggers-screen')).toBeNull();
  });
});
