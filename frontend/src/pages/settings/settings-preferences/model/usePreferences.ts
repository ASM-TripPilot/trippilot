/**
 * l05 취향 수정 데이터 훅 (TRIP-610 · frontend-components §4) — GET 초기값 + PUT 저장 + 400 표식.
 *
 * 생성 훅(`useGetMePreferences`·`usePutMePreferences`)을 얇게 감싸 화면이 필요한 것만 노출한다.
 * `save`는 mutator 계약대로 `{ data }`로 감싸 PUT 한다(와이어 바디 = `data`). 400(ValidationError)은
 * `saveError`로 표면화한다(INV-4 — 침묵·낙관 확정 금지, 화면이 인라인 오류로 그린다).
 *
 * 격리 테스트하지 않는다(02a §1) — GET 초기값·PUT 저장·400 행위는 화면 통합테스트가 관통 검증한다.
 */
import { useQueryClient } from '@tanstack/react-query';

import { isOfflineWaiting } from '@/shared/api';
import type { PreferenceInput } from '@/shared/api/index.schemas';
import {
  getGetMePreferencesQueryKey,
  useGetMePreferences,
  usePutMePreferences,
} from '@/shared/api/index.hooks';

export interface UsePreferencesResult {
  view: ReturnType<typeof useGetMePreferences>['data'];
  isLoading: boolean;
  /**
   * TRIP-1755 · 받아 본 값이 없는데 실패했거나(`errorUpdateCount` — 다시 시도로 `isError` 가 꺼진 틈 포함) 오프라인 보류 중.
   * 받아 둔 값이 있으면 재조회가 실패해도 false.
   */
  loadFailed: boolean;
  /** 다시 받는 중 — 화면이 다시 시도를 잠근다. */
  isFetching: boolean;
  refetch: () => unknown;
  /** `onSaved` 는 PUT 성공 뒤에만 불린다(화면이 토스트·뒤로 가기를 건다). */
  save: (input: PreferenceInput, onSaved?: () => void) => void;
  saveError: boolean;
}

export function usePreferences(): UsePreferencesResult {
  const query = useGetMePreferences();
  const queryClient = useQueryClient();
  // 저장 성공 뒤 조회를 낡음 표시 — 스택에 남은 설정(l05)의 취향 요약이 옛 값을 보이지 않게 한다(TRIP-778 D11).
  const mutation = usePutMePreferences({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: getGetMePreferencesQueryKey(),
        }),
    },
  });

  return {
    view: query.data,
    isLoading: query.isPending,
    loadFailed:
      query.data === undefined &&
      (query.isError || query.errorUpdateCount > 0 || isOfflineWaiting(query)),
    isFetching: query.isFetching,
    refetch: query.refetch,
    save: (input, onSaved) =>
      mutation.mutate({ data: input }, { onSuccess: onSaved }),
    saveError: mutation.isError,
  };
}
