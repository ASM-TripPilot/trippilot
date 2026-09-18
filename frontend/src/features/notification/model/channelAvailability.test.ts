import fc from 'fast-check';

import { type PushPermission, resolvePushColumn } from './channelAvailability';

/**
 * TRIP-607 · l02 알림 설정 · PBT-U6-F2(CI 차단 게이트) — resolvePushColumn: OS 권한 × 토글 조합
 * → 푸시 열 가용성. 순수 함수라 화면·서버 없이 값만 검사한다.
 *
 * 무엇을 보장하나:
 *  - **핵심 불변식(PBT-U6-F2)**: OS 권한이 `DENIED` 면 **어떤 토글 조합에서도** 푸시 열이 활성으로
 *    그려지지 않는다 — `available===false` 이고 모든 `cellsOn` 이 false. 한 행이라도 pushEnabled 가
 *    true 여도(그리고 어떤 inAppEnabled 조합이어도) 이 판정을 넘보지 못한다(anti-patterns L99:
 *    조합 케이스 누락 금지 — 생성기가 DENIED×pushEnabled=true 조합을 실제로 훑는다).
 *  - **양의 방향**: 권한이 `GRANTED` 면 열이 활성이고, 각 푸시 셀 ON 이 그 행 pushEnabled 를 정확히
 *    반영한다(끄기를 삼키지 않는다).
 *  - **인앱 무간섭**: `inAppEnabled` 는 입력에 있으나 푸시 판정에 영향을 주지 않는다(조합 실검증으로
 *    확인 — buggy `||toggles.some(pushEnabled)` 구현은 이 생성기에 1테스트 만에 red, 02a §5-C).
 *
 * 커버하지 않는 것:
 *  - 픽셀상 실제 회색·thumb 위치·실차단(jest 원리적 사각 → 6-b 실기). 여기선 반환값만 기계 강제.
 *  - 인앱 열 가용성(권한 무관 항상 조작 가능 → 이 함수의 관심 밖, 화면 테스트가 잠근다).
 *
 * PBT 근거: `tripBuckets.test.ts`(fast-check@^4) 동형. `fc.constantFrom(...리터럴)` 은
 * `Arbitrary<유니온>` 이라 PushPermission 으로 그대로 쓰인다(02a §5-C).
 */

/** 임의의 권한 — 세 상태 전부(GRANTED·DENIED·UNDETERMINED). */
const permissionArb: fc.Arbitrary<PushPermission> = fc.constantFrom(
  'GRANTED',
  'DENIED',
  'UNDETERMINED'
);

/** 임의의 토글 6~7행 — push·inApp 을 독립적으로 흔들어 조합 공간을 훑는다(실물은 6행, 서버는 7종). */
const togglesArb = fc.array(
  fc.record({ pushEnabled: fc.boolean(), inAppEnabled: fc.boolean() }),
  { minLength: 6, maxLength: 7 }
);

describe('PBT-U6-F2 · resolvePushColumn — DENIED 면 어떤 조합에서도 푸시 열 미활성 (CI 차단 게이트)', () => {
  it('권한 DENIED 이면 available=false 이고 모든 푸시 셀이 OFF 다 (∀ 토글 조합)', () => {
    fc.assert(
      fc.property(togglesArb, (toggles) => {
        const { available, cellsOn } = resolvePushColumn('DENIED', toggles);

        // 열 전체가 조작 불가.
        expect(available).toBe(false);
        // 한 행도 ON 으로 새지 않는다 — pushEnabled=true 행이 섞여 있어도.
        expect(cellsOn).toHaveLength(toggles.length);
        expect(cellsOn.every((on) => on === false)).toBe(true);
      })
    );
  });

  it('권한이 없으면(DENIED·UNDETERMINED) 열은 절대 활성이 아니다', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<PushPermission>('DENIED', 'UNDETERMINED'),
        togglesArb,
        (permission, toggles) => {
          const { available, cellsOn } = resolvePushColumn(permission, toggles);
          expect(available).toBe(false);
          expect(cellsOn.some((on) => on === true)).toBe(false);
        }
      )
    );
  });
});

describe('resolvePushColumn — GRANTED 면 열이 활성이고 셀 ON 이 설정을 반영한다', () => {
  it('권한 GRANTED 이면 available=true 이고 각 셀 ON 이 그 행 pushEnabled 와 정확히 같다', () => {
    fc.assert(
      fc.property(togglesArb, (toggles) => {
        const { available, cellsOn } = resolvePushColumn('GRANTED', toggles);

        expect(available).toBe(true);
        // 끄기를 삼키지 않는다 — 셀 ON 이 pushEnabled 를 그대로 반영.
        expect(cellsOn).toEqual(toggles.map((t) => t.pushEnabled));
      })
    );
  });

  it('인앱 값은 푸시 셀 ON 에 영향을 주지 않는다 (같은 push 설정이면 inApp 을 뒤집어도 동일)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 6, maxLength: 7 }),
        (pushes) => {
          const withInAppOn = pushes.map((pushEnabled) => ({
            pushEnabled,
            inAppEnabled: true,
          }));
          const withInAppOff = pushes.map((pushEnabled) => ({
            pushEnabled,
            inAppEnabled: false,
          }));

          // inApp 만 다른 두 입력의 푸시 셀 ON 은 완전히 같다(인앱이 푸시 판정을 넘보지 않는다).
          expect(resolvePushColumn('GRANTED', withInAppOn).cellsOn).toEqual(
            resolvePushColumn('GRANTED', withInAppOff).cellsOn
          );
        }
      )
    );
  });
});

describe('resolvePushColumn — 경계: 빈 목록', () => {
  it('토글이 없으면 어떤 권한이든 cellsOn 은 빈 배열이다', () => {
    (['GRANTED', 'DENIED', 'UNDETERMINED'] as PushPermission[]).forEach(
      (permission) => {
        expect(resolvePushColumn(permission, []).cellsOn).toEqual([]);
      }
    );
  });
});
