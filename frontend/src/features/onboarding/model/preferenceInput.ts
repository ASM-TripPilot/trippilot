import type { PreferenceInput } from '@/shared/api/generated/schemas/preferenceInput';
import type { PreferenceInputActivitiesItem } from '@/shared/api/generated/schemas/preferenceInputActivitiesItem';
import type { PreferenceInputBudgetTier } from '@/shared/api/generated/schemas/preferenceInputBudgetTier';
import type { PreferenceInputCompanionTypesItem } from '@/shared/api/generated/schemas/preferenceInputCompanionTypesItem';
import type { PreferenceInputFoodTastesItem } from '@/shared/api/generated/schemas/preferenceInputFoodTastesItem';
import type { PreferenceInputPace } from '@/shared/api/generated/schemas/preferenceInputPace';
import type { PreferenceInputStylesItem } from '@/shared/api/generated/schemas/preferenceInputStylesItem';
import type { PreferenceInputTransportModesItem } from '@/shared/api/generated/schemas/preferenceInputTransportModesItem';

/**
 * TRIP-471 · 온보딩 취향 스토어(세션 메모리)의 **slug** 를 서버 `PreferenceInput`(한국어 enum
 * 리터럴)으로 번역한다. 스토어는 화면 slug('low'·'relaxed'…)를 담지만 서버는 도메인 값('저가'·
 * '느긋하게'…)을 받으므로 이 매핑이 없으면 그대로 보낼 수 없다(그래서 "배선만"이 아니었다).
 *
 * 특례: 동행 'pet' slug 는 companionTypes 항목이 아니라 별도 `petFlag: boolean` 으로 간다
 * (서버 companionTypes enum 에 반려동물이 없다). 미선택 축은 null(→ 서버 "미설정으로 초기화").
 */

/** 스토어 PreferenceDraft 의 값 부분(토글 메서드 제외) — getState() 결과가 구조적으로 대입된다. */
export interface PreferenceDraftValues {
  styles: string[] | null;
  pace: string | null;
  budget: string | null;
  companions: string[] | null;
  foods: string[] | null;
  transports: string[] | null;
  activities: string[] | null;
}

const STYLE: Record<string, PreferenceInputStylesItem> = {
  rest: '휴양',
  gourmet: '미식',
  nature: '자연',
  art: '문화예술',
  activity: '액티비티',
  sightseeing: '관광',
  shopping: '쇼핑',
};

const PACE: Record<string, PreferenceInputPace> = {
  relaxed: '느긋하게',
  balanced: '균형있게',
  packed: '알차게',
};

const BUDGET: Record<string, PreferenceInputBudgetTier> = {
  low: '저가',
  mid: '중간',
  high: '고급',
  luxury: '럭셔리',
};

const COMPANION: Record<string, PreferenceInputCompanionTypesItem> = {
  solo: '혼자',
  couple: '커플',
  friends: '친구',
  family: '가족',
  parents: '부모님',
  // 'pet' 은 여기 없다 — petFlag 로 간다(위 특례).
};

const ACTIVITY: Record<string, PreferenceInputActivitiesItem> = {
  nature: '자연',
  history: '역사문화',
  themepark: '테마파크',
  foodtour: '맛집투어',
  cafe: '카페',
  exhibition: '전시',
  nightview: '야경',
  shopping: '쇼핑',
};

const FOOD: Record<string, PreferenceInputFoodTastesItem> = {
  korean: '한식',
  western: '양식',
  japanese: '일식',
  chinese: '중식',
  asian: '아시안',
};

const TRANSPORT: Record<string, PreferenceInputTransportModesItem> = {
  walk: '도보',
  transit: '대중교통',
  rental: '렌터카',
  taxi: '택시',
  bike: '자전거',
};

/** slug 배열을 매핑을 통과시켜 서버 값 배열로 — 알 수 없는 slug 는 버린다. null 은 null 유지. */
function mapAxis<T>(
  slugs: string[] | null,
  table: Record<string, T>
): T[] | null {
  if (slugs === null) return null;
  return slugs
    .map((slug) => table[slug])
    .filter((v): v is T => v !== undefined);
}

export function toPreferenceInput(
  draft: PreferenceDraftValues
): PreferenceInput {
  return {
    styles: mapAxis(draft.styles, STYLE),
    activities: mapAxis(draft.activities, ACTIVITY),
    transportModes: mapAxis(draft.transports, TRANSPORT),
    foodTastes: mapAxis(draft.foods, FOOD),
    companionTypes: mapAxis(draft.companions, COMPANION),
    petFlag: draft.companions?.includes('pet') ?? false,
    pace: draft.pace === null ? null : (PACE[draft.pace] ?? null),
    budgetTier: draft.budget === null ? null : (BUDGET[draft.budget] ?? null),
    budgetRawAmount: null,
  };
}
