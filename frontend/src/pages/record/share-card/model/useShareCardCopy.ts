import { useEffect, useRef } from 'react';

import {
  postTripsTripIdShareCardCopy,
  usePostTripsTripIdShareCardCopy,
} from '@/shared/api/index.hooks';
import {
  isRateLimited,
  isShareCardDailyLimit,
  retryAfterSeconds,
} from '@/shared/api';

/**
 * TRIP-1605 · j06 서버 문구 — 마운트될 때 `POST /trips/{tripId}/share-card/copy` 를 정확히 1회 부른다.
 *
 * POST 지만 저장은 없고 AI 를 불러 하루 횟수를 쓴다. 읽기 훅(useQuery)으로 감싸면 재시도·앱 복귀 재조회 기본값이
 * 몰래 켜져 횟수가 새므로 뮤테이션 훅을 쓰고, 부르는 시점은 이 훅이 한 번만 정한다.
 * 429 는 상태가 같고 `error.code` 로만 갈린다 — `RATE_LIMITED`(잠깐 막힘)는 Retry-After 초 뒤 딱 1회 다시 부르고,
 * 하루 상한·그 밖 실패·헤더 없음은 다시 부르지 않는다(호출부는 온디바이스 문구로 대체).
 * 화면을 떠난 뒤에는 그 재호출도 나가지 않는다 — 뮤테이션은 컴포넌트가 사라져도 살아서 재시도를 이어가기 때문이다.
 */
export function useShareCardCopy(tripId: string) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { mutate, data, isError, error } = usePostTripsTripIdShareCardCopy({
    mutation: {
      // 재시도도 이 함수를 다시 거친다 — 화면이 없으면 서버를 부르지 않고 실패로 끝낸다(재시도 한도 1회라 거기서 멈춤).
      mutationFn: ({ tripId: id }) =>
        mounted.current
          ? postTripsTripIdShareCardCopy(id)
          : Promise.reject(new Error('share-card unmounted')),
      retry: (failureCount, err) =>
        failureCount < 1 &&
        isRateLimited(err) &&
        !isShareCardDailyLimit(err) &&
        retryAfterSeconds(err) !== null,
      retryDelay: (_failureCount, err) => (retryAfterSeconds(err) ?? 0) * 1000,
    },
  });

  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    mutate({ tripId });
  }, [mutate, tripId]);

  return {
    copy: data,
    /** 응답도 실패도 아직 없다(호출 전·진행 중·Retry-After 대기). */
    waiting: data === undefined && !isError,
    dailyLimit: isError && isShareCardDailyLimit(error),
  };
}
