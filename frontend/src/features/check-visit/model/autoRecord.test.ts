import { autoRecordPart } from './autoRecord';

/** TRIP-1340 · 표식 여부는 서버 출처에서만 파생(BR-U10-29). */
describe('autoRecordPart', () => {
  it('AR1 수동 기록 → 표식 없음', () => {
    expect(
      autoRecordPart({ source: 'MANUAL', arrivedAt: 't', completedAt: 't' })
    ).toBeNull();
  });
  it('AR2 자동 도착 + 완료 → COMPLETION, 자동 도착만 → ARRIVAL', () => {
    expect(
      autoRecordPart({
        source: 'AUTO_GEOFENCE',
        arrivedAt: 't',
        completedAt: 't',
      })
    ).toBe('COMPLETION');
    expect(
      autoRecordPart({
        source: 'AUTO_GEOFENCE',
        arrivedAt: 't',
        completedAt: null,
      })
    ).toBe('ARRIVAL');
  });
  it('AR3 건너뜀·빈 행(되돌림 뒤) → 표식 없음', () => {
    expect(
      autoRecordPart({
        source: 'AUTO_GEOFENCE',
        arrivedAt: 't',
        skippedAt: 't',
      })
    ).toBeNull();
    expect(autoRecordPart({ source: 'AUTO_GEOFENCE' })).toBeNull();
  });
});
