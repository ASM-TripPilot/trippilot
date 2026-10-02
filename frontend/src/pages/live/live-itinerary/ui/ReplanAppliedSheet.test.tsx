import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { ReplanAppliedSheet } from './ReplanAppliedSheet';
import type { AppliedDiffRow } from './ReplanAppliedSheet';

/**
 * TRIP-754 · AC-1·3·4·8 — i08 변경 반영 시트(Figma 4401:1568, 순수 바텀시트 — props + 콜백만).
 *
 * 무엇을 보장하나:
 *  - 라벨 "변경 반영됨"(success 색) · 제목 · 부제 줄 · 요약 배지 · 변경 내역(추가/삭제 점 + 이름 + 메타) ·
 *    [되돌리기]/[확인]을 **받은 순서 그대로** 그린다.
 *  - 데이터 prop 이 없거나 빈 배열이면 부제·배지 줄·내역 카드를 **컨테이너째** 안 그린다(E4 정직 축소).
 *  - [확인]·스크림·아래로 끌기 → onConfirm, [되돌리기] → onRevert. 서로 섞이지 않고, 본문을 눌러도 안 닫힌다.
 *  - showRevertNotice 가 켜지면 시트 안에 "이미 반영돼 되돌릴 수 없어요"(E2).
 *
 * ★ 바텀시트 목 사각: 통과형 목이라 실제 딤 전면 커버·시트 높이·끌어 닫기 제스처는 jest 가 못 본다
 *   (repo-traps 바텀시트 항). 여기 심판은 testID·글자·클래스·콜백까지.
 *
 * 3동작 뼈대: 준비=props → 실행=render/press → 단언=보이는 것·콜백.
 */

jest.mock('@gorhom/bottom-sheet');

const SUBTITLE = [
  '비 예보를 반영했어요',
  '방문한 곳은 그대로 두고 17시 이후만 바뀌었어요',
];
const BADGES = ['바뀐 곳 1', '방문지 5→5', '이동 −6.9km'];
const ADDED: AppliedDiffRow = {
  kind: 'added',
  name: 'F1963 복합문화공간',
  meta: '17:00–18:30 · 비 예보로 실내 대안',
};
const REMOVED: AppliedDiffRow = {
  kind: 'removed',
  name: '해운대 해변',
  meta: '17:00–18:30 · 비 예보 · 17시 이후',
};
const NOTICE = '이미 반영돼 되돌릴 수 없어요';

const SHEET = 'planb-applied-sheet';

function classTokens(node: ReactTestInstance): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.split(/\s+/).filter(Boolean) : [];
}

function callbacks() {
  return { onConfirm: jest.fn(), onRevert: jest.fn() };
}

function renderFull(cb = callbacks()) {
  render(
    <ReplanAppliedSheet
      subtitleLines={SUBTITLE}
      summaryBadges={BADGES}
      diffRows={[ADDED, REMOVED]}
      {...cb}
    />
  );
  return cb;
}

/** 반복 testID 노드들이 기대 글자와 개수·순서까지 같다(각 노드 완전 일치). */
function expectTexts(testID: string, expected: string[]): void {
  const nodes = screen.getAllByTestId(testID);
  expect(nodes).toHaveLength(expected.length);
  nodes.forEach((node, index) =>
    expect(node).toHaveTextContent(expected[index])
  );
}

/** 내역 행 하나 — 점 색·종류 글자·이름·메타. */
function expectDiffRow(
  row: ReactTestInstance,
  kind: '추가' | '삭제',
  dotClass: 'bg-success' | 'bg-primary',
  name: string,
  meta: string
): void {
  expect(within(row).getByTestId('planb-applied-diff-kind')).toHaveTextContent(
    kind
  );
  expect(
    classTokens(within(row).getByTestId('planb-applied-diff-dot'))
  ).toContain(dotClass);
  expect(within(row).getByTestId('planb-applied-diff-name')).toHaveTextContent(
    name
  );
  expect(within(row).getByTestId('planb-applied-diff-meta')).toHaveTextContent(
    meta
  );
}

