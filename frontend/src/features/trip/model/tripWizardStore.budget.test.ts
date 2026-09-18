import { useTripWizardStore } from './tripWizardStore';

/**
 * TRIP-207 (01b D5 · D6) — 위저드 드래프트의 **예산 축**.
 *
 * 무엇을 보장하나: 예산 입력의 **원문**(사용자가 친 그대로, 콤마 포함)이 화면 밖 상자에
 * 담기고, **사용자가 예산을 건드렸다는 사실**이 `touched`에 `'budget'`으로 남는다. 그 한 줄이
 * 이 사이클의 모든 게이팅을 가른다 — 프리필을 언제 멈출지(AC-1c), 오류를 언제 보일지(AC-4)가
 * 전부 이 값으로 갈린다.
 *
 * 왜 새 파일인가: `tripWizardStore.test.ts`는 TRIP-205 게이트①로 승인·동결된 파일이다. 거기에
 * 덧붙이면 재승인 표면이 통째로 넓어진다 — TRIP-206이 `TripWizardStep1Screen.errors.test.tsx`를
 * 새로 판 것과 같은 이유다. 그 파일의 단언은 이 사이클에서 **한 줄도 안 바뀐다**(예산 축을
 * 더해도 거기 단언들은 자기가 고른 키만 비교하므로 그대로 green이다).
 *
 * 커버하지 않는 것: **원문 → 정수 변환**은 순수 함수 몫이라 `budgetAmount.test.ts`가 본다.
 * 이 상자는 문자열을 판단 없이 담기만 한다. 프리필은 여기 쓰지 않는다 — 파생값이다(02a §2-4).
 *
 * ⚠️ 모듈 싱글턴이라 테스트 사이에 값이 샌다. 매 테스트 전 reset() 한다(승인 파일과 같은 규칙).
 *
 * 3동작 뼈대: 준비=reset → 실행=액션 호출 → 단언=getState() 값.
 */

beforeEach(() => {
  useTripWizardStore.getState().reset();
});

describe('AC-1b · 예산 축의 초기 상태', () => {
  it('원문은 빈 문자열이고 touched에 budget이 없다', () => {
    const state = useTripWizardStore.getState();

    // 빈 문자열이지 `undefined`가 아니다 — 제어 입력의 `value`로 그대로 내려가므로,
    // `undefined`면 RN이 **비제어 입력**으로 취급해 값의 주인이 둘이 된다.
    expect(state.budgetText).toBe('');

    // AC-1의 전제: 아직 안 건드렸으므로 프리필이 값을 채울 수 있다.
    expect(state.touched).not.toContain('budget');
  });
});

describe('AC-1c · 사람이 친 값은 원문 그대로 담기고 touched를 켠다 (01b D6)', () => {
  it('친 문자열이 가공 없이 담기고 budget 축이 켜진다', () => {
    // 실행 — 콤마가 든 문자열을 그대로 넣는다.
    useTripWizardStore.getState().setBudgetText('1,200,000');

    const state = useTripWizardStore.getState();
    // 상자는 판단하지 않는다 — 파싱·포맷은 순수 함수와 배선의 몫이다.
    expect(state.budgetText).toBe('1,200,000');
    expect(state.touched).toContain('budget');
  });

  it('**지운 것도 건드린 것이다** — 빈 문자열을 넣어도 touched가 켜진다', () => {
    // 이 한 줄이 AC-1c(지운 상태가 재진입에도 보존된다)와 AC-2(비우면 미전송)의 뿌리다.
    // 빈 문자열을 "안 건드린 것"으로 접으면 프리필이 매번 되살아나 **지우기가 불가능해진다**.
    useTripWizardStore.getState().setBudgetText('');

    const state = useTripWizardStore.getState();
    expect(state.budgetText).toBe('');
    expect(state.touched).toContain('budget');
  });

  it('짝 — 예산을 건드려도 다른 축은 꺼진 채로 남는다', () => {
    // 이게 없으면 "전부 켜는" 구현도 위를 통과하고, 그러면 다른 블록의 오류 문구가
    // 아무것도 안 고른 사용자에게 뜬다(TRIP-206 AC-10c 위반).
    useTripWizardStore.getState().setBudgetText('120000');

    const touched = useTripWizardStore.getState().touched;
    ['destinations', 'period', 'party', 'companion'].forEach((field) => {
      expect(touched).not.toContain(field);
    });
  });

  it('같은 축을 여러 번 건드려도 중복으로 쌓이지 않는다', () => {
    useTripWizardStore.getState().setBudgetText('1');
    useTripWizardStore.getState().setBudgetText('12');
    useTripWizardStore.getState().setBudgetText('120');

    // 집합이지 로그가 아니다(승인 파일이 `party` 축에 세운 성질과 같다).
    expect(useTripWizardStore.getState().touched).toEqual(['budget']);
    expect(useTripWizardStore.getState().budgetText).toBe('120');
  });
});

describe('AC-1c · 보존과 reset', () => {
  it('컴포넌트와 무관하게 원문이 남는다 (모듈 싱글턴 · BR-U1-33)', () => {
    useTripWizardStore.getState().setBudgetText('500,000');

    const reread = useTripWizardStore.getState();
    expect({ budgetText: reread.budgetText, touched: reread.touched }).toEqual({
      budgetText: '500,000',
      touched: ['budget'],
    });
  });

  it('짝 — reset()은 원문과 touched를 함께 되돌린다', () => {
    // 위 보존 단언이 "아무도 안 지웠을 뿐"이 아니라 **지울 수단이 있는데도 남았다**임을
    // 보이는 짝. 그리고 reset 뒤에는 touched가 비므로 프리필이 다시 채울 수 있다(N4-6 짝).
    useTripWizardStore.getState().setBudgetText('500,000');

    useTripWizardStore.getState().reset();

    const state = useTripWizardStore.getState();
    expect({ budgetText: state.budgetText, touched: state.touched }).toEqual({
      budgetText: '',
      touched: [],
    });
  });
});
