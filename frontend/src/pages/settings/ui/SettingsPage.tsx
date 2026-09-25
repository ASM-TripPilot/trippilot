import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { type ReactElement, useState } from 'react';
import { Share } from 'react-native';

import { usePreferenceStore } from '@/features/onboarding/model/preferenceStore';
import { OSM_COPYRIGHT_URL } from '@/features/settings/model/dataAttribution';
import { resolveExportSummary } from '@/features/settings/model/exportSummary';
import {
  buildSettingsSections,
  filterReadySettingsSections,
} from '@/features/settings/model/settingsSections';
import { SettingsScreen } from '@/features/settings/ui/SettingsScreen';
import { logout } from '@/shared/api';
import {
  useDeleteMeDeletion,
  useGetMe,
  useGetMeExport,
  usePostMeDeletion,
} from '@/shared/api/generated/account/account';
import { useGetMeLocationConsent } from '@/shared/api/generated/location/location';
import { useGetMePreferences } from '@/shared/api/generated/preferences/preferences';
import {
  getGetMeSettingsQueryKey,
  useGetMeProfile,
  useGetMeSettings,
  usePatchMeProfileNickname,
  usePatchMeSettings,
} from '@/shared/api/generated/profile/profile';
import { useGetMePersonalization } from '@/shared/api/generated/reflection/reflection';
import {
  type AccountSettings,
  PersonalizationInfoReason,
} from '@/shared/api/generated/schemas';
import { validateNicknameFormat } from '@/shared/validation/nicknameFormat';

/**
 * 라우팅 — `expo-router` 를 **정적 import 하지 않는다.** 정적 import 면 이 파일의 node-버킷 테스트
 * (`SettingsPage.test.tsx`, expo-router 미목)가 `@react-navigation` ESM 로드로 깨진다. require 를
 * **호출 시점까지** 늦춘다(모듈 로드가 아니라) — 목/실물이 없으면(미목 테스트) throw → catch → no-op.
 *
 * ⚠️ 호출 시점 require 인 이유(모듈 로드가 아니라): `SettingsPage.nav.test.tsx` 의 목
 * `jest.mock('expo-router', () => ({ router: { push: mockPush, ... } }))` 팩토리는 **첫 require 때**
 * 평가된다. 모듈 로드에서 당기면 그 첫 require 가 `const mockPush = jest.fn()` 배정 전에 돌아
 * `router.push` 가 undefined 로 굳는다(press 때 "not a function"). require 를 press 시점으로 늦추면
 * mockPush 배정 뒤 팩토리가 돌아 싱글턴 `router.push` 가 mockPush 를 받는다.
 */
function loadRouter(): typeof import('expo-router').router | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('expo-router') as typeof import('expo-router')).router;
  } catch {
    return null;
  }
}

/**
 * l05 설정 배선(pages 층) — 조회(useGetMe·useGetMeProfile)와 뮤테이션 4종(닉네임 PATCH · 삭제
 * POST · 철회 DELETE · 내보내기 지연 GET)을 화면에 잇는다. **판정·상태 전이는 여기서만** 산다
 * (화면은 순수 프레젠테이션).
 *
 * 표시값은 서버 값을 기본으로 하고 로컬 override 로 덮는다 — 조회가 늦게 도착해도(async) 초기엔
 * 서버 값을 보이고, 성공한 편집/삭제 뒤엔 override 가 이긴다(닉네임·삭제 상태 모두 이 패턴).
 */
