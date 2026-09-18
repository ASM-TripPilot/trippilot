import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ConflictVisitVM } from '../model/conflict';
import { ConflictSheet, type ConflictSheetProps } from './ConflictSheet';

/**
 * TRIP-568 · AC-3 (BR-U5-21·21a) — 충돌 해소 화면(ConflictSheet).
 *
 * 무엇을 보장하나:
 *  - 충돌은 **방문(레코드) 단위**로 `내 기기(오프라인)` vs `서버` **2열**을 보이고, 열마다 라디오 1개다
 *    (필드별이 아니라 버전 단위 선택, BR-U5-21a).
 *  - **미선택으로 시작**하고, `[선택한 버전으로 동기화]` 는 **모든 카드가 버전을 고르기 전까지 비활성**
 *    (침묵 승자 금지 — 무응답이 로컬을 조용히 승자로 만들 수 없게, 01b §1).
 *  - 선택은 **`accessibilityState.selected` 로 반영**한다(fill 색 아님 — 글리프 fill 은 jest 원리적
 *    사각이라 색으로 잠그면 "저장됐다는 거짓말"이 통과, repo-traps 글리프 함정).
 *  - 모두 고른 뒤 적용 press → 콜백이 **정확히 1회**, **방문별 선택 배열**로.
 *
 * 개념: **VM 주입** = 화면에 데이터를 만드는 훅 대신 완성된 뷰모델(view-model)을 prop 으로 넣어,
 *   네트워크 없이 렌더만 검사한다. `ConflictSheet` 는 전체화면 조건부 렌더 뷰다(바텀시트 아님 — 01b
 *   추가결정, Figma 1563:1842 가 딤·핸들 없는 전체화면 본문으로 그림).
 *   `toBeSelected()` = `accessibilityState.selected===true` 판독 · `toBeDisabled()` = real disabled
 *   prop(=`accessibilityState.disabled`) 판독(node_modules 실검증, 02a §5-A·§5-B).
 *
 * testID(정본 §8 기저 + per-instance `-{visitCheckId}` 접미 = 리포 관례 record-trip-visit-card-{id} 동형):
 *   카드 record-conflict-card-{v} · 라디오 record-conflict-choice-{local|server}-{v} · 적용 record-conflict-apply.
 *
 * 3동작 뼈대: 준비=충돌 VM 주입·렌더 → 실행=라디오/적용 press → 단언=selected·disabled·콜백.
 */

/** 충돌 카드 VM — rows 가 비교 행을 실어 카드마다 필드 세트가 유연하다(Figma 카드별 3필드). */
function conflict(
  visitCheckId: string,
  over: Partial<ConflictVisitVM> = {}
): ConflictVisitVM {
  return {
    visitCheckId,
    nameKo: `장소-${visitCheckId}`,
    rows: [
      { label: '방문 시각', local: '14:20 체크', server: '14:05 체크' },
      { label: '메모', local: '노을 최고', server: '-' },
      { label: '사진', local: '2장(대기)', server: '1장' },
    ],
    ...over,
  };
}

const CARD1 = conflict('v1', { nameKo: '광안리 해변' });
const CARD2 = conflict('v2', {
  nameKo: '부산시립미술관',
  rows: [
    { label: '방문 상태', local: '방문 완료', server: '방문 안 함' },
    { label: '메모', local: '-', server: '-' },
    { label: '사진', local: '0장', server: '0장' },
  ],
});

function renderSheet(over: Partial<ConflictSheetProps> = {}) {
  const onApply = jest.fn();
  const props: ConflictSheetProps = {
    conflicts: [CARD1, CARD2],
    onApply,
    ...over,
  };
  render(<ConflictSheet {...props} />);
  return { onApply };
}

