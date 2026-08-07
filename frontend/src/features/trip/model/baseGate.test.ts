import {
  applyDayPick,
  baseBlockReason,
  canSaveStayFix,
  extendedTripPeriod,
  isOutsideTripPeriod,
  tripDayOptions,
  type StayGateInput,
  type TripPeriod,
} from './baseGate';

/**
 * TRIP-226 거점 지정 **전제 게이트**의 순수 판정(BR-U1-22 · BR-U1-26 · BR-U1-27 · INV-U1-08·09·15).
 * 네트워크·시계·저장소를 건드리지 않는다 — 기준일도 인자로 받는다.
 *
 * 무엇을 보장하나:
 *  - **★3** 차단 사유 슬롯이 하나뿐이라(01b D7) 셋이 겹칠 때의 **우선순위가 계약**이다.
 *  - **★4** `canSaveStayFix ⟺ baseBlockReason === undefined` — D3의 *"고쳤는데 여전히 막힌다를
 *    원리적으로 없앤다"*를 32조합 전수로 기계화한다. 두 게이트를 손으로 따로 적으면 한 글자
 *    차이로 갈라지고, 그 갈라짐은 조합을 전수로 돌리기 전엔 안 나온다.
 *  - **★5** "기간 밖"은 **증명할 수 있을 때만** 주장한다. 날짜가 없거나 여행 기간이 빈
 *    문자열이면 주장하지 않는다 — 배선이 `startDate ?? ''`를 쓰기 때문에 후자가 실재한다.
 *  - **★6** D6 등호 포함 경계는 **등호에서만** 갈린다. 네 점으로 집는다.
 *  - **★9** 날짜 칩은 두 탭을 **정렬하지 않는다**. 정렬하면 `checkOut <= checkIn` 상태에
 *    도달할 수 없어 AC-6②가 통과 불가능한 AC가 된다.
 *
 * > *(개념)* **페일클로즈(fail-closed)** — 판단 근거가 없으면 막는 쪽으로 기운다. 단 이 파일에서
 * > 그 원칙이 걸리는 곳은 **차단 판정**이지 *"기간 밖이라는 주장"*이 아니다. 모르면서 "밖이다"라고
 * > 말하는 것은 페일클로즈가 아니라 거짓말이다(★5).
 */

const TRIP: TripPeriod = { startDate: '2026-06-10', endDate: '2026-06-13' };

function stay(over: Partial<StayGateInput> = {}): StayGateInput {
  return {
    coordConfirmed: true,
    checkIn: '2026-06-10',
    checkOut: '2026-06-12',
    ...over,
  };
}

describe('baseBlockReason — 지정을 막는 사유', () => {
  it('정상 숙소는 막지 않는다 (앵커)', () => {
    // 이 앵커가 없으면 "언제나 막는" 구현이 아래 케이스를 전부 통과한다.
    expect(baseBlockReason(stay())).toBeUndefined();
  });

  it('세 사유가 각각 제 코드로 나온다', () => {
    expect(baseBlockReason(stay({ checkIn: null }))).toBe('DATES_MISSING');
    expect(baseBlockReason(stay({ checkOut: null }))).toBe('DATES_MISSING');
    expect(baseBlockReason(stay({ checkOut: '2026-06-09' }))).toBe(
      'DATES_REVERSED'
    );
    expect(baseBlockReason(stay({ coordConfirmed: false }))).toBe(
      'COORD_UNCONFIRMED'
    );
  });

  it('🔴 ★3 — 셋이 겹치면 DATES_MISSING이 이긴다 (01b D7 한 슬롯 계약)', () => {
    // 사유 슬롯은 `trip-base-assign-blocked-{id}` 하나인데 사유는 셋이다. 우선순위를 안
    // 정하면 구현마다 다른 문구가 나오고, 그 차이를 아무 케이스도 못 잡는다.
    //
    // 날짜를 먼저 두는 이유는 **최소 놀람**이다 — 225가 이미 날짜 없는 숙소에
    // `날짜가 없어 지정할 수 없어요`를 보이고 있고 그 문구는 동결 케이스에 완전 일치로
    // 박혀 있다. 날짜가 이기면 225의 관찰 가능한 동작이 226의 진부분집합이 된다.
    expect(
      baseBlockReason({ coordConfirmed: false, checkIn: null, checkOut: null })
    ).toBe('DATES_MISSING');

    // 짝 — 날짜가 멀쩡하면 좌표 사유가 드러난다. 이게 없으면 "언제나 DATES_MISSING"이 통과한다.
    expect(baseBlockReason(stay({ coordConfirmed: false }))).toBe(
      'COORD_UNCONFIRMED'
    );
    // 짝 — 역전과 좌표가 겹치면 역전이 이긴다.
    expect(
      baseBlockReason(stay({ coordConfirmed: false, checkOut: '2026-06-10' }))
    ).toBe('DATES_REVERSED');
  });

  it('🔴 역전 경계 — 같은 날은 0박이라 막고, 하루라도 뒤면 안 막는다', () => {
    // INV-U1-15: `dateTo > dateFrom`. 같은 날은 숙박이 아니다.
    expect(baseBlockReason(stay({ checkOut: '2026-06-10' }))).toBe(
      'DATES_REVERSED'
    );
    // 짝 — 경계 바로 바깥은 통과한다. 없으면 `>=`로 적은 구현이 정상 숙소까지 막는다.
    expect(baseBlockReason(stay({ checkOut: '2026-06-11' }))).toBeUndefined();
  });
});

