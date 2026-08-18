import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { GeneratingScreen } from '@/features/itinerary/ui/GeneratingScreen';
import { usePostTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

/**
 * h09 배선(TRIP-305) — 생성 POST 를 소유·발화하고 진행/성공/실패/이탈을 화면에 잇는다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **마운트 시 POST 를 정확히 1회 쏜다.** `{ generationMode:'FULLY_AI' }` 하나만 담는다(여분 키
 *     0, BR-U3-03). `firedRef` 가드가 필요한 이유: react-query 반환 객체와 목 router 가 렌더마다
 *     새 객체라 effect 의존성이 매번 바뀌어 effect 가 재실행돼도 두 번 쏘지 않게 한다.
 *  2. **성공(201, day1 PARTIAL)이면 draft 로 `router.replace`.** push 가 아니라 replace — 뒤로가면
 *     생성 화면으로 돌아오지 않게. 이후 PARTIAL→COMPLETE 폴링은 DraftPage 소관(중복 제거).
 *  3. **오류는 침묵하지 않는다(INV-4).** `isError` 를 화면에 내려 실패 표면을 띄우고, [다시 시도]가
 *     POST 를 재발화한다.
 *  4. **세션 GET 폴링·cancel 뮤테이션을 쓰지 않는다.** in-flight 라 sessionId 가 없다(Seed 결정 3).
 */
export function GeneratingPage({ tripId }: { tripId: string }): ReactElement {
  const router = useRouter();
  const generate = usePostTripsTripIdItinerary();
  const firedRef = useRef(false);

  const start = useCallback(() => {
    generate.mutate(
      { tripId, data: { generationMode: 'FULLY_AI' } },
      {
        onSuccess: () =>
          router.replace({
            pathname: '/trips/[tripId]/itinerary/draft',
            params: { tripId },
          }),
      }
    );
  }, [generate, router, tripId]);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    start();
  }, [start]);

  return (
    <GeneratingScreen
      failed={generate.isError}
      onRetry={start}
      onCancel={() => {
        // ponytail: 진짜 in-flight 중단은 불가 — orval customInstance 가 AbortSignal 을 안 받고
        // (02a §5-5) react-query mutationFn 도 signal 을 안 준다. `reset()` 은 로컬 뮤테이션
        // 상태만 지우고 서버는 일정을 만들 수 있다(⚑D). 관측 가능한 폐기 = 뒤로 이탈뿐.
        // mutator 에 signal 배선이 생기면 여기서 abort 로 올린다.
        generate.reset?.();
        router.back();
      }}
      onBackground={() => {
        // 화면만 앞으로 이탈(여행 탭). 뮤테이션은 리셋하지 않는다 — 이미 나간 POST 는 언마운트로
        // 취소되지 않아(axios+react-query) 서버가 백그라운드에서 일정을 완성한다(Seed·openapi 767).
        router.replace('/(tabs)/itinerary');
      }}
    />
  );
}