describe('🔴 S1·S2 · AC-1 — 픽스처 전부를 Figma 순서로 그린다', () => {
  it('S1 라벨·제목·부제 2줄·배지 3개·버튼 2개', () => {
    renderFull();

    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
    const eyebrow = screen.getByTestId('planb-applied-eyebrow');
    expect(eyebrow).toHaveTextContent('변경 반영됨');
    // Figma 실측 #0E9384 — 티켓의 primary-text 가 아니다(브리프 드리프트 ①).
    expect(classTokens(eyebrow)).toContain('text-success');
    expect(screen.getByTestId('planb-applied-title')).toHaveTextContent(
      '새 일정이 반영됐어요'
    );
    expect(screen.getByTestId('planb-applied-subtitle')).toBeOnTheScreen();
    expectTexts('planb-applied-subtitle-line', SUBTITLE);
    expect(screen.getByTestId('planb-applied-summary')).toBeOnTheScreen();
    expectTexts('planb-applied-badge', BADGES);
    expect(screen.getByTestId('planb-applied-revert')).toHaveTextContent(
      '되돌리기'
    );
    expect(screen.getByTestId('planb-applied-confirm')).toHaveTextContent(
      '확인'
    );
  });

  it('S2 변경 내역 2행 — 추가(초록 점)·삭제(빨강 점) + 이름 + 메타', () => {
    renderFull();

    expect(screen.getByTestId('planb-applied-diff')).toBeOnTheScreen();
    const rows = screen.getAllByTestId('planb-applied-diff-row');
    expect(rows).toHaveLength(2);
    expectDiffRow(rows[0], '추가', 'bg-success', ADDED.name, ADDED.meta);
    expectDiffRow(rows[1], '삭제', 'bg-primary', REMOVED.name, REMOVED.meta);
  });
});

describe('🔴 S3 · AC-1 — 배지·내역은 받은 순서 그대로(정렬하지 않는다)', () => {
  it('뒤집은 입력은 뒤집힌 채로 그린다', () => {
    render(
      <ReplanAppliedSheet
        summaryBadges={['이동 −6.9km', '바뀐 곳 1']}
        diffRows={[REMOVED, ADDED]}
        {...callbacks()}
      />
    );

    expectTexts('planb-applied-badge', ['이동 −6.9km', '바뀐 곳 1']);
    const rows = screen.getAllByTestId('planb-applied-diff-row');
    expect(rows).toHaveLength(2);
    expectDiffRow(rows[0], '삭제', 'bg-primary', REMOVED.name, REMOVED.meta);
    expectDiffRow(rows[1], '추가', 'bg-success', ADDED.name, ADDED.meta);
  });
});