describe('🔴 ★4 — 저장 게이트와 차단 판정은 같은 답을 낸다 (01b D3)', () => {
  it('좌표 2 × 체크인 4 × 체크아웃 4 = 32조합 전수에서 동치다', () => {
    // D3의 본문이 *"저장 성공 = 즉시 지정 가능. '고쳤는데 여전히 막힌다'를 **원리적으로**
    // 없앤다"*다. 그 "원리적으로"를 기계로 만드는 방법이 이 동치다.
    //
    // 깨지면: 사용자가 시트에서 저장에 성공하고 시트가 닫혔는데 카드는 여전히 잠겨 있다.
    // 무엇을 더 고쳐야 하는지 화면이 말해 주지 않으므로 사용자는 같은 시트를 다시 연다.
    //
    // fast-check를 안 쓰는 이유: 입력 공간이 32개로 유한하다. 열거가 곧 성질이고,
    // 실패하면 반례가 결정적으로 나온다.
    const DATES = [null, '2026-06-10', '2026-06-11', '2026-06-12'] as const;
    const rows: { input: StayGateInput; save: boolean; blocked: boolean }[] =
      [];

    for (const coordConfirmed of [true, false]) {
      for (const checkIn of DATES) {
        for (const checkOut of DATES) {
          const input: StayGateInput = { coordConfirmed, checkIn, checkOut };
          rows.push({
            input,
            save: canSaveStayFix(input),
            blocked: baseBlockReason(input) !== undefined,
          });
        }
      }
    }

    // 앵커 ① — 실제로 32조합을 돌았다.
    expect(rows).toHaveLength(32);
    // 앵커 ② — 두 답이 모두 true인 조합도, 모두 false인 조합도 실존한다. 없으면
    // "언제나 false"인 두 함수가 동치 단언을 공짜로 통과한다.
    expect(rows.some((row) => row.save)).toBe(true);
    expect(rows.some((row) => !row.save)).toBe(true);

    // 본체 — 어긋나는 조합을 **입력째** 남긴다(어느 조합에서 갈렸는지 diff로 보이게).
    const mismatched = rows
      .filter((row) => row.save === row.blocked)
      .map((row) => row.input);
    expect(mismatched).toEqual([]);
  });
});

