/**
 * 기기 시간대를 테스트 안에서 바꾸는 jest 환경.
 *
 * jest 는 테스트 파일마다 `process.env` 를 사본으로 주므로 테스트 안의 `process.env.TZ = …` 는
 * `Date` 에 반영되지 않는다(node 는 진짜 `process.env.TZ` 대입에서만 시간대를 다시 읽는다).
 * 이 환경은 워커 쪽 진짜 `process.env` 를 만지는 `__setDeviceTimeZone(tz | undefined)` 를 테스트
 * 전역에 꽂는다. `undefined` 는 원래 값으로 복원하고, teardown 도 복원한다(다음 파일로 새지 않게).
 *
 * 사용: 파일 머리 docblock `@jest-environment ./src/test-support/deviceTimeZoneEnvironment.cjs`.
 */
const BaseEnvironment = require(
  require('jest-expo/jest-preset').testEnvironment
);

class DeviceTimeZoneEnvironment extends BaseEnvironment {
  async setup() {
    await super.setup();
    const hadTz = Object.prototype.hasOwnProperty.call(process.env, 'TZ');
    const originalTz = process.env.TZ;
    this.restoreTimeZone = () => {
      if (hadTz) process.env.TZ = originalTz;
      else delete process.env.TZ;
    };
    this.global.__setDeviceTimeZone = (tz) => {
      if (tz === undefined) this.restoreTimeZone();
      else process.env.TZ = tz;
    };
  }

  async teardown() {
    if (this.restoreTimeZone) this.restoreTimeZone();
    await super.teardown();
  }
}

module.exports = DeviceTimeZoneEnvironment;
