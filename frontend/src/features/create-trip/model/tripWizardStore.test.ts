import { useTripWizardStore } from './tripWizardStore';

/**
 * TRIP-205 — 위저드 드래프트 스토어 (AC-3 · AC-4 · AC-5 · AC-7 · AC-8 · AC-10c · AC-11).
 *
 * 무엇을 보장하나: 위저드가 화면 밖에 들고 있는 입력값 상자가 ① 정본이 정한 기본값으로
 * 시작하고(인원 1 — BR-U1-39) ② 도시 목록의 `seq`를 서버 계약대로 1..N 연속으로 유지하며
 * ③ 인원 하한 1을 스토어 층에서도 접고 ④ **사용자가 건드린 축(`touched`)을 따로 기억한다.**
 *
 * ④가 이 사이클의 설계 핵심이다(01b). `validateTripDraft`는 페일클로즈라 빈 드래프트에서도
 * 위반을 낸다 — 그것을 그대로 문구로 뿌리면 아무것도 안 고른 사용자에게 오류가 뜬다. 그래서
 * "무엇을 건드렸나"를 따로 남겨 두고, **문구를 언제 보일지는 그 값으로 가른다**. 이 칸은
 * 문구를 그리지 않으므로(01b D3 — 표시는 TRIP-206) 여기서 잠그는 것은 `touched`가 **초기에
 * 비어 있고 건드린 축만 켜진다**는 성질까지다.
 *
 * > *(개념)* **Zustand 스토어** — 화면 밖에 사는 작은 상태 상자. 컴포넌트가 사라졌다 다시
 * > 나타나도 값이 남아 있어서 "뒤로 갔다 오면 입력이 보존된다"(BR-U1-33)가 공짜로 성립한다.
 * > `getState()`는 지금 값을 그대로 읽는 문(렌더 없이 단언할 때 쓴다).
 *
 * 3동작 뼈대: 준비=reset → 실행=액션 호출 → 단언=getState() 값.
 *
 * ⚠️ 모듈 싱글턴이라 테스트 사이에 값이 샌다. 매 테스트 전 reset() 한다
 * (`preferenceStore` 선례 — `PrefStep1Page.test.tsx` §7-6과 같은 규칙).
 */

beforeEach(() => {
  useTripWizardStore.getState().reset();
});

describe('AC-7 · 초기 드래프트', () => {
  it('빈 값 + 인원 1 + touched 없음으로 시작한다', () => {
    const state = useTripWizardStore.getState();

    // 값 6종을 한 객체로 통째 비교한다 — 하나씩 보면 첫 실패에서 멈춘다.
    expect({
      destinations: state.destinations,
      startDate: state.startDate,
      endDate: state.endDate,
      presetCode: state.presetCode,
      party: state.party,
      companionType: state.companionType,
      touched: state.touched,
    }).toEqual({
      destinations: [],
      startDate: undefined,
      endDate: undefined,
      presetCode: undefined,
      // US-TRIP-01 · BR-U1-39 — 인원 기본 1.
      party: 1,
      // TRIP-1045(QA #019) — 동반 유형 기본값은 '혼자'(frontend-components `PartyPicker`).
      companionType: '혼자',
      // AC-10c의 전제: 아직 아무것도 안 건드렸다.
      touched: [],
    });
  });
});

