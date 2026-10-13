/**
 * e03 숙소 상세 배선(TRIP-457 · US-STAY-*). 화면·시트는 라우터·훅·Linking 을 모르므로(FSD 경계),
 * 조회·저장 요청·아웃바운드 이동·전화 열기·로그인 유도는 이 배선 층에서만 일어난다.
 *
 * 데이터는 `GET /stays/{stayId}` 하나에서 온다(TRIP-940 D0 — 진입부 목록 값을 placeholder 로도 쓰지
 * 않는다). 조회 결과를 화면의 `state` 로 번역한다: 응답 전=loading · 404=notFound · 400 또는 stayId
 * 없음=invalid · 그 밖(5xx·네트워크)=error(INV-4). 404·400 은 다시 해도 같으므로 자동 재시도를 끈다
 * (운영 QueryClient 기본 3회 → 약 7초 로딩 방지, AC-13). 재시도는 error 얼굴의 버튼이 맡는다.
 * 저장 하트는 `useSavedStays`(TRIP-417 토글 훅) 하나가 소유하고, 미인증은 요청 없이
 * 로그인으로 보낸다(BR-U1-03·55, 죽은 버튼 회피). "외부에서 예약하기"는 제휴 시트(BR-U1-30) →
 * [이동] 서버 아웃바운드(`openStayOutbound`, TRIP-1167).
 *
 * TRIP-781(l07): 시트의 열림·error 얼굴·"다시 보지 않기" 체크는 전부 이 층이 쥔다(시트는 제어 컴포넌트).
 * 저장값이 켜져 있으면 시트 없이 바로 이동하고, 그 이동이 실패하면 error 얼굴 시트를 새로 연다(BR-U1-55).
 * 저장값을 아직 못 받았거나 조회가 실패하면 고지 쪽으로 쓰러진다(시트를 띄운다).
 *
 * TRIP-778: 저장처는 서버 `/me/settings.affiliateNoticeDismissed`(계정 단위, BR-U6-33)다. l05 토글과 같은
 * 쿼리 키를 읽으므로 한쪽의 변경을 다른 쪽이 그대로 본다. 게스트는 조회도 캐시 판독도 하지 않고 체크박스도 숨긴다(D9).
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Share } from 'react-native';

import { isNotFound } from '@/shared/api';
import { getAccessToken } from '@/shared/api';
import {
  getGetMeSettingsQueryKey,
  useGetMeSettings,
  usePatchMeSettings,
} from '@/shared/api/index.hooks';
import { useGetStaysStayId } from '@/shared/api/index.hooks';
import type { AccountSettings, StayDetail } from '@/shared/api/index.schemas';

import { useSavedStays } from '@/features/save-stay';
import { openStayOutbound, stayOutboundMode } from '../model/stayOutbound';
import { stayKey } from '@/features/save-stay';
import { OtaChoiceSheet } from './OtaChoiceSheet';
import { StayDetailScreen, type StayDetailState } from './StayDetailScreen';

/** 조회 결과 → 화면 얼굴. 404 만 notFound, 400 은 invalid, 응답 없음(네트워크)·5xx 는 error(INV-4). */
function resolveDetailState(
  stayId: string,
  query: UseQueryResult<StayDetail, unknown>
): StayDetailState {
  if (stayId === '') {
    return { kind: 'invalid' };
  }
  if (query.isSuccess) {
    return { kind: 'ready', detail: query.data };
  }
  if (!query.isError) {
    return { kind: 'loading' };
  }
  if (isNotFound(query.error)) {
    return { kind: 'notFound' };
  }
  if (isAxiosError(query.error) && query.error.response?.status === 400) {
    return { kind: 'invalid' };
  }
  return { kind: 'error' };
}