describe('🔴 AC-3 · 방문 단위 2열·열당 라디오 1개 (BR-U5-21a)', () => {
  it('충돌 2건이면 카드 2장을 방문 단위로 그리고, 각 카드가 로컬/서버 라디오와 비교 행을 보인다', () => {
    renderSheet();

    // 카드가 방문마다 하나(동기화 충돌 2건).
    expect(screen.getAllByTestId(/^record-conflict-card-/)).toHaveLength(2);

    // 각 카드에 2열 라디오가 하나씩.
    expect(
      screen.getByTestId('record-conflict-choice-local-v1')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('record-conflict-choice-server-v1')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('record-conflict-choice-local-v2')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('record-conflict-choice-server-v2')
    ).toBeOnTheScreen();

    // 카드1 비교 행이 로컬·서버 값을 나란히 보인다(충돌 축 시각).
    expect(screen.getByText('14:20 체크')).toBeOnTheScreen();
    expect(screen.getByText('14:05 체크')).toBeOnTheScreen();
  });
});

describe('🔴 AC-3 · 미선택 시작 + 적용 비활성 (01b §1 · 침묵 승자 금지)', () => {
  it('처음엔 어느 라디오도 선택 안 됐고, 적용 버튼은 비활성이며 press 해도 콜백이 없다', () => {
    const { onApply } = renderSheet();

    // 네 라디오 모두 미선택(accessibilityState.selected===false, 색 아님).
    expect(
      screen.getByTestId('record-conflict-choice-local-v1')
    ).not.toBeSelected();
    expect(
      screen.getByTestId('record-conflict-choice-server-v1')
    ).not.toBeSelected();
    expect(
      screen.getByTestId('record-conflict-choice-local-v2')
    ).not.toBeSelected();
    expect(
      screen.getByTestId('record-conflict-choice-server-v2')
    ).not.toBeSelected();

    // 적용은 real disabled — 모두 고르기 전엔 못 누른다.
    const apply = screen.getByTestId('record-conflict-apply');
    expect(apply).toBeDisabled();

    // 비활성 press 는 콜백 미발화(짝).
    fireEvent.press(apply);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-3 · 선택은 accessibilityState.selected 로 반영 (★fill 색 아님)', () => {
  it('라디오 press 로 그 카드 그 열이 선택되고, 반대 열을 누르면 버전 단위로 전환된다', () => {
    renderSheet();

    // 실행 — 카드1 로컬 열 선택.
    fireEvent.press(screen.getByTestId('record-conflict-choice-local-v1'));

    // 단언 — 로컬만 선택(색이 아니라 접근성 상태로).
    expect(
      screen.getByTestId('record-conflict-choice-local-v1')
    ).toBeSelected();
    expect(
      screen.getByTestId('record-conflict-choice-server-v1')
    ).not.toBeSelected();

    // 실행2 — 같은 카드 서버 열 선택 → 버전 단위 전환.
    fireEvent.press(screen.getByTestId('record-conflict-choice-server-v1'));

    expect(
      screen.getByTestId('record-conflict-choice-local-v1')
    ).not.toBeSelected();
    expect(
      screen.getByTestId('record-conflict-choice-server-v1')
    ).toBeSelected();
  });
});

describe('🔴 AC-3 · 모두 고르면 일괄 적용 1회(방문별 선택 배열)', () => {
  it('두 카드를 각각 고르면 적용이 활성되고, press 시 콜백이 정확히 1회 방문별 선택으로 불린다', () => {
    const { onApply } = renderSheet();

    // 실행 — 카드1=로컬, 카드2=서버.
    fireEvent.press(screen.getByTestId('record-conflict-choice-local-v1'));
    fireEvent.press(screen.getByTestId('record-conflict-choice-server-v2'));

    // 모두 고른 뒤 적용이 활성.
    const apply = screen.getByTestId('record-conflict-apply');
    expect(apply).not.toBeDisabled();

    // 실행2 — 일괄 적용.
    fireEvent.press(apply);

    // 정확히 1회 + 방문별 선택 배열.
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toEqual([
      { visitCheckId: 'v1', choice: 'local' },
      { visitCheckId: 'v2', choice: 'server' },
    ]);
  });
});