describe('AC-3 · AC-4 · 여행지 목록', () => {
  it('도시를 더하면 seq가 1부터 순서대로 붙는다', () => {
    // 실행 — 두 곳을 차례로 추가.
    useTripWizardStore.getState().addDestination('부산', 2);
    useTripWizardStore.getState().addDestination('경주', 1);

    // 단언 — `seq`는 서버 계약(TripDestination)의 필수 필드다. 순서가 곧 방문 순서다.
    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 2 },
      { seq: 2, region: '경주', nights: 1 },
    ]);
  });

  it('도시를 빼면 그 지역만 사라지고 나머지 박수는 그대로다', () => {
    // 준비 — 세 곳.
    useTripWizardStore.getState().addDestination('부산', 2);
    useTripWizardStore.getState().addDestination('경주', 1);
    useTripWizardStore.getState().addDestination('여수', 3);

    // 실행 — 가운데(seq 2) 하나만 제거(TRIP-364 — 이름이 아니라 seq로).
    useTripWizardStore.getState().removeDestination(2);

    // 단언 — 남은 둘의 지역·박수가 그대로이고, seq는 빈칸 없이 다시 1..N으로 매겨진다.
    // (seq에 구멍이 나면 서버가 방문 순서를 읽을 수 없다.)
    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 2 },
      { seq: 2, region: '여수', nights: 3 },
    ]);
  });

  it('TRIP-364 · 같은 지역을 두 번 담고 두 번째(seq 3)를 빼면 첫 번째만 남는다', () => {
    // 준비 — 같은 지역 두 번. 사이에 다른 도시를 끼운다(TRIP-1423: 바로 연달아 담으면 한 행으로
    // 합쳐진다). 박수를 달리해 어느 부산이 남았는지 구분한다.
    useTripWizardStore.getState().addDestination('부산', 2);
    useTripWizardStore.getState().addDestination('제주시', 1);
    useTripWizardStore.getState().addDestination('부산', 5);

    // 실행 — 두 번째 부산(seq 3)만 제거.
    useTripWizardStore.getState().removeDestination(3);

    // 단언 — 이름이 같아도 seq로 짚어 두 번째만 사라진다. 이름으로 지우던 옛 구현은
    // 첫 일치(2박)를 지워 여기서 red가 된다.
    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 2 },
      { seq: 2, region: '제주시', nights: 1 },
    ]);
  });
});

// TRIP-1423 (Q-055) — 지역 피커에서 바로 앞 행과 같은 도시를 또 고르면 새 행이 아니라 그 행 박수에 더한다(A→A).
// 바로 앞이 다른 도시면 지금처럼 새 행이다(A→B→A). "같은 도시"는 둘 다 코드가 있으면 코드 완전 일치, 아니면 이름.
describe('TRIP-1423 · 바로 앞 행과 같은 도시면 그 행 박수에 더한다', () => {
  function store() {
    return useTripWizardStore.getState();
  }

  it('M1 · 부산 1박 뒤에 부산을 또 담으면 행이 늘지 않고 부산 2박이 된다 (끝 날짜도 따라간다)', () => {
    expect(store().destinations).toHaveLength(0);
    store().setStartDate('2026-10-01');
    store().addDestination('부산광역시', 1, '26');

    store().addDestination('부산광역시', 1, '26');

    expect(store().destinations).toEqual([
      { seq: 1, region: '부산광역시', nights: 2, regionCode: '26' },
    ]);
    expect(store().endDate).toBe('2026-10-03');
    expect(store().touched).toContain('destinations');
  });

  it('M2 · 합치는 박수는 앞 행 박수 + 새로 담는 박수다 (2 + 3 = 5)', () => {
    expect(store().destinations).toHaveLength(0);
    store().addDestination('부산광역시', 2, '26');

    store().addDestination('부산광역시', 3, '26');

    expect(store().destinations).toHaveLength(1);
    expect(store().destinations[0].nights).toBe(5);
  });

  it('M3 · 부산 → 제주 → 부산은 합치지 않는다 — 세 번째 행 부산 1박이 생긴다 (바로 앞만 본다)', () => {
    expect(store().destinations).toHaveLength(0);
    store().addDestination('부산광역시', 1, '26');
    store().addDestination('제주시', 1, '50110');

    store().addDestination('부산광역시', 1, '26');

    expect(store().destinations).toEqual([
      { seq: 1, region: '부산광역시', nights: 1, regionCode: '26' },
      { seq: 2, region: '제주시', nights: 1, regionCode: '50110' },
      { seq: 3, region: '부산광역시', nights: 1, regionCode: '26' },
    ]);
  });

  it('M4 · 29박에 같은 도시 1박을 합치면 딱 30박 한 행이다 (경계 값은 허용)', () => {
    expect(store().destinations).toHaveLength(0);
    store().addDestination('부산광역시', 1, '26');
    store().setNights(1, 29);

    store().addDestination('부산광역시', 1, '26');

    expect(store().destinations).toEqual([
      { seq: 1, region: '부산광역시', nights: 30, regionCode: '26' },
    ]);
  });

  it('M5 · 30박에 같은 도시를 합치면 31박이 되므로 아무것도 안 바뀐다 (TRIP-1210 상한)', () => {
    expect(store().destinations).toHaveLength(0);
    store().addDestination('부산광역시', 1, '26');
    store().setNights(1, 30);
    store().setStartDate('2026-10-01');

    store().addDestination('부산광역시', 1, '26');

    expect(store().destinations).toEqual([
      { seq: 1, region: '부산광역시', nights: 30, regionCode: '26' },
    ]);
    expect(store().endDate).toBe('2026-10-31');
  });

  it('M6 · 이름이 같아도 코드가 다르면(서울 중구 → 부산 중구) 다른 도시다 — 두 행', () => {
    expect(store().destinations).toHaveLength(0);
    store().addDestination('중구', 1, '11140');

    store().addDestination('중구', 1, '26110');

    expect(store().destinations.map((one) => one.regionCode)).toEqual([
      '11140',
      '26110',
    ]);
  });

  it('M7 · 코드가 접두 관계(부산광역시 26 → 해운대구 26350)여도 다른 도시다 — 두 행', () => {
    expect(store().destinations).toHaveLength(0);
    store().addDestination('부산광역시', 1, '26');

    store().addDestination('해운대구', 1, '26350');

    expect(store().destinations.map((one) => one.regionCode)).toEqual([
      '26',
      '26350',
    ]);
  });

  it.each([
    ['앞 행에만 코드', '26', undefined],
    ['뒤에만 코드', undefined, '26'],
  ] as [string, string | undefined, string | undefined][])(
    'M8 · 한쪽이라도 코드가 없으면 이름으로 판정해 합치고, 앞 행의 코드는 그대로다 (%s)',
    (_label, firstCode, secondCode) => {
      expect(store().destinations).toHaveLength(0);
      store().addDestination('부산', 1, firstCode);

      store().addDestination('부산', 1, secondCode);

      expect(store().destinations).toHaveLength(1);
      const [busan] = store().destinations;
      expect(busan.nights).toBe(2);
      // toEqual 은 undefined 키를 무시하므로 코드는 따로 본다.
      expect(busan.regionCode).toBe(firstCode);
    }
  );

  it('M9 · 둘 다 코드가 있고 같으면 이름이 달라도 같은 도시다 — 앞 행 이름 그대로 2박', () => {
    expect(store().destinations).toHaveLength(0);
    store().addDestination('부산', 1, '26');

    store().addDestination('부산광역시', 1, '26');

    expect(store().destinations).toEqual([
      { seq: 1, region: '부산', nights: 2, regionCode: '26' },
    ]);
  });

  it('M10 · 당일치기(0박) 도시에 같은 도시를 합치면 0 + 1 = 1박이다 (한 행이라 하한은 0 그대로)', () => {
    expect(store().destinations).toHaveLength(0);
    store().addDestination('부산광역시', 0, '26');

    store().addDestination('부산광역시', 1, '26');

    expect(store().destinations).toEqual([
      { seq: 1, region: '부산광역시', nights: 1, regionCode: '26' },
    ]);
  });
});

