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
 * [이동] 서버 아웃바운드(TRIP-1167).
 *
 * TRIP-781·778 의 제휴 흐름(시트 열림·error 얼굴·"다시 보지 않기"·`/me/settings` 저장값)은 TRIP-1579 로
 * `features/stay-outbound` 의 `useStayOutboundFlow` 가 쥔다 — 인기 숙소 카드·전체 보기와 같은 흐름을 쓴다.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Share } from 'react-native';

import { isNotFound } from '@/shared/api';
import { getAccessToken } from '@/shared/api';
import { useGetStaysStayId } from '@/shared/api/index.hooks';
import type { StayDetail } from '@/shared/api/index.schemas';

import { useSavedStays } from '@/features/save-stay';
import { stayKey } from '@/features/save-stay';
import { OtaChoiceSheet, useStayOutboundFlow } from '@/features/stay-outbound';
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
  const outbound = useStayOutboundFlow();

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

  // 아웃바운드 stayId 는 라우트 값 그대로(TRIP-1167) — 가격 칸은 상세 응답 값으로 그린다.
  function handlePressBook(): void {
    if (item === null) {
      return;
    }
    outbound.request({
      kind: 'stay',
      stayId,
      source: item.externalSource,
      showPrice: true,
      price: item.price,
    });
  }

  return (
    <>
      <StayDetailScreen
        state={state}
        coverKey={item === null ? undefined : stayKey(item)}
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
      {outbound.sheetProps !== null ? (
        <OtaChoiceSheet {...outbound.sheetProps} />
      ) : null}
    </>
  );
}
