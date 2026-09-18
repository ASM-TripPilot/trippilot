import { fireEvent, render, screen } from '@testing-library/react-native';

import { VisitTimeSheet } from './VisitTimeSheet';

/**
 * TRIP-613 · j01 · AC-1(UI 반)·AC-2·AC-3·AC-4·AC-7 — 방문 시각 편집 시트의 **폼 계약**.
 *
 * 시트는 현재 도착·완료 시각을 시·분 셀로 시드해 보이고, 각각 바꿀 수 있게 하며, [저장]에서
 * `adjustTimesDraft(합성값, now)`로 클라 선검증 후 **위반이면 인라인 오류 + onSave 미호출**,
 * 통과면 **바뀐 필드만** `onSave`한다(서버 재검증이 최종 — INV-2).
 *
 * *(개념)* **왜 셀을 눌러 시각을 고르나** — 이 리포엔 휠(스크롤-스냅) 시각 피커 라이브러리가 있으나
 *   (`shared/ui/WheelPicker`), 바텀시트 안에 넣으면 `enableContentPanningGesture` 회귀가 재발한다
 *   (repo-traps TRIP-599). 그래서 SlotTimeSheet 처럼 시·분을 **값별 셀**로 두고 press 로 고른다.
 * *(개념)* **`@gorhom/bottom-sheet` 수동 목은 children 을 무조건 렌더**한다(통과 컴포넌트) — 시트를
 *   직접 마운트하면 **항상 열린 상태**다. 딤·개폐·터치차단은 여기서 못 잰다(6-b 실기 전용, 02a ★1).
 * *(개념)* **`fireEvent.press` 는 disabled 를 안 막는다**(pointerEvents 만, 02a ★2·§5-B) → AC-3 은
 *   상태 단언(`toBeDisabled`)으로, AC-2/4 "요청 안 나감"은 **onSave 미호출**로 성립.
 *
 * 3동작 뼈대: 준비=현재 시각+now 로 렌더 → 실행=셀/버튼 press → 단언=선택 셀·인라인 오류·콜백 인자.
 */

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 렌더된 문자열 전부 — INV-3 부정 스캔의 모집단(SlotTimeSheet CS6 헬퍼 이식). */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

const onSave = jest.fn();
const onCancel = jest.fn();

function renderSheet(
  over: Partial<React.ComponentProps<typeof VisitTimeSheet>> = {}
) {
  return render(
    <VisitTimeSheet
      visitCheckId="v1"
      arrivedAt="2026-08-31T14:20:00"
      completedAt="2026-08-31T15:00:00"
      now="2026-08-31T20:00:00"
      onSave={onSave}
      onCancel={onCancel}
      {...over}
    />
  );
}

beforeEach(() => {
  onSave.mockClear();
  onCancel.mockClear();
});

describe('🔴 S1 · 시트 골격 — 루트·저장·셀 트리·시드', () => {
  it('sheet/save 루트가 뜨고, 도착·완료가 각 셀 선택으로 시드된다', () => {
    renderSheet();

    expect(
      screen.getByTestId('record-trip-visit-time-sheet')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('record-trip-visit-time-save')).toBeOnTheScreen();

    // 도착 14:20 · 완료 15:00 가 독립 값으로 시드(분 granularity 유지).
    expect(
      screen.getByTestId('record-trip-visit-time-arrived-h-14')
    ).toBeSelected();
    expect(
      screen.getByTestId('record-trip-visit-time-arrived-m-20')
    ).toBeSelected();
    expect(
      screen.getByTestId('record-trip-visit-time-completed-h-15')
    ).toBeSelected();
    expect(
      screen.getByTestId('record-trip-visit-time-completed-m-00')
    ).toBeSelected();

    // 짝(부정) — 시드 안 된 값은 선택되지 않는다(전 셀이 트리에 실재하되 선택은 시드값만).
    expect(
      screen.getByTestId('record-trip-visit-time-arrived-h-13')
    ).not.toBeSelected();
  });
});

