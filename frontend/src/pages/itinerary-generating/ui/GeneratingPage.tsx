import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { firstCoPickSlotKey } from '@/features/itinerary/model/coPickSlots';
import { buildMustVisitPins } from '@/features/itinerary/model/mustVisitList';
import { GeneratingScreen } from '@/features/itinerary/ui/GeneratingScreen';
import type {
  GenerateItineraryRequestGenerationMode,
  Itinerary,
} from '@/shared/api/generated/schemas';
import {
  useGetTripsTripIdMustVisits,
  usePostTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { getAccessToken } from '@/shared/api/tokenManager';

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
 *  5. **꼭 갈 곳 지도 좌표(TRIP-929).** 핀이 0개면 `pins`·`center` 둘 다 `undefined` 로 넘긴다 —
 *     화면 게이트 `pins && center` 를 두 겹으로 닫는 이중 방어다(INV-4 빈 지도 금지). 어느 한 겹도
 *     중복이 아니다: 서울 폴백 `center` 를 넣으면 `pins` 겹만 남고, `pins` 를 `[]` 그대로 넘기면
 *     (`[]` 는 참) `center` 겹만 남는다. 조회 오류는 지도만 생략하고 `failed` 에 합치지 않는다 —
 *     합치면 POST 가 진행 중인데 생성 실패가 뜬다.
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
   * (허브 라우트 `copick`(index)은 TRIP-796으로 삭제됨 — 죽은 유니온 멤버도 함께 제거.) */
  successRoute?:
    | '/trips/[tripId]/itinerary/draft'
    | '/trips/[tripId]/itinerary/copick/[slotKey]';
}): ReactElement {
  const router = useRouter();
  const generate = usePostTripsTripIdItinerary();
  const firedRef = useRef(false);

  const mustVisits = useGetTripsTripIdMustVisits(tripId);
  const savedPlaces = useSavedPlaces({ isAuthed: getAccessToken() !== null });
  const pins = buildMustVisitPins({
    items: mustVisits.data ?? [],
    savedPlaces: savedPlaces.savedPlaces,
  });
  const firstPin = pins[0];

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
      pins={firstPin ? pins : undefined}
      center={firstPin ? { lat: firstPin.lat, lng: firstPin.lng } : undefined}
      onRetry={start}
      onBackground={() => {
        // 앱바 뒤로 = 백그라운드 이탈(화면만 홈으로). 뮤테이션은 리셋하지 않는다 — 이미 나간
        // POST 는 언마운트로 취소되지 않아(axios+react-query) 서버가 백그라운드에서 일정을 완성한다
        // (Seed·openapi 767). 홈으로 보내는 이유: 일정 탭은 trips[0] 로 리다이렉트해 생성 중인 여행이
        // 아닌 옛 일정에 착지할 수 있다(traps-itinerary ③, 팀 확정 2026-09-11). [취소]=CANCELED(구
        // BR-U3-05)는 팀 확정으로 제거 — canon BR-U3-04/05 도 "취소 없음"으로 갱신됨(TRIP-789).
        router.replace('/(tabs)');
      }}
    />
  );
}
