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
} from './NotificationInboxScreen';

/**
 * TRIP-1075 · l01 — 알림 행이 서버 본문(`body`)을 버리지 않고 제목·본문·메타 3줄로 그린다(결정 1 A).
 *
 * 무엇을 보장하나:
 *  - **AC-1**: 본문 노드(`notification-inbox-body`)가 행 안에 있고 텍스트가 서버 문자열과 가공 없이
 *    같다(BR-U6-03). 두 줄 말줄임(`numberOfLines`)은 화면 표시만 줄이고 노드 텍스트는 전부 남는다.
 *  - **AC-2**: 한 행의 글자 줄 순서 = 제목 → 본문 → 메타 → (PLAN_B) 인라인 액션.
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

/** className 을 토큰 배열로 — `font-noto` 가 `font-noto-bold` 에 부분 일치하는 것을 막는다. */
function tokens(el: ReactTestInstance): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
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
  it('180자 본문이 전부 노드에 남고, numberOfLines=2 · Regular 13 muted(text-body 아님)다', () => {
    // 준비 — 두 줄을 넘는 긴 본문(body maxLength 400 안).
    const long = '가나다라마바사아자차카타파하 '.repeat(12).trim();
    expect(long.length).toBeGreaterThan(150);
    renderRows([row({ body: long })]);

    // 실행 — 본문 노드를 잡는다(testID 는 host Text 자체에 있다, 02a §2).
    const body = screen.getByTestId(BODY);

    // 단언 — FE 가 자르지 않았다(BR-U6-03).
    expect(body).toHaveTextContent(long, AS_IS);
    // 두 줄 말줄임은 표시만(Q2).
    expect(body.props.numberOfLines).toBe(2);
    // 글자 토큰 — 보통 굵기 13 · muted. `text-body` 는 크기(14)이자 색 이름이라 금지(02a ★10).
    expect(tokens(body)).toEqual(
      expect.arrayContaining(['font-noto', 'text-label', 'text-muted'])
    );
    expect(tokens(body)).not.toContain('font-noto-bold');
    expect(tokens(body)).not.toContain('text-body');
  });
});

describe('🔴 B3 · AC-2 — 행 안 줄 순서는 제목 → 본문 → 메타 → (PLAN_B) 액션', () => {
  it('PLAN_B 행은 [제목, 본문, 메타, 액션], 일반 행은 [제목, 본문, 메타] 로 정확히 그 순서다', () => {
    // 준비 — PLAN_B(인라인 액션 있음) 1행 + 일정 알림 1행.
    const planB = row({
      title: '비 예보 — 일정 영향',
      body: '14:00 한강공원 일정이 비 예보로 영향을 받아요',
      meta: 'Plan-B · 10일 전',
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

    // 단언 — 행별 글자 목록 전체 완전일치(순서 뒤바뀜·대체 문구·중복 전부 red).
    const rows = screen.getAllByTestId(ROW);
    expect(rowTexts(rows[0])).toEqual([
      '비 예보 — 일정 영향',
      '14:00 한강공원 일정이 비 예보로 영향을 받아요',
      'Plan-B · 10일 전',
      PLAN_B_LABEL,
    ]);
    expect(rowTexts(rows[1])).toEqual([
      '오늘의 일정',
      '오늘 어디를 가는지 확인해 보세요.',
      '일정 · 2일 전',
    ]);
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
  it('회고 행의 본문을 누르면 onNavigate(route) 가 1회 불린다', () => {
    // 준비 — 인라인 액션 없는 회고 행.
    const props = renderRows([
      row({
        body: '어제 여행을 돌아봐요',
        route: '/trips/t1/records/reflection/2026-08-29',
      }),
    ]);

    // 실행 — 본문 노드를 누른다(자체 핸들러가 없으면 행으로 올라간다, 02a ★13).
    fireEvent.press(screen.getByTestId(BODY));

    // 단언.
    expect(props.onNavigate).toHaveBeenCalledTimes(1);
    expect(props.onNavigate).toHaveBeenCalledWith(
      '/trips/t1/records/reflection/2026-08-29'
    );
  });
});

describe('🔴 B6 · AC-9 — PLAN_B 행은 본문이 press 를 새로 만들지 않고, 인라인 액션만 이동한다', () => {
  it('본문 press 는 무동작, 인라인 액션 press 는 route 로 1회', () => {
    // 준비 — PLAN_B 행(행 자체 press 없음).
    const props = renderRows([
      row({
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
    expect(props.onNavigate).toHaveBeenCalledWith('/trips/t1/planb');
  });
});
