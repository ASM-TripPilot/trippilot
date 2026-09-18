import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { firstCoPickSlotKey } from '@/features/itinerary/model/coPickSlots';
import { GeneratingScreen } from '@/features/itinerary/ui/GeneratingScreen';
import type {
  GenerateItineraryRequestGenerationMode,
  Itinerary,
} from '@/shared/api/generated/schemas';
import { usePostTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

/**
 * h09 배선(TRIP-305) — 생성 POST 를 소유·발화하고 진행/성공/실패/이탈을 화면에 잇는다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **마운트 시 POST 를 정확히 1회 쏜다.** `{ generationMode: mode }` 하나만 담는다(여분 키 0,
 *     BR-U3-03). 완전AI 씨앗은 기본 `FULLY_AI`, copick 씨앗은 `CO_PLAN` 을 주입받는다(TRIP-462).
 *     `firedRef` 가드가 필요한 이유: react-query 반환 객체와 목 router 가 렌더마다 새 객체라 effect
 *     의존성이 매번 바뀌어 effect 가 재실행돼도 두 번 쏘지 않게 한다.
 *  2. **성공(201, day1 PARTIAL)이면 `successRoute` 로 `router.replace`.** 기본 draft(h11), copick
 *     씨앗은 허브(h16)를 주입받는다(TRIP-462). push 가 아니라 replace — 뒤로가면 생성 화면으로
 *     돌아오지 않게. 이후 PARTIAL→COMPLETE 폴링은 목적지 페이지 소관(중복 제거).
 *  3. **오류는 침묵하지 않는다(INV-4).** `isError` 를 화면에 내려 실패 표면을 띄우고, [다시 시도]가
 *     POST 를 재발화한다.
 *  4. **세션 GET 폴링·cancel 뮤테이션을 쓰지 않는다.** in-flight 라 sessionId 가 없다(Seed 결정 3).
 */
export function GeneratingPage({
  tripId,
  mode = 'FULLY_AI',
  successRoute = '/trips/[tripId]/itinerary/draft',
}: {
  tripId: string;
  /** 생성 모드. 미지정=FULLY_AI. copick 씨앗은 CO_PLAN 을 넘긴다(TRIP-462). */
  mode?: GenerateItineraryRequestGenerationMode;
  /** 성공 후 목적지 pathname. 미지정=draft(h11). copick 씨앗(TRIP-504)은 첫 슬롯 라우트 템플릿을
   * 넘기고, 이 화면이 생성 응답의 days 로 실 slotKey 를 채워 replace 한다.
   * ponytail: `copick`(허브 h16)는 안 (가) 흐름에서 라우팅이 끊겼다 — 파일 존치, 유니온 멤버는 후속 정리 대상. */
  successRoute?:
    | '/trips/[tripId]/itinerary/draft'
    | '/trips/[tripId]/itinerary/copick'
    | '/trips/[tripId]/itinerary/copick/[slotKey]';
}): ReactElement {
  const router = useRouter();
  const generate = usePostTripsTripIdItinerary();
  const firedRef = useRef(false);

  const start = useCallback(() => {
    generate.mutate(
      { tripId, data: { generationMode: mode } },
      {
        onSuccess: (data: Itinerary) => {
          // copick 씨앗은 허브가 아니라 **첫 비고정 슬롯**의 SlotFillPage 로 착지한다(01b 순회 세부,
          // AC-6). h05 는 slotKey 를 몰라 템플릿만 실어 보내므로, 채우는 것은 이 화면이다 — 생성
          // 응답이 곧 생성된 일정(days 포함, `customInstance<Itinerary>`)이라 별도 GET 불요.
          if (successRoute === '/trips/[tripId]/itinerary/copick/[slotKey]') {
            const slotKey = firstCoPickSlotKey(data.days);
            if (slotKey === null) {
              // 채울 비고정 슬롯이 하나도 없다(전부 고정) — 순회할 것이 없으니 곧장 h17(완성 확인).
              router.replace({
                pathname: '/trips/[tripId]/itinerary/copick/complete',
                params: { tripId },
              });
              return;
            }
            router.replace({
              pathname: '/trips/[tripId]/itinerary/copick/[slotKey]',
              params: { tripId, slotKey },
            });
            return;
          }
          router.replace({ pathname: successRoute, params: { tripId } });
        },
      }
    );
  }, [generate, router, tripId, mode, successRoute]);

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
