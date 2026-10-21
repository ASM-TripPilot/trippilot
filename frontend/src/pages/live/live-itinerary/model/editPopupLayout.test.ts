import fc from 'fast-check';

import {
  LIVE_BAR_BOTTOM_GAP,
  LIVE_BAR_HEIGHT,
  LIVE_BAR_SIDE,
  LIVE_BOTTOM_BAR_RESERVE,
  editPopupPlacement,
} from './editPopupLayout';

/**
 * TRIP-1522 v2 · AC-5 → 사이클 3 정정 — 수정 팝업(AI에게 맡기기 위 · 직접 수정 아래)을 어디에 붙일지 정하는 순수 함수.
 *
 * 사이클 3 에서 바가 앱 하단 탭 바와 같은 자리로 옮겨졌다: 좌우 **30**(폭 390 → 330) · pill 높이 58 · 바닥 12 · **하단 안전영역을
 * 더하지 않는다**(탭 바도 안 더한다). 그래서 함수 입력에서 안전영역이 사라졌다.
 *
 * 무엇을 보장하나:
 *  - Figma 고정값: 폭 390·팝업 139 → 팝업 중심 = **수정 칸 중심 197.5**(left = 128, Figma B 그대로 — 반올림 없음), 아랫변은
 *    화면 아래로부터 **78**(= 바 윗변 70 + 8, Figma 766 = 774 − 8).
 *  - 좌우 30 안으로 클램프(화면 가장자리로 안 삐져나온다).
 *  - 구조 성질(독립 오라클): 클램프가 안 걸리면 화면이 1 넓어질 때 팝업 중심이 정확히 0.375(= 둘째 칸이 4칸 캡슐의 1.5/4) 오른쪽으로 간다.
 *
 * ⚠️ 사이클 2 의 `cellCenter` 헬퍼는 구현과 **같은 수식**(16·58·8·10)을 따로 갖고 있어 둘이 같이 틀리면 통과했다 → 지웠다.
 *    값은 Figma 리터럴로, 성질은 구조(선형성·경계·상수)로만 단언한다.
 *
 * (개념) property test = 값 몇 개가 아니라 "임의의 입력에서도 늘 참인 관계"를 무작위로 많이 시험한다.
 * 3동작: 준비(화면 폭·팝업 폭) → 실행(함수 호출) → 단언(left·bottom 관계).
 */

describe('editPopupLayout · EL0 Figma 고정 치수 (사이클 3 · AC-1·2)', () => {
  it('좌우 30 · 바 높이 58 · 바닥 12 · 바 점유 70 — 옛 값(좌우 16)이면 red', () => {
    expect(LIVE_BAR_SIDE).toBe(30);
    expect(LIVE_BAR_HEIGHT).toBe(58);
    expect(LIVE_BAR_BOTTOM_GAP).toBe(12);
    expect(LIVE_BOTTOM_BAR_RESERVE).toBe(70);
  });
});

describe('editPopupPlacement · EL1 Figma 기준 예제 (AC-2)', () => {
  it('폭 390·팝업 139 → left 128(중심 197.5) · bottom 78(아랫변 766 = 바 윗변 774 − 8)', () => {
    const { left, bottom } = editPopupPlacement({
      windowWidth: 390,
      popupWidth: 139,
    });

    // Figma B 팝업 x=128 — 반올림 없이 딱 떨어진다(사이클 2 는 194 라 0.5 어긋났다).
    expect(left).toBe(128);
    expect(left + 139 / 2).toBe(197.5);
    expect(bottom).toBe(78);
  });

  it('아랫변은 화면 폭과 무관한 상수다 — 안전영역을 줄 자리가 없고(입력은 폭 둘뿐), 폭이 바뀌어도 78', () => {
    for (const windowWidth of [320, 390, 430]) {
      expect(editPopupPlacement({ windowWidth, popupWidth: 139 }).bottom).toBe(
        78
      );
    }
  });
});

describe('editPopupPlacement · EL2 좌우 30 클램프 (AC-2)', () => {
  it('폭 390·팝업 330 은 오른쪽 끝이 360 을 넘지 않게 left 가 30 에 붙는다', () => {
    const { left } = editPopupPlacement({ windowWidth: 390, popupWidth: 330 });

    // 순수 중심 정렬이면 197.5 + 165 = 362.5 > 360 → 30 으로 밀린다.
    expect(left).toBe(30);
    expect(left + 330).toBe(390 - 30);
  });
});

describe('editPopupPlacement · EL3 성질 (AC-2 · property)', () => {
  // 화면 폭 320~430, 팝업 폭은 100 ~ (화면 폭 − 60) 사이 비율.
  const inputs = fc
    .tuple(fc.integer({ min: 320, max: 430 }), fc.integer({ min: 0, max: 100 }))
    .map(([windowWidth, percent]) => ({
      windowWidth,
      popupWidth: 100 + Math.floor(((windowWidth - 60 - 100) * percent) / 100),
    }));

  it('① 항상 좌우 30 안 ② 아랫변은 78', () => {
    fc.assert(
      fc.property(inputs, (input) => {
        const { left, bottom } = editPopupPlacement(input);

        expect(left).toBeGreaterThanOrEqual(30);
        expect(left + input.popupWidth).toBeLessThanOrEqual(
          input.windowWidth - 30
        );
        expect(bottom).toBe(78);
      }),
      {
        numRuns: 200,
        // 클램프가 걸리는 경계와 Figma 기준을 확률에 맡기지 않고 박아 둔다(README PBT 규칙).
        examples: [
          [{ windowWidth: 390, popupWidth: 330 }],
          [{ windowWidth: 390, popupWidth: 139 }],
          [{ windowWidth: 320, popupWidth: 260 }],
        ],
      }
    );
  });

  it('③ 선형성 — 클램프가 안 걸리는 좁은 팝업(≤150)이면 화면이 1 넓어질 때 중심이 정확히 0.375 오른쪽으로 간다', () => {
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

          // 중심 = left + 폭/2 — 구조(4칸 캡슐의 둘째 칸)에서 나오는 독립 성질이라 구현 수식을 베끼지 않는다.
          expect(wide.left - narrow.left).toBeCloseTo(0.375, 9);
        }
      ),
      { numRuns: 100 }
    );
  });
});
