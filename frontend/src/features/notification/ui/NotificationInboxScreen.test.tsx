import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import {
  NotificationInboxScreen,
  type NotificationInboxScreenProps,
  type NotificationRowVM,
  type NotificationSection,
} from './NotificationInboxScreen';

/**
 * TRIP-576 · l01 알림함 화면(순수 프레젠테이션 — 주입 VM + 콜백). TRIP-773 으로 '모두 읽음'·empty 삽화 추가.
 *
 * 무엇을 보장하나:
 *  - **AC-1 렌더**: sections(오늘·이전)의 모든 row 가 정확히 한 `notification-inbox-row` 로, 유실·중복
 *    없이 나오고 그룹 라벨("오늘"·"이전")이 그려진다.
 *  - **AC-2 미읽음 dot**: `unread=true` 행에만 `notification-inbox-unread-dot`(View) 이 있고 읽음 행엔
 *    없다 — dot 개수 = 미읽음 개수. dot 은 색(fill)이 아니라 **testID 존재/부재**로만 잰다.
 *  - **AC-3 메타·제목** · **AC-4 PLAN_B 인라인 액션** · **AC-5 REFLECTION 행 press** · **AC-6 route=null 무동작**.
 *  - **TRIP-773 '모두 읽음'**: 미읽음 행이 하나라도 있으면 앱바 오른쪽에 `notification-inbox-mark-all`,
 *    전부 읽음·empty 면 부재. press → onMarkAllRead. 진행 중(markAllPending)엔 disabled + opacity-40,
 *    실패 안내(markAllError)는 받은 문자열을 앱바 밖 한 줄로 그린다.
 *  - **TRIP-773 [구조]**: 헤더 좌우 양끝 배치·버튼 글자 토큰·터치 영역(hitSlop), empty 삽화 토큰·글리프 46·선 굵기.
 *
 * 왜 화면 층인가: testID·press→콜백·className 은 화면의 성질이라 콜백을 jest.fn() 으로 잰다. 실제로 나간
 * POST·재조회는 페이지 통합 테스트(NotificationInboxPage.integration.test.tsx)가 잠근다. 픽셀은 [검증] 대조.
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
    onMarkAllRead: jest.fn(),
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

describe('empty(AC-1 경계)', () => {
  it('isEmpty 면 notification-inbox-empty 를 그리고 행이 0 이다', () => {
    renderScreen({ isEmpty: true, sections: [] });

    expect(screen.getByTestId('notification-inbox-empty')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(0);
  });
});

// ── TRIP-773 · '모두 읽음' + empty 삽화 ─────────────────────────────────────

/** className 을 공백으로 쪼갠 토큰 배열 — `font-noto` 가 `font-noto-bold` 에 부분 일치하는 것을 막는다. */
function tokens(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

/** 가장 가까운 host View 조상. */
function nearestHostView(el: ReactTestInstance): ReactTestInstance | null {
  let cur = el.parent;
  while (cur && (cur.type as unknown) !== 'View') cur = cur.parent;
  return cur;
}

/** hitSlop(숫자 또는 {top,bottom}) 의 위+아래 합. */
function verticalHitSlop(value: unknown): number {
  if (typeof value === 'number') return value * 2;
  const slop = (value ?? {}) as { top?: number; bottom?: number };
  return (slop.top ?? 0) + (slop.bottom ?? 0);
}

const MARK_ALL = 'notification-inbox-mark-all';
const MARK_ALL_ERROR = 'notification-inbox-mark-all-error';
const PARTIAL_FAILURE = '일부 알림을 읽음 처리하지 못했어요';

describe("TRIP-773 AC-1 · '모두 읽음'은 미읽음이 있을 때만 앱바 오른쪽에 있다", () => {
  it('미읽음 1행이 있으면 헤더 안에 "모두 읽음" 버튼이 있다', () => {
    renderScreen({
      sections: [
        section('today', '오늘', [
          row({ unread: true }),
          row({ unread: false }),
        ]),
      ],
    });

    const header = screen.getByTestId('notification-inbox-header');
    const markAll = within(header).getByTestId(MARK_ALL);
    expect(within(markAll).getByText('모두 읽음')).toBeOnTheScreen();
  });

  it('전부 읽음이면 행은 그려지지만 버튼은 없다', () => {
    renderScreen({
      sections: [
        section('today', '오늘', [
          row({ unread: false }),
          row({ unread: false }),
        ]),
      ],
    });

    // 긍정 짝 — 빈 렌더로 공짜 통과하지 않게 행 2개가 실제로 있다.
    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(2);
    expect(screen.queryByTestId(MARK_ALL)).toBeNull();
  });

  it('empty 면 empty 는 그려지지만 버튼은 없다', () => {
    renderScreen({ isEmpty: true, sections: [] });

    expect(screen.getByTestId('notification-inbox-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId(MARK_ALL)).toBeNull();
  });

  it('누르면 onMarkAllRead 가 1회 불린다', () => {
    const props = renderScreen({
      sections: [section('today', '오늘', [row({ unread: true })])],
    });

    fireEvent.press(screen.getByTestId(MARK_ALL));

    expect(props.onMarkAllRead).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-773 AC-5 · 진행 중(markAllPending)이면 버튼이 비활성이다 (D3)', () => {
  it('pending 이면 disabled + opacity-40 이고, 눌러도 콜백이 안 불린다', () => {
    const props = renderScreen({
      sections: [section('today', '오늘', [row({ unread: true })])],
      markAllPending: true,
    });
    const markAll = screen.getByTestId(MARK_ALL);

    fireEvent.press(markAll);

    expect(markAll).toBeDisabled();
    expect(tokens(markAll)).toContain('opacity-40');
    expect(props.onMarkAllRead).not.toHaveBeenCalled();
  });

  it('짝 — pending 이 아니면 활성이고 opacity-40 이 없다', () => {
    renderScreen({
      sections: [section('today', '오늘', [row({ unread: true })])],
    });
    const markAll = screen.getByTestId(MARK_ALL);

    expect(markAll).not.toBeDisabled();
    expect(tokens(markAll)).not.toContain('opacity-40');
  });
});

describe('TRIP-773 AC-4 · 실패 안내(markAllError)는 받은 문구를 앱바 밖 한 줄로 그린다 (D2)', () => {
  it('markAllError 가 있으면 그 문구 그대로(text-label) 헤더 밖에 보인다', () => {
    renderScreen({
      sections: [section('today', '오늘', [row({ unread: true })])],
      markAllError: PARTIAL_FAILURE,
    });

    const error = screen.getByTestId(MARK_ALL_ERROR);
    // 완전 일치 — 안내 요소의 전체 텍스트가 문구와 같아야 한다.
    expect(error).toHaveTextContent(PARTIAL_FAILURE);
    expect(tokens(screen.getByText(PARTIAL_FAILURE))).toContain('text-label');
    expect(
      within(screen.getByTestId('notification-inbox-header')).queryByTestId(
        MARK_ALL_ERROR
      )
    ).toBeNull();
  });

  it('짝 — markAllError 가 null 이면 행은 있고 안내는 없다', () => {
    renderScreen({
      sections: [section('today', '오늘', [row({ unread: true })])],
      markAllError: null,
    });

    expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(1);
    expect(screen.queryByTestId(MARK_ALL_ERROR)).toBeNull();
  });
});

describe('TRIP-773 AC-6 [구조] · 헤더 좌(‹ 알림)·우(모두 읽음) 양끝 + 버튼 글자·터치 영역', () => {
  it('헤더가 justify-between 이고 ‹·알림은 좌측 묶음 안, 버튼은 Regular 14 primary, hitSlop 으로 44 이상', () => {
    renderScreen({
      sections: [section('today', '오늘', [row({ unread: true })])],
    });
    const header = screen.getByTestId('notification-inbox-header');
    const markAll = within(header).getByTestId(MARK_ALL);

    // 양끝 배치.
    expect(tokens(header)).toContain('justify-between');
    // ‹·알림은 헤더 직계가 아닌 묶음 View 안(형제 3개 + justify-between 이면 제목이 가운데로 뜬다).
    const titleGroup = nearestHostView(screen.getByText('알림'));
    // 인스턴스끼리 toBe 는 실패 메시지 직렬화가 순환참조로 죽는다(PlaceDetailScreen 선례) → 불리언으로 비교.
    expect(titleGroup == null).toBe(false);
    expect(titleGroup === header).toBe(false);
    expect(
      within(titleGroup as ReactTestInstance).getByTestId(
        'notification-inbox-back'
      )
    ).toBeOnTheScreen();

    // 버튼 글자 — Regular(굵게 아님) 14 primary.
    const label = tokens(within(markAll).getByText('모두 읽음'));
    expect(label).toEqual(
      expect.arrayContaining(['font-noto', 'text-body', 'text-primary'])
    );
    expect(label).not.toContain('font-noto-bold');

    // 터치 영역 — 글자 줄높이 20(text-body) + 위아래 hitSlop ≥ 24 = 44 이상(D4).
    expect(verticalHitSlop(markAll.props.hitSlop)).toBeGreaterThanOrEqual(24);
  });
});

describe('TRIP-773 AC-7 [구조] · empty 삽화 — 라이브 Figma 1599:2388 값 (D5)', () => {
  it('박스 112 r24 canvas-alt 대시 1.5 · 간격 18 · 제목 section bold ink · 부제 13.5 muted', () => {
    renderScreen({ isEmpty: true, sections: [] });
    const empty = screen.getByTestId('notification-inbox-empty');
    const box = within(empty).getByTestId('notification-inbox-empty-box');

    expect(tokens(box)).toEqual(
      expect.arrayContaining([
        'h-[112px]',
        'w-[112px]',
        'rounded-[24px]',
        'bg-canvas-alt',
        'border-[1.5px]',
        'border-dashed',
        'border-hairline-strong',
      ])
    );
    expect(tokens(empty)).toContain('gap-[18px]');
    expect(tokens(within(empty).getByText('아직 받은 알림이 없어요'))).toEqual(
      expect.arrayContaining(['text-section', 'font-noto-bold', 'text-ink'])
    );
    expect(
      tokens(
        within(empty).getByText('새로운 소식이 오면 여기에서 알려드릴게요')
      )
    ).toEqual(expect.arrayContaining(['text-[13.5px]', 'text-muted']));
  });

  it('종 글리프는 46 이고 실제 선 굵기가 Figma 1.9 근처(1.8~2.0)다 — 크기만 키우면 3.8', () => {
    renderScreen({ isEmpty: true, sections: [] });
    const box = screen.getByTestId('notification-inbox-empty-box');

    // 합성 Svg·Path 노드(host 쪽은 stroke 가 객체로 바뀐다 — 02a §5-D).
    const svg = box.findAll((node) => node.props?.viewBox != null)[0];
    const paths = box.findAll(
      (node) => typeof node.props?.stroke === 'string' && node.props?.d != null
    );
    expect(svg).toBeDefined();
    expect(paths.length).toBeGreaterThan(0);

    expect(Number(svg.props.width)).toBe(46);
    expect(Number(svg.props.height)).toBe(46);

    // 실효 굵기 = strokeWidth × (그려진 폭 ÷ viewBox 폭).
    const viewBoxWidth = Number(String(svg.props.viewBox).split(/\s+/)[2]);
    paths.forEach((path) => {
      const effective =
        (Number(path.props.strokeWidth) * Number(svg.props.width)) /
        viewBoxWidth;
      expect(effective).toBeGreaterThanOrEqual(1.8);
      expect(effective).toBeLessThanOrEqual(2.0);
      expect(path.props.stroke).toBe('#9AA1AB');
    });
  });
});
