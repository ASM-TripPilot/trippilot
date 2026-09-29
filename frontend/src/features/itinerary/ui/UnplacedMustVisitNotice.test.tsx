import { render, screen, within } from '@testing-library/react-native';

import type { UnplacedMustVisitRow } from '@/features/itinerary/model/unplacedMustVisits';

import { UnplacedMustVisitNotice } from './UnplacedMustVisitNotice';

/**
 * TRIP-1094 · "일정에 넣지 못한 꼭 갈 곳" 블록 — 이름이 붙은 행을 받아 그리기만 하는 순수 표시 컴포넌트.
 *
 * 무엇을 보장하나:
 *  - 0건이면 아무것도 안 그린다(AC-7 — 빈 배열 = 전부 배치됨).
 *  - 제목 한 줄 + 항목마다 (이름) + 서버 문구. 이름이 없으면 이름 자리 없이 문구만 — 대체 이름 0(AC-3).
 *  - 클라가 만든 사유 문장·제안 버튼이 없다(AC-8 · AC-5 · 결정 2).
 *  - 소요시간 표기가 없다(AC-11 · INV-3).
 *
 * 글자 단언은 전부 완전 일치다 — `toHaveTextContent(문자열)`은 자식 글자를 구분자 없이 이어 붙인 값과
 * 통째로 비교하고, `getByText(문자열)`은 Text 하나의 글자와 통째로 비교한다(02a ★1·★2).
 *
 * 3동작 뼈대: 준비=행 배열 → 실행=렌더 → 단언=testID·글자.
 */

const ROOT = 'itinerary-unplaced-mustvisit';
const ITEM_PREFIX = /^itinerary-unplaced-mustvisit-/;
const TITLE = '일정에 넣지 못한 꼭 갈 곳';

/** 서버 `UnplacedText.kt` 원문 4종. */
const MSG = {
  OUT_OF_RANGE:
    '여행 기간 밖 날짜로 지정돼 있어 넣지 못했어요. 날짜를 여행 기간 안으로 바꿔 주세요.',
  WINDOW_CONFLICT:
    '다른 필수 방문지와 시간이 겹쳐 넣지 못했어요. 한쪽 시각을 옮겨 주세요.',
  NO_FEASIBLE_SLOT:
    '남은 시간과 이동을 고려하면 넣을 자리가 없었어요. 시각 고정을 풀거나 일정을 줄여 보세요.',
  UNKNOWN: '넣지 못했어요. 사유를 확인하지 못했습니다.',
} as const;

/** 소요시간 표기 — 단어 「시간」이 아니라 숫자+단위다. 서버 문구의 「남은 시간과」는 정당하다(02a ★5). */
const DURATION_TEXT = /\d+\s*(분|시간)|소요/;
/** US-SCHED-04 제안 버튼 문구 — 결정 2 로 이 칸엔 없다(서버 문구에 안 걸림 실측, 02a ★6). */
const SUGGESTION_TEXT = /다른 날짜|시각 고정 해제|인접 조정/;

const itemId = (poiId: string): string => `${ROOT}-${poiId}`;

function itemIds(): string[] {
  return within(screen.getByTestId(ROOT))
    .queryAllByTestId(ITEM_PREFIX)
    .map((node) => String(node.props.testID));
}

describe('N1 · AC-7 — 행이 0건이면 아무것도 그리지 않는다', () => {
  it('rows=[] → 블록 없음, 렌더 결과 null', () => {
    const view = render(<UnplacedMustVisitNotice rows={[]} />);

    expect(screen.queryByTestId(ROOT)).toBeNull();
    expect(view.toJSON()).toBeNull();
  });
});

describe('N2 · AC-1·AC-2 — 제목 한 줄 + 항목마다 이름과 서버 문구', () => {
  it('항목 2개가 입력 순서로 서고, 각 항목 글자는 이름+문구뿐이다', () => {
    // 준비
    const rows: UnplacedMustVisitRow[] = [
      { poiId: 'poi-1', name: '성산일출봉', message: MSG.NO_FEASIBLE_SLOT },
      { poiId: 'poi-2', name: '우도', message: MSG.WINDOW_CONFLICT },
    ];

    // 실행
    render(<UnplacedMustVisitNotice rows={rows} />);

    // 단언 — 블록 하나, 제목 Text 정확히 하나(개수 표기 없는 한 줄 · Q2).
    const root = screen.getByTestId(ROOT);
    expect(within(root).getAllByText(TITLE)).toHaveLength(1);
    expect(itemIds()).toEqual([itemId('poi-1'), itemId('poi-2')]);

    // 이름·문구는 각자 자기 Text 로 완전 일치 — 문구 앞뒤에 글자를 붙이면 못 찾는다.
    const first = screen.getByTestId(itemId('poi-1'));
    expect(within(first).getByText('성산일출봉')).toBeOnTheScreen();
    expect(within(first).getByText(MSG.NO_FEASIBLE_SLOT)).toBeOnTheScreen();
    expect(first).toHaveTextContent(`성산일출봉${MSG.NO_FEASIBLE_SLOT}`);

    const second = screen.getByTestId(itemId('poi-2'));
    expect(within(second).getByText('우도')).toBeOnTheScreen();
    expect(within(second).getByText(MSG.WINDOW_CONFLICT)).toBeOnTheScreen();
    expect(second).toHaveTextContent(`우도${MSG.WINDOW_CONFLICT}`);
  });
});

