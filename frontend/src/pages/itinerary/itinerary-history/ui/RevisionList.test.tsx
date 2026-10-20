import fc from 'fast-check';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Revision } from '@/shared/api/index.schemas';

import { RevisionList } from './RevisionList';

/**
 * TRIP-1513 · h36 변경 이력 — 리비전 행 목록(순수 뷰). 리비전 = "그 시점의 일정 전체를 저장해 둔 되돌리기 지점".
 *
 * 무엇을 보장하나: 서버가 준 순서(최신순) 그대로 그린다(재정렬 없음) · 첫 행은 현재 버전이라 [되돌리기] 가 없고
 * 나머지 행엔 있다 · kind=BASELINE 행에만 "기준 버전" · 소요시간·삭제 표기 없음(INV-3 · AC-7).
 *
 * 3동작: 준비=리비전 배열 → 실행=렌더(+press) → 단언=행 순서·버튼 유무·라벨·콜백.
 */

const NOW = new Date('2026-10-20T12:00:00.000Z');
const ROW_ID = /^itinerary-history-[0-9a-f]{8}-/;

const revisionArb = fc.record({
  revisionId: fc.uuid(),
  actor: fc.constantFrom('USER', 'AI'),
  kind: fc.constantFrom('BASELINE', 'GENERATE', 'EDIT', 'RESTORE'),
  summary: fc.constantFrom(
    '숙소를 바꿨어요',
    '일정을 새로 짰어요',
    '방문지를 옮겼어요'
  ),
  detail: fc.option(fc.constantFrom('2일차 · 순서 변경', '3곳 추가'), {
    nil: null,
  }),
});

const listArb = fc
  .uniqueArray(revisionArb, {
    selector: (r) => r.revisionId,
    minLength: 1,
    maxLength: 8,
  })
  .map((rows): Revision[] =>
    // seq·createdAt 은 서버 순서와 무관한 값 — 뷰가 이 값으로 재정렬하면 순서 단언이 깨진다(W2)
    rows.map((row, index) => ({
      ...row,
      seq: ((index * 7919) % 97) + 1,
      createdAt: new Date(
        Date.UTC(2026, 9, 20, 1 + ((index * 5) % 9))
      ).toISOString(),
    }))
  );

