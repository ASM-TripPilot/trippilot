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
      companionType: undefined,
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

    // 실행 — 가운데 하나만 제거.
    useTripWizardStore.getState().removeDestination('경주');

    // 단언 — 남은 둘의 지역·박수가 그대로이고, seq는 빈칸 없이 다시 1..N으로 매겨진다.
    // (seq에 구멍이 나면 서버가 방문 순서를 읽을 수 없다.)
    expect(useTripWizardStore.getState().destinations).toEqual([
      { seq: 1, region: '부산', nights: 2 },
      { seq: 2, region: '여수', nights: 3 },
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
});