describe('AC-7 · 인원 하한 (BR-U1-39 · §5 폼 검증 `인원 ≥ 1`)', () => {
  it('1 미만을 넣어도 1로 접는다', () => {
    useTripWizardStore.getState().setParty(0);
    expect(useTripWizardStore.getState().party).toBe(1);

    useTripWizardStore.getState().setParty(-3);
    expect(useTripWizardStore.getState().party).toBe(1);
  });

  it('짝 — 1 이상은 그대로 들어간다', () => {
    // 위 단언만 두면 "항상 1을 돌려주는" 구현도 통과한다.
    useTripWizardStore.getState().setParty(4);
    expect(useTripWizardStore.getState().party).toBe(4);
  });
});

describe('AC-5 · AC-8 · 기간과 동반 유형', () => {
  it('프리셋과 날짜 범위가 함께 들어간다', () => {
    useTripWizardStore.getState().setPeriod('3n4d', '2026-06-10', '2026-06-13');

    const state = useTripWizardStore.getState();
    expect({
      presetCode: state.presetCode,
      startDate: state.startDate,
      endDate: state.endDate,
    }).toEqual({
      presetCode: '3n4d',
      startDate: '2026-06-10',
      endDate: '2026-06-13',
    });
  });

  it('동반 유형은 단일 선택이다 — 나중에 고른 것이 앞의 것을 대체한다', () => {
    useTripWizardStore.getState().selectCompanion('친구');
    expect(useTripWizardStore.getState().companionType).toBe('친구');

    useTripWizardStore.getState().selectCompanion('가족');
    // 배열로 쌓이지 않는다(BR-U1-39는 단일 선택이다).
    expect(useTripWizardStore.getState().companionType).toBe('가족');
  });
});

