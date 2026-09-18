import type { PreferenceView } from '@/shared/api/generated/schemas';

import {
  buildPreferenceInput,
  initialSelection,
  type PreferenceSelection,
} from './preferenceDraft';

/**
 * TRIP-610 · l05 취향 전체 수정 — `preferenceDraft`: GET 응답 모양(`PreferenceView`, 축마다
 * `{value, isNeutralDefault}` 래퍼)을 PUT 요청 모양(`PreferenceInput`, 평면 배열)으로 되돌리는
 * **순수 함수 두 개**. (개념) 순수 함수 = 입력만으로 출력 결정, 조회·부수효과·시계 없음.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 `initialSelection`: GET View → 초기 선택. **isNeutralDefault=true(또는 축 부재)면 미설정**으로
 *    본다 — 그 값을 "선택됨"으로 반영하면 미설정 축을 설정된 것처럼 저장하는 버그(01b 맹점②).
 *  - 🔴 `buildPreferenceInput`(AC-2 핵심): 초기값과 비교해 **바뀐 축만** 키로 담는다. 안 바꾼 축은
 *    **키 자체가 없어야**(omit) 한다 — `null`을 보내면 계약상 그 축이 서버에서 리셋(데이터 손실).
 *    `null`은 "사용자가 전부 해제"한 명시적 리셋에만 정당하다.
 *
 * 왜 이렇게 테스트하나(02a §4-★A·★B·§5-B):
 *  - omit은 "키를 안 만드는 것"이지 `undefined` 대입이 아니다. `not.toHaveProperty`는
 *    `{a:undefined}`·`{a:null}` 둘 다 red로 잡으므로(실측 §5-B), 조건부 키 심기를 강제한다.
 *  - "아무 변경 없음 → 빈 바디"는 `toStrictEqual({})`로 잠근다 — `toEqual`은 여분 `undefined` 키를
 *    무시해 못 잡는다(실측).
 *
 * 3동작 뼈대: 준비(View·selection 픽스처) → 실행(함수 호출) → 단언(반환 객체의 키·값).
 * 커버하지 않는 것: 화면 렌더·타일 선택 시각은 `PreferencesEditScreen.integration.test.tsx` 몫.
 */

describe('initialSelection — GET View를 초기 선택으로', () => {
  it('A1(AC-1) 설정된 배열 축은 그대로 반영된다', () => {
    // 준비 — 스타일 축이 진짜 사용자 값으로 설정됨(중립 아님).
    const view: PreferenceView = {
      styles: { value: ['휴양', '미식'], isNeutralDefault: false },
    };

    // 실행
    const sel = initialSelection(view);

    // 단언 — 값이 그대로 초기 선택으로.
    expect(sel.styles).toEqual(['휴양', '미식']);
  });

  it('A2(맹점②·AC-3) 중립 기본값 축은 미설정(null)로 — 값이 있어도 선택으로 다루지 않는다', () => {
    // 준비 — pace·food 둘 다 value는 있으나 isNeutralDefault=true(서버 파생, 진짜 설정 아님).
    const view: PreferenceView = {
      pace: { value: '균형있게', isNeutralDefault: true },
      foodTastes: { value: ['한식'], isNeutralDefault: true },
    };

    // 실행
    const sel = initialSelection(view);

    // 단언 — 중립이면 미설정(null). 이걸 값으로 반영하면 미설정 축을 저장하는 버그가 된다.
    expect(sel.pace).toBeNull();
    expect(sel.foodTastes).toBeNull();
  });

  it('A3 누락 축은 미설정 기본값(배열=null, petFlag=false)', () => {
    // 준비 — 축이 하나도 없는 View(전부 미설정).
    const view: PreferenceView = {};

    // 실행
    const sel = initialSelection(view);

    // 단언 — 여분 키·타입까지 toStrictEqual로 고정(undefined 키 유출 차단).
    expect(sel).toStrictEqual({
      styles: null,
      activities: null,
      transportModes: null,
      foodTastes: null,
      pace: null,
      companionTypes: null,
      petFlag: false,
      budgetTier: null,
    });
  });

  it('A4(필드 대응) companion→companionTypes·petFlag, budget→budgetTier로 분해된다', () => {
    // 준비 — 래퍼 구조(companion.companionTypes / companion.petFlag / budget.tier)를 평면으로 편다.
    const view: PreferenceView = {
      companion: {
        companionTypes: ['혼자', '커플'],
        petFlag: true,
        isNeutralDefault: false,
      },
      budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
    };

    // 실행
    const sel = initialSelection(view);

    // 단언 — GET 래퍼 필드가 PUT 평면 필드로 대응된다.
    expect(sel.companionTypes).toEqual(['혼자', '커플']);
    expect(sel.petFlag).toBe(true);
    expect(sel.budgetTier).toBe('중간');
  });
});

