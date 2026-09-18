import {
  DEFAULT_DWELL_KEY,
  DWELL_OPTIONS,
  buildFixedMustVisitRequest,
  canSubmitMustVisitTime,
  mustVisitTimeBlockReason,
  startTimeOptions,
  tripDayChips,
  type MustVisitTimeForm,
} from './mustVisitTimeForm';

/**
 * h07 방문 시각 지정의 **순수 판정** — 날짜 칩 · 시각 목록 · FIXED 폼 검증 · 요청 본문.
 *
 * 무엇을 보장하나:
 *  - 고를 수 있는 날짜가 **여행 기간뿐**이다(AC-6). INV-U1-17("`fixedDate` 는 여행 기간 안")을
 *    사후 검증이 아니라 **입력 위젯 자체로** 강제한다 — 기간 밖 날짜는 애초에 만들어지지 않는다.
 *  - FIXED 인데 날짜·시각이 비면 **요청 본문을 만들 수 없다**(AC-5 · INV-U1-17). 클라 검증은
 *    UX 사본이고 판정 권위는 서버지만, 만들 수 없는 요청은 나갈 수도 없다.
 *  - 체류 3단계 라벨에 분값이 새지 않는다(AC-9 · INV-3 — `dwellMin` 은 솔버 입력이지 표시값이
 *    아니다).
 *
 * 시계를 읽지 않는다: 요일은 `Date.UTC(...).getUTCDay()` 로 **순수 산술**로 얻는다(`baseGate.ts`
 * 가 달 길이를 세는 방식과 같은 구분 — `new Date()` 로 지금을 읽는 것과 다르다).
 *
 * 3동작 뼈대: 준비=여행 기간·폼 상태 → 실행=순수 함수 호출 → 단언=돌아온 값.
 */

/** 완전히 채워진 FIXED 폼 — 여기서 한 칸씩 빼며 부정 갈래를 만든다. */
const COMPLETE: MustVisitTimeForm = {
  fixed: true,
  fixedDate: '2026-06-11',
  fixedStart: '13:00',
  dwellKey: 'NORMAL',
};

describe('C7 · AC-6 — 날짜 칩이 여행 기간 날짜 정확히 그 개수만 나온다', () => {
  it('3일 여행이면 칩 3개이고 라벨이 `6.11 (목)` 꼴이다', () => {
    // ⚠️ 요일은 **Figma 목업에서 베끼지 않았다.** 목업은 `6.10 (화)·6.11 (수)·6.12 (목)` 인데
    //    2026-06-10 은 실제로 **수요일**이다(02a §5-4 실측). 목업 라벨을 박으면 올바른 구현이
    //    영원히 red 를 낸다.
    expect(
      tripDayChips({ startDate: '2026-06-10', endDate: '2026-06-12' })
    ).toEqual([
      { date: '2026-06-10', label: '6.10 (수)' },
      { date: '2026-06-11', label: '6.11 (목)' },
      { date: '2026-06-12', label: '6.12 (금)' },
    ]);
  });

  it('C7-b 하루 여행이면 칩 1개다', () => {
    expect(
      tripDayChips({ startDate: '2026-06-13', endDate: '2026-06-13' })
    ).toEqual([{ date: '2026-06-13', label: '6.13 (토)' }]);
  });
});

describe('C8 · AC-6 짝 — 경계와 달 넘김', () => {
  it('기간이 비었거나 뒤집혔으면 고를 수 있는 날짜가 없다', () => {
    // 배선이 스토어의 `startDate ?? ''` 를 그대로 넘기는 경로가 실재한다(baseGate 선례).
    // 막지 않으면 루프가 끝나지 않는다.
    expect(tripDayChips({ startDate: '', endDate: '' })).toEqual([]);
    expect(
      tripDayChips({ startDate: '2026-06-12', endDate: '2026-06-10' })
    ).toEqual([]);
  });

  it('C8-b 달을 넘겨도 날짜와 요일이 함께 이어진다', () => {
    // ★ 이 칸은 `tripDayOptions`(baseGate) 의 문자열 산술 위에 **요일**을 얹는다. 달을 넘길 때
    //    두 계산이 어긋나면 여기서만 보인다(6월은 30일까지다).
    expect(
      tripDayChips({ startDate: '2026-06-30', endDate: '2026-07-01' })
    ).toEqual([
      { date: '2026-06-30', label: '6.30 (화)' },
      { date: '2026-07-01', label: '7.1 (수)' },
    ]);
  });
});

describe('C9 · D2 — 시작 시각 목록이 30분 간격 하루치다', () => {
  it('48개이고 00:00 에서 23:30 까지 빈틈·중복이 없다', () => {
    const options = startTimeOptions();

    expect(options).toHaveLength(48);
    expect(options[0]).toBe('00:00');
    expect(options[1]).toBe('00:30');
    expect(options[47]).toBe('23:30');
    // 중복이 있으면 시트에서 같은 시각이 두 번 보이고 testID 가 충돌한다.
    expect(new Set(options).size).toBe(48);
    // 형식 — `AddMustVisitRequest.fixedStart` 가 `HH:mm[:ss]` 다.
    expect(
      options.every((value) => /^([01]\d|2[0-3]):(00|30)$/.test(value))
    ).toBe(true);
  });
});

