import fc from 'fast-check';

import {
  resolveOnboardingStep,
  type OnboardingProgress,
  type OnboardingStep,
} from './resolveOnboardingStep';

/**
 * AC C1 · C2 · C3 — 온보딩 잔여 단계 계산 (BR-U0-26 '온보딩 잔여').
 *
 * 무엇을 보장하나: 부트스트랩이 알려준 "약관/닉네임 완료 여부"만 보고 **다음에 보여줄 단계 하나**를
 * 결정한다. 순수 함수라 화면·네트워크 없이 검증되고, 조합이 4개뿐이라 전수 + 성질 양쪽으로 잠근다.
 *
 * 왜 PBT(속성 기반 테스트)인가: 예제 테스트는 "내가 떠올린 입력"만 확인한다. fast-check 는
 * 입력을 수백 번 자동 생성해 "모든 입력에서 성립해야 하는 성질"을 깨는 반례를 찾아 준다.
 * 분기 우선순위(약관 > 닉네임)는 조합이 늘어날수록 실수가 나는 자리라 성질로 고정한다.
 */

const STEPS: OnboardingStep[] = ['terms', 'nickname', 'done'];

const progressArb: fc.Arbitrary<OnboardingProgress> = fc.record({
  termsCompleted: fc.boolean(),
  nicknameCompleted: fc.boolean(),
});

describe('resolveOnboardingStep — 전수 매핑 (AC C1·C2·C3)', () => {
  // 정의역이 4개뿐이라 전수로 잠근다. 한 it 안에 네 조합을 모두 두는 이유:
  // 조합을 it 으로 쪼개면 스텁이 우연히 맞히는 조합 하나가 green 으로 남아
  // "일부 통과"가 구현 완료로 오독될 수 있다(가짜 통과 방지).
  it('약관·닉네임 완료 여부 4개 조합이 각각 유일한 잔여 단계로 매핑된다', () => {
    expect(
      resolveOnboardingStep({ termsCompleted: false, nicknameCompleted: false })
    ).toBe('terms');
    expect(
      resolveOnboardingStep({ termsCompleted: false, nicknameCompleted: true })
    ).toBe('terms');
    expect(
      resolveOnboardingStep({ termsCompleted: true, nicknameCompleted: false })
    ).toBe('nickname');
    expect(
      resolveOnboardingStep({ termsCompleted: true, nicknameCompleted: true })
    ).toBe('done');
  });
});

describe('resolveOnboardingStep — 성질/PBT (AC C1)', () => {
  it('임의 입력에 대해 항상 3개 단계 중 하나를 반환하고, 남은 단계가 있으면 done 을 반환하지 않는다', () => {
    fc.assert(
      fc.property(progressArb, (progress) => {
        const step = resolveOnboardingStep(progress);

        expect(STEPS).toContain(step);

        // 아직 끝나지 않은 단계가 하나라도 있으면 '끝났다'고 말해선 안 된다.
        // 이 성질이 깨지면 사용자가 약관·닉네임을 건너뛰고 홈에 도달한다.
        const allDone = progress.termsCompleted && progress.nicknameCompleted;
        if (!allDone) {
          expect(step).not.toBe('done');
        }
      }),
      { numRuns: 500 }
    );
  });

  it('약관이 미완료이면 닉네임 상태와 무관하게 항상 terms 다 (약관 > 닉네임 우선순위 · AC C2)', () => {
    fc.assert(
      fc.property(fc.boolean(), (nicknameCompleted) => {
        expect(
          resolveOnboardingStep({ termsCompleted: false, nicknameCompleted })
        ).toBe('terms');
      }),
      { numRuns: 200 }
    );
  });

  it('약관이 끝났으면 terms 를 다시 보여주지 않는다 — 닉네임만 남으면 nickname (AC C3)', () => {
    fc.assert(
      fc.property(progressArb, (progress) => {
        const completedTerms = { ...progress, termsCompleted: true };
        const step = resolveOnboardingStep(completedTerms);

        // 이미 동의한 약관을 다시 요구하면 재진입 사용자가 같은 화면에 갇힌다.
        expect(step).not.toBe('terms');
        expect(step).toBe(
          completedTerms.nicknameCompleted ? 'done' : 'nickname'
        );
      }),
      { numRuns: 500 }
    );
  });

  it('같은 입력에 항상 같은 출력을 낸다 (결정적 — 부수효과·시간 의존 없음)', () => {
    fc.assert(
      fc.property(progressArb, (progress) => {
        const first = resolveOnboardingStep(progress);
        const second = resolveOnboardingStep(progress);

        expect(second).toBe(first);
        // 결정적이기만 하고 값이 틀리면 의미가 없으므로 정답도 함께 고정한다.
        expect(first).toBe(
          !progress.termsCompleted
            ? 'terms'
            : progress.nicknameCompleted
              ? 'done'
              : 'nickname'
        );
      }),
      { numRuns: 500 }
    );
  });
});
