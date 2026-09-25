/**
 * e03 숙소 상세 배선(TRIP-457 · US-STAY-*). 화면·시트는 라우터·훅·Linking 을 모르므로(FSD 경계),
 * params 파싱·저장 요청·웹검색 이동·로그인 유도는 이 배선 층에서만 일어난다.
 *
 * 데이터는 손에 든 `item`(JSON param)에서 온다(계약 GET 부재, 01b Q1) — `useLocalSearchParams`로
 * 받아 `JSON.parse`한다. 파싱 실패·부재는 `null`로 접어 화면이 notFound 얼굴을 그린다(INV-4, ★F-9).
 * 저장 하트·"일정에 추가"는 `useSavedStays`(TRIP-417 토글 훅) 하나가 소유하고, 미인증은 요청 없이
 * 로그인으로 보낸다(BR-U1-03·55, 죽은 버튼 회피). "외부에서 예약하기"는 제휴 시트(BR-U1-30) →
 * [이동] 웹검색 폴백(`openStayOutbound`, BR-U1-31).
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
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getAccessToken } from '@/shared/api/tokenManager';
import {
  getGetMeSettingsQueryKey,
  useGetMeSettings,
  usePatchMeSettings,
} from '@/shared/api/generated/profile/profile';
import type { AccountSettings, StayItem } from '@/shared/api/generated/schemas';

import { useSavedStays } from '@/features/stay/model/savedStays';
import { openStayOutbound } from '@/features/stay/model/stayOutbound';
import { stayKey } from '@/features/stay/model/stayKey';
import { OtaChoiceSheet } from '@/features/stay/ui/OtaChoiceSheet';
import { StayDetailScreen } from '@/features/stay/ui/StayDetailScreen';

/** `item` param(JSON)을 파싱한다 — 손에 든 카드 데이터가 유일한 데이터 출처(GET 계약 부재).
 * 파싱 실패·부재·**형태 불일치**는 `null`로 접는다(INV-4) → 화면이 notFound 얼굴을 그린다.
 *
 * ⚠️ `JSON.parse`는 `123`·`{}`·`[]`·`"x"` 같은 **문법상 유효하지만 StayItem이 아닌** 값도
 * 성공시킨다 — 그대로 통과하면 화면의 `item.amenities.length`에서 `undefined.length` 크래시
 * (미인증 딥링크 `stays/x?item=123`로 도달 가능, 신뢰 경계). `as StayItem` 캐스트는 tsc가 믿을
 * 뿐 런타임 보장이 아니므로, 화면이 실제로 읽는 최소 형태(객체 + amenities 배열)를 여기서 한 번
 * 검문한다(5-b 경고-1 봉합). */
function isStayItemShape(value: unknown): value is StayItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as StayItem).amenities)
  );
}

function parseItem(raw?: string | string[]): StayItem | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isStayItemShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function StayDetailPage(): ReactElement {
  const router = useRouter();
  const { item: itemParam } = useLocalSearchParams<{
    stayId?: string;
    item?: string;
  }>();
  const item = parseItem(itemParam);

  // isAuthed는 렌더 시점 1회 동기 판정(StaySearchPage·PlaceExplorePage 선례 — "판정 대기" 제3
  // 상태가 안 생긴다). 담김 판정·토글은 useSavedStays 한 곳이 소유한다.
  const isAuthed = getAccessToken() !== null;
  const { isSaved, save, remove } = useSavedStays({ isAuthed });

  const [pending, setPending] = useState(false);
  const [addedNotice, setAddedNotice] = useState(false);
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

  // "일정에 추가" = 담기(거점 후보 편입) + 안내(AC-10). 미인증은 로그인 유도(죽은 버튼 아님).
  async function handleAddToTrip(): Promise<void> {
    if (item === null) {
      return;
    }
    setPending(true);
    const outcome = await save(item);
    setPending(false);
    if (outcome.kind === 'failed' && outcome.reason === 'unauthenticated') {
      router.push('/(auth)/login');
      return;
    }
    if (outcome.kind === 'saved') {
      setAddedNotice(true);
    }
  }

  // 웹검색 폴백으로 연다(01b Q2). 성공하면 시트를 닫고, 실패하면 시트를 error 얼굴로 연다 — 생략
  // 경로(시트가 닫혀 있던 때)도 같다. 침묵 금지(BR-U1-55).
  async function runOutbound(): Promise<void> {
    if (item === null) {
      return;
    }
    const result = await openStayOutbound(item, () => {});
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
        item={item}
        saved={saved}
        pending={pending}
        addedNotice={addedNotice}
        onToggleSave={() => void handleToggleSave()}
        onPressBook={handlePressBook}
        onPressAddToTrip={() => void handleAddToTrip()}
        onPressBack={() => router.back()}
      />
      {otaOpen && item !== null ? (
        <OtaChoiceSheet
          item={item}
          variant={outboundError ? 'error' : 'default'}
          dontShowAgain={dontShowAgain}
          onToggleDontShowAgain={() => setDontShowAgain((on) => !on)}
          showDontShowAgain={isAuthed}
          onCancel={handleCancelOutbound}
          onConfirm={handleConfirmOutbound}
          onRetry={() => void runOutbound()}
        />
      ) : null}
    </>
  );
}