describe('C10 · AC-5 — FIXED 인데 날짜·시각이 비면 사유가 나온다 (INV-U1-17)', () => {
  it('완전히 채워졌으면 막는 사유가 없다 (긍정 앵커)', () => {
    // 앵커가 없으면 `() => 'DATE_MISSING'` 한 줄짜리 구현이 아래 세 줄을 전부 통과한다.
    expect(mustVisitTimeBlockReason(COMPLETE)).toBeUndefined();
  });

  it('C10-b 날짜만 비면 DATE_MISSING, 시각만 비면 START_MISSING', () => {
    expect(mustVisitTimeBlockReason({ ...COMPLETE, fixedDate: null })).toBe(
      'DATE_MISSING'
    );
    expect(mustVisitTimeBlockReason({ ...COMPLETE, fixedStart: null })).toBe(
      'START_MISSING'
    );
  });

  it('C10-c 둘 다 비면 날짜를 먼저 말한다 (사유 슬롯이 하나뿐이라 우선순위가 계약이다)', () => {
    expect(
      mustVisitTimeBlockReason({
        ...COMPLETE,
        fixedDate: null,
        fixedStart: null,
      })
    ).toBe('DATE_MISSING');
  });
});

describe('C11 · D8 — 토글 OFF 면 고정할 값이 없으므로 저장할 수 없다', () => {
  it('값이 다 채워져 있어도 토글이 꺼져 있으면 false 다', () => {
    // ★ "값이 없어서 false" 와 구별되는 자리다 — 완전한 값을 넣고도 false 여야 한다.
    expect(canSubmitMustVisitTime({ ...COMPLETE, fixed: false })).toBe(false);
    // 짝(긍정) — 켜져 있고 값이 차면 저장할 수 있다.
    expect(canSubmitMustVisitTime(COMPLETE)).toBe(true);
  });

  it('C11-b 켜져 있어도 값이 비면 저장할 수 없다', () => {
    expect(canSubmitMustVisitTime({ ...COMPLETE, fixedStart: null })).toBe(
      false
    );
  });
});

describe('C12 · AC-4 — 저장 요청 본문 (POST /trips/{tripId}/must-visits)', () => {
  it('type=FIXED · fixedDate · fixedStart · dwellMin 이 정확히 그 모양으로 만들어진다', () => {
    // `AddMustVisitRequest` 계약 그대로다 — 임의 필드를 발명하지 않는다.
    expect(
      buildFixedMustVisitRequest({ poiId: 'poi-a', form: COMPLETE })
    ).toEqual({
      poiId: 'poi-a',
      type: 'FIXED',
      fixedDate: '2026-06-11',
      fixedStart: '13:00',
      dwellMin: 60,
    });
  });

  it('C12-b 만들 수 없는 상태에서는 null 이다 — 만들 수 없는 요청은 나갈 수도 없다', () => {
    expect(
      buildFixedMustVisitRequest({
        poiId: 'poi-a',
        form: { ...COMPLETE, fixedStart: null },
      })
    ).toBeNull();
    expect(
      buildFixedMustVisitRequest({
        poiId: 'poi-a',
        form: { ...COMPLETE, fixedDate: null },
      })
    ).toBeNull();
    expect(
      buildFixedMustVisitRequest({
        poiId: 'poi-a',
        form: { ...COMPLETE, fixed: false },
      })
    ).toBeNull();
  });

  it('C12-c 체류를 여유로 바꾸면 dwellMin 만 바뀐다', () => {
    expect(
      buildFixedMustVisitRequest({
        poiId: 'poi-a',
        form: { ...COMPLETE, dwellKey: 'LONG' },
      })
    ).toEqual({
      poiId: 'poi-a',
      type: 'FIXED',
      fixedDate: '2026-06-11',
      fixedStart: '13:00',
      dwellMin: 120,
    });
  });
});

describe('C13 · D4 — 체류 3단계 (⚠️ 세 숫자는 정본 공백을 메운 구현 결정이다)', () => {
  it('짧게·보통·여유가 30·60·120 이고 기본 선택이 보통이다', () => {
    // ⚠️ 어느 정본에도 없는 값이다 — `domain-entities.md` 는 필드만, `frontend-components.md`
    // §8 은 "범위 안내만" 이라고 한다. U1 이 TRIP-209 에서 같은 종류의 값을 게이트①로 확정한
    // 선례를 따른다. 게이트①에서 사용자가 볼 자리다.
    expect(DWELL_OPTIONS).toEqual([
      { key: 'SHORT', label: '짧게', dwellMin: 30 },
      { key: 'NORMAL', label: '보통', dwellMin: 60 },
      { key: 'LONG', label: '여유', dwellMin: 120 },
    ]);
    // Figma 가 `보통` 을 선택된 상태로 그린다 → 미선택 갈래가 없다(dwellMin 은 항상 실린다).
    expect(DEFAULT_DWELL_KEY).toBe('NORMAL');
  });
});

describe('C14 · AC-9 · INV-3 — 체류 라벨에 분값이 새지 않는다', () => {
  it('라벨 3종이 정확히 짧게·보통·여유이고 숫자도 분 도 들어 있지 않다', () => {
    const labels = DWELL_OPTIONS.map((option) => option.label);

    // 긍정 앵커 먼저 — 없으면 라벨이 전부 빈 문자열인 구현이 아래 부정 두 줄을 통과한다.
    expect(labels).toEqual(['짧게', '보통', '여유']);

    // 부정 — 화면에 보이는 것은 라벨이고, 분값은 서버로만 간다.
    expect(labels.some((label) => /\d/.test(label))).toBe(false);
    expect(labels.some((label) => label.includes('분'))).toBe(false);
  });
});