describe('🔴 S4·S5 · AC-3 — 데이터가 없으면 컨테이너째 없다 (E4 정직 축소)', () => {
  function expectHonestMinimum(): void {
    // 짝 앵커 — 시트·라벨·제목·두 버튼은 있다(아래 부재 단언의 공허 통과 차단).
    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
    expect(screen.getByTestId('planb-applied-eyebrow')).toHaveTextContent(
      '변경 반영됨'
    );
    expect(screen.getByTestId('planb-applied-title')).toHaveTextContent(
      '새 일정이 반영됐어요'
    );
    expect(screen.getByTestId('planb-applied-revert')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-applied-confirm')).toBeOnTheScreen();

    expect(screen.queryByTestId('planb-applied-subtitle')).toBeNull();
    expect(screen.queryByTestId('planb-applied-summary')).toBeNull();
    expect(screen.queryByTestId('planb-applied-diff')).toBeNull();
    expect(screen.queryAllByTestId('planb-applied-badge')).toHaveLength(0);
    expect(screen.queryAllByTestId('planb-applied-diff-row')).toHaveLength(0);
    expect(screen.queryByTestId('planb-applied-revert-notice')).toBeNull();
  }

  it('S4 콜백 두 개만 주면 라벨·제목·버튼만 그린다', () => {
    render(<ReplanAppliedSheet {...callbacks()} />);

    expectHonestMinimum();
  });

  it('S5 빈 배열을 주어도 빈 회색 상자를 남기지 않는다', () => {
    render(
      <ReplanAppliedSheet
        subtitleLines={[]}
        summaryBadges={[]}
        diffRows={[]}
        {...callbacks()}
      />
    );

    expectHonestMinimum();
  });
});

describe('🔴 S6~S8 · AC-4 · Q1 — 닫기와 되돌리기는 섞이지 않는다', () => {
  it('S6a [확인] → onConfirm 1회, onRevert 0회', () => {
    const cb = renderFull();

    fireEvent.press(screen.getByTestId('planb-applied-confirm'));

    expect(cb.onConfirm).toHaveBeenCalledTimes(1);
    expect(cb.onRevert).not.toHaveBeenCalled();
  });

  it('S6b [되돌리기] → onRevert 1회, onConfirm 0회', () => {
    const cb = renderFull();

    fireEvent.press(screen.getByTestId('planb-applied-revert'));

    expect(cb.onRevert).toHaveBeenCalledTimes(1);
    expect(cb.onConfirm).not.toHaveBeenCalled();
  });

  it('S7 스크림(시트 밖) → onConfirm 1회 (Q1 — 확인과 같은 닫기)', () => {
    const cb = renderFull();
    const scrim = screen.getByTestId('planb-applied-scrim');
    // 스크림은 시트 본문의 형제다 — 본문 안에 두면 딤이 시트 뒤 화면을 덮지 못한다.
    expect(
      within(screen.getByTestId(SHEET)).queryByTestId('planb-applied-scrim')
    ).toBeNull();

    fireEvent.press(scrim);

    expect(cb.onConfirm).toHaveBeenCalledTimes(1);
    expect(cb.onRevert).not.toHaveBeenCalled();
  });

  it('S7b 아래로 끌어 닫기(gorhom onClose) → onConfirm 1회 (Q1)', () => {
    const cb = renderFull();
    const panClosable = screen.UNSAFE_root.findAll(
      (node) => node.props?.enablePanDownToClose === true
    );
    expect(panClosable.length).toBeGreaterThan(0);

    panClosable[0].props.onClose();

    expect(cb.onConfirm).toHaveBeenCalledTimes(1);
    expect(cb.onRevert).not.toHaveBeenCalled();
  });

  it('S8 본문(제목)을 눌러도 닫히지 않는다 — 대조군 스크림은 닫는다', () => {
    const cb = renderFull();

    fireEvent.press(screen.getByTestId('planb-applied-title'));
    expect(cb.onConfirm).not.toHaveBeenCalled();
    expect(cb.onRevert).not.toHaveBeenCalled();

    // 대조군 — 같은 배선에서 스크림은 실제로 닫는다(0회 단언의 공허 통과 차단).
    fireEvent.press(screen.getByTestId('planb-applied-scrim'));
    expect(cb.onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 S9 · AC-8 — 되돌리기 안내 줄 (E2)', () => {
  it('showRevertNotice 면 시트 안에 정직 안내가 뜬다', () => {
    render(<ReplanAppliedSheet showRevertNotice {...callbacks()} />);

    const notice = within(screen.getByTestId(SHEET)).getByTestId(
      'planb-applied-revert-notice'
    );
    expect(notice).toHaveTextContent(NOTICE);
    // 안내가 떠도 버튼은 그대로다(Q3 — 숨기거나 잠그지 않는다).
    expect(screen.getByTestId('planb-applied-revert')).toBeOnTheScreen();
  });

  it('주지 않으면 안내 줄이 없다', () => {
    renderFull();

    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
    expect(screen.queryByTestId('planb-applied-revert-notice')).toBeNull();
  });
});
