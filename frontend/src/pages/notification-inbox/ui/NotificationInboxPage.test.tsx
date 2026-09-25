// 부분 목 — 조회 훅만 가짜로 바꾸고 나머지(읽음 POST 함수·쿼리 키·생성 뮤테이션 훅)는 실물을 둔다.
// 전체 자동 목이면 '모두 읽음' 배선이 생성 훅을 쓰는 순간 그 훅이 undefined 를 돌려줘 렌더가 죽는다(TRIP-773).
jest.mock('@/shared/api/generated/notification/notification', () => ({
  ...jest.requireActual('@/shared/api/generated/notification/notification'),
  useGetMeNotifications: jest.fn(),
}));

import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { useGetMeNotifications } from '@/shared/api/generated/notification/notification';
import type { Notification } from '@/shared/api/generated/schemas';

import { NotificationInboxPage } from './NotificationInboxPage';

/**
 * l01 알림함 페이지 배선(d02) — 딥경로 목 seam 으로 서버 응답을 주입하고 실제 페이지를 렌더해
 * "조회 → VM 조립 → 화면 → router.push" 배선을 잠근다. TRIP-576 신설, TRIP-946 액션 계약 이전.
 *
 * 무엇을 보장하나:
 *  - 행 진입(TRIP-946 AC-10): PLANB_REPLAN 은 인라인 '대안 일정 보기' press 로, 나머지 3갈래는 행 press 로
 *    `router.push` 1회. 목적지는 actionType 이 정한다(kind 가 아니라).
 *  - 인라인 라벨 판정(Q2): '대안 일정 보기' 는 actionType=PLANB_REPLAN 에만 붙는다 — 옛 행(kind PLAN_B +
 *    TRIP_ITINERARY)에 붙이면 일정 화면으로 가는 거짓 라벨이 된다.
 *  - 진입 표시 없음(AC-11, INV-4): 액션 없음·STAY_DETAIL·결측·모르는 값 행은 인라인 링크가 없고, 행이 버튼이
 *    아니고, 눌러도 이동 0회.
 *  - 배선·조립·empty(TRIP-576 유지): 행 개수, 메타 "Plan-B · 10분 전", 0건이면 empty.
 *
 * `router.push` 목은 "불렸다·이 인자로·N회"까지 — 실제 화면 이동과 planb 모달 모양은 6-b 실기 몫.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
  },
}));

function renderPage(ui: ReactElement = <NotificationInboxPage />): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const mockUseGetMeNotifications = useGetMeNotifications as jest.Mock;

/** now 로부터 ms 과거의 ISO(상대시각 결정성: 10분30초 → floor 10 → "10분 전"). */
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const TEN_MIN_30S = 10 * 60000 + 30000;

/** 계약 밖 와이어 값(옛 키·모르는 actionType)을 생성 타입 자리에 넣는다. */
const wirePayload = (
  payload: Record<string, string>
): Notification['actionPayload'] =>
  payload as unknown as Notification['actionPayload'];
const wireType = (value: string): Notification['actionType'] =>
  value as string as Notification['actionType'];

function notification(overrides: Partial<Notification>): Notification {
  return {
    notificationId: 'n1',
    kind: 'SYSTEM',
    title: '알림',
    body: '',
    actionType: null,
    actionPayload: null,
    occurredAt: ago(TEN_MIN_30S),
    readAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  };
}

const PLAN_B = notification({
  notificationId: 'p1',
  kind: 'PLAN_B',
  title: "비 예보 — '○○공원' 일정이 영향받아요",
  body: '대안을 확인해 주세요',
  actionType: 'PLANB_REPLAN',
  actionPayload: { tripId: 't1', triggerId: 'tr1' },
  readAt: null,
});

const REFLECTION = notification({
  notificationId: 'r1',
  kind: 'REFLECTION',
  title: '여행 기록이 정리되었습니다',
  body: '회고를 확인해 보세요',
  actionType: 'REFLECTION_DAILY',
  actionPayload: { tripId: 't1', dayDate: '2026-08-20' },
});

