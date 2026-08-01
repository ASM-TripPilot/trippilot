import { useGetMePreferences } from '@/shared/api/generated/preferences/preferences';

/**
 * 생성 훅(`useGetMePreferences`)을 도메인 이름으로 재수출한다(`useStaySearch` 선례, 몸통
 * 1줄). 여행 생성 폼이 계정 취향으로 프리필하는 용도다(BR-U1-38 — 온보딩 값을 프리필해
 * "당신 취향으로 맞췄어요"로 보이되, 여행 단위로 덮어쓸 수 있다). 계정 취향 자체를 바꾸는
 * 것은 이 훅의 일이 아니다.
 */
export function usePreferencePrefill() {
  return useGetMePreferences();
}
