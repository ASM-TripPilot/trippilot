import fc from 'fast-check';

import { consentPutBody } from './consentPutBody';

/**
 * TRIP-609 AC-2 · PBT-U6-F3(리포 CI 차단 게이트) · BR-U6-29 · DEC-U6-11 — 토글→PUT 바디 순수함수.
 *
 * 무엇을 보장하나: 위치 동의 토글 하나가 L2(법정 동의)·L3(GPS 옵트인)를 **함께** 움직인다.
 * `consentPutBody(on)` 은 `legalConsent` 와 `gpsRecordingOptIn` 을 **항상 같은 값**으로 낸다 —
 * 어떤 boolean 입력에도 둘이 갈라지지 않는다. 이 함수가 PUT 바디의 유일 조립점이므로(단일 통로는
 * `locationConsentPutBodyOwnership.test.ts` 가 소스 층에서 잠근다), "legalConsent 만 먼저 보내는"
 * 분리 전송 경로가 원천적으로 생기지 않는다.
 *
 * 왜 PBT 인가: 성질("둘이 항상 같다")은 예시 몇 개로 증명되지 않는다. 임의 boolean 전수(fast-check)
 * 로 못 박아야 100% 통과 게이트가 의미를 갖는다(예: 누가 나중에 `{legalConsent: on, gpsRecordingOptIn: !on}`
 * 오타를 내면 PBT 가 반례를 찾아 red).
 *
 * (개념) 순수 함수 = 같은 입력이면 같은 출력, 부작용 0. (개념) fast-check `fc.boolean()` 은
 * "임의 boolean 생성기"이고, `fc.property(생성기, 검사)` 를 `fc.assert` 가 수백 케이스 돌린다.
 * 매처 `toBe` = 원시값 동등, `toEqual` = 구조(깊은) 동등. (fast-check@^4 · tripBuckets 실증 · 02a §5-D)
 */
describe('TRIP-609 · consentPutBody (AC-2 · PBT-U6-F3)', () => {
  it('임의 boolean 에 대해 legalConsent === gpsRecordingOptIn 이 항상 성립한다(분리 전송 0)', () => {
    fc.assert(
      fc.property(fc.boolean(), (toggleOn) => {
        const body = consentPutBody(toggleOn);
        // 급소: 두 필드가 절대 갈라지지 않는다(PBT-U6-F3).
        expect(body.legalConsent).toBe(body.gpsRecordingOptIn);
        // 그리고 둘 다 입력 토글값과 같다 — 매핑까지 못 박아 상수 반환 스텁을 차단한다.
        expect(body.legalConsent).toBe(toggleOn);
        expect(body.gpsRecordingOptIn).toBe(toggleOn);
      })
    );
  });

  it('ON 이면 둘 다 true 로 조립한다', () => {
    expect(consentPutBody(true)).toEqual({
      legalConsent: true,
      gpsRecordingOptIn: true,
    });
  });

  it('OFF 이면 둘 다 false 로 조립한다(철회 = 둘 동시 해제)', () => {
    expect(consentPutBody(false)).toEqual({
      legalConsent: false,
      gpsRecordingOptIn: false,
    });
  });
});
