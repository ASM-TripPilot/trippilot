import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  NotificationInboxScreen,
  type NotificationInboxScreenProps,
  type NotificationRowVM,
  type NotificationSection,
} from './NotificationInboxScreen';

/**
 * TRIP-576 · l01 알림함 화면(순수 프레젠테이션 — 주입 VM + onNavigate 콜백).
 *
 * 무엇을 보장하나:
 *  - **AC-1 렌더**: sections(오늘·이전)의 모든 row 가 정확히 한 `notification-inbox-row` 로, 유실·중복
 *    없이 나오고 그룹 라벨("오늘"·"이전")이 그려진다.
 *  - **AC-2 미읽음 dot**: `unread=true` 행에만 `notification-inbox-unread-dot`(View) 이 있고 읽음 행엔
 *    없다 — dot 개수 = 미읽음 개수. ★ dot 은 색(fill)이 아니라 **testID 존재/부재**로만 잰다(맹점③).
 *  - **AC-3 메타·제목**: 행이 주입된 title·meta("라벨 · 상대시각") 문자열을 그대로 그린다(kind→아이콘/라벨
 *    매핑 정확성은 notificationKind.test.ts, 상대시각은 formatRelativeTime.test.ts 가 잠근다).
 *  - **AC-4 PLAN_B 인라인 액션**: inlineActionLabel 있는 행에 `notification-inbox-action` 이 있고 press →
 *    onNavigate(route) 1회.
 *  - **AC-5 REFLECTION 행 press**: 인라인 액션 없이 행 자체 press → onNavigate(route) 1회.
 *  - **AC-6 데이터없음 회고**: route=null 행은 action 부재 + 행 press 무동작(onNavigate 0회).
 *  - empty(AC-1 경계): isEmpty → `notification-inbox-empty`(StateNotice) 렌더, row 0.
 *  - 스코프(01b Q3): '모두 읽음'(`notification-inbox-mark-all`) 은 렌더하지 않는다(죽은 컨트롤=INV-4 침묵).
 *
 * 왜 화면 층인가: testID·press→콜백은 화면의 성질이라 onNavigate=jest.fn() 으로 잰다. 실제 화면 이동
 * (router.push)은 페이지가 잠근다(NotificationInboxPage.test.tsx). 글리프 픽셀·딤은 jest 사각 → 6-b.
 *
 * (개념·02a §5 node_modules 실측) — `getByText(문자열)`=완전일치(자식 텍스트 join('') 후 정규화 ===),
 *  그래서 meta·title 을 각자 단일 Text 노드로 두고 그 노드만 잡는다(row 컨테이너에 toHaveTextContent 금지).
 *  `queryAllByTestId(id).length`=0건이면 [](throw 없음)로 개수 셈. `within(el)`=서브트리 스코프.
 */

let idSeq = 0;
function row(overrides: Partial<NotificationRowVM> = {}): NotificationRowVM {
  idSeq += 1;
  return {
    id: `n${idSeq}`,
    icon: 'sun',
    title: `제목-${idSeq}`,
    body: `본문-${idSeq}`,
    meta: `시스템 · ${idSeq}분 전`,
    unread: false,
    route: null,
    inlineActionLabel: null,
    ...overrides,
  };
}

function renderScreen(
  overrides: Partial<NotificationInboxScreenProps> = {}
): NotificationInboxScreenProps {
  const props: NotificationInboxScreenProps = {
    sections: [],
    isEmpty: false,
    onNavigate: jest.fn(),
    ...overrides,
  };
  render(<NotificationInboxScreen {...props} />);
  return props;
}

function section(
  key: NotificationSection['key'],
  label: string,
  rows: NotificationRowVM[]
): NotificationSection {
  return { key, label, rows };
}

beforeEach(() => {
  idSeq = 0;
});

describe('AC-1 · sections 를 유실·중복 없이 행으로 렌더', () => {
  it('오늘 2 + 이전 2 = 정확히 4 행이 나오고 그룹 라벨이 그려진다', () => {
    renderScreen({
      sections: [
        section('today', '오늘', [row(), row()]),
        section('earlier', '이전', [row(), row()]),
      ],
    });

    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(4);
    expect(screen.getByText('오늘')).toBeOnTheScreen();
    expect(screen.getByText('이전')).toBeOnTheScreen();
  });
});