export function SettingsPage(): ReactElement {
  const account = useGetMe();
  const profile = useGetMeProfile();
  const queryClient = useQueryClient();

  // 닉네임: 서버 값 기본 + 편집 성공 시 override(200 뒤 요약 갱신 / 409·503 뒤 미변경).
  const [nicknameOverride, setNicknameOverride] = useState<string | null>(null);
  const currentNickname = nicknameOverride ?? profile.data?.nickname ?? '';
  const [nicknameError, setNicknameError] = useState<string | null>(null);

  // 삭제 상태: 서버 status 기본 + 뮤테이션 성공 시 override(POST→pending / DELETE→active).
  const [deletionOverride, setDeletionOverride] = useState<
    'active' | 'pending' | null
  >(null);
  const deletionState =
    deletionOverride ??
    (account.data?.status === 'DELETION_PENDING' ? 'pending' : 'active');
  const [purgeAt, setPurgeAt] = useState<string | null>(null);
  const [cancelDeletionError, setCancelDeletionError] = useState(false);
  const [deleteRequestError, setDeleteRequestError] = useState(false);

  const [truncatedLabel, setTruncatedLabel] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // TRIP-778 행 값 — 조회 전·실패면 undefined 로 흘려 값·칩을 그리지 않는다(D4).
  // 위치 동의는 GET 만 쓴다: `useLocationConsent` 는 마운트 시 OS 권한 미러 PATCH 를 쏜다.
  const preferences = useGetMePreferences();
  const locationConsent = useGetMeLocationConsent();
  const personalization = useGetMePersonalization();
  const personalizationReason = personalization.data?.reason;

  // 제휴 안내: 진실은 `/me/settings` 쿼리 캐시 하나다(숙소 상세도 같은 키를 읽는다 — AC-11).
  // 라벨이 "다시 보기"라 ON = dismissed:false — 서버 값 ↔ UI 반전은 여기 한 곳에서만 한다.
  const settingsKey = getGetMeSettingsQueryKey();
  const accountSettings = useGetMeSettings();
  const dismissed = accountSettings.data?.affiliateNoticeDismissed;
  const [affiliateNoticeError, setAffiliateNoticeError] = useState(false);
  const patchSettings = usePatchMeSettings<
    unknown,
    { previous?: AccountSettings }
  >({
    mutation: {
      // 낙관 반영 — 응답 전에 캐시를 먼저 바꾸고, 실패하면 이전 값으로 되돌린다(D7).
      onMutate: ({ data }) => {
        const previous = queryClient.getQueryData<AccountSettings>(settingsKey);
        queryClient.setQueryData<AccountSettings>(settingsKey, {
          affiliateNoticeDismissed: data.affiliateNoticeDismissed === true,
        });
        setAffiliateNoticeError(false);
        return { previous };
      },
      onSuccess: (data) => {
        queryClient.setQueryData(settingsKey, data);
      },
      onError: (_error, _variables, context) => {
        if (context?.previous)
          queryClient.setQueryData(settingsKey, context.previous);
        setAffiliateNoticeError(true);
      },
    },
  });

  const patchNickname = usePatchMeProfileNickname({
    mutation: {
      onSuccess: (data, variables) => {
        // 서버 응답 닉네임을 우선하되, 없으면 방금 보낸 값으로 요약을 갱신한다.
        setNicknameOverride(data?.nickname ?? variables.data.nickname);
        setNicknameError(null);
      },
      onError: (error) => {
        setNicknameError(classifyNicknameError(error));
      },
    },
  });

  const postDeletion = usePostMeDeletion({
    mutation: {
      onSuccess: (data) => {
        setDeletionOverride('pending');
        setPurgeAt(data?.purgeAt ?? null);
        setDeleteRequestError(false);
      },
      // 5xx·네트워크 오류 모두 — 상태는 active 그대로, 인라인 오류로 알린다(TRIP-935 R5, INV-4).
      onError: () => {
        setDeleteRequestError(true);
      },
    },
  });

  const cancelDeletion = useDeleteMeDeletion({
    mutation: {
      onSuccess: () => {
        setDeletionOverride('active');
        setPurgeAt(null);
        setCancelDeletionError(false);
      },
      // 404 는 "유예 없음"이지 성공이 아니다. 그 밖의 실패도 조용히 넘기지 않고 안내한다(INV-4).
      onError: () => {
        setCancelDeletionError(true);
      },
    },
  });

  const exportQuery = useGetMeExport(undefined, { query: { enabled: false } });

  const submitNickname = (draft: string): void => {
    const check = validateNicknameFormat(draft);
    if (!check.valid) {
      setNicknameError(
        check.reason === 'TOO_SHORT'
          ? '닉네임은 2자 이상이어야 해요'
          : '닉네임은 20자 이하여야 해요'
      );
      return;
    }
    setNicknameError(null);
    patchNickname.mutate({ data: { nickname: draft } });
  };

  const runExport = async (): Promise<void> => {
    // refetch 는 실패해도 throw 하지 않고 { data, error } 를 resolve 한다(react-query) — data 가
    // 없으면 조용히 삼키지 않고 인라인 오류로 표면화한다(INV-4).
    const { data } = await exportQuery.refetch();
    if (!data) {
      // 실패 시 직전 성공의 잘림 고지를 함께 비운다 — 오류 옆에 낡은 "일부 잘림" 이 남으면
      // 인접 거짓 표면이 된다(5-b 경고-1, INV-4).
      setTruncatedLabel(null);
      setExportError('내보내기 정보를 불러오지 못했어요. 다시 시도해 주세요.');
      return;
    }
    setExportError(null);
    const summary = resolveExportSummary(data);
    setTruncatedLabel(summary.truncatedLabel);

    const parts = [`TripPilot 내보내기 (${summary.sectionCount}개 섹션)`];
    if (summary.truncatedLabel) parts.push(summary.truncatedLabel);
    parts.push(JSON.stringify(data));
    await Share.share({ message: parts.join('\n\n') });
  };

  // 로그아웃(TRIP-938): 토큰 삭제 → 이전 계정 캐시 비우기 → 게이트('/')에 인계. replace 라 뒤로가기로
  // 설정에 못 돌아온다. 로그인 경로로 직접 가지 않는 이유 — (auth) 는 게이트가 재조회를 마쳐야 열린다.
  const runLogout = async (): Promise<void> => {
    await logout();
    queryClient.clear();
    usePreferenceStore.getState().reset();
    loadRouter()?.replace('/');
  };

  return (
    <SettingsScreen
      groups={filterReadySettingsSections(
        buildSettingsSections({
          nickname: currentNickname,
          email: account.data?.email ?? null,
          preferences: preferences.data,
          locationConsent: locationConsent.data?.legalConsent,
          personalizationOn:
            personalizationReason === undefined
              ? undefined
              : personalizationReason !==
                PersonalizationInfoReason.CONSENT_MISSING,
        })
      )}
      deletionState={deletionState}
      purgeAt={purgeAt}
      currentNickname={currentNickname}
      nicknameError={nicknameError}
      truncatedLabel={truncatedLabel}
      cancelDeletionError={cancelDeletionError}
      deleteRequestError={deleteRequestError}
      exportError={exportError}
      onPressBack={() => loadRouter()?.back()}
      onSubmitNickname={submitNickname}
      onPressExport={() => void runExport()}
      onPressDeleteAccount={() => postDeletion.mutate()}
      onPressCancelDeletion={() => cancelDeletion.mutate()}
      onPressLocation={() => loadRouter()?.push('/settings/location')}
      onPressNotifications={() => loadRouter()?.push('/settings/notifications')}
      onPressTerms={(termsType) => loadRouter()?.push(`/terms/${termsType}`)}
      onPressLogout={() => void runLogout()}
      onPressPreferences={() => loadRouter()?.push('/settings/preferences')}
      onPressPersonalization={() =>
        loadRouter()?.push('/settings/personalization')
      }
      affiliateNoticeOn={dismissed === undefined ? null : !dismissed}
      affiliateNoticeError={affiliateNoticeError}
      onToggleAffiliateNotice={() => {
        if (dismissed === undefined) return;
        // 보낸 필드만 바뀐다(생략 = 변경 없음) — 본문은 이 한 필드뿐이다.
        patchSettings.mutate({
          data: { affiliateNoticeDismissed: !dismissed },
        });
      }}
      // 스토어 버전과 같은 출처(app.config version). 없으면 화면이 버전 줄을 그리지 않는다(TRIP-935 R4).
      appVersion={Constants.expoConfig?.version}
      onPressOsmCopyright={() => {
        // 브라우저를 못 열어도 설정 화면은 그대로 둔다(TRIP-886 Q3 — 링크 실패는 무시).
        Linking.openURL(OSM_COPYRIGHT_URL).catch(() => undefined);
      }}
    />
  );
}

/** 서버 권한 경계 — 중복(409)·모더레이션(503)은 서버가 판정, 화면은 인라인으로 표면화만 한다. */
function classifyNicknameError(error: unknown): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 409) return '이미 사용 중인 닉네임이에요';
  if (status === 503)
    return '지금은 확인할 수 없어요. 잠시 후 다시 시도해 주세요';
  return '변경에 실패했어요. 잠시 후 다시 시도해 주세요';
}
