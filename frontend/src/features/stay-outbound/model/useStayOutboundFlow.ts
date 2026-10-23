/**
 * 제휴 고지 → 서버 아웃바운드 흐름 훅(TRIP-1579 — StayDetailPage 에 있던 흐름을 그대로 뽑았다, TRIP-781·778·1167).
 *
 * `request(target, query?)` 하나로 연다. 저장값(`/me/settings.affiliateNoticeDismissed`)이 켜져 있으면 시트 없이
 * 바로 이동하고, 그 이동이 실패하면 error 얼굴 시트를 연다(BR-U1-55). 그 밖엔 고지 시트(BR-U1-30)를 먼저 띄운다.
 * 저장값을 아직 못 받았거나 조회가 실패하면 고지 쪽으로 쓰러진다. 게스트는 조회도 캐시 판독도 하지 않고
 * 체크박스도 숨긴다(TRIP-778 D9). l05 토글과 같은 쿼리 키를 읽으므로 한쪽의 변경을 다른 쪽이 그대로 본다.
 *
 * 반환 `sheetProps` 는 시트가 열렸을 때만 값이 있다 — 소비처는 `<OtaChoiceSheet {...sheetProps} />` 로 꽂는다.
 * 대상: 'stay' = 호텔 상세 아웃바운드(상세 화면·인기 숙소 카드), 'browse' = 지역 숙소 목록(Trip.com 전체 보기).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getAccessToken } from '@/shared/api';
import {
  getGetMeSettingsQueryKey,
  useGetMeSettings,
  usePatchMeSettings,
} from '@/shared/api/index.hooks';
import type { AccountSettings, StayItem } from '@/shared/api/index.schemas';

import type { OtaChoiceSheetProps } from '../ui/OtaChoiceSheet';
import {
  openBrowseOutbound,
  openStayOutbound,
  stayOutboundMode,
  type OutboundQuery,
} from './stayOutbound';

export type OutboundTarget =
  | {
      kind: 'stay';
      stayId: string;
      /** 시트 표시명 사전 키(`externalSource`). */
      source: string;
      /** 가격 칸을 그릴지 — 생략 = false(인기 숙소엔 가격이 없다). 상세 화면은 true + price. */
      showPrice?: boolean;
      price?: StayItem['price'];
    }
  | { kind: 'browse'; region?: string; regionCode?: string };

interface Pending {
  target: OutboundTarget;
  query?: OutboundQuery;
}

// 전체 보기는 Trip.com 지역 목록으로만 간다(서버 계약 `/stays/browse/outbound`).
const BROWSE_SOURCE = 'TRIPCOM';

export function useStayOutboundFlow(): {
  request: (target: OutboundTarget, query?: OutboundQuery) => void;
  sheetProps: OtaChoiceSheetProps | null;
} {
  // 렌더 시점 1회 동기 판정(StayDetailPage 선례 — "판정 대기" 제3 상태가 안 생긴다).
  const isAuthed = getAccessToken() !== null;
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);
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

  // 성공하면 시트를 닫고, 실패하면 시트를 error 얼굴로 연다 — 생략 경로(시트가 닫혀 있던 때)도 같다. 침묵 금지(BR-U1-55).
  async function runOutbound(next: Pending): Promise<void> {
    const { target, query } = next;
    const result =
      target.kind === 'stay'
        ? await openStayOutbound(target.stayId, () => {}, query)
        : await openBrowseOutbound(target, () => {}, query);
    const failed = result === 'failed';
    setOutboundError(failed);
    setOpen(failed);
  }

  function request(target: OutboundTarget, query?: OutboundQuery): void {
    const next = { target, query };
    setPending(next);
    if (noticeDismissed) {
      void runOutbound(next);
      return;
    }
    // 시트를 열 때마다 체크는 해제·default 얼굴에서 시작한다(01b).
    setDontShowAgain(false);
    setOutboundError(false);
    setOpen(true);
  }

  if (!open || pending === null) {
    return { request, sheetProps: null };
  }

  const { target } = pending;
  return {
    request,
    sheetProps: {
      item:
        target.kind === 'stay'
          ? { externalSource: target.source, price: target.price }
          : { externalSource: BROWSE_SOURCE },
      showPrice: target.kind === 'stay' && target.showPrice === true,
      variant: outboundError ? 'error' : 'default',
      dontShowAgain,
      onToggleDontShowAgain: () => setDontShowAgain((on) => !on),
      showDontShowAgain: isAuthed,
      // 이동 방식이 시트 얼굴(수수료 고지 유무)을 정한다 — 지금은 늘 제휴(TRIP-1167).
      outbound: stayOutboundMode(),
      onCancel: () => {
        setOpen(false);
        setOutboundError(false);
      },
      // [이동] — 체크돼 있으면 누른 순간 저장한다(이동 결과와 무관, 01b Q4). 보낸 필드만 바뀐다.
      onConfirm: () => {
        if (dontShowAgain) {
          patchSettings.mutate({ data: { affiliateNoticeDismissed: true } });
        }
        void runOutbound(pending);
      },
      onRetry: () => void runOutbound(pending),
    },
  };
}
