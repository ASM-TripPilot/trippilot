import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Proposal } from '../api/assistantContract';
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