describe('N3 · AC-3 — 이름이 없으면 이름 자리 없이 서버 문구만 (대체 이름 0 · INV-4)', () => {
  it('name=null 항목의 글자는 문구와 완전히 같고, 대체 이름은 화면 어디에도 없다', () => {
    const rows: UnplacedMustVisitRow[] = [
      { poiId: 'poi-1', name: null, message: MSG.NO_FEASIBLE_SLOT },
      { poiId: 'poi-2', name: '우도', message: MSG.WINDOW_CONFLICT },
    ];

    render(<UnplacedMustVisitNotice rows={rows} />);

    // 항목은 빠지지 않는다.
    expect(itemIds()).toEqual([itemId('poi-1'), itemId('poi-2')]);
    // 완전 일치 — 이름 Text·대체 이름·빈 자리 표시 글자가 하나라도 있으면 실패한다(02a ★1).
    expect(screen.getByTestId(itemId('poi-1'))).toHaveTextContent(
      MSG.NO_FEASIBLE_SLOT
    );
    expect(screen.queryByText('이름을 불러오지 못한 곳')).toBeNull();
    expect(screen.queryByText('알 수 없는 장소')).toBeNull();
  });
});

describe('N4 · AC-5 — 블록 안에 누를 수 있는 요소가 0개다 (결정 2)', () => {
  it('onPress·onLongPress 를 가진 노드 0 · 버튼 역할 0 · 제안 문구 0', () => {
    render(
      <UnplacedMustVisitNotice
        rows={[
          { poiId: 'poi-1', name: null, message: MSG.NO_FEASIBLE_SLOT },
          { poiId: 'poi-2', name: '우도', message: MSG.WINDOW_CONFLICT },
        ]}
      />
    );

    const root = screen.getByTestId(ROOT);
    // 역할 표시 없는 Pressable 은 role 검사로 안 잡힌다(02a ★4 실측) — 합성 노드까지 prop 으로 전수 훑는다.
    const pressables = root.findAll(
      (node) =>
        typeof node.props.onPress === 'function' ||
        typeof node.props.onLongPress === 'function'
    );
    expect(pressables).toHaveLength(0);
    expect(within(root).queryAllByRole('button')).toHaveLength(0);
    expect(within(root).queryAllByText(SUGGESTION_TEXT)).toHaveLength(0);
  });
});

describe('N5 · AC-8·AC-9 — 블록의 글자는 제목 + 서버가 준 것뿐이다 (문구 무발명)', () => {
  it('사유 4종(목록 밖 코드용 UNKNOWN 문구 포함)에서 루트 글자 = 제목 + Σ(이름 + 문구)', () => {
    const rows: UnplacedMustVisitRow[] = [
      { poiId: 'poi-1', name: '성산일출봉', message: MSG.OUT_OF_RANGE },
      { poiId: 'poi-2', name: null, message: MSG.WINDOW_CONFLICT },
      { poiId: 'poi-3', name: '한라산', message: MSG.NO_FEASIBLE_SLOT },
      { poiId: 'poi-4', name: null, message: MSG.UNKNOWN },
    ];

    render(<UnplacedMustVisitNotice rows={rows} />);

    // 완전 일치 — 클라가 만든 사유 문장·개수·구분 글자가 끼면 실패한다.
    const expected =
      TITLE + rows.map((row) => `${row.name ?? ''}${row.message}`).join('');
    expect(screen.getByTestId(ROOT)).toHaveTextContent(expected);
    expect(itemIds()).toHaveLength(4);
  });
});

describe('N6 · AC-11 — 블록에 소요시간 표기가 없다 (INV-3)', () => {
  it('서버 문구 4종을 그려도 숫자+분/시간·「소요」가 0건이다', () => {
    render(
      <UnplacedMustVisitNotice
        rows={Object.values(MSG).map((message, index) => ({
          poiId: `poi-${index}`,
          name: index % 2 === 0 ? `장소-${index}` : null,
          message,
        }))}
      />
    );

    const root = screen.getByTestId(ROOT);
    // 긍정 짝 — 블록에 글자가 있다(빈 블록에서 "0건"이 공짜로 통과하지 않게).
    expect(root).toHaveTextContent(/\S/);
    expect(within(root).queryAllByText(DURATION_TEXT)).toHaveLength(0);
    expect(root).not.toHaveTextContent(DURATION_TEXT);
  });
});
