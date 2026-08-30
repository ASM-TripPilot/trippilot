import { isAxiosError } from 'axios';
import { type ReactElement, useState } from 'react';
import { Share } from 'react-native';

import { resolveExportSummary } from '@/features/settings/model/exportSummary';
import { buildSettingsSections } from '@/features/settings/model/settingsSections';
import { SettingsScreen } from '@/features/settings/ui/SettingsScreen';
import {
  useDeleteMeDeletion,
  useGetMe,
  useGetMeExport,
  usePostMeDeletion,
} from '@/shared/api/generated/account/account';
import {
  useGetMeProfile,
  usePatchMeProfileNickname,
} from '@/shared/api/generated/profile/profile';
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

  const [truncatedLabel, setTruncatedLabel] = useState<string | null>(null);

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
    const { data } = await exportQuery.refetch();
    if (!data) return;
    const summary = resolveExportSummary(data);
    setTruncatedLabel(summary.truncatedLabel);

    const parts = [`TripPilot 내보내기 (${summary.sectionCount}개 섹션)`];
    if (summary.truncatedLabel) parts.push(summary.truncatedLabel);
    parts.push(JSON.stringify(data));
    await Share.share({ message: parts.join('\n\n') });
  };

  return (
    <SettingsScreen
      groups={buildSettingsSections({
        nickname: currentNickname,
        email: account.data?.email ?? null,
      })}
      deletionState={deletionState}
      purgeAt={purgeAt}
      currentNickname={currentNickname}
      nicknameError={nicknameError}
      truncatedLabel={truncatedLabel}
      cancelDeletionError={cancelDeletionError}
      onPressBack={() => loadRouter()?.back()}
      onSubmitNickname={submitNickname}
      onPressExport={() => void runExport()}
      onPressDeleteAccount={() => postDeletion.mutate()}
      onPressCancelDeletion={() => cancelDeletion.mutate()}
      onPressLocation={() => loadRouter()?.push('/settings/location')}
      onPressNotifications={() => loadRouter()?.push('/settings/notifications')}
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