describe('RevisionList (TRIP-1513 · h36)', () => {
  it('속성 · 임의 리비전 배열이면 서버 순서 그대로, 첫 행만 버튼 없음, BASELINE 행만 기준 버전', () => {
    fc.assert(
      fc.property(listArb, (revisions) => {
        const view = render(
          <RevisionList revisions={revisions} now={NOW} onRestore={jest.fn()} />
        );

        // 순서: 렌더된 행 id = 입력 id (재정렬 금지)
        const rendered = screen
          .getAllByTestId(ROW_ID)
          .map((node) => node.props.testID.replace('itinerary-history-', ''));
        expect(rendered).toEqual(revisions.map((r) => r.revisionId));

        // 첫 행 = 현재 버전(버튼 없음), 나머지 = 버튼 있음
        const first = revisions[0];
        const firstRow = screen.getByTestId(
          `itinerary-history-${first.revisionId}`
        );
        expect(within(firstRow).getByText('현재 버전')).toBeOnTheScreen();
        expect(
          screen.queryByTestId(`itinerary-history-restore-${first.revisionId}`)
        ).toBeNull();
        revisions.slice(1).forEach((r) => {
          expect(
            screen.getByTestId(`itinerary-history-restore-${r.revisionId}`)
          ).toBeOnTheScreen();
        });
        expect(screen.queryAllByText('이 버전으로 되돌리기')).toHaveLength(
          revisions.length - 1
        );
        expect(screen.queryAllByText('현재 버전')).toHaveLength(1);

        // 기준 버전 라벨은 BASELINE 행 안에만
        const baselineIds = revisions
          .filter((r) => r.kind === 'BASELINE')
          .map((r) => r.revisionId);
        expect(
          screen.queryAllByTestId('itinerary-history-baseline')
        ).toHaveLength(baselineIds.length);
        baselineIds.forEach((id) => {
          const row = screen.getByTestId(`itinerary-history-${id}`);
          expect(within(row).getByText('기준 버전')).toBeOnTheScreen();
        });

        // 행 내용: 배지(나/AI) · 요약 · 있으면 부연
        revisions.forEach((r) => {
          const row = screen.getByTestId(`itinerary-history-${r.revisionId}`);
          expect(
            within(row).getByText(r.actor === 'USER' ? '나' : 'AI')
          ).toBeOnTheScreen();
          expect(within(row).getByText(r.summary)).toBeOnTheScreen();
          if (r.detail) {
            expect(within(row).getByText(r.detail)).toBeOnTheScreen();
          }
        });

        // INV-3 · AC-7: 소요시간·삭제 표기 없음
        expect(screen.queryByText(/소요|걸려|걸림/)).toBeNull();
        expect(screen.queryByText(/삭제|지우기/)).toBeNull();

        view.unmount();
      }),
      {
        numRuns: 40,
        examples: [
          // 한 행짜리 BASELINE — 같은 행에 현재 버전 + 기준 버전
          [
            [
              {
                revisionId: '11111111-1111-4111-8111-111111111111',
                seq: 1,
                actor: 'AI',
                kind: 'BASELINE',
                summary: '일정을 새로 짰어요',
                detail: null,
                createdAt: '2026-10-20T11:00:00.000Z',
              },
            ],
          ],
          // BASELINE 이 맨 위에 와도 뷰가 끌어내리지 않는다(재정렬 금지)
          [
            [
              {
                revisionId: '22222222-2222-4222-8222-222222222222',
                seq: 2,
                actor: 'AI',
                kind: 'BASELINE',
                summary: '일정을 새로 짰어요',
                detail: null,
                createdAt: '2026-10-20T11:00:00.000Z',
              },
              {
                revisionId: '33333333-3333-4333-8333-333333333333',
                seq: 1,
                actor: 'USER',
                kind: 'EDIT',
                summary: '숙소를 바꿨어요',
                detail: null,
                createdAt: '2026-10-20T10:00:00.000Z',
              },
            ],
          ],
        ],
      }
    );
  });

  it('서버 순서가 seq·createdAt 순서와 달라도 그 순서 그대로 그리고, 현재 버전은 첫 행이다', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 20, h)).toISOString();
    const rows: Revision[] = [
      ['e1e1e1e1', 1, at(3)],
      ['e3e3e3e3', 3, at(1)],
      ['e2e2e2e2', 2, at(2)],
    ].map(([p, seq, createdAt]) => ({
      revisionId: `${p}-eeee-4eee-8eee-eeeeeeeeeeee`,
      seq: seq as number,
      actor: 'USER',
      kind: 'EDIT',
      summary: '숙소를 바꿨어요',
      detail: null,
      createdAt: createdAt as string,
    }));
    render(<RevisionList revisions={rows} now={NOW} onRestore={jest.fn()} />);

    const rendered = screen
      .getAllByTestId(ROW_ID)
      .map((node) => node.props.testID.replace('itinerary-history-', ''));
    expect(rendered).toEqual(rows.map((r) => r.revisionId));
    expect(
      within(
        screen.getByTestId(`itinerary-history-${rows[0].revisionId}`)
      ).getByText('현재 버전')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(`itinerary-history-restore-${rows[0].revisionId}`)
    ).toBeNull();
    expect(
      screen.getByTestId(`itinerary-history-restore-${rows[1].revisionId}`)
    ).toBeOnTheScreen();
  });

  it('createdAt 은 경과 시각("18분 전")으로 그린다', () => {
    render(
      <RevisionList
        revisions={[
          {
            revisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            seq: 1,
            actor: 'USER',
            kind: 'EDIT',
            summary: '숙소를 바꿨어요',
            detail: null,
            createdAt: new Date(
              NOW.getTime() - 18 * 60_000 - 5000
            ).toISOString(),
          },
        ]}
        now={NOW}
        onRestore={jest.fn()}
      />
    );
    expect(screen.getByText('18분 전')).toBeOnTheScreen();
  });

  it('[이 버전으로 되돌리기] 를 누르면 그 행의 revisionId 로 정확히 1번 알린다', () => {
    const onRestore = jest.fn();
    const rows: Revision[] = ['bbbbbbbb', 'cccccccc', 'dddddddd'].map(
      (p, i) => ({
        revisionId: `${p}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
        seq: 3 - i,
        actor: 'USER',
        kind: 'EDIT',
        summary: '숙소를 바꿨어요',
        detail: null,
        createdAt: '2026-10-20T11:00:00.000Z',
      })
    );
    render(<RevisionList revisions={rows} now={NOW} onRestore={onRestore} />);

    fireEvent.press(
      screen.getByTestId(`itinerary-history-restore-${rows[2].revisionId}`)
    );

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(rows[2].revisionId);
  });

  it('빈 배열이면 행을 하나도 그리지 않는다(빈 얼굴은 페이지 몫)', () => {
    render(<RevisionList revisions={[]} now={NOW} onRestore={jest.fn()} />);
    expect(screen.queryAllByTestId(ROW_ID)).toHaveLength(0);
  });
});
