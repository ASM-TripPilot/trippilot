import { useQueryClient } from '@tanstack/react-query';

import {
  getGetTripsTripIdReflectionsQueryKey,
  useGetTripsTripIdReflections,
  usePostTripsTripIdReflectionsDayDate,
  usePutTripsTripIdReflectionsDayDate,
} from '@/shared/api/generated/reflection/reflection';
import type {
  Reflection,
  ReflectionList,
} from '@/shared/api/generated/schemas';

import { buildEditCard } from './editCard';

/**
 * TRIP-571 · useDailyReflection — 당일 회고 조회·생성·수정을 잇는 얇은 래퍼(재사용 3훅만, 새 HTTP 0).
 *
 * 무엇을 보장하나: 단일 날짜 GET 엔드포인트가 없어 **목록 GET**(`useGetTripsTripIdReflections`)에서
 * `dayDate === date` 항목을 골라 낸다. 생성(POST)·수정(PUT) 뮤테이션도 여기서 감싸 페이지에 넘긴다.
 * `source`(AI|RULE|BASIC)는 응답 레코드에 그대로 실려 오고 **여기서 UI 분기를 하지 않는다**(맹점② —
 * AI 미개통이라 source 로 가르면 죽은 가지가 된다). 표시본 결정은 이 파일이 아니라 `reflectionFallback`
 * 이 진다(AC-8).
 *
 * ★ 재사용만 — orval 이 생성한 3훅을 감쌀 뿐 raw HTTP(customInstance·axios)를 새로 만들지 않는다(G5).
 */

export interface UseDailyReflectionResult {
  /** 선택 날짜의 회고 레코드(없으면 undefined — empty 얼굴 판정 근거). */
  reflection: Reflection | undefined;
  isPending: boolean;
  isError: boolean;
  /** 조회 재시도(error 얼굴 "다시 시도"). */
  refetch: () => void;
  /** 회고 생성·재생성(BR-U5-32). */
  create: () => void;
  /**
   * 회고 카드 수정 — 초안은 남는다(BR-U5-35, `EditReflectionRequest.card` · subtitle 만 교체).
   * 저장 성공이면 true, 실패면 false 로 풀린다 — 화면이 편집을 닫을지·실패를 알릴지 정한다(INV-4).
   */
  saveEdit: (text: string) => Promise<boolean>;
}

export function useDailyReflection(
  tripId: string,
  date: string
): UseDailyReflectionResult {
  const list = useGetTripsTripIdReflections(tripId);
  const post = usePostTripsTripIdReflectionsDayDate();
  const queryClient = useQueryClient();
  // 저장 성공 = 서버가 돌려준 Reflection 으로 목록 캐시의 그 날짜 항목을 갈아 끼운다(TRIP-980).
  // 재조회(invalidate)가 아니라 직접 갱신이라 응답 도착과 동시에 화면이 바뀐다 — 재조회 틈에
  // empty 얼굴이 비치지 않는다. 훅 수준 onSuccess 라 화면을 떠나도 캐시는 고쳐진다.
  // 목록을 아직 못 받은 캐시(조회 실패 얼굴에서 직접 작성, BR-U5-36)는 다른 날짜가 빠진 목록을
  // 지어내지 않고 재조회한다.
  const put = usePutTripsTripIdReflectionsDayDate({
    mutation: {
      onSuccess: (saved) => {
        const key = getGetTripsTripIdReflectionsQueryKey(tripId);
        const current = queryClient.getQueryData<ReflectionList>(key);
        if (!current) {
          void queryClient.invalidateQueries({ queryKey: key });
          return;
        }
        queryClient.setQueryData<ReflectionList>(key, {
          ...current,
          items: [
            ...(current.items ?? []).filter(
              (item) => item.dayDate !== saved.dayDate
            ),
            saved,
          ],
        });
      },
    },
  });

  // ?.items 까지 방어한다(?.data 만으론 부족) — 계약 위반 응답 {}/{items:null} 에서
  // undefined.find 크래시(5-b 경고-1, StaySearchPage W-3 동형).
  const reflection = list.data?.items?.find((item) => item.dayDate === date);

  return {
    reflection,
    isPending: list.isPending,
    isError: list.isError,
    refetch: () => {
      void list.refetch();
    },
    create: () => {
      post.mutate({ tripId, dayDate: date });
    },
    saveEdit: (text: string) =>
      new Promise<boolean>((resolve) => {
        put.mutate(
          {
            tripId,
            dayDate: date,
            data: { card: buildEditCard(reflection?.card, text) },
          },
          { onSuccess: () => resolve(true), onError: () => resolve(false) }
        );
      }),
  };
}
