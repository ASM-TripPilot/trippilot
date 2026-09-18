/**
 * l05 취향 수정 데이터 훅 (TRIP-610 · frontend-components §4) — GET 초기값 + PUT 저장 + 400 표식.
 *
 * 생성 훅(`useGetMePreferences`·`usePutMePreferences`)을 얇게 감싸 화면이 필요한 것만 노출한다.
 * `save`는 mutator 계약대로 `{ data }`로 감싸 PUT 한다(와이어 바디 = `data`). 400(ValidationError)은
 * `saveError`로 표면화한다(INV-4 — 침묵·낙관 확정 금지, 화면이 인라인 오류로 그린다).
 *
 * 격리 테스트하지 않는다(02a §1) — GET 초기값·PUT 저장·400 행위는 화면 통합테스트가 관통 검증한다.
 */
import type { PreferenceInput } from '@/shared/api/generated/schemas';
import {
  useGetMePreferences,
  usePutMePreferences,
} from '@/shared/api/generated/preferences/preferences';

export interface UsePreferencesResult {
  view: ReturnType<typeof useGetMePreferences>['data'];
  isLoading: boolean;
  save: (input: PreferenceInput) => void;
  saveError: boolean;
}

export function usePreferences(): UsePreferencesResult {
  const query = useGetMePreferences();
  const mutation = usePutMePreferences();

  return {
    view: query.data,
    isLoading: query.isPending,
    save: (input) => mutation.mutate({ data: input }),
    saveError: mutation.isError,
  };
}
