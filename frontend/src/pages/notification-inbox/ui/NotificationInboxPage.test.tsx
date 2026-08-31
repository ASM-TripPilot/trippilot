jest.mock('@/shared/api/generated/notification/notification');

import { fireEvent, render, screen } from '@testing-library/react-native';

import { useGetMeNotifications } from '@/shared/api/generated/notification/notification';
import type { Notification } from '@/shared/api/generated/schemas';

import { NotificationInboxPage } from './NotificationInboxPage';

/**
 * TRIP-576 · l01 알림함 페이지 배선(d02) — 딥경로 목 seam 으로 서버 응답을 주입하고 실제 페이지를 렌더해
 * "조회 → groupByDay·VM 조립 → 화면 → router.push" 배선을 잠근다.
 *
 * 무엇을 보장하나:
 *  - **AC-1(배선)**: `useGetMeNotifications` 가 준 items 를 실제 행으로 그린다(useNotificationInbox 래핑 +
 *    페이지 VM 조립이 실제로 돈다).
 *  - **AC-4**: PLAN_B 행 액션 press → `router.push('/trips/{tripId}/planb')` 1회(★2 — 화면 콜백이 실제
 *    router 에 물렸는지는 이 층에서만 정직).
 *  - **AC-5**: REFLECTION 행 press → `router.push('/trips/{tripId}/records/reflection/{date}')` 1회.
 *  - **AC-3(조립)**: 메타가 `notificationKind.label · formatRelativeTime` 로 합쳐진다(occurredAt=10분30초
 *    전 → "Plan-B · 10분 전"). 두 순수 함수를 실제로 함께 태워 조립을 증명.
 *  - empty: items 0 → `notification-inbox-empty`(StateNotice).
 *
 * ★ 목 seam 은 **딥 경로**(`generated/notification/notification`) — 배럴 목이면 실 훅이 QueryClient 부재로
 *   죽는다(SettingsPage 선례). `router.push` 목은 "불렸다·이 인자로·N회"까지(통과형 목 사각 — 실 이동 6-b).
 * ★ REFLECTION 대상 라우트(records/reflection/[date])는 U5 미착수라 router.push 인자만 본다(브리프 6.②).
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const mockUseGetMeNotifications = useGetMeNotifications as jest.Mock;

/** now 로부터 ms 과거의 ISO(상대시각 결정성: 10분30초 → floor 10 → "10분 전"). */
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const TEN_MIN_30S = 10 * 60000 + 30000;

const PLAN_B: Notification = {
  notificationId: 'p1',
  kind: 'PLAN_B',
  title: "비 예보 — '○○공원' 일정이 영향받아요",
  body: '대안을 확인해 주세요',
  actionType: null,
  actionPayload: { tripId: 't1' },
  occurredAt: ago(TEN_MIN_30S),
  readAt: null,
};

const REFLECTION: Notification = {
  notificationId: 'r1',
  kind: 'REFLECTION',
  title: '여행 기록이 정리되었습니다',
  body: '회고를 확인해 보세요',
  actionType: null,
  actionPayload: { tripId: 't1', date: '2026-08-29' },
  occurredAt: ago(TEN_MIN_30S),
  readAt: '2026-08-29T00:00:00.000Z',
};

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

describe('AC-1(배선) · 조회 결과를 행으로 렌더', () => {
  it('items 2건 → notification-inbox-row 2개', () => {
    mockItems([PLAN_B, REFLECTION]);
    render(<NotificationInboxPage />);
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(2);
  });
});

describe('AC-4 · PLAN_B 액션 press → router.push(/trips/{tripId}/planb)', () => {
  it('대안 일정 보기 press 로 planb 로 1회 이동', () => {
    mockItems([PLAN_B]);
    render(<NotificationInboxPage />);

    fireEvent.press(screen.getByTestId('notification-inbox-action'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/trips/t1/planb');
  });
});

describe('AC-5 · REFLECTION 행 press → router.push(records/reflection/{date})', () => {
  it('회고 행 press 로 회고 딥링크로 1회 이동', () => {
    mockItems([REFLECTION]);
    render(<NotificationInboxPage />);

    fireEvent.press(screen.getByTestId('notification-inbox-row'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      '/trips/t1/records/reflection/2026-08-29'
    );
  });
});

describe('AC-3(조립) · 메타 = 라벨 · 상대시각', () => {
  it('PLAN_B occurredAt 10분30초 전 → "Plan-B · 10분 전"', () => {
    mockItems([PLAN_B]);
    render(<NotificationInboxPage />);
    expect(screen.getByText('Plan-B · 10분 전')).toBeOnTheScreen();
  });
});

describe('empty · 알림 0건', () => {
  it('items 0 → notification-inbox-empty(StateNotice)', () => {
    mockItems([]);
    render(<NotificationInboxPage />);
    expect(screen.getByTestId('notification-inbox-empty')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(0);
  });
});
