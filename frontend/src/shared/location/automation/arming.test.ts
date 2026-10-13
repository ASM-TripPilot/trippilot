import fc from 'fast-check';

import { resolveArming, type ArmingInput } from './arming';
import { AUTOMATION_CONFIG } from './config';

/**
 * TRIP-1332 · PBT-U10-F1 (BR-U10-02~07) — 무장 판정 resolveArming.
 *
 * 3동작 뼈대: 준비=권한·토글·구간·플래그·설명 이력 조합 → 실행=resolveArming → 단언=state/reason.
 * ARMED 는 저장 상태가 아니라 매번 다시 계산하는 판정이라(§3), 입력 하나가 거짓이 되는 "강등 입력"은
 * 곧 ARMED 가 아닌 결과다 — 같은 함수 성질로 잠근다.
 */

const permission = fc.constantFrom('granted', 'denied', 'undetermined');

const arbInput: fc.Arbitrary<ArmingInput> = fc.record({
  flagOn: fc.boolean(),
  serverEnabled: fc.boolean(),
  foreground: permission,
  background: permission,
  backgroundCanAskAgain: fc.boolean(),
  precise: fc.boolean(),
  consentOn: fc.boolean(),
  inTripWindow: fc.boolean(),
  onHub: fc.boolean(),
  explainerAsked: fc.boolean(),
});

const armedAll: ArmingInput = {
  flagOn: true,
  serverEnabled: true,
  foreground: 'granted',
  background: 'granted',
  backgroundCanAskAgain: true,
  precise: true,
  consentOn: true,
  inTripWindow: true,
  onHub: true,
  explainerAsked: false,
};

const explainerReady: ArmingInput = {
  ...armedAll,
  background: 'undetermined',
};