describe('AC-2 · 미읽음 dot 은 unread 행에만 (testID 존재/부재)', () => {
  it('미읽음 행에만 dot 이 있고 개수 = 미읽음 수 (색 아님)', () => {
    renderScreen({
      sections: [
        section('today', '오늘', [
          row({ unread: true }),
          row({ unread: false }),
        ]),
      ],
    });

    // 개수: 미읽음 1개.
    expect(
      screen.queryAllByTestId('notification-inbox-unread-dot')
    ).toHaveLength(1);

    // 행별: 첫 행(미읽음)엔 있고, 둘째 행(읽음)엔 없다 — 짝으로 잠근다.
    const rows = screen.getAllByTestId('notification-inbox-row');
    expect(
      within(rows[0]).getByTestId('notification-inbox-unread-dot')
    ).toBeOnTheScreen();
    expect(
      within(rows[1]).queryByTestId('notification-inbox-unread-dot')
    ).toBeNull();
  });
});

describe('AC-3 · 제목·메타를 주입 문자열 그대로 렌더', () => {
  it('meta("라벨 · 상대시각")·title 이 그려진다', () => {
    renderScreen({
      sections: [
        section('today', '오늘', [
          row({ title: '비 예보 — 일정 영향', meta: 'Plan-B · 10분 전' }),
        ]),
      ],
    });

    expect(screen.getByText('비 예보 — 일정 영향')).toBeOnTheScreen();
    expect(screen.getByText('Plan-B · 10분 전')).toBeOnTheScreen();
  });
});

describe('AC-4 · PLAN_B 인라인 액션 press → onNavigate(route)', () => {
  it('inlineActionLabel 있는 행에 action 이 있고 press 하면 route 로 1회 이동', () => {
    const props = renderScreen({
      sections: [
        section('today', '오늘', [
          row({
            inlineActionLabel: '대안 일정 보기 ›',
            route: '/trips/t1/planb',
          }),
        ]),
      ],
    });

    const rows = screen.getAllByTestId('notification-inbox-row');
    const action = within(rows[0]).getByTestId('notification-inbox-action');
    expect(action).toBeOnTheScreen();

    fireEvent.press(action);

    expect(props.onNavigate).toHaveBeenCalledTimes(1);
    expect(props.onNavigate).toHaveBeenCalledWith('/trips/t1/planb');
  });
});

describe('AC-5 · REFLECTION 행 press → onNavigate(route) (인라인 액션 없음)', () => {
  it('인라인 액션 없이 행 자체 press 로 route 로 1회 이동', () => {
    const props = renderScreen({
      sections: [
        section('earlier', '이전', [
          row({
            inlineActionLabel: null,
            route: '/trips/t1/records/reflection/2026-08-29',
          }),
        ]),
      ],
    });

    const rows = screen.getAllByTestId('notification-inbox-row');
    // 짝: 회고 행엔 인라인 액션이 없다.
    expect(
      within(rows[0]).queryByTestId('notification-inbox-action')
    ).toBeNull();

    fireEvent.press(rows[0]);

    expect(props.onNavigate).toHaveBeenCalledTimes(1);
    expect(props.onNavigate).toHaveBeenCalledWith(
      '/trips/t1/records/reflection/2026-08-29'
    );
  });
});

describe('AC-6 · 데이터없음 회고(route=null) = 액션·라우팅 없음', () => {
  it('action 부재 + 행 press 해도 onNavigate 가 호출되지 않는다', () => {
    const props = renderScreen({
      sections: [
        section('earlier', '이전', [
          row({ inlineActionLabel: null, route: null }),
        ]),
      ],
    });

    const rows = screen.getAllByTestId('notification-inbox-row');
    // 짝: 행은 존재하되 액션이 없다.
    expect(rows[0]).toBeOnTheScreen();
    expect(
      within(rows[0]).queryByTestId('notification-inbox-action')
    ).toBeNull();

    fireEvent.press(rows[0]);

    expect(props.onNavigate).not.toHaveBeenCalled();
  });
});

describe('empty(AC-1 경계) · 스코프(01b Q3)', () => {
  it('isEmpty 면 StateNotice(notification-inbox-empty) 를 그리고 행이 0 이다', () => {
    renderScreen({ isEmpty: true, sections: [] });

    expect(screen.getByTestId('notification-inbox-empty')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(0);
  });

  it("'모두 읽음'(notification-inbox-mark-all) 은 렌더하지 않는다", () => {
    renderScreen({
      sections: [section('today', '오늘', [row(), row()])],
    });
    // 짝(★7) — 실제로 행이 그려진 상태에서 mark-all 만 부재(빈 렌더 공짜 통과 차단).
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(2);
    expect(screen.queryByTestId('notification-inbox-mark-all')).toBeNull();
  });
});
