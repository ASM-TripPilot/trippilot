/**
 * TRIP-778 · l05 설정 취향 축별 요약 — 서버 취향(`PreferenceView`)을 축 key 별 요약으로 바꾼다.
 * TRIP-1051 부터 설정 화면은 `kind` 로 설정된 축 수만 센다. 값 문자열(`text`)은 소비처가 없어 TRIP-1355 에서 지웠다.
 *
 * 미설정 판정은 편집 화면과 같은 `initialSelection`(축 부재·`isNeutralDefault` → null)을 그대로 쓴다.
 * 동행은 반려동물만 있어도 값이고, 예산은 등급만 본다(`rawAmount` 무시, D6).
 */
import type { PreferenceView } from '@/shared/api/index.schemas';

import { initialSelection } from '@/features/edit-preferences';

export type PreferenceRowKey =
  | 'style'
  | 'budget'
  | 'companions'
  | 'activities'
  | 'transport'
  | 'food'
  | 'pace';

export type PreferenceSummary = { kind: 'value' } | { kind: 'unset' };

function summarize(
  values: (string | null | undefined)[] | null
): PreferenceSummary {
  const present = (values ?? []).filter((v): v is string => !!v);
  return present.length > 0 ? { kind: 'value' } : { kind: 'unset' };
}

export function summarizePreferences(
  view: PreferenceView
): Record<PreferenceRowKey, PreferenceSummary> {
  const s = initialSelection(view);
  return {
    style: summarize(s.styles),
    budget: summarize([s.budgetTier]),
    companions: summarize([
      ...(s.companionTypes ?? []),
      s.petFlag ? '반려동물' : null,
    ]),
    activities: summarize(s.activities),
    transport: summarize(s.transportModes),
    food: summarize(s.foodTastes),
    pace: summarize([s.pace]),
  };
}
