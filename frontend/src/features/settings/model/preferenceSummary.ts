/**
 * TRIP-778 · l05 설정 취향 7행 값 — 서버 취향(`PreferenceView`)을 행 key 별 요약으로 바꾼다.
 *
 * 미설정 판정은 편집 화면과 같은 `initialSelection`(축 부재·`isNeutralDefault` → null)을 그대로 쓴다.
 * 값은 서버 enum 원문을 서버 순서대로 가운뎃점으로 잇는다(D5). 동행은 반려동물을 덧붙이고,
 * 예산은 등급만 쓴다(`rawAmount` 무시, D6).
 */
import type { PreferenceView } from '@/shared/api/generated/schemas';

import { initialSelection } from './preferenceDraft';

export type PreferenceRowKey =
  | 'style'
  | 'budget'
  | 'companions'
  | 'activities'
  | 'transport'
  | 'food'
  | 'pace';

export type PreferenceSummary =
  { kind: 'value'; text: string } | { kind: 'unset' };

const DOT = '·';

function summarize(
  values: (string | null | undefined)[] | null
): PreferenceSummary {
  const present = (values ?? []).filter((v): v is string => !!v);
  return present.length > 0
    ? { kind: 'value', text: present.join(DOT) }
    : { kind: 'unset' };
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