function mockItems(items: Notification[]): void {
  mockUseGetMeNotifications.mockReturnValue({
    data: { items },
    isLoading: false,
    isError: false,
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseGetMeNotifications.mockReset();
});

describe('배선 · 조회 결과를 행으로 렌더', () => {
  it('items 2건 → notification-inbox-row 2개', () => {
    mockItems([PLAN_B, REFLECTION]);
    renderPage();
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(2);
  });
});

describe('AC-10 · PLANB_REPLAN — 인라인 "대안 일정 보기" press 로 재계획 진입', () => {
  it('router.push("/trips/t1/planb?triggerId=tr1") 1회', () => {
    mockItems([PLAN_B]);
    renderPage();

    fireEvent.press(screen.getByTestId('notification-inbox-action'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trips/t1/planb?triggerId=tr1');
  });
});

describe('AC-10 · 나머지 3갈래 — 행 press 로 이동, 인라인 링크 없음', () => {
  it.each<[string, Notification, string]>([
    [
      'TRIP_ITINERARY(리마인드) → 일정 화면',
      notification({
        kind: 'TRIP_PRE',
        actionType: 'TRIP_ITINERARY',
        actionPayload: { tripId: 't1' },
      }),
      '/trips/t1/itinerary',
    ],
    [
      'TRIP_SUMMARY → 여행 요약',
      notification({
        kind: 'REFLECTION',
        actionType: 'TRIP_SUMMARY',
        actionPayload: { tripId: 't1' },
      }),
      '/trips/t1/records/summary',
    ],
    [
      'REFLECTION_DAILY → 그날 회고(dayDate)',
      REFLECTION,
      '/trips/t1/records/reflection/2026-08-20',
    ],
  ])('%s', (_label, item, expected) => {
    mockItems([item]);
    renderPage();
    const row = screen.getByTestId('notification-inbox-row');

    expect(screen.queryByTestId('notification-inbox-action')).toBeNull();
    expect(row).toHaveProp('accessibilityRole', 'button');

    fireEvent.press(row);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(expected);
  });
});

describe('Q2 · "대안 일정 보기" 는 kind 가 아니라 actionType 에 붙는다', () => {
  it('옛 행(kind PLAN_B + TRIP_ITINERARY) → 인라인 링크 없음, 행 press 로 일정 화면', () => {
    mockItems([
      notification({
        kind: 'PLAN_B',
        actionType: 'TRIP_ITINERARY',
        actionPayload: { tripId: 't1' },
      }),
    ]);
    renderPage();

    expect(screen.queryByTestId('notification-inbox-action')).toBeNull();

    fireEvent.press(screen.getByTestId('notification-inbox-row'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trips/t1/itinerary');
  });
});

describe('AC-11 · 진입 표시 없음 — 인라인 링크 없음 · 버튼 아님 · 눌러도 이동 0회 (INV-4)', () => {
  it.each<[string, Notification]>([
    [
      '액션 없음(회고 데이터 없음, BR-U6-12)',
      notification({
        kind: 'REFLECTION',
        actionType: null,
        actionPayload: null,
      }),
    ],
    [
      'kind PLAN_B 여도 actionType 이 null 이면 kind 로 되살리지 않는다',
      notification({
        kind: 'PLAN_B',
        actionType: null,
        actionPayload: { tripId: 't1', triggerId: 'tr1' },
      }),
    ],
    [
      'STAY_DETAIL(결정2)',
      notification({
        kind: 'STAY',
        actionType: 'STAY_DETAIL',
        actionPayload: { savedStayId: '00000000-0000-4000-8000-0000000000bb' },
      }),
    ],
    [
      'PLANB_REPLAN 인데 tripId 가 빈 문자열(결측)',
      notification({
        kind: 'PLAN_B',
        actionType: 'PLANB_REPLAN',
        actionPayload: { tripId: '', triggerId: 'tr1' },
      }),
    ],
    [
      '5값 밖 actionType(옛 TRIP_REFLECTION)',
      notification({
        kind: 'REFLECTION',
        actionType: wireType('TRIP_REFLECTION'),
        actionPayload: wirePayload({ tripId: 't1', date: '2026-08-20' }),
      }),
    ],
  ])('%s', (_label, item) => {
    mockItems([item]);
    renderPage();
    const row = screen.getByTestId('notification-inbox-row');

    expect(screen.queryByTestId('notification-inbox-action')).toBeNull();
    expect(row.props.accessibilityRole).not.toBe('button');

    fireEvent.press(row);

    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('조립 · 메타 = 라벨 · 상대시각', () => {
  it('PLAN_B occurredAt 10분30초 전 → "Plan-B · 10분 전"', () => {
    mockItems([PLAN_B]);
    renderPage();
    expect(screen.getByText('Plan-B · 10분 전')).toBeOnTheScreen();
  });
});

describe('empty · 알림 0건', () => {
  it('items 0 → notification-inbox-empty', () => {
    mockItems([]);
    renderPage();
    expect(screen.getByTestId('notification-inbox-empty')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(0);
  });
});
