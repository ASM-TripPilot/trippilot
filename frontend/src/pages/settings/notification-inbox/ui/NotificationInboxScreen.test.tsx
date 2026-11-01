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
 * l01 알림함 화면(순수 프레젠테이션) 단위 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `NotificationInboxScreen{,.body}.test.tsx` 2개를 각자의 바깥 describe 로 옮겼다.
 * 이름이 같고 기본값이 다른 픽스처(`row()` 의 meta · 모듈 카운터 `idSeq`)는 describe 안에 갇혀 그대로다.
 */

// TRIP-576 · TRIP-773
describe('행·헤더·빈 화면 (옛 .test)', () => {
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
   *    전부 읽음·empty 면 부재. press → onMarkAllRead. 진행 중(markAllPending)엔 disabled,
   *    실패 안내(markAllError)는 받은 문자열을 앱바 밖 한 줄로 그린다.
   *  - **TRIP-773**: 헤더 ‹ 알림 · empty 삽화 문구(배치·토큰·hitSlop·글리프 선 굵기는 TRIP-1367 로 지웠다 — 실화면 몫).
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
            row({ title: '비 예보 — 일정 영향', meta: '재계획 · 10분 전' }),
          ]),
        ],
      });

      expect(screen.getByText('비 예보 — 일정 영향')).toBeOnTheScreen();
      expect(screen.getByText('재계획 · 10분 전')).toBeOnTheScreen();
    });
  });

  // TRIP-1420: 콜백이 알림 id 를 함께 넘긴다 — 페이지가 그 id 로 읽음 요청을 낸다.
  describe('AC-4 · PLAN_B 인라인 액션 press → onNavigate(route, id)', () => {
    it('inlineActionLabel 있는 행에 action 이 있고 press 하면 route·알림 id 로 1회 이동', () => {
      const props = renderScreen({
        sections: [
          section('today', '오늘', [
            row({
              id: 'planb-1',
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
      expect(props.onNavigate).toHaveBeenCalledWith(
        '/trips/t1/planb',
        'planb-1'
      );
    });
  });

  describe('AC-5 · REFLECTION 행 press → onNavigate(route, id) (인라인 액션 없음)', () => {
    it('인라인 액션 없이 행 자체 press 로 route·알림 id 로 1회 이동', () => {
      const props = renderScreen({
        sections: [
          section('earlier', '이전', [
            row({
              id: 'reflect-1',
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
        '/trips/t1/records/reflection/2026-08-29',
        'reflect-1'
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
    it('pending 이면 disabled 이고, 눌러도 콜백이 안 불린다', () => {
      const props = renderScreen({
        sections: [section('today', '오늘', [row({ unread: true })])],
        markAllPending: true,
      });
      const markAll = screen.getByTestId(MARK_ALL);

      fireEvent.press(markAll);

      expect(markAll).toBeDisabled();
      expect(props.onMarkAllRead).not.toHaveBeenCalled();
    });

    it('짝 — pending 이 아니면 활성이다', () => {
      renderScreen({
        sections: [section('today', '오늘', [row({ unread: true })])],
      });
      const markAll = screen.getByTestId(MARK_ALL);

      expect(markAll).not.toBeDisabled();
    });
  });

  describe('TRIP-773 AC-4 · 실패 안내(markAllError)는 받은 문구를 앱바 밖 한 줄로 그린다 (D2)', () => {
    it('markAllError 가 있으면 그 문구 그대로 헤더 밖에 보인다', () => {
      renderScreen({
        sections: [section('today', '오늘', [row({ unread: true })])],
        markAllError: PARTIAL_FAILURE,
      });

      const error = screen.getByTestId(MARK_ALL_ERROR);
      // 완전 일치 — 안내 요소의 전체 텍스트가 문구와 같아야 한다.
      expect(error).toHaveTextContent(PARTIAL_FAILURE);
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

  describe('TRIP-773 AC-6 · 헤더 ‹ 알림', () => {
    it('헤더에 뒤로 버튼과 "알림" 제목이 있다', () => {
      renderScreen({
        sections: [section('today', '오늘', [row({ unread: true })])],
      });
      const header = screen.getByTestId('notification-inbox-header');

      expect(
        within(header).getByTestId('notification-inbox-back')
      ).toBeOnTheScreen();
      expect(within(header).getByText('알림')).toBeOnTheScreen();
    });
  });

  describe('TRIP-773 AC-7 · empty 삽화 문구 (D5)', () => {
    it('empty 에 제목·부제 문구가 뜬다', () => {
      renderScreen({ isEmpty: true, sections: [] });
      const empty = screen.getByTestId('notification-inbox-empty');

      expect(
        within(empty).getByText('아직 받은 알림이 없어요')
      ).toBeOnTheScreen();
      expect(
        within(empty).getByText('새로운 소식이 오면 여기에서 알려드릴게요')
      ).toBeOnTheScreen();
    });
  });

  // TRIP-1501 · 조회 실패 얼굴. 페이지가 `isError && data === undefined` 를 판정해 loadFailed 로 내리고,
  // 화면은 재판정 없이 그린다. 실패 때 페이지는 items=[] 라 isEmpty=true 도 같이 내려오므로 loadFailed 가 이겨야 한다.
  describe('TRIP-1501 · 조회 실패(loadFailed) = 오류 얼굴 + 다시 시도, empty 로 접지 않는다', () => {
    const ERROR = 'notification-inbox-error';
    const RETRY = 'notification-inbox-retry';

    it('오류 얼굴·다시 시도·헤더가 보이고 empty·"모두 읽음"·행은 없다, 다시 시도 press → onRetry 1회', () => {
      // 준비
      const onRetry = jest.fn();
      renderScreen({
        loadFailed: true,
        isEmpty: true,
        sections: [],
        onRetry,
      });

      // 단언 1 — 오류 얼굴 + 헤더(뒤로 갈 길은 열려 있다).
      expect(screen.getByTestId(ERROR)).toBeOnTheScreen();
      expect(screen.getByTestId(RETRY)).toBeOnTheScreen();
      expect(screen.getByTestId('notification-inbox-header')).toBeOnTheScreen();
      expect(screen.getByTestId('notification-inbox-back')).toBeOnTheScreen();
      // 단언 2 — 실패를 "알림 없음"으로 위장하지 않고, 목록 얼굴 전용 요소도 없다.
      expect(screen.queryByTestId('notification-inbox-empty')).toBeNull();
      expect(screen.queryByTestId(MARK_ALL)).toBeNull();
      expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(0);

      // 실행 + 단언 3 — 다시 시도를 누르면 콜백이 실제로 불린다.
      fireEvent.press(screen.getByTestId(RETRY));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('재시도 중(retrying)엔 다시 시도가 비활성이고, 눌러도 onRetry 는 0회, 오류 얼굴은 그대로다', () => {
      // 준비
      const onRetry = jest.fn();
      renderScreen({
        loadFailed: true,
        isEmpty: true,
        sections: [],
        retrying: true,
        onRetry,
      });

      // 실행
      fireEvent.press(screen.getByTestId(RETRY));

      // 단언
      expect(screen.getByTestId(RETRY)).toBeDisabled();
      expect(onRetry).not.toHaveBeenCalled();
      expect(screen.getByTestId(ERROR)).toBeOnTheScreen();
    });

    it('loadFailed 가 아니면(false·미지정) 오류 얼굴은 없다 — 목록·empty 얼굴은 각자 그대로 (긍정 짝)', () => {
      // 준비 + 실행 — 목록 얼굴(loadFailed false 명시).
      const { unmount } = render(
        <NotificationInboxScreen
          sections={[section('today', '오늘', [row({ unread: true })])]}
          isEmpty={false}
          loadFailed={false}
          onNavigate={jest.fn()}
          onMarkAllRead={jest.fn()}
        />
      );
      // 단언 — 행은 보이고 오류 얼굴은 없다.
      expect(screen.queryAllByTestId('notification-inbox-row')).toHaveLength(1);
      expect(screen.queryByTestId(ERROR)).toBeNull();
      expect(screen.queryByTestId(RETRY)).toBeNull();
      unmount();

      // 준비 + 실행 — empty 얼굴(loadFailed 미지정).
      renderScreen({ isEmpty: true, sections: [] });
      // 단언 — empty 는 보이고 오류 얼굴은 없다.
      expect(screen.getByTestId('notification-inbox-empty')).toBeOnTheScreen();
      expect(screen.queryByTestId(ERROR)).toBeNull();
    });
  });
});

// TRIP-1075
describe('본문 줄 (옛 .body)', () => {
  /**
   * TRIP-1075 · l01 — 알림 행이 서버 본문(`body`)을 버리지 않고 제목·본문·메타 3줄로 그린다(결정 1 A).
   *
   * 무엇을 보장하나:
   *  - **AC-1**: 본문 노드(`notification-inbox-body`)가 행 안에 있고 텍스트가 서버 문자열과 가공 없이
   *    같다(BR-U6-03). 두 줄 말줄임(`numberOfLines`)은 화면 표시만 줄이고 노드 텍스트는 전부 남는다.
   *  - **AC-2**: 한 행의 글자 줄 = 제목 · 본문 · 메타 · (PLAN_B) 인라인 액션(순서는 실화면 몫).
   *  - **AC-3**: 본문이 비었거나 공백뿐이면 본문 노드가 없고 대체 문구도 없다(Q1).
   *  - **AC-9**: 본문을 눌러도 행 press 규칙이 그대로다(본문이 press 대상을 바꾸지 않는다).
   *
   * 형제 `NotificationInboxScreen.test.tsx` 와 같은 층(순수 뷰 + jest.fn() 콜백)이다.
   */

  const BODY = 'notification-inbox-body';
  const ROW = 'notification-inbox-row';
  const ACTION = 'notification-inbox-action';
  const PLAN_B_LABEL = '대안 일정 보기 ›';

  /** 앞뒤 공백 자르기·공백 합치기를 끈다 — "가공 없음"을 글자 그대로 비교(02a ★8). */
  const AS_IS = { normalizer: (text: string) => text };

  let idSeq = 0;
  function row(overrides: Partial<NotificationRowVM> = {}): NotificationRowVM {
    idSeq += 1;
    return {
      id: `n${idSeq}`,
      icon: 'sun',
      title: `제목-${idSeq}`,
      body: `본문-${idSeq}`,
      meta: `시스템 · ${idSeq}일 전`,
      unread: false,
      route: null,
      inlineActionLabel: null,
      ...overrides,
    };
  }

  function renderRows(rows: NotificationRowVM[]): NotificationInboxScreenProps {
    const props: NotificationInboxScreenProps = {
      sections: [{ key: 'today', label: '오늘', rows }],
      isEmpty: false,
      onNavigate: jest.fn(),
      onMarkAllRead: jest.fn(),
    };
    render(<NotificationInboxScreen {...props} />);
    return props;
  }

  /** 행 안 host Text 의 글자를 트리 순서대로(02a ★12). 합성 Text 는 type 이 함수라 안 걸린다. */
  function rowTexts(el: ReactTestInstance): string[] {
    return el
      .findAll((node) => (node.type as unknown) === 'Text')
      .map((node) => [node.props.children].flat().join(''));
  }

  beforeEach(() => {
    idSeq = 0;
  });

  describe('🔴 B1 · AC-1 — 행이 서버 본문을 그대로 그린다', () => {
    it('본문 노드가 그 행 안에 있고 텍스트가 서버 문자열과 글자 그대로 같다(제목·메타도 그대로)', () => {
      // 준비 — 오늘의 일정 알림 1건(본문 = BR-U6-05 문안 모양).
      const item = row({
        title: '오늘의 일정',
        body: '다음 일정: 경복궁 · 14:30 · 840m',
        meta: '일정 · 10일 전',
      });

      // 실행.
      renderRows([item]);

      // 단언 — 본문 노드가 **그 행 안**에 있다.
      const theRow = screen.getByTestId(ROW);
      const body = within(theRow).getByTestId(BODY);
      expect(body).toHaveTextContent('다음 일정: 경복궁 · 14:30 · 840m', AS_IS);
      // 제목·메타 무회귀.
      expect(within(theRow).getByText('오늘의 일정')).toBeOnTheScreen();
      expect(within(theRow).getByText('일정 · 10일 전')).toBeOnTheScreen();
    });
  });

  describe('🔴 B2 · AC-1·Q2 — 긴 본문은 화면에서만 두 줄로 줄이고 노드 텍스트는 자르지 않는다', () => {
    it('180자 본문이 전부 노드에 남는다', () => {
      // 준비 — 두 줄을 넘는 긴 본문(body maxLength 400 안).
      const long = '가나다라마바사아자차카타파하 '.repeat(12).trim();
      expect(long.length).toBeGreaterThan(150);
      renderRows([row({ body: long })]);

      // 실행 — 본문 노드를 잡는다(testID 는 host Text 자체에 있다, 02a §2).
      const body = screen.getByTestId(BODY);

      // 단언 — FE 가 자르지 않았다(BR-U6-03).
      expect(body).toHaveTextContent(long, AS_IS);
      // 두 줄 말줄임(Q2)은 표시라 실화면 몫이다.
    });
  });

  describe('🔴 B3 · AC-2 — 행 안 줄은 제목 · 본문 · 메타 · (PLAN_B) 액션', () => {
    it('PLAN_B 행은 {제목, 본문, 메타, 액션}, 일반 행은 {제목, 본문, 메타} 를 정확히 그린다', () => {
      // 준비 — PLAN_B(인라인 액션 있음) 1행 + 일정 알림 1행.
      const planB = row({
        title: '비 예보 — 일정 영향',
        body: '14:00 한강공원 일정이 비 예보로 영향을 받아요',
        meta: '재계획 · 10일 전',
        inlineActionLabel: PLAN_B_LABEL,
        route: '/trips/t1/planb',
      });
      const itinerary = row({
        title: '오늘의 일정',
        body: '오늘 어디를 가는지 확인해 보세요.',
        meta: '일정 · 2일 전',
        route: '/trips/t1/itinerary',
      });

      // 실행.
      renderRows([planB, itinerary]);

      // 단언 — 행별 글자 집합 완전일치(대체 문구·중복·누락 red). 줄 순서는 생김새라 실화면 몫(TRIP-1367).
      const rows = screen.getAllByTestId(ROW);
      expect(rowTexts(rows[0]).sort()).toEqual(
        [
          '비 예보 — 일정 영향',
          '14:00 한강공원 일정이 비 예보로 영향을 받아요',
          '재계획 · 10일 전',
          PLAN_B_LABEL,
        ].sort()
      );
      expect(rowTexts(rows[1]).sort()).toEqual(
        [
          '오늘의 일정',
          '오늘 어디를 가는지 확인해 보세요.',
          '일정 · 2일 전',
        ].sort()
      );
    });
  });

  describe('🔴 B4 · AC-3 — 빈·공백 본문은 노드를 안 그리고 대체 문구도 없다 (Q1 · BR-U6-03)', () => {
    it.each([
      ['빈 문자열', ''],
      ['공백·줄바꿈뿐', '  \n '],
    ])(
      '%s 본문 행엔 본문 노드가 없고 [제목, 메타] 두 줄뿐이다',
      (_label, empty) => {
        // 준비 — 본문 있는 형제 행(긍정 짝) + 빈 본문 행.
        const filled = row({
          title: '제목-A',
          body: '본문 있음',
          meta: '메타-A',
        });
        const blank = row({ title: '제목-B', body: empty, meta: '메타-B' });

        // 실행.
        renderRows([filled, blank]);

        // 단언 — 긍정 짝: 본문 있는 행엔 노드가 있다(빈 렌더로 공짜 통과 차단, 02a ★11).
        const rows = screen.getAllByTestId(ROW);
        expect(within(rows[0]).getByTestId(BODY)).toBeOnTheScreen();
        expect(screen.queryAllByTestId(BODY)).toHaveLength(1);
        // 빈 본문 행: 노드 없음 + 글자는 제목·메타뿐(대체 문구 없음).
        expect(within(rows[1]).queryByTestId(BODY)).toBeNull();
        expect(rowTexts(rows[1])).toEqual(['제목-B', '메타-B']);
      }
    );
  });

  describe('🔴 B5 · AC-9 — 본문을 눌러도 행 press 로 이어진다 (route 있고 인라인 액션 없음)', () => {
    it('회고 행의 본문을 누르면 onNavigate(route, id) 가 1회 불린다', () => {
      // 준비 — 인라인 액션 없는 회고 행.
      const props = renderRows([
        row({
          id: 'reflect-2',
          body: '어제 여행을 돌아봐요',
          route: '/trips/t1/records/reflection/2026-08-29',
        }),
      ]);

      // 실행 — 본문 노드를 누른다(자체 핸들러가 없으면 행으로 올라간다, 02a ★13).
      fireEvent.press(screen.getByTestId(BODY));

      // 단언.
      expect(props.onNavigate).toHaveBeenCalledTimes(1);
      expect(props.onNavigate).toHaveBeenCalledWith(
        '/trips/t1/records/reflection/2026-08-29',
        'reflect-2'
      );
    });
  });

  describe('🔴 B6 · AC-9 — PLAN_B 행은 본문이 press 를 새로 만들지 않고, 인라인 액션만 이동한다', () => {
    it('본문 press 는 무동작, 인라인 액션 press 는 route 로 1회', () => {
      // 준비 — PLAN_B 행(행 자체 press 없음).
      const props = renderRows([
        row({
          id: 'planb-2',
          body: '대안을 확인해 주세요',
          inlineActionLabel: PLAN_B_LABEL,
          route: '/trips/t1/planb',
        }),
      ]);

      // 실행 1 — 본문 press.
      fireEvent.press(screen.getByTestId(BODY));
      // 단언 1 — 본문이 이동을 만들지 않는다.
      expect(props.onNavigate).not.toHaveBeenCalled();

      // 실행 2 — 인라인 액션 press(무회귀).
      fireEvent.press(screen.getByTestId(ACTION));
      // 단언 2.
      expect(props.onNavigate).toHaveBeenCalledTimes(1);
      expect(props.onNavigate).toHaveBeenCalledWith(
        '/trips/t1/planb',
        'planb-2'
      );
    });
  });
});