describe('isOutsideTripPeriod — 밖임을 아는가 (01b D6)', () => {
  it('🔴 ★6 — 등호 포함 경계 네 점 (AC-13)', () => {
    // 경계는 등호에서만 갈린다. 안쪽 픽스처만 쓰면 `>`/`<`(엄격)로 적은 구현이 통과하고,
    // **마지막 날 아침 체크아웃**이라는 가장 흔한 정상 케이스가 조용히 막힌다.
    expect(
      isOutsideTripPeriod(
        stay({ checkIn: '2026-06-12', checkOut: '2026-06-13' }),
        TRIP
      )
    ).toBe(false); // dateTo === endDate → 안
    expect(
      isOutsideTripPeriod(
        stay({ checkIn: '2026-06-13', checkOut: '2026-06-14' }),
        TRIP
      )
    ).toBe(true); // dateTo === endDate + 1일 → 밖
    expect(
      isOutsideTripPeriod(
        stay({ checkIn: '2026-06-10', checkOut: '2026-06-11' }),
        TRIP
      )
    ).toBe(false); // dateFrom === startDate → 안
    expect(
      isOutsideTripPeriod(
        stay({ checkIn: '2026-06-09', checkOut: '2026-06-11' }),
        TRIP
      )
    ).toBe(true); // dateFrom === startDate − 1일 → 밖
  });

  it('🔴 ★5 — 날짜가 없으면 "밖이다"라고 주장하지 않는다', () => {
    // 날짜가 없는 숙소는 이미 `DATES_MISSING`으로 막힌다. 거기에 "기간 밖" 경고까지
    // 얹으면 근거 없는 말을 두 개 하는 셈이다.
    expect(isOutsideTripPeriod(stay({ checkIn: null }), TRIP)).toBe(false);
    expect(isOutsideTripPeriod(stay({ checkOut: null }), TRIP)).toBe(false);
    // 짝 — 같은 기간에 날짜가 있으면 실제로 주장한다. 없으면 "언제나 false"가 통과한다.
    expect(
      isOutsideTripPeriod(
        stay({ checkIn: '2026-06-20', checkOut: '2026-06-22' }),
        TRIP
      )
    ).toBe(true);
  });

  it("🔴 ★5 — 여행 기간이 비어 있으면 주장하지 않는다 (배선의 `startDate ?? ''` 경로)", () => {
    // ⚠️ 이 함정은 실재한다. 배선이 `toBaseSections(..., { startDate: startDate ?? '' })`를
    // 쓰고 있어(225 TripNewStep2Page.tsx) 같은 빈 문자열이 이 함수에도 들어온다.
    // 순진한 문자열 비교면 `'2026-06-12' <= ''`가 false라 **기간이 없는데 "기간 밖" 경고가
    // 상주한다** — 위저드 스토어가 날아간 딥링크 진입에서 곧바로 보이는 증상이다.
    expect(isOutsideTripPeriod(stay(), { startDate: '', endDate: '' })).toBe(
      false
    );
    expect(
      isOutsideTripPeriod(stay(), { startDate: '2026-06-10', endDate: '' })
    ).toBe(false);
    // 짝 — 기간이 온전하면 판정한다.
    expect(isOutsideTripPeriod(stay(), TRIP)).toBe(false);
    expect(isOutsideTripPeriod(stay({ checkOut: '2026-06-20' }), TRIP)).toBe(
      true
    );
  });
});

describe('extendedTripPeriod — 확장해야 할 새 기간 (01b D4)', () => {
  it('🔴 앞·뒤·양쪽으로 늘어나고, 이미 안이면 null이다', () => {
    // 뒤로만 늘리는 구현이 흔하다 — 앞으로 늘어나는 갈래가 ★12(박 번호 재계산)의 입력이라
    // 여기서 먼저 잠근다.
    expect(
      extendedTripPeriod(
        stay({ checkIn: '2026-06-14', checkOut: '2026-06-16' }),
        TRIP
      )
    ).toEqual({ startDate: '2026-06-10', endDate: '2026-06-16' });
    expect(
      extendedTripPeriod(
        stay({ checkIn: '2026-06-08', checkOut: '2026-06-09' }),
        TRIP
      )
    ).toEqual({ startDate: '2026-06-08', endDate: '2026-06-13' });
    expect(
      extendedTripPeriod(
        stay({ checkIn: '2026-06-08', checkOut: '2026-06-20' }),
        TRIP
      )
    ).toEqual({ startDate: '2026-06-08', endDate: '2026-06-20' });

    // 짝 — 안이면 확장할 것이 없다. 없으면 "언제나 새 기간을 만드는" 구현이 통과하고,
    // 정상 배정에도 `PATCH /trips`가 나간다.
    expect(extendedTripPeriod(stay(), TRIP)).toBeNull();
  });

  it('🔴 해를 넘는 갈래도 맞다 (사전식 비교의 근거를 고정한다)', () => {
    // 'YYYY-MM-DD'는 폭이 고정이라 문자열 비교가 곧 날짜 비교다. 그래서 이 파일은
    // 에포크 변환 없이 비교만으로 판정한다 — 그 전제가 깨지는 자리가 해 넘김이라 여기서 잰다.
    const yearEnd: TripPeriod = {
      startDate: '2026-12-30',
      endDate: '2027-01-02',
    };
    expect(
      isOutsideTripPeriod(
        stay({ checkIn: '2026-12-31', checkOut: '2027-01-01' }),
        yearEnd
      )
    ).toBe(false);
    expect(
      extendedTripPeriod(
        stay({ checkIn: '2026-12-28', checkOut: '2027-01-05' }),
        yearEnd
      )
    ).toEqual({ startDate: '2026-12-28', endDate: '2027-01-05' });
  });
});