describe('buildPreferenceInput — 바뀐 축만 PUT 바디로', () => {
  it('B1(AC-2 핵심) 아무 축도 안 바꾸면 빈 바디를 낸다', () => {
    // 준비 — 여러 축이 설정된 View. 초기 선택을 그대로 현재 선택으로(= 아무 변경 없음).
    const view: PreferenceView = {
      styles: { value: ['휴양'], isNeutralDefault: false },
      pace: { value: '균형있게', isNeutralDefault: false },
      budget: { tier: '중간', isNeutralDefault: false },
    };
    const sel = initialSelection(view);

    // 실행
    const body = buildPreferenceInput(view, sel);

    // 단언 — 키가 하나도 없어야 한다. "안 만졌으면 아무것도 안 보낸다"(toStrictEqual: 여분
    // undefined 키까지 잡음, §5-B).
    expect(body).toStrictEqual({});
  });

  it('B2(AC-2 헤드라인) 바꾼 축만 담고 안 바꾼 축은 omit(null 아님)', () => {
    // 준비 — 스타일은 설정됨(안 만짐), 음식은 중립=미설정. 음식만 새로 고른다.
    const view: PreferenceView = {
      styles: { value: ['휴양'], isNeutralDefault: false },
      pace: { value: '균형있게', isNeutralDefault: false },
      foodTastes: { value: [], isNeutralDefault: true },
    };
    const sel: PreferenceSelection = {
      ...initialSelection(view),
      foodTastes: ['한식'],
    };

    // 실행
    const body = buildPreferenceInput(view, sel);

    // 단언 — 바꾼 축만 값으로 실린다.
    expect(body).toHaveProperty('foodTastes', ['한식']);
    // 안 바꾼 축은 키 자체가 없다(not.toHaveProperty는 undefined·null 둘 다 red로 잡음 §5-B →
    // styles:null 로 보내는 데이터 손실도, 전체 input 통째 전송도 여기서 red).
    expect(body).not.toHaveProperty('styles');
    expect(body).not.toHaveProperty('pace');
    expect(body).not.toHaveProperty('activities');
  });

  it('B3(AC-3) 미설정(중립) 축을 새로 고르면 그 축이 담긴다', () => {
    // 준비 — 활동 축은 중립=미설정(초기 null). 사용자가 '카페'를 고른다.
    const view: PreferenceView = {
      activities: { value: ['자연'], isNeutralDefault: true },
    };
    const sel: PreferenceSelection = {
      ...initialSelection(view),
      activities: ['카페'],
    };

    // 실행
    const body = buildPreferenceInput(view, sel);

    // 단언 — 미설정이던 축도 선택하면 저장 대상이 된다(null → ['카페']).
    expect(body).toHaveProperty('activities', ['카페']);
  });

  it('B4(omit≠리셋) 한 축을 전부 해제하면 그 경우에만 null이 담긴다', () => {
    // 준비 — 스타일이 진짜 설정됨. 사용자가 전부 해제(null).
    const view: PreferenceView = {
      styles: { value: ['휴양'], isNeutralDefault: false },
    };
    const sel: PreferenceSelection = {
      ...initialSelection(view),
      styles: null,
    };

    // 실행
    const body = buildPreferenceInput(view, sel);

    // 단언 — "안 만짐"(omit)과 달리 "전부 해제"는 null을 명시적으로 보낸다(미설정으로 리셋 의도).
    expect(body).toHaveProperty('styles', null);
  });

  it('B5(스칼라 변경) pace·petFlag·budgetTier 변경은 그 축만 담고, 안 바꾼 companionTypes는 omit', () => {
    // 준비 — 세 스칼라를 바꾸되 companionTypes(배열)는 그대로 둔다.
    const view: PreferenceView = {
      pace: { value: '균형있게', isNeutralDefault: false },
      companion: {
        companionTypes: [],
        petFlag: false,
        isNeutralDefault: false,
      },
      budget: { tier: '중간', isNeutralDefault: false },
    };
    const sel: PreferenceSelection = {
      ...initialSelection(view),
      pace: '알차게',
      petFlag: true,
      budgetTier: '고급',
    };

    // 실행
    const body = buildPreferenceInput(view, sel);

    // 단언 — 바뀐 스칼라 세 축만.
    expect(body).toHaveProperty('pace', '알차게');
    expect(body).toHaveProperty('petFlag', true);
    expect(body).toHaveProperty('budgetTier', '고급');
    // petFlag만 바뀌었고 companionTypes(빈 배열)는 그대로 → 담지 않는다.
    expect(body).not.toHaveProperty('companionTypes');
  });
});
