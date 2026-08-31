import {
  useGetTripsTripIdReflections,
  usePostTripsTripIdReflectionsDayDate,
  usePutTripsTripIdReflectionsDayDate,
} from '@/shared/api/generated/reflection/reflection';
import type { Reflection } from '@/shared/api/generated/schemas';

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
  /** 회고 문장 수정 — 초안은 남는다(BR-U5-35, `EditReflectionRequest.text`). */
  saveEdit: (text: string) => void;
}

export function useDailyReflection(
  tripId: string,
  date: string
): UseDailyReflectionResult {
  const list = useGetTripsTripIdReflections(tripId);
  const post = usePostTripsTripIdReflectionsDayDate();
  const put = usePutTripsTripIdReflectionsDayDate();

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
    saveEdit: (text: string) => {
      put.mutate({ tripId, dayDate: date, data: { text } });
    },
  };
}
