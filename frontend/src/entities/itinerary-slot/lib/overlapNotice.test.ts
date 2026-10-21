import { overlapAwareNotice } from './overlapNotice';
import { VIOLATION_NOTICE } from './violationLabel';

// 준비: 앞 카드 10:00–11:00 · 지금 카드 시작/위반 문구를 바꿔 가며 → 실행: overlapAwareNotice → 단언: 문구.
const prev = {
  startAt: '10:00:00',
  endAt: '11:00:00',
  nameKo: '백년가게',
  hasViolation: false,
};
const cur = (over: Partial<Parameters<typeof overlapAwareNotice>[0]>) => ({
  startAt: '10:00:00',
  endAt: '12:00:00',
  nameKo: '늘',
  hasViolation: true,
  violationReason: null,
  ...over,
});

describe('overlapAwareNotice (TRIP-1505)', () => {
  it('서버 문구가 고정 라벨로 떨어지고 앞 카드와 겹치면 어느 곳과 겹쳤는지 말한다', () => {
    expect(overlapAwareNotice(cur({}), prev)).toBe('‘백년가게’ 시각과 겹쳐요');
  });
  it('서버가 정성 문구를 줬으면 그대로 둔다', () => {
    expect(
      overlapAwareNotice(
        cur({ violationReason: '영업시간과 맞지 않아요' }),
        prev
      )
    ).toBe('영업시간과 맞지 않아요');
  });
  it('겹치지 않으면(시작이 앞 종료 이후) 고정 라벨 그대로', () => {
    expect(overlapAwareNotice(cur({ startAt: '11:00:00' }), prev)).toBe(
      VIOLATION_NOTICE
    );
  });
  it('위반 표식이 없고 겹치지도 않으면 null', () => {
    expect(
      overlapAwareNotice(
        cur({ startAt: '11:30:00', hasViolation: false }),
        prev
      )
    ).toBeNull();
  });
  it('첫 카드(앞 없음)·시각 미지정은 겹침을 말하지 않는다', () => {
    expect(overlapAwareNotice(cur({}), undefined)).toBe(VIOLATION_NOTICE);
    expect(overlapAwareNotice(cur({ startAt: null }), prev)).toBe(
      VIOLATION_NOTICE
    );
  });
  it('서버가 위반 표식을 안 달았어도 화면 시각이 겹치면 알린다(이름 없으면 앞 장소)', () => {
    expect(
      overlapAwareNotice(cur({ hasViolation: false }), {
        ...prev,
        nameKo: null,
      })
    ).toBe('앞 장소 시각과 겹쳐요');
  });

  it('앞 카드가 시각 미지정(startAt null)이면 겹침을 말하지 않는다', () => {
    expect(overlapAwareNotice(cur({}), { ...prev, startAt: null })).toBe(
      VIOLATION_NOTICE
    );
  });
  it('순서만 바뀌어 내가 앞 카드보다 먼저 끝나면(안 겹침) 겹침이라 말하지 않는다', () => {
    // 앞 카드 11:00–12:00 · 나 10:00–11:00 — 시작(10:00) < 앞 종료(12:00) 이지만 내 종료(11:00) ≤ 앞 시작(11:00)
    expect(
      overlapAwareNotice(cur({ startAt: '10:00:00', endAt: '11:00:00' }), {
        ...prev,
        startAt: '11:00:00',
        endAt: '12:00:00',
      })
    ).toBe(VIOLATION_NOTICE);
  });
  it('앞 카드가 다음 날로 넘어가면(23:00–01:00) 23:30 카드는 겹친다', () => {
    expect(
      overlapAwareNotice(cur({ startAt: '23:30:00', endAt: '23:59:00' }), {
        ...prev,
        startAt: '23:00:00',
        endAt: '01:00:00',
        endsNextDay: true,
      })
    ).toBe('‘백년가게’ 시각과 겹쳐요');
  });
});
