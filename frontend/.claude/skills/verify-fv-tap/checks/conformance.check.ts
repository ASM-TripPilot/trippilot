/**
 * verify-fv-tap 적합성 검사 — TLA+ 모델(TapGuard.tla 「CODE MIRROR」 GuardAllows · 모듈 전역 openedAt 하나)이
 * 실제 `shared/lib/pressGuard.ts` 와 같은 판정을 하는지 fast-check 생성 입력으로 대조한다. 손으로 쓴 함수 모형이
 * 아니라 **실제 guardPress·openPressGuardWindow** 를 `Date.now` 만 바꿔 가며 돌린다.
 *
 * 대조하는 것:
 *  - 창 안(0 ≤ 경과 < 400ms) 누름은 무시, 밖이면 창을 열고 핸들러를 부른다(GuardAllows).
 *  - 무시된 누름은 창을 늘리지 않는다(모델: 창 안 누름은 스터터 — openedAt 불변).
 *  - 시계가 뒤로 가면(경과 < 0) 창 밖이다.
 *  - 창은 감싼 함수마다가 아니라 모듈에 하나다 — 서로 다른 두 버튼이 같은 openedAt 을 본다(모델 변수 하나).
 *  - openPressGuardWindow() 는 누름 없이 창을 연다(모델 RespondOk 의 openOnOk).
 *
 * 이 파일이 red 면 "코드가 모델과 달라졌다"는 뜻이다 — 앱 결함이 아니다. TapGuard.tla 의 GuardAllows 와
 * 아래 modelGuardAllows 를 코드에 맞게 함께 고친 뒤 TLC 를 다시 돌려야 속성 결과가 다시 유효하다.
 */
import fc from 'fast-check';

import {
  guardPress,
  openPressGuardWindow,
  resetPressGuard,
} from '@/shared/lib/pressGuard';

// ── 모델 식(TapGuard.tla CODE MIRROR 의 TS 옮김 — 둘은 같이 고친다) ─────────────────────
const WINDOW = 400; // Window = 4 틱 × 100ms
function modelGuardAllows(now: number, openedAt: number): boolean {
  return !(now - openedAt >= 0 && now - openedAt < WINDOW);
}

type Ev =
  | { kind: 'tap'; button: 'A' | 'B'; dt: number }
  | { kind: 'open'; dt: number };

// 시각 간격: 대부분 앞으로(같은 틱 0 포함), 가끔 뒤로(기기 시계 되감김).
const dtArb = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 600 }) },
  { weight: 1, arbitrary: fc.integer({ min: -900, max: -1 }) },
  { weight: 1, arbitrary: fc.constantFrom(0, 399, 400, 401) }
);
const evArb: fc.Arbitrary<Ev> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('tap' as const), button: fc.constantFrom('A' as const, 'B' as const), dt: dtArb }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('open' as const), dt: dtArb }) }
);

describe('verify-fv-tap 적합성 — guardPress == 모델 GuardAllows', () => {
  let clock: jest.SpyInstance;
  let now = 0;
  beforeEach(() => {
    now = 1_790_000_000_000;
    clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    resetPressGuard();
  });
  afterEach(() => clock.mockRestore());

  it('생성한 누름·창 열기 순서마다 핸들러 호출 여부가 모델과 같다', () => {
    fc.assert(
      fc.property(fc.array(evArb, { minLength: 1, maxLength: 25 }), (events) => {
        resetPressGuard();
        let openedAt = -Infinity; // 모델 openedAt(NegInf)
        const fired: string[] = [];
        const expected: string[] = [];
        // 버튼 둘 — 각자 따로 guardPress 로 감싼다(화면이 매 렌더 새로 감싸는 것과 같다).
        const A = guardPress(() => fired.push('A'));
        const B = guardPress((tag: string) => fired.push(tag));
        events.forEach((ev, i) => {
          now += ev.dt;
          if (ev.kind === 'open') {
            openPressGuardWindow();
            openedAt = now;
            return;
          }
          if (modelGuardAllows(now, openedAt)) {
            openedAt = now;
            expected.push(`${ev.button}`);
          }
          if (ev.button === 'A') A();
          else B('B');
          if (fired.length !== expected.length) {
            throw new Error(`사건 ${i}(${ev.kind} ${ev.button} dt=${ev.dt}) 에서 갈림 — 실제 ${fired.join('')} / 모델 ${expected.join('')}`);
          }
        });
        expect(fired).toEqual(expected);
      }),
      { numRuns: 300 }
    );
  });

  it('틱(100ms) 격자 위에서도 같다 — TLC 의 Window=4 판정이 400ms 판정과 같은 값을 낸다', () => {
    fc.assert(
      fc.property(fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 }), (nowT, openT) => {
        const tick = !(nowT - openT >= 0 && nowT - openT < 4);
        expect(modelGuardAllows(nowT * 100, openT * 100)).toBe(tick);
      }),
      { numRuns: 200 }
    );
  });
});