describe('AC-10c · touched — 오류 문구를 언제 보일지 가르는 값', () => {
  it('아무것도 안 건드리면 비어 있다', () => {
    // 이것이 AC-10c의 뿌리다. 비어 있으므로 TRIP-206이 문구를 하나도 못 그린다.
    expect(useTripWizardStore.getState().touched).toEqual([]);
  });

  it('건드린 축만 켜지고, 안 건드린 축은 꺼진 채 남는다', () => {
    // 실행 — 기간만 건드린다.
    useTripWizardStore.getState().setPeriod('3n4d', '2026-06-10', '2026-06-13');

    const afterPeriod = useTripWizardStore.getState().touched;
    // 긍정 — 건드린 축이 켜졌다.
    expect(afterPeriod).toContain('period');
    // 부정(짝) — 안 건드린 축은 그대로다. 이게 없으면 "전부 켜는" 구현도 통과한다.
    expect(afterPeriod).not.toContain('destinations');
    expect(afterPeriod).not.toContain('party');
    expect(afterPeriod).not.toContain('companion');

    // 실행 — 여행지도 건드린다.
    useTripWizardStore.getState().addDestination('부산', 2);
    expect(useTripWizardStore.getState().touched).toEqual(
      expect.arrayContaining(['period', 'destinations'])
    );
  });

  it('같은 축을 여러 번 건드려도 중복으로 쌓이지 않는다', () => {
    useTripWizardStore.getState().setParty(2);
    useTripWizardStore.getState().setParty(3);
    useTripWizardStore.getState().setParty(4);

    // 집합이지 로그가 아니다 — 중복이 쌓이면 소비자(TRIP-206)가 세는 값이 흔들린다.
    expect(useTripWizardStore.getState().touched).toEqual(['party']);
  });
});

describe('AC-11 · 입력 보존과 reset', () => {
  it('컴포넌트와 무관하게 값이 남는다 — 뒤로 갔다 와도 보존된다(BR-U1-33)', () => {
    // 준비·실행 — 화면 없이 값만 채운다.
    useTripWizardStore.getState().addDestination('부산', 2);
    useTripWizardStore.getState().setPeriod('3n4d', '2026-06-10', '2026-06-13');
    useTripWizardStore.getState().setParty(3);

    // 단언 — 스토어를 다시 읽어도 그대로다(모듈 싱글턴 = 앱이 사는 동안 유지).
    const reread = useTripWizardStore.getState();
    expect({
      count: reread.destinations.length,
      startDate: reread.startDate,
      party: reread.party,
    }).toEqual({ count: 1, startDate: '2026-06-10', party: 3 });
  });

  it('짝 — reset()은 초기 상태로 되돌린다', () => {
    // 위 보존 단언이 "그냥 아무도 안 지웠다"가 아니라 **지울 수단이 있는데도 남았다**임을
    // 보이는 짝. reset은 위저드 완료·이탈에서 쓰는 정당한 프로덕션 액션이다.
    useTripWizardStore.getState().addDestination('부산', 2);
    useTripWizardStore.getState().setParty(3);

    useTripWizardStore.getState().reset();

    const state = useTripWizardStore.getState();
    expect({
      destinations: state.destinations,
      party: state.party,
      touched: state.touched,
    }).toEqual({ destinations: [], party: 1, touched: [] });
  });

  it('TRIP-1045 · reset()은 동행을 혼자로 되돌리고, 기본값은 companion 을 touched 에 켜지 않는다', () => {
    // 준비 — 사용자가 가족을 골랐다(이때는 touched 에 companion 이 켜진다).
    useTripWizardStore.getState().selectCompanion('가족');
    expect(useTripWizardStore.getState().touched).toContain('companion');

    // 실행 — 새 드래프트로 되돌린다.
    useTripWizardStore.getState().reset();

    // 단언 — 기본값 '혼자'는 사용자 입력이 아니다. touched 가 켜지면 "건드린 축"이 거짓이 된다.
    const state = useTripWizardStore.getState();
    expect({
      companionType: state.companionType,
      party: state.party,
      touched: state.touched,
    }).toEqual({ companionType: '혼자', party: 1, touched: [] });
  });
});