describe('🔴 S6 · AC-1(UI) — 도착만 바꿔 저장 → onSave 는 바뀐 필드만', () => {
  it('도착 시 13 press → onSave({arrivedAt:"2026-08-31T13:20:00"}) 1회, completedAt 키 없음', () => {
    renderSheet();

    // 도착 '시'만 13 으로(도착 분 20·완료 15:00 은 안 건드린다).
    fireEvent.press(screen.getByTestId('record-trip-visit-time-arrived-h-13'));
    fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

    // 날짜 보존·초 :00·분 유지. completedAt 은 안 바꿔서 diff 에 안 실린다(안 보내면 유지 = AC-1).
    // toHaveBeenCalledWith 는 깊은 동등이라 completedAt 키가 섞이면 red.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ arrivedAt: '2026-08-31T13:20:00' });
    expect(onCancel).not.toHaveBeenCalled();
    // 인라인 오류는 뜨지 않는다(정상 저장).
    expect(screen.queryByTestId('record-trip-visit-time-error')).toBeNull();
  });
});

describe('🔴 S2 · AC-2 · BR-U5-05 — completedAt < arrivedAt → 인라인 오류 + onSave 0회', () => {
  it('완료 시를 13 으로(도착 14:00 보다 앞) → 오류 뜨고 요청 안 나감', () => {
    renderSheet({
      arrivedAt: '2026-08-31T14:00:00',
      completedAt: '2026-08-31T15:00:00',
    });

    // 완료 '시'를 13 으로 → 완료 13:00 < 도착 14:00(순서 위반).
    fireEvent.press(
      screen.getByTestId('record-trip-visit-time-completed-h-13')
    );
    fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

    // 인라인 오류가 뜨고(UX), 요청(onSave)은 안 나간다 — 클라 선차단(서버 재검증이 최종).
    expect(
      screen.getByTestId('record-trip-visit-time-error')
    ).toBeOnTheScreen();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('🔴 S4 · AC-4 — 미래 시각(now 기준) → 인라인 오류 + onSave 0회', () => {
  it('도착 시를 23 으로(now 12:00 보다 미래) → 오류 뜨고 요청 안 나감', () => {
    renderSheet({
      arrivedAt: '2026-08-31T10:00:00',
      completedAt: null,
      now: '2026-08-31T12:00:00',
    });

    // 도착 '시'를 23 으로 → 도착 23:00 > now 12:00(미래).
    fireEvent.press(screen.getByTestId('record-trip-visit-time-arrived-h-23'));
    fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

    expect(
      screen.getByTestId('record-trip-visit-time-error')
    ).toBeOnTheScreen();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('🔴 S3 · AC-3 · BR-U5-05 — 도착 없는 방문은 완료 입력 비활성', () => {
  it('arrivedAt null → 완료 섹션 disabled / arrivedAt 있음 → 완료 섹션 활성', () => {
    // arrivedAt 없음 — 완료만 남길 수 없다(도착이 있어야 완료가 의미).
    const { rerender } = renderSheet({ arrivedAt: null, completedAt: null });
    expect(
      screen.getByTestId('record-trip-visit-time-completed')
    ).toBeDisabled();

    // 짝 — 도착이 있으면 완료 섹션은 활성(공허 통과 방지: 항상 disabled 면 red).
    rerender(
      <VisitTimeSheet
        visitCheckId="v1"
        arrivedAt="2026-08-31T14:20:00"
        completedAt="2026-08-31T15:00:00"
        now="2026-08-31T20:00:00"
        onSave={onSave}
        onCancel={onCancel}
      />
    );
    expect(
      screen.getByTestId('record-trip-visit-time-completed')
    ).not.toBeDisabled();
  });
});

describe('🔴 S5 · AC-7 · INV-3 — 시트 렌더 어디에도 소요시간 문자열이 없다', () => {
  it('시각 숫자는 보이는데 분·시간·소요 표기는 0건이다(분 셀은 "30" 이지 "30분" 아님)', () => {
    renderSheet();

    const texts = renderedTexts();
    // 긍정 앵커 — 시트가 실제로 시각을 그리고 있다.
    expect(texts.some((t) => t.includes('14'))).toBe(true);
    expect(texts.some((t) => t.includes('20'))).toBe(true);

    // 분 셀은 맨 숫자다(소스 가드가 못 보는 `${m}분` 동적 렌더까지 잡는 유일 심판, 02a §2·§4-7).
    expect(
      screen.getByTestId('record-trip-visit-time-arrived-m-30')
    ).toHaveTextContent('30');

    // 부정 — 소요시간 표기 0건.
    expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);
  });
});

describe('🔴 S7 · 취소 — onCancel 만, onSave 는 안 부른다', () => {
  it('취소 press → onCancel 1회, onSave 0회', () => {
    renderSheet();

    fireEvent.press(screen.getByTestId('record-trip-visit-time-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