export function StayDetailPage(): ReactElement {
  const router = useRouter();
  const { stayId = '' } = useLocalSearchParams<{ stayId?: string }>();
  // 빈 stayId 는 요청하지 않는다 — 생성 훅의 기본 enabled 는 null/undefined 만 걸러 '' 이면
  // `GET /stays/` 로 새어 나간다. 404·400 은 재시도해도 같아 자동 재시도를 끈다(AC-13).
  const detailQuery = useGetStaysStayId(stayId, {
    query: { enabled: stayId !== '', retry: false },
  });
  const state = resolveDetailState(stayId, detailQuery);
  // 저장·예약은 조회 결과(StayItem 상위집합)로만 한다 — 응답 전엔 null 이라 버튼도 없다.
  const item = state.kind === 'ready' ? state.detail : null;

  // isAuthed는 렌더 시점 1회 동기 판정(StaySearchPage·PlaceExplorePage 선례 — "판정 대기" 제3
  // 상태가 안 생긴다). 담김 판정·토글은 useSavedStays 한 곳이 소유한다.
  const isAuthed = getAccessToken() !== null;
  const { isSaved, save, remove } = useSavedStays({ isAuthed });

  const [pending, setPending] = useState(false);
  const [otaOpen, setOtaOpen] = useState(false);
  const [outboundError, setOutboundError] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  // 응답 전·조회 실패·게스트 = false(고지 쪽으로 닫힌 실패, BR-U1-30). 꺼진 쿼리도 캐시 값은
  // 돌려주므로(이전 계정의 true가 남을 수 있다) 게스트는 캐시를 아예 읽지 않는다(D9).
  const queryClient = useQueryClient();
  const settingsKey = getGetMeSettingsQueryKey();
  const accountSettings = useGetMeSettings({ query: { enabled: isAuthed } });
  const noticeDismissed =
    isAuthed && (accountSettings.data?.affiliateNoticeDismissed ?? false);
  const patchSettings = usePatchMeSettings<
    void,
    { previous?: AccountSettings }
  >({
    mutation: {
      // 누른 순간 캐시에 반영한다 — 같은 화면에서 다시 눌러도 시트가 안 뜬다(781 I23).
      onMutate: () => {
        const previous = queryClient.getQueryData<AccountSettings>(settingsKey);
        queryClient.setQueryData<AccountSettings>(settingsKey, {
          affiliateNoticeDismissed: true,
        });
        return { previous };
      },
      onSuccess: (data) => queryClient.setQueryData(settingsKey, data),
      // 저장 실패 = 낙관값을 먼저 걷어낸다(재조회까지 실패해도 true가 남지 않게) → 서버 값 재조회.
      // 이전 값이 없으면 false — 다음에 시트가 다시 뜬다(고지 쪽).
      onError: (_error, _variables, context) => {
        queryClient.setQueryData<AccountSettings>(
          settingsKey,
          context?.previous ?? { affiliateNoticeDismissed: false }
        );
        void queryClient.invalidateQueries({ queryKey: settingsKey });
      },
    },
  });

  const saved = item !== null && isSaved(stayKey(item));

  // 하트 = 토글(담김이면 해제, 아니면 담기). 미인증 누름은 요청 없이 로그인으로(BR-U1-03·Q6).
  async function handleToggleSave(): Promise<void> {
    if (item === null) {
      return;
    }
    setPending(true);
    const outcome = saved ? await remove(item) : await save(item);
    setPending(false);
    if (outcome.kind === 'failed' && outcome.reason === 'unauthenticated') {
      router.push('/(auth)/login');
    }
  }

  // 서버 아웃바운드로 연다(TRIP-1167). 성공하면 시트를 닫고, 실패하면 시트를 error 얼굴로 연다 — 생략
  // 경로(시트가 닫혀 있던 때)도 같다. 침묵 금지(BR-U1-55).
  async function runOutbound(): Promise<void> {
    if (item === null) {
      return;
    }
    const result = await openStayOutbound(stayId, () => {});
    const failed = result === 'failed';
    setOutboundError(failed);
    setOtaOpen(failed);
  }

  function handlePressBook(): void {
    if (noticeDismissed) {
      void runOutbound();
      return;
    }
    // 시트를 열 때마다 체크는 해제·default 얼굴에서 시작한다(01b).
    setDontShowAgain(false);
    setOutboundError(false);
    setOtaOpen(true);
  }

  // [이동] — 체크돼 있으면 누른 순간 저장한다(이동 결과와 무관, 01b Q4). 보낸 필드만 바뀐다.
  function handleConfirmOutbound(): void {
    if (dontShowAgain) {
      patchSettings.mutate({ data: { affiliateNoticeDismissed: true } });
    }
    void runOutbound();
  }

  function handleCancelOutbound(): void {
    setOtaOpen(false);
    setOutboundError(false);
  }

  return (
    <>
      <StayDetailScreen
        state={state}
        saved={saved}
        pending={pending}
        onToggleSave={() => void handleToggleSave()}
        onPressBook={handlePressBook}
        onPressBack={() => router.back()}
        // 전화 앱이 없으면(시뮬레이터 등) 열기가 실패한다 — 부가 동선이라 삼킨다(TRIP-940 Q5).
        onPressPhone={() => {
          if (item?.phone != null) {
            Linking.openURL(`tel:${item.phone}`).catch(() => undefined);
          }
        }}
        onRetry={() => void detailQuery.refetch()}
        // 딥링크 URL 계약이 없어 링크는 안 붙인다(TRIP-989 Q5). 주소가 비어 있지 않을 때만 둘째 줄로 붙인다
        // (TRIP-1019 #017) — null·키 없음·"" 은 이름만(`"undefined"`·빈 줄이 새지 않게 truthy 로 가른다).
        onPressShare={() => {
          if (item !== null)
            void Share.share({
              message: item.address
                ? `${item.name}\n${item.address}`
                : item.name,
            });
        }}
      />
      {otaOpen && item !== null ? (
        <OtaChoiceSheet
          item={item}
          variant={outboundError ? 'error' : 'default'}
          dontShowAgain={dontShowAgain}
          onToggleDontShowAgain={() => setDontShowAgain((on) => !on)}
          showDontShowAgain={isAuthed}
          // 이동 방식이 시트 얼굴(수수료 고지 유무)을 정한다 — 지금은 늘 제휴(TRIP-1167).
          outbound={stayOutboundMode()}
          onCancel={handleCancelOutbound}
          onConfirm={handleConfirmOutbound}
          onRetry={() => void runOutbound()}
        />
      ) : null}
    </>
  );
}
