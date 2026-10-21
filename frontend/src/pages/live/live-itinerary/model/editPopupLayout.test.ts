import fc from 'fast-check';

import { editPopupPlacement } from './editPopupLayout';

/**
 * 수정 팝업(AI에게 맡기기 위 · 직접 수정 아래)을 어디에 붙일지 정하는 순수 함수. 바는 앱 하단 탭 바와 같은 자리(좌우 30 · 바닥 12 · 안전영역 미가산)라
 * 입력에 안전영역이 없다. 값은 Figma 리터럴로, 성질은 구조(경계·상수·선형성)로만 단언한다 — 구현과 같은 수식을 베낀 오라클은 둘이 같이 틀리면 통과했다.
 */

describe('editPopupPlacement', () => {
  it('폭 390·팝업 139 → left 128(중심 = 수정 칸 중심 197.5, Figma B) · bottom 78(= 바 윗변 70 + 8)이고, 아랫변은 화면 폭과 무관한 상수다', () => {
    const { left, bottom } = editPopupPlacement({
      windowWidth: 390,
      popupWidth: 139,
    });

    expect(left).toBe(128);
    expect(left + 139 / 2).toBe(197.5);
    expect(bottom).toBe(78);
    for (const windowWidth of [320, 430])
      expect(editPopupPlacement({ windowWidth, popupWidth: 139 }).bottom).toBe(
        78
      );
  });

  it('좌우 30 안으로 클램프된다 — 폭 390·팝업 330 은 중심 정렬이면 오른쪽 끝이 362.5 로 삐져나오므로 left 30 에 붙는다', () => {
    const { left } = editPopupPlacement({ windowWidth: 390, popupWidth: 330 });

    expect(left).toBe(30);
    expect(left + 330).toBe(390 - 30);
  });

  it('선형성 — 클램프가 안 걸리는 좁은 팝업(≤150)이면 화면이 1 넓어질 때 중심이 정확히 0.375 오른쪽으로 간다 (둘째 칸 = 4칸 캡슐의 1.5/4)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 320, max: 429 }),
        fc.integer({ min: 100, max: 150 }),
        (windowWidth, popupWidth) => {
          const narrow = editPopupPlacement({ windowWidth, popupWidth });
          const wide = editPopupPlacement({
            windowWidth: windowWidth + 1,
            popupWidth,
          });

          expect(wide.left - narrow.left).toBeCloseTo(0.375, 9);
        }
      ),
      { numRuns: 100 }
    );
  });
});