describe('tripDayOptions — 시트가 그릴 날짜 칩', () => {
  it('🔴 여행 기간의 모든 날을 순서대로 내고, 체크아웃 날도 포함한다', () => {
    expect(tripDayOptions(TRIP)).toEqual([
      { date: '2026-06-10', label: '6/10' },
      { date: '2026-06-11', label: '6/11' },
      { date: '2026-06-12', label: '6/12' },
      { date: '2026-06-13', label: '6/13' },
    ]);
  });

  it('🔴 기간이 비었거나 뒤집혔으면 빈 목록이다 (무한 루프 방지)', () => {
    // 시작→끝을 하루씩 늘리는 구현에서 기간이 비면 루프가 멈추지 않거나 NaN으로 폭주한다.
    // 배선이 `startDate ?? ''`를 쓰므로 이 입력은 실제로 도달한다.
    expect(tripDayOptions({ startDate: '', endDate: '' })).toEqual([]);
    expect(
      tripDayOptions({ startDate: '2026-06-13', endDate: '2026-06-10' })
    ).toEqual([]);
    // 짝 — 하루짜리 기간은 칩 하나다(빈 목록과 구별된다).
    expect(
      tripDayOptions({ startDate: '2026-06-10', endDate: '2026-06-10' })
    ).toEqual([{ date: '2026-06-10', label: '6/10' }]);
  });
});

describe('🔴 ★9 — applyDayPick은 두 탭을 정렬하지 않는다', () => {
  it('빈 상태 → 체크인, 한쪽만 → 체크아웃, 둘 다 → 처음부터 다시', () => {
    expect(
      applyDayPick({ checkIn: null, checkOut: null }, '2026-06-11')
    ).toEqual({ checkIn: '2026-06-11', checkOut: null });
    expect(
      applyDayPick({ checkIn: '2026-06-11', checkOut: null }, '2026-06-13')
    ).toEqual({ checkIn: '2026-06-11', checkOut: '2026-06-13' });
    // 둘 다 차 있으면 새 범위를 시작한다 — 안 그러면 사용자가 고쳐 고를 방법이 없다.
    expect(
      applyDayPick(
        { checkIn: '2026-06-11', checkOut: '2026-06-13' },
        '2026-06-10'
      )
    ).toEqual({ checkIn: '2026-06-10', checkOut: null });
  });

  it('늦은 날을 먼저 고르면 역전 상태가 그대로 남는다 (AC-6②의 도달 가능성)', () => {
    // ⚠️ 이것이 이 칸에서 가장 위험한 "두 결정의 곱"이다. D3는 `checkOut > checkIn`일 때만
    // 저장을 연다. AC-6②는 `checkOut <= checkIn` 상태를 **실제로 만들어** 사유가 뜨는지 본다.
    // 여기서 `[a,b].sort()` 한 줄을 넣으면 그 상태에 도달할 수 없고, **AC-6②는 어떤 정상
    // 구현으로도 통과할 수 없는 AC가 된다.** 각 결정이 개별로는 옳은데 곱하면 서로를 지운다.
    const picked = applyDayPick(
      applyDayPick({ checkIn: null, checkOut: null }, '2026-06-13'),
      '2026-06-11'
    );

    expect(picked).toEqual({ checkIn: '2026-06-13', checkOut: '2026-06-11' });
    // 그리고 그 상태는 저장 게이트가 실제로 막는다 — 두 함수가 이 케이스에서 만난다.
    expect(canSaveStayFix({ coordConfirmed: true, ...picked })).toBe(false);
    expect(baseBlockReason({ coordConfirmed: true, ...picked })).toBe(
      'DATES_REVERSED'
    );
  });
});
