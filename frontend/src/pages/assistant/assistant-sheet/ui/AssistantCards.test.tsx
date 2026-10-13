import fc from 'fast-check';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  AssistantMessage,
  FallbackCause,
  ReviewPayload,
} from '../api/assistantContract';
import { assistantSample } from '../api/assistantSamples';
import { cardConsumes, MessageCard } from './AssistantCards';

/**
 * TRIP-1323 · b01 review · b03 scope · b04 guardrail · b05 error/solver-unavailable · b06 행.
 * 카드는 서버 값을 그대로 그린다 — 문제를 더 판정하지 않고(BR-U8-14), 소요시간을 만들지 않는다(BR-U8-15·INV-3).
 */

const handlers = () => ({
  onPressAction: jest.fn(),
  onPickCandidate: jest.fn(),
});

function renderCard(message: AssistantMessage) {
  const h = handlers();
  const view = render(<>{MessageCard({ message, ...h })}</>);
  return { ...h, view };
}

const FALLBACK_CAUSES: FallbackCause[] = [
  'AI_UNAVAILABLE',
  'SOLVER_UNAVAILABLE',
  'SOURCE_UNAVAILABLE',
  'TRANSLATION_FAILED',
  'REJECTED',
];

describe('ReviewCard (TRIP-1323 · b01 review)', () => {
  it('BR-U8-14 · 문제 행은 서버 problems[] 수만큼이고 각 행에 해결 행동이 있다', () => {
    const message = assistantSample('review', { id: 'r1' });
    const { onPressAction } = renderCard(message);
    const payload = message.payload as ReviewPayload;

    expect(screen.getByTestId('assistant-review-card')).toBeOnTheScreen();
    payload.problems.forEach((problem, index) => {
      expect(
        screen.getByTestId(`assistant-review-problem-${index}`)
      ).toHaveTextContent(problem.reason, { exact: false });
      fireEvent.press(screen.getByTestId(`assistant-review-fix-${index}`));
      expect(onPressAction).toHaveBeenLastCalledWith(problem.fixAction);
    });
    expect(
      screen.queryByTestId(
        `assistant-review-problem-${payload.problems.length}`
      )
    ).toBeNull();
  });

  it('속성 · 임의의 요약·문제 문자열을 그대로 그리고 행 수가 같다(소요시간 문구를 더하지 않는다)', () => {
    const clean = fc
      .string({ minLength: 1 })
      .filter((s) => s.trim() === s && !/분|소요/.test(s));
    fc.assert(
      fc.property(
        fc.array(fc.record({ label: clean, value: clean }), { maxLength: 4 }),
        fc.array(clean, { maxLength: 4 }),
        (summary, reasons) => {
          const message: AssistantMessage = {
            id: 'x',
            role: 'ASSISTANT',
            kind: 'REVIEW',
            payload: {
              title: '진행 상태 요약',
              summary,
              problems: reasons.map((reason) => ({
                reason,
                fixAction: {
                  type: 'OPEN_ITINERARY',
                  label: '보기',
                  params: {},
                },
              })),
            },
            nextActions: [],
            createdAt: '',
          };
          const { view } = renderCard(message);
          const card = screen.getByTestId('assistant-review-card');
          summary.forEach((row) => {
            expect(card).toHaveTextContent(row.value, { exact: false });
          });
          expect(
            screen.queryAllByTestId(/assistant-review-problem-/)
          ).toHaveLength(reasons.length);
          expect(card).not.toHaveTextContent(/분 소요|duration/);
          view.unmount();
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('CandidateCard (TRIP-1323)', () => {
  it('이름·거리·이유를 그대로 그리고 누르면 그 poiId 를 올린다', () => {
    const message = assistantSample('candidates', { id: 'c1' });
    const { onPickCandidate } = renderCard(message);
    const row = screen.getByTestId('assistant-candidate-poi-bookcafe');
    expect(row).toHaveTextContent('책방카페', { exact: false });
    expect(row).toHaveTextContent('630m · 조용한 좌석 · 리뷰 기준', {
      exact: false,
    });
    fireEvent.press(row);
    expect(onPickCandidate).toHaveBeenCalledWith('poi-bookcafe');
  });
});

describe('InfoCard (TRIP-1323)', () => {
  it('서버 행을 그대로 그린다(다음 장소 — 계획 시각·직전 구간 거리)', () => {
    renderCard(assistantSample('next-slot', { id: 'i1' }));
    const card = screen.getByTestId('assistant-info-card');
    expect(card).toHaveTextContent('카페 모카', { exact: false });
    expect(card).toHaveTextContent('14:00', { exact: false });
    expect(card).toHaveTextContent('840m', { exact: false });
  });
});

describe('ScopeCard (TRIP-1323 · b03)', () => {
  it('BR-U8-27 · 외부 위임 카드 — 누르면 OPEN_OTA 행동, 그 행동은 아래 버튼 줄에서 빠진다', () => {
    const message = assistantSample('scope', { id: 's1' });
    const { onPressAction } = renderCard(message);
    expect(screen.getByTestId('assistant-scope-card')).toHaveTextContent(
      '송정 호텔 · 외부 OTA',
      { exact: false }
    );
    fireEvent.press(screen.getByTestId('assistant-scope-ota'));
    expect(onPressAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OPEN_OTA' })
    );
    expect(cardConsumes(message)).toContain('OPEN_OTA');
  });
});

describe('RefusalNotice (TRIP-1323 · b04)', () => {
  it('"제가 할 수 있는 것" 안내를 그린다', () => {
    renderCard(assistantSample('refusal', { id: 'g1' }));
    expect(screen.getByTestId('assistant-refusal')).toBeOnTheScreen();
    expect(screen.getByTestId('assistant-capabilities')).toHaveTextContent(
      '제가 할 수 있는 것',
      { exact: false }
    );
  });
});

describe('FallbackNotice (TRIP-1323 · b05)', () => {
  it('error — [다시 시도] 를 누르면 RETRY_TURN', () => {
    const { onPressAction } = renderCard(
      assistantSample('fallback-error', { id: 'f1' })
    );
    fireEvent.press(screen.getByTestId('assistant-fallback-retry'));
    expect(onPressAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RETRY_TURN' })
    );
  });

  it('BR-U8-42 · solver-unavailable — 추측 안내를 그리고 시각 문자열은 없다', () => {
    renderCard(assistantSample('fallback-solver', { id: 'f2' }));
    const card = screen.getByTestId('assistant-fallback');
    expect(card).toHaveTextContent('추측으로 시각을 채우지 않아요', {
      exact: false,
    });
    expect(card).not.toHaveTextContent(/\d{1,2}:\d{2}/);
  });

  it.each(FALLBACK_CAUSES)(
    'BR-U8-41 · 원인 %s 에도 "도우미 없이 계속" 출구가 항상 있다',
    (cause) => {
      const { onPressAction } = renderCard({
        id: 'f',
        role: 'ASSISTANT',
        kind: 'FALLBACK',
        text: '실패',
        payload: { cause },
        nextActions: [],
        createdAt: '',
      });
      const exit = screen.getByTestId('assistant-fallback-continue');
      expect(exit).toHaveTextContent('도우미 없이', { exact: false });
      fireEvent.press(exit);
      expect(onPressAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CONTINUE_WITHOUT_ASSISTANT' })
      );
    }
  );
});

describe('ActionLogRow (TRIP-1323 · b06 행)', () => {
  it('무엇을 바꿨는지·태그·상세를 그린다', () => {
    renderCard({
      id: 'l1',
      role: 'ASSISTANT',
      kind: 'ACTION_LOG',
      payload: {
        what: '오늘 14:25 · 3일차 카페 교체',
        tag: 'CHANGE',
        detail: '카페 모카 → 책방카페 (솔버 검증)',
      },
      nextActions: [],
      createdAt: '',
    });
    const row = screen.getByTestId('assistant-action-log-l1');
    expect(row).toHaveTextContent('오늘 14:25 · 3일차 카페 교체', {
      exact: false,
    });
    expect(row).toHaveTextContent('반영된 변경', { exact: false });
  });
});
