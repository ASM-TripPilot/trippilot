import fc from 'fast-check';

import {
  PreferenceInputActivitiesItem,
  PreferenceInputCompanionTypesItem,
  PreferenceInputFoodTastesItem,
  PreferenceInputStylesItem,
  PreferenceInputTransportModesItem,
  type PreferenceView,
} from '@/shared/api/generated/schemas';

import { summarizePreferences } from './preferenceSummary';

/**
 * TRIP-778 AC-1 — 서버 취향(`PreferenceView`)을 설정 화면 행 값으로 바꾸는 순수 함수.
 *
 * 무엇을 보장하나:
 *  - 설정된 축은 서버 값을 **서버 순서 그대로** 가운뎃점(U+00B7)으로 잇는다(D5 — enum 원문).
 *  - 미설정 축(축 없음 · `isNeutralDefault:true` · 빈 값)은 빈 문자열이 아니라 `unset` 표지다 —
 *    화면은 이것을 회색 `미설정` 칩으로 그린다. `isNeutralDefault:true`면 값이 있어도 미설정이다.
 *  - 동행은 `반려동물`을 덧붙이고, 예산은 등급만 쓴다(`rawAmount` 무시, D6).
 *  - 어떤 입력에서도 'undefined'·'null' 글자가 새지 않는다.
 *
 * 3동작 뼈대: 준비=PreferenceView 픽스처 → 실행=summarizePreferences → 단언=행 key 별 요약.
 *
 * (개념) `it.each(표)` — 같은 테스트를 표의 행마다 한 번씩 돌린다. `%s` 자리에 행의 첫 값이 들어간다.
 * (개념) fast-check `fc.assert(fc.property(생성기, 검사))` — 생성기가 만든 입력 수백 개로 검사를 돌려
 *  "어떤 입력이든 성립하는 성질"을 확인한다.
 */

const DOT = '·';

describe('TRIP-778 AC-1 · summarizePreferences — 표 기반', () => {
  it.each<[string, PreferenceView, string, unknown]>([
    [
      '배열 축 복수 값은 서버 순서로 · 연결',
      { styles: { value: ['휴양', '자연'], isNeutralDefault: false } },
      'style',
      { kind: 'value', text: `휴양${DOT}자연` },
    ],
    [
      '배열 축 순서를 정렬하지 않는다',
      { styles: { value: ['자연', '휴양'], isNeutralDefault: false } },
      'style',
      { kind: 'value', text: `자연${DOT}휴양` },
    ],
    ['축이 없으면 미설정', {}, 'food', { kind: 'unset' }],
    [
      '빈 배열이면 미설정(빈 문자열 금지)',
      { activities: { value: [], isNeutralDefault: false } },
      'activities',
      { kind: 'unset' },
    ],
    [
      '중립 기본값이면 값이 있어도 미설정',
      { transportModes: { value: ['도보'], isNeutralDefault: true } },
      'transport',
      { kind: 'unset' },
    ],
    [
      '스칼라(pace) 값은 서버 원문 그대로',
      { pace: { value: '느긋하게', isNeutralDefault: false } },
      'pace',
      { kind: 'value', text: '느긋하게' },
    ],
    [
      '스칼라 null 이면 미설정',
      { pace: { value: null, isNeutralDefault: false } },
      'pace',
      { kind: 'unset' },
    ],
    [
      '동행 + 반려동물이면 반려동물을 덧붙인다',
      {
        companion: {
          companionTypes: ['친구'],
          petFlag: true,
          isNeutralDefault: false,
        },
      },
      'companions',
      { kind: 'value', text: `친구${DOT}반려동물` },
    ],
    [
      '반려동물만 있어도 값이다',
      {
        companion: {
          companionTypes: [],
          petFlag: true,
          isNeutralDefault: false,
        },
      },
      'companions',
      { kind: 'value', text: '반려동물' },
    ],
    [
      '동행이 비고 반려동물도 없으면 미설정',
      {
        companion: {
          companionTypes: [],
          petFlag: false,
          isNeutralDefault: false,
        },
      },
      'companions',
      { kind: 'unset' },
    ],
    [
      '예산은 등급만(rawAmount 무시)',
      { budget: { tier: '중간', rawAmount: 500000, isNeutralDefault: false } },
      'budget',
      { kind: 'value', text: '중간' },
    ],
    [
      '예산 등급이 없으면 금액이 있어도 미설정',
      { budget: { tier: null, rawAmount: 500000, isNeutralDefault: false } },
      'budget',
      { kind: 'unset' },
    ],
  ])('%s', (_title, view, key, expected) => {
    // 실행
    const summary = summarizePreferences(view);

    // 단언(완전일치): 그 행 key 의 요약.
    expect(summary[key as keyof typeof summary]).toEqual(expected);
  });

  it('D5 프리뷰 픽스처 한 벌이 7행 요약으로 정확히 바뀐다', () => {
    // 준비 — 예산만 미설정(축 없음), 나머지는 서버 enum 원문.
    const view: PreferenceView = {
      styles: { value: ['휴양', '자연'], isNeutralDefault: false },
      companion: {
        companionTypes: ['친구'],
        petFlag: false,
        isNeutralDefault: false,
      },
      activities: { value: ['맛집투어', '전시'], isNeutralDefault: false },
      transportModes: { value: ['대중교통'], isNeutralDefault: false },
      foodTastes: { value: ['일식'], isNeutralDefault: false },
      pace: { value: '느긋하게', isNeutralDefault: false },
    };

    // 실행
    const summary = summarizePreferences(view);

    // 단언(완전일치 · 7키 전부): 빠진 key·남는 key 도 red.
    expect(summary).toEqual({
      style: { kind: 'value', text: `휴양${DOT}자연` },
      budget: { kind: 'unset' },
      companions: { kind: 'value', text: '친구' },
      activities: { kind: 'value', text: `맛집투어${DOT}전시` },
      transport: { kind: 'value', text: '대중교통' },
      food: { kind: 'value', text: '일식' },
      pace: { kind: 'value', text: '느긋하게' },
    });
  });

  it('중립 기본값은 네 모양(배열·스칼라·동행·예산) 모두 미설정이다', () => {
    // 준비 — 값은 전부 있지만 서버가 "사용자가 고른 게 아니다"라고 표시했다.
    const view: PreferenceView = {
      styles: { value: ['휴양'], isNeutralDefault: true },
      pace: { value: '균형있게', isNeutralDefault: true },
      companion: {
        companionTypes: ['혼자'],
        petFlag: true,
        isNeutralDefault: true,
      },
      budget: { tier: '중간', rawAmount: 1, isNeutralDefault: true },
    };

    // 실행
    const summary = summarizePreferences(view);

    // 단언
    expect(summary.style).toEqual({ kind: 'unset' });
    expect(summary.pace).toEqual({ kind: 'unset' });
    expect(summary.companions).toEqual({ kind: 'unset' });
    expect(summary.budget).toEqual({ kind: 'unset' });
  });
});

