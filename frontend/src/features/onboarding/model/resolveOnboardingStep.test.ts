import fc from 'fast-check';

import {
  resolveOnboardingStep,
  type OnboardingProgress,
  type OnboardingStep,
} from './resolveOnboardingStep';

/**
 * 온보딩 남은 첫 단계 계산 (BR-U0-26 '온보딩 잔여' · frontend-components §7 PBT · TRIP-1421 AC14).
 *
 * 무엇을 보장하나: 서버에서 읽은 "약관 / 닉네임 / 취향 저장" 세 사실만 보고 **다음에 보여줄 단계 하나**를
 * 정한다. 결과에 홈은 없다 — 온보딩 그룹 안에 있다는 것 자체가 서버 기준 미완이라, 다 끝난 것처럼 보여도
 * 완료를 다시 시도하는 취향 2/2(pref2)로 보낸다(`'/'`는 온보딩 그룹으로 되풀려 막다른 화면이 된다).
 *
 * 왜 PBT(속성 기반 테스트)인가: 예제 테스트는 "내가 떠올린 입력"만 확인한다. fast-check 는
 * 입력을 수백 번 자동 생성해 "모든 입력에서 성립해야 하는 성질"을 깨는 반례를 찾아 준다.
 */

const STEPS: OnboardingStep[] = ['terms', 'nickname', 'location', 'pref2'];

const progressArb: fc.Arbitrary<OnboardingProgress> = fc.record({
  termsCompleted: fc.boolean(),
  nicknameCompleted: fc.boolean(),
  preferencesSaved: fc.boolean(),
});

/** 정답 표(오라클) — 약관 > 닉네임 > 취향 순으로 첫 미완 단계. 다 됐으면 완료 재시도(pref2). */
function expectedStep(progress: OnboardingProgress): OnboardingStep {
  if (!progress.termsCompleted) return 'terms';
  if (!progress.nicknameCompleted) return 'nickname';
  return progress.preferencesSaved ? 'pref2' : 'location';
}

describe('resolveOnboardingStep — 전수 매핑 (AC14)', () => {
  // 정의역이 8개뿐이라 전수로 잠근다. 한 it 에 묶는 이유: 조합을 it 으로 쪼개면 우연히 맞는 조합이
  // green 으로 남아 "일부 통과"가 완료로 오독된다.
  it('약관·닉네임·취향 8개 조합이 각각 유일한 단계로 매핑된다', () => {
    const table: [boolean, boolean, boolean, OnboardingStep][] = [
      [false, false, false, 'terms'],
      [false, false, true, 'terms'],
      [false, true, false, 'terms'],
      [false, true, true, 'terms'],
      [true, false, false, 'nickname'],
      [true, false, true, 'nickname'],
      [true, true, false, 'location'],
      [true, true, true, 'pref2'],
    ];

    for (const [
      termsCompleted,
      nicknameCompleted,
      preferencesSaved,
      step,
    ] of table) {
      expect(
        resolveOnboardingStep({
          termsCompleted,
          nicknameCompleted,
          preferencesSaved,
        })
      ).toBe(step);
    }
  });
});

describe('resolveOnboardingStep — 성질/PBT (AC14 · frontend-components §7)', () => {
  it('임의 입력에서 늘 4단계 중 하나이고, 홈(done·/)은 결코 나오지 않는다', () => {
    fc.assert(
      fc.property(progressArb, (progress) => {
        const step = resolveOnboardingStep(progress);

        expect(STEPS).toContain(step);
        // 그룹 안에서 '/'로 보내면 온보딩 index 로 되풀리는 루프가 된다(브리프 맹점 ①).
        expect(step).not.toBe('done');
        expect(step).not.toBe('/');
      }),
      { numRuns: 500 }
    );
  });

  it('약관이 미완이면 닉네임·취향과 무관하게 늘 terms 다', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (nickname, preferences) => {
        expect(
          resolveOnboardingStep({
            termsCompleted: false,
            nicknameCompleted: nickname,
            preferencesSaved: preferences,
          })
        ).toBe('terms');
      }),
      { numRuns: 300 }
    );
  });

  it('약관이 끝났고 닉네임이 미완이면 취향과 무관하게 늘 nickname 이다', () => {
    fc.assert(
      fc.property(fc.boolean(), (preferences) => {
        expect(
          resolveOnboardingStep({
            termsCompleted: true,
            nicknameCompleted: false,
            preferencesSaved: preferences,
          })
        ).toBe('nickname');
      }),
      { numRuns: 300 }
    );
  });

  it('같은 입력에 늘 같은 출력을 내고, 그 값은 정답 표와 같다', () => {
    fc.assert(
      fc.property(progressArb, (progress) => {
        const first = resolveOnboardingStep(progress);

        expect(resolveOnboardingStep(progress)).toBe(first);
        expect(first).toBe(expectedStep(progress));
      }),
      { numRuns: 500 }
    );
  });
});
