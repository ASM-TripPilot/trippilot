import { automationNoticeCopy, tripDateRangeLabel } from './noticeCopy';

/**
 * TRIP-1339 · 강등·폐기 안내 1줄 카피(BR-U10-22·46 · FD §11 · Figma u10c 4857:3012). 오류 화면·푸시 아님.
 */
describe('automationNoticeCopy', () => {
  it('NC1 권한 강등 → 제목 + 사유 + 설정 열기', () => {
    expect(
      automationNoticeCopy({ kind: 'degraded', reason: 'when-in-use' }, 0)
    ).toEqual({
      title: '자동 기록이 꺼졌어요',
      detail: "위치 권한이 '사용하는 동안'으로 바뀌었어요",
      settings: true,
    });
  });

  it('NC2 여행 구간 끝(정상 종료)은 안내하지 않는다', () => {
    expect(
      automationNoticeCopy({ kind: 'degraded', reason: 'outside-trip' }, 0)
    ).toBeNull();
  });

  it('NC3 날짜 넘김 폐기 건수 → 직접 남기라는 1줄(설정 링크 없음)', () => {
    expect(automationNoticeCopy(null, 2)).toEqual({
      title: '보내지 못한 자동 기록 2건',
      detail: '방문 기록에서 직접 남겨 주세요',
      settings: false,
    });
  });

  it('NC4 안내 없음', () => {
    expect(automationNoticeCopy(null, 0)).toBeNull();
  });

  it('NC5 문구에 소요시간·속도·체류 시간이 없다(INV-3)', () => {
    for (const reason of [
      'when-in-use',
      'background-blocked',
      'no-permission',
      'approximate',
      'consent-off',
      'consent-rejected',
      'native-register-failed',
      'server-disabled',
    ]) {
      const c = automationNoticeCopy({ kind: 'degraded', reason }, 0);
      expect(JSON.stringify(c)).not.toMatch(/소요|속도|체류|분/);
    }
  });
});

describe('tripDateRangeLabel', () => {
  it('DL1 같은 달 / 다른 달', () => {
    expect(tripDateRangeLabel('2026-10-14', '2026-10-16')).toBe(
      '10월 14일~16일'
    );
    expect(tripDateRangeLabel('2026-10-30', '2026-11-02')).toBe(
      '10월 30일~11월 2일'
    );
    expect(tripDateRangeLabel('2026-10-14', '2026-10-14')).toBe('10월 14일');
  });
});