/** 계약 enum 값으로만 만든, 중복 없는 비어있지 않은 부분집합(02a ★13 — `·` 든 값은 계약상 없다). */
function subsetOf(values: readonly string[]) {
  return fc.uniqueArray(fc.constantFrom(...values), {
    minLength: 1,
    maxLength: values.length,
  });
}

const ARRAY_AXES = [
  ['styles', 'style', Object.values(PreferenceInputStylesItem)],
  ['activities', 'activities', Object.values(PreferenceInputActivitiesItem)],
  [
    'transportModes',
    'transport',
    Object.values(PreferenceInputTransportModesItem),
  ],
  ['foodTastes', 'food', Object.values(PreferenceInputFoodTastesItem)],
] as const;

describe('TRIP-778 AC-1 · summarizePreferences — 속성', () => {
  it.each(ARRAY_AXES)(
    '배열 축(%s): 어떤 enum 부분집합이든 입력 순서 그대로 · 로 잇고, 구분자 수 = 원소 수 − 1',
    (axis, key, values) => {
      fc.assert(
        fc.property(subsetOf(values), (picked) => {
          // 준비·실행
          const summary = summarizePreferences({
            [axis]: { value: picked, isNeutralDefault: false },
          } as PreferenceView);
          const row = summary[key];

          // 단언
          expect(row).toEqual({ kind: 'value', text: picked.join(DOT) });
          if (row.kind === 'value') {
            expect(row.text.split(DOT)).toHaveLength(picked.length);
            expect(row.text).not.toMatch(/undefined|null/);
          }
        })
      );
    }
  );

  it('동행: 어떤 부분집합 + 반려동물 여부든 반려동물은 끝에 한 번만 붙는다', () => {
    fc.assert(
      fc.property(
        subsetOf(Object.values(PreferenceInputCompanionTypesItem)),
        fc.boolean(),
        (types, pet) => {
          const summary = summarizePreferences({
            companion: {
              companionTypes: types,
              petFlag: pet,
              isNeutralDefault: false,
            },
          });

          const expected = pet ? [...types, '반려동물'] : types;
          expect(summary.companions).toEqual({
            kind: 'value',
            text: expected.join(DOT),
          });
        }
      )
    );
  });

  it('모든 축이 중립 기본값이면 7행 전부 미설정이다(값이 무엇이든)', () => {
    fc.assert(
      fc.property(
        subsetOf(Object.values(PreferenceInputStylesItem)),
        subsetOf(Object.values(PreferenceInputFoodTastesItem)),
        (styles, foods) => {
          const summary = summarizePreferences({
            styles: { value: styles, isNeutralDefault: true },
            activities: { value: ['카페'], isNeutralDefault: true },
            transportModes: { value: ['도보'], isNeutralDefault: true },
            foodTastes: { value: foods, isNeutralDefault: true },
            pace: { value: '알차게', isNeutralDefault: true },
            companion: {
              companionTypes: ['가족'],
              petFlag: true,
              isNeutralDefault: true,
            },
            budget: { tier: '고급', isNeutralDefault: true },
          });

          expect(Object.values(summary)).toHaveLength(7);
          for (const row of Object.values(summary)) {
            expect(row).toEqual({ kind: 'unset' });
          }
        }
      )
    );
  });
});
