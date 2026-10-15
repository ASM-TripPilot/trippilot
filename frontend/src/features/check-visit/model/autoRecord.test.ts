import { autoRecordPart } from './autoRecord';

/** TRIP-1340 · 표식 여부는 서버 출처에서만 파생(BR-U10-29). */
describe('autoRecordPart', () => {
  it('AR1 수동 기록 → 표식 없음', () => {
    expect(
      autoRecordPart({ source: 'MANUAL', arrivedAt: 't', completedAt: 't' })
    ).toBeNull();
  });
  it('AR2 자동 도착 + 자동 완료 → COMPLETION, 자동 도착만 → ARRIVAL', () => {
    expect(
      autoRecordPart({
        source: 'AUTO_GEOFENCE',
        completionSource: 'AUTO_GEOFENCE_EXIT',
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

  it('AR4 수동 도착 + 자동 완료도 표식이 붙고 되돌릴 부분은 완료다(TRIP-1409)', () => {
    for (const completionSource of [
      'AUTO_GEOFENCE_EXIT',
      'AUTO_NEXT_ARRIVAL',
    ] as const) {
      expect(
        autoRecordPart({
          source: 'MANUAL',
          completionSource,
          arrivedAt: 't',
          completedAt: 't',
        })
      ).toBe('COMPLETION');
    }
  });

  it('AR5 자동 도착 + 수동·빈 완료 → 표식 없음(서버가 VISIT_NOT_AUTO 로 거절)', () => {
    for (const completionSource of ['MANUAL', null, undefined] as const) {
      expect(
        autoRecordPart({
          source: 'AUTO_GEOFENCE',
          completionSource,
          arrivedAt: 't',
          completedAt: 't',
        })
      ).toBeNull();
    }
  });
});
