// 순수 뷰·글리프·config·순수 model 은 index.view 가 정본이고, 여기엔 네트워크 훅 등 그 밖의 것만 더한다.
export * from './index.view';

export { appliedSummaryBadges, appliedSummaryInputFromDiff } from './model/appliedSummary';
export { useActiveTriggers } from './model/useActiveTriggers';
