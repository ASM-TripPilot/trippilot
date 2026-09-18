/**
 * TRIP-610 · l05 취향 전체 수정 — GET 응답(`PreferenceView`, 축마다 `{value, isNeutralDefault}`
 * 래퍼)을 PUT 요청(`PreferenceInput`, 평면 배열)으로 되돌리는 순수 함수 두 개.
 *
 * GET/PUT 타입이 비대칭(래퍼 ↔ 평면)이라 역변환이 필요하다. 두 규칙이 핵심이다:
 *  - `isNeutralDefault=true`(또는 축 부재) = 미설정 → 초기 선택에 반영하지 않는다(그 값을
 *    "선택됨"으로 다루면 미설정 축을 설정된 것처럼 저장하는 버그).
 *  - PUT 은 **바뀐 축만** 담는다(omit). openapi 계약상 축을 생략하면 미변경, `null`을 보내면
 *    미설정으로 초기화(데이터 손실)라, 안 만진 축은 키 자체를 안 만든다. `null`은 사용자가
 *    한 축을 전부 해제한 "명시적 리셋"에만 정당하다.
 */
import type {
  PrefArrayAxis,
  PrefScalarAxis,
  PreferenceInput,
  PreferenceView,
} from '@/shared/api/generated/schemas';

export interface PreferenceSelection {
  styles: string[] | null;
  activities: string[] | null;
  transportModes: string[] | null;
  foodTastes: string[] | null;
  pace: string | null;
  companionTypes: string[] | null;
  petFlag: boolean;
  budgetTier: string | null;
}

/** 배열 축: 미설정(축 부재·중립)이면 null, 아니면 서버값 그대로. */
function arrayAxis(axis: PrefArrayAxis | undefined): string[] | null {
  if (!axis || axis.isNeutralDefault) return null;
  return axis.value ?? null;
}

/** 스칼라 축: 미설정(축 부재·중립)이면 null, 아니면 서버값 그대로. */
function scalarAxis(axis: PrefScalarAxis | undefined): string | null {
  if (!axis || axis.isNeutralDefault) return null;
  return axis.value ?? null;
}

/** 순서 민감 배열 동등 비교 — 안 만진 배열 축은 seed 그대로라 순서까지 같다(→ omit). */
function arrayEq(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * GET View → 초기 선택 상태. companion·budget 은 래퍼 구조를 평면 필드로 편다.
 * 미설정(중립·부재) 축은 배열·스칼라=null, petFlag=false.
 */
export function initialSelection(view: PreferenceView): PreferenceSelection {
  const companion = view.companion;
  const companionUnset = !companion || companion.isNeutralDefault === true;
  const budget = view.budget;
  const budgetUnset = !budget || budget.isNeutralDefault === true;

  return {
    styles: arrayAxis(view.styles),
    activities: arrayAxis(view.activities),
    transportModes: arrayAxis(view.transportModes),
    foodTastes: arrayAxis(view.foodTastes),
    pace: scalarAxis(view.pace),
    companionTypes: companionUnset ? null : (companion.companionTypes ?? null),
    petFlag: companionUnset ? false : (companion.petFlag ?? false),
    budgetTier: budgetUnset ? null : (budget.tier ?? null),
  };
}

/**
 * 현재 선택을 초기값과 비교해 **바뀐 축만** PUT 바디에 담는다. 안 바꾼 축은 키를 아예 만들지
 * 않는다(omit — `undefined` 대입도 아님). 값이 유효 enum 임은 UI 옵션이 계약값으로 고정돼
 * 보장되므로, 경계에서 계약 타입으로 재단언한다(`as`).
 */
export function buildPreferenceInput(
  view: PreferenceView,
  selection: PreferenceSelection
): PreferenceInput {
  const initial = initialSelection(view);
  const input: PreferenceInput = {};

  if (!arrayEq(selection.styles, initial.styles)) {
    input.styles = selection.styles as PreferenceInput['styles'];
  }
  if (!arrayEq(selection.activities, initial.activities)) {
    input.activities = selection.activities as PreferenceInput['activities'];
  }
  if (!arrayEq(selection.transportModes, initial.transportModes)) {
    input.transportModes =
      selection.transportModes as PreferenceInput['transportModes'];
  }
  if (!arrayEq(selection.foodTastes, initial.foodTastes)) {
    input.foodTastes = selection.foodTastes as PreferenceInput['foodTastes'];
  }
  if (!arrayEq(selection.companionTypes, initial.companionTypes)) {
    input.companionTypes =
      selection.companionTypes as PreferenceInput['companionTypes'];
  }
  if (selection.pace !== initial.pace) {
    input.pace = selection.pace as PreferenceInput['pace'];
  }
  if (selection.petFlag !== initial.petFlag) {
    input.petFlag = selection.petFlag;
  }
  if (selection.budgetTier !== initial.budgetTier) {
    input.budgetTier = selection.budgetTier as PreferenceInput['budgetTier'];
  }

  return input;
}
