import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Proposal, ProposalDiffItem } from '../api/assistantContract';
import { assistantSample } from '../api/assistantSamples';
import { ProposalCard, type ProposalCardProps } from './ProposalCard';

/**
 * TRIP-1324 · b02 · BR-U8-30~35 — 전후 비교 카드. 위반이 있으면 [적용]이 없다는 판정은 서버가
 * `violations` 로 이미 내렸다 — 카드는 길이만 본다. 시각·거리는 diff 문자열 그대로, 소요시간 없음.
 */

function proposalOf(scenario: 'proposal' | 'proposal-violation'): Proposal {
  const proposal = assistantSample(scenario, { id: 'm1' }).proposal;
  if (!proposal) throw new Error('샘플에 제안 없음');
  return proposal;
}

function renderCard(overrides: Partial<ProposalCardProps> = {}) {
  const props: ProposalCardProps = {
    proposal: proposalOf('proposal'),
    applying: false,
    onApply: jest.fn(),
    onDismiss: jest.fn(),
    onRepropose: jest.fn(),
    ...overrides,
  };
  render(<ProposalCard {...props} />);
  return props;
}

describe('ProposalCard (TRIP-1324)', () => {
  it('b02 · 지금/변경 줄을 서버 문자열 그대로 그린다(이동은 거리만)', () => {
    renderCard();
    const card = screen.getByTestId('assistant-proposal-proposal-m1');
    expect(card).toHaveTextContent('14:00 카페 모카 · 이동 840m', {
      exact: false,
    });
    expect(card).toHaveTextContent('14:00 책방카페 · 이동 630m', {
      exact: false,
    });
    expect(card).not.toHaveTextContent(/분 소요|소요/);
  });

  it('위반 없는 제안 — [적용] 을 누르면 onApply(id)', () => {
    const props = renderCard();
    fireEvent.press(screen.getByTestId('assistant-proposal-apply'));
    expect(props.onApply).toHaveBeenCalledWith('proposal-m1');
  });

  it('BR-U8-31 · 위반이 1건 이상이면 [적용]이 트리에 없고 위반 사유를 보인다', () => {
    renderCard({ proposal: proposalOf('proposal-violation') });
    expect(screen.queryByTestId('assistant-proposal-apply')).toBeNull();
    expect(
      screen.getByTestId('assistant-proposal-violation-0')
    ).toHaveTextContent('16:00 미술관 운영시간(17:00)까지 머물 수 없어요', {
      exact: false,
    });
  });

  it('[취소] 를 누르면 onDismiss 만 — onApply 는 0회', () => {
    const props = renderCard();
    fireEvent.press(screen.getByTestId('assistant-proposal-dismiss'));
    expect(props.onDismiss).toHaveBeenCalledWith('proposal-m1');
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('적용 진행 중이면 [적용]이 비활성이다(연타 방지 §7)', () => {
    const props = renderCard({ applying: true });
    fireEvent.press(screen.getByTestId('assistant-proposal-apply'));
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it.each(['STALE', 'EXPIRED'] as const)(
    'BR-U8-32 · %s 면 "낡음" 안내 + [다시 제안], 적용·취소 버튼은 없다',
    (status) => {
      const props = renderCard({
        proposal: { ...proposalOf('proposal'), status },
      });
      expect(screen.getByTestId('assistant-proposal-stale')).toHaveTextContent(
        '일정이 바뀌어 다시 제안할게요',
        { exact: false }
      );
      expect(screen.queryByTestId('assistant-proposal-apply')).toBeNull();
      expect(screen.queryByTestId('assistant-proposal-dismiss')).toBeNull();
      fireEvent.press(screen.getByTestId('assistant-proposal-repropose'));
      expect(props.onRepropose).toHaveBeenCalledTimes(1);
    }
  );

  it('적용됨·취소됨은 결과 표지만 남긴다', () => {
    renderCard({ proposal: { ...proposalOf('proposal'), status: 'APPLIED' } });
    expect(screen.getByTestId('assistant-proposal-status')).toHaveTextContent(
      '적용했어요'
    );
    expect(screen.queryByTestId('assistant-proposal-apply')).toBeNull();
  });
});

/**
 * 여러 날을 통째로 바꾼 안("1일차는 종로 2일차는 강남구쪽으로") — 서버가 줄마다 `dayLabel` 을 싣는다(여행 시작일을
 * 알면 한 날 안에도). 받은 순서 그대로 날마다 묶고, 빠지는 곳은 "빠짐"·새로 넣는 곳은 "추가". 라벨 없는 옛 서버
 * 응답은 묶지 않는다. 부정 단언은 정규식으로 쓴다 — 문자열은 기본이 전체 일치라 `not` 이 늘 통과한다.
 */
describe('ProposalCard — 여러 날 안', () => {
  const DAY1 = '1일차 · 10월 24일';
  const DAY2 = '2일차 · 10월 25일';
  const face = (name: string) => ({
    name,
    startAt: '10:00',
    distanceRange: null,
  });
  const removed = (name: string, dayLabel?: string): ProposalDiffItem => ({
    change: 'REMOVED',
    slotKey: `old#${name}`,
    before: face(name),
    after: null,
    dayLabel,
  });
  const added = (name: string, dayLabel?: string): ProposalDiffItem => ({
    change: 'ADDED',
    slotKey: `new#${name}`,
    before: null,
    after: face(name),
    dayLabel,
  });
  const withDiff = (diff: ProposalDiffItem[]): Proposal => ({
    ...proposalOf('proposal'),
    diff,
  });

  it('날마다 머리 줄 아래로 묶는다 — 같은 날 줄은 한 묶음', () => {
    renderCard({
      proposal: withDiff([
        removed('경복궁', DAY1),
        added('종묘', DAY1),
        removed('해운대', DAY2),
        added('코엑스', DAY2),
      ]),
    });
    const day1 = screen.getByTestId('assistant-proposal-day-0');
    expect(day1).toHaveTextContent(DAY1, { exact: false });
    expect(day1).toHaveTextContent('10:00 경복궁', { exact: false });
    expect(day1).toHaveTextContent('10:00 종묘', { exact: false });
    expect(day1).not.toHaveTextContent(/2일차|해운대|코엑스/);
    const day2 = screen.getByTestId('assistant-proposal-day-1');
    expect(day2).toHaveTextContent(DAY2, { exact: false });
    expect(day2).toHaveTextContent('10:00 해운대', { exact: false });
    expect(day2).toHaveTextContent('10:00 코엑스', { exact: false });
    expect(day2).not.toHaveTextContent(/1일차|경복궁|종묘/);
    expect(screen.queryByTestId('assistant-proposal-day-2')).toBeNull();
    // INV-3 — 묶어 그려도 시각·거리뿐(날 머리에 '약 8시간' 같은 계산값을 붙이면 여기서 걸린다)
    expect(
      screen.getByTestId('assistant-proposal-proposal-m1')
    ).not.toHaveTextContent(/소요|\d+\s*(분|시간)/);
  });

  it('한 날 안이어도 라벨이 오면 그 날 머리 줄을 단다', () => {
    const base = proposalOf('proposal');
    renderCard({
      proposal: {
        ...base,
        diff: base.diff.map((item) => ({ ...item, dayLabel: DAY2 })),
      },
    });
    const day = screen.getByTestId('assistant-proposal-day-0');
    expect(day).toHaveTextContent(DAY2, { exact: false });
    expect(day).toHaveTextContent('14:00 카페 모카 · 이동 840m', {
      exact: false,
    });
    expect(day).toHaveTextContent('14:00 책방카페 · 이동 630m', {
      exact: false,
    });
    expect(screen.queryByTestId('assistant-proposal-day-1')).toBeNull();
  });

  it('같은 날이 떨어져 오면 합치지 않는다 — 받은 순서를 바꾸지 않는다(INV-2)', () => {
    renderCard({
      proposal: withDiff([
        removed('경복궁', DAY1),
        removed('해운대', DAY2),
        added('종묘', DAY1),
      ]),
    });
    const groups = [
      [DAY1, '경복궁', /해운대|종묘/],
      [DAY2, '해운대', /경복궁|종묘/],
      [DAY1, '종묘', /경복궁|해운대/],
    ] as const;
    groups.forEach(([label, place, others], index) => {
      const group = screen.getByTestId(`assistant-proposal-day-${index}`);
      expect(group).toHaveTextContent(label, { exact: false });
      expect(group).toHaveTextContent(place, { exact: false });
      expect(group).not.toHaveTextContent(others);
    });
  });

  it.each<[ProposalDiffItem['change'], string[], string[]]>([
    ['REMOVED', ['빠짐'], ['지금', '추가', '변경']],
    ['ADDED', ['추가'], ['빠짐', '지금', '변경']],
    ['REPLACED', ['지금', '변경'], ['빠짐', '추가']],
    ['MOVED', ['지금', '변경'], ['빠짐', '추가']],
    ['RETIMED', ['지금', '변경'], ['빠짐', '추가']],
  ])('%s 줄 배지 — %j 만', (change, shown, hidden) => {
    renderCard({
      proposal: withDiff([
        {
          change,
          slotKey: 's1',
          before: change === 'ADDED' ? null : face('카페 모카'),
          after: change === 'REMOVED' ? null : face('책방카페'),
        },
      ]),
    });
    for (const badge of shown) {
      expect(screen.getByText(badge)).toBeOnTheScreen();
    }
    for (const badge of hidden) {
      expect(screen.queryByText(badge)).toBeNull();
    }
  });

  it('dayLabel 이 하나도 없으면(옛 서버) 날로 묶지 않는다 — 날 머리 없이 카드 한 장', () => {
    renderCard({
      proposal: withDiff([removed('경복궁'), added('종묘')]),
    });
    expect(screen.queryByTestId('assistant-proposal-day-0')).toBeNull();
    const card = screen.getByTestId('assistant-proposal-proposal-m1');
    expect(card).toHaveTextContent('10:00 경복궁', { exact: false });
    expect(card).toHaveTextContent('10:00 종묘', { exact: false });
  });
});