describe('resolveArming (PBT-U10-F1)', () => {
  it('AR1 다섯 조건(always·정확·토글·구간·플래그)+서버 스위치가 모두 참이면 ARMED', () => {
    expect(resolveArming(armedAll)).toEqual({
      state: 'ARMED',
      reason: 'armed',
    });
  });

  it('AR2 when-in-use · 허브 첫 진입 · 미질문이면 EXPLAINER', () => {
    expect(resolveArming(explainerReady).state).toBe('EXPLAINER');
  });

  it('AR3 [나중에] 뒤(이 여행에서 이미 물음)는 MANUAL', () => {
    expect(resolveArming({ ...explainerReady, explainerAsked: true })).toEqual({
      state: 'MANUAL',
      reason: 'when-in-use',
    });
  });

  it('AR4 OS 가 더 묻지 못하면(거부 확정) 설명 대신 MANUAL — l06 설정 열기만 남는다(BR-U10-05)', () => {
    expect(
      resolveArming({ ...explainerReady, backgroundCanAskAgain: false })
    ).toEqual({ state: 'MANUAL', reason: 'background-blocked' });
  });

  it('AR5 허브가 아닌 진입(설정·온보딩)에서는 설명을 띄우지 않는다', () => {
    expect(resolveArming({ ...explainerReady, onHub: false }).state).toBe(
      'MANUAL'
    );
  });

  it('AR6 always 지만 대략 위치면 MANUAL(approximate)', () => {
    expect(resolveArming({ ...armedAll, precise: false })).toEqual({
      state: 'MANUAL',
      reason: 'approximate',
    });
  });

  it('AR7 (PBT) ARMED ⇔ 여섯 조건 모두 참', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const all =
          input.flagOn &&
          input.serverEnabled &&
          input.foreground === 'granted' &&
          input.background === 'granted' &&
          input.precise &&
          input.consentOn &&
          input.inTripWindow;
        expect(resolveArming(input).state === 'ARMED').toBe(all);
      }),
      { numRuns: 500 }
    );
  });

  it('AR8 (PBT) 토글 OFF·플래그 OFF·서버 스위치 OFF 면 EXPLAINER 가 나오지 않는다', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        if (!input.consentOn || !input.flagOn || !input.serverEnabled) {
          expect(resolveArming(input).state).not.toBe('EXPLAINER');
        }
      }),
      { numRuns: 500 }
    );
  });

  it('AR9 (PBT) 강등 입력(ARMED 조건 하나를 거짓으로) 직후 ARMED 는 0', () => {
    const downgrades: ((i: ArmingInput) => ArmingInput)[] = [
      (i) => ({ ...i, background: 'denied' }),
      (i) => ({ ...i, precise: false }),
      (i) => ({ ...i, consentOn: false }),
      (i) => ({ ...i, inTripWindow: false }),
      (i) => ({ ...i, flagOn: false }),
      (i) => ({ ...i, serverEnabled: false }),
      (i) => ({ ...i, foreground: 'denied' }),
    ];
    fc.assert(
      fc.property(
        arbInput,
        fc.constantFrom(...downgrades),
        (input, downgrade) => {
          expect(resolveArming(downgrade(input)).state).not.toBe('ARMED');
        }
      ),
      { numRuns: 500 }
    );
  });

  it('AR10 (PBT) 플래그 OFF 면 항상 MANUAL·flag-off — 권한 요청 경로(EXPLAINER)로 가지 않는다(BR-U10-07)', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        expect(resolveArming({ ...input, flagOn: false })).toEqual({
          state: 'MANUAL',
          reason: 'flag-off',
        });
      }),
      { numRuns: 300 }
    );
  });

  it('AR11 EXPLAINER 는 when-in-use 허용·토글 ON·구간 안·허브·미질문·재질문 가능일 때만', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        if (resolveArming(input).state === 'EXPLAINER') {
          expect(input.foreground).toBe('granted');
          expect(input.background).not.toBe('granted');
          expect(input.consentOn).toBe(true);
          expect(input.inTripWindow).toBe(true);
          expect(input.onHub).toBe(true);
          expect(input.explainerAsked).toBe(false);
          expect(input.backgroundCanAskAgain).toBe(true);
        }
      }),
      { numRuns: 500 }
    );
  });
});

describe('AUTOMATION_CONFIG (DEC-U10-22 · NFR)', () => {
  it('CF1 임계 기본값은 한 곳에서 정의된다 — FD·NFR 확정값', () => {
    expect(AUTOMATION_CONFIG.geofenceRadiusM).toBe(150);
    expect(AUTOMATION_CONFIG.maxAccuracyM).toBe(100);
    expect(AUTOMATION_CONFIG.arriveDwellMs).toBe(3 * 60_000);
    expect(AUTOMATION_CONFIG.minStayForCompleteMs).toBe(10 * 60_000);
    expect(AUTOMATION_CONFIG.exitConfirmMs).toBe(3 * 60_000);
    expect(AUTOMATION_CONFIG.maxRegions).toBe(10);
    expect(AUTOMATION_CONFIG.route.toleranceM).toBe(15);
    expect(AUTOMATION_CONFIG.route.maxPoints).toBe(2000);
    expect(AUTOMATION_CONFIG.route.maxSegments).toBe(200);
    expect(AUTOMATION_CONFIG.route.gapMs).toBe(10 * 60_000);
    expect(AUTOMATION_CONFIG.route.jumpM).toBe(1000);
    expect(AUTOMATION_CONFIG.route.privacyRadiusM).toBe(150);
    expect(AUTOMATION_CONFIG.route.stopRadiusM).toBe(100);
    expect(AUTOMATION_CONFIG.route.stopMs).toBe(3 * 60_000);
  });

  it('CF2 INV-3 — 설정값 이름에 속도·걸음 수 계열이 없다', () => {
    const keys = JSON.stringify(AUTOMATION_CONFIG);
    expect(keys).not.toMatch(/speed|step|duration|pace/i);
  });
});
