import { useTripWizardStore } from './tripWizardStore';

/**
 * TRIP-669 (S5) — 위저드 드래프트 스토어의 **여행 단위 취향 오버라이드** 필드
 * (`prefStyleOverride` + `setPrefStyleOverride`) 단위 테스트 (01b D1·D2).
 *
 * 무엇을 보장하나: 스토어가 "오버라이드 없음(프리필 사용)"과 "빈 오버라이드(다 지웠다)"를
 * **서로 다른 값으로** 기억한다.
 *  - `undefined` = 오버라이드 없음 → 배선의 `effectiveStyles = prefStyleOverride ?? prefill`이
 *    프리필로 흘러간다.
 *  - `[]`(빈 배열) = 오버라이드가 있고 아무것도 안 골랐다 → 프리필로 **되돌아가면 안 된다**.
 *  이 둘을 한 값(예: `[]`)으로 합치면 "전부 해제한 취향"을 표현할 방법이 사라진다(맹점②
 *  null-vs-empty). 그래서 필드를 `string[] | undefined`로 두고, 전해제는 배선이 `toggleMulti`의
 *  `null`을 `[]`로 매핑해 저장한다(그 매핑은 배선/통합 테스트가 잠근다 — 여기선 스토어 계약만).
 *
 * > *(개념)* **Zustand 스토어** — 화면 밖에 사는 작은 상태 상자. `getState()`는 지금 값을 그대로
 * > 읽는 문(렌더 없이 단언할 때 쓴다). `set(...)`은 **병합**이라(교체가 아니라) `reset()`이
 * > 초기 객체에 없는 키는 안 지운다 — SO-4가 그 함정을 잠근다.
 *
 * 3동작 뼈대: 준비=reset → 실행=setPrefStyleOverride → 단언=getState().prefStyleOverride.
 *
 * ⚠️ 모듈 싱글턴이라 테스트 사이에 값이 샌다. 매 테스트 전 reset() 한다
 * (`tripWizardStore.test.ts` 선례와 같은 규칙).
 */

beforeEach(() => {
  useTripWizardStore.getState().reset();
});

describe('SO-1 · 초기값은 undefined (오버라이드 없음 = 프리필 사용)', () => {
  it('아무것도 안 했으면 prefStyleOverride 가 undefined 다 (빈 배열이 아니다)', () => {
    // ⚠️ 이 단언은 red 단계에선 공허 통과다(필드가 없어도 undefined 를 읽는다). 목적은
    //    구현자가 이 필드를 `[]`로 초기화하지 못하게 굳히는 계약이다 — 구현 뒤 의미가 산다.
    expect(useTripWizardStore.getState().prefStyleOverride).toBeUndefined();
  });
});

describe('SO-2 · ★ 빈 오버라이드 저장 — [] 는 undefined 와 다른 상태다 (null-vs-empty)', () => {
  it('setPrefStyleOverride([]) 는 [] 로 저장된다 (프리필로 안 돌아가는 "다 지웠다")', () => {
    useTripWizardStore.getState().setPrefStyleOverride([]);

    const value = useTripWizardStore.getState().prefStyleOverride;
    // toEqual 로 정확히 빈 배열임을 잠근다 — undefined 로 접히면(오버라이드 없음으로 오인) red.
    expect(value).toEqual([]);
    expect(value).not.toBeUndefined();
  });
});

describe('SO-3 · 정상 오버라이드 저장', () => {
  it('setPrefStyleOverride(["휴양","자연"]) 를 그대로 담는다', () => {
    useTripWizardStore.getState().setPrefStyleOverride(['휴양', '자연']);

    expect(useTripWizardStore.getState().prefStyleOverride).toEqual([
      '휴양',
      '자연',
    ]);
  });
});

describe('SO-4 · ★ reset() 이 새 필드도 되돌린다 (재진입·테스트 오염 방지)', () => {
  it('오버라이드를 저장한 뒤 reset() 하면 undefined 로 비워진다', () => {
    // 준비 — 값을 채운다.
    useTripWizardStore.getState().setPrefStyleOverride(['휴양']);
    expect(useTripWizardStore.getState().prefStyleOverride).toEqual(['휴양']);

    // 실행 — 초기화(위저드 이탈·완료의 정당한 액션).
    useTripWizardStore.getState().reset();

    // 단언 — set(INITIAL_DRAFT) 는 병합이라 INITIAL_DRAFT 에 이 키가 없으면 ['휴양'] 이
    // 그대로 남는다(테스트 오염·재진입 잔존). 구현자는 INITIAL_DRAFT 에
    // prefStyleOverride: undefined 를 넣어야 한다.
    expect(useTripWizardStore.getState().prefStyleOverride).toBeUndefined();
  });
});
