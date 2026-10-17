import { useQuery } from '@tanstack/react-query';

import { initialSelection } from '@/features/edit-preferences';
import {
  ONBOARDING_TERMS_TYPES,
  type OnboardingProgress,
} from '@/features/onboarding';
import { fetchConsents, isNotFound } from '@/shared/api';
import { useGetMePreferences, useGetMeProfile } from '@/shared/api/index.hooks';
import type { PreferenceView } from '@/shared/api/index.schemas';

/**
 * 재진입 판정 재료 — 서버 GET 3개(`/me/consents`·`/me/profile`·`/me/preferences`)를 진행 상태로 접는다
 * (TRIP-1421 결정 ②). 셋 다 **이번 마운트 뒤에** 답이 와야 값을 낸다(그 전엔 null): 앱 전역 staleTime(30초)
 * 안의 캐시는 다른 계정·이전 단계의 옛 답일 수 있어, 그 값으로 한 번짜리 Redirect 를 하면 엉뚱한 단계로 간다.
 * 실패한 축은 "미완"으로 접는다 — 막다른 화면 대신 한 단계를 다시 보는 쪽이 안전하다(프로필 404 = 닉네임 없음).
 */

// 실패 한 번만 다시 묻는다 — 전역 3회(지연 2·4·5초)면 오프라인에서 빈 화면이 약 11초 간다.
const retryOnce = (failureCount: number, error: unknown) =>
  failureCount < 1 && !isNotFound(error);

const AFTER_MOUNT = { refetchOnMount: 'always', retry: retryOnce } as const;

/** 설정 화면 "N/6"과 같은 정의 — 예산 제외 6축 중 하나라도 설정됐거나 반려동물 동행. */
function hasSavedPreferences(view: PreferenceView): boolean {
  const { petFlag, ...axes } = initialSelection(view);
  return petFlag || Object.values(axes).some((axis) => axis !== null);
}

export function useOnboardingProgress(): OnboardingProgress | null {
  const consents = useQuery({
    queryKey: ['/me/consents'],
    queryFn: fetchConsents,
    ...AFTER_MOUNT,
  });
  const profile = useGetMeProfile({ query: AFTER_MOUNT });
  const preferences = useGetMePreferences({ query: AFTER_MOUNT });

  if (
    !consents.isFetchedAfterMount ||
    !profile.isFetchedAfterMount ||
    !preferences.isFetchedAfterMount
  ) {
    return null;
  }

  return {
    termsCompleted:
      consents.isSuccess &&
      ONBOARDING_TERMS_TYPES.every((type) =>
        consents.data.some((row) => row.termsType === type && row.granted)
      ),
    nicknameCompleted: profile.isSuccess,
    preferencesSaved:
      preferences.isSuccess && hasSavedPreferences(preferences.data),
  };
}
