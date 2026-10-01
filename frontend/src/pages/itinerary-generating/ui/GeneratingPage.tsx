import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { firstCoPickSlotKey } from '@/features/itinerary/model/coPickSlots';
import { buildMustVisitPins } from '@/features/itinerary/model/mustVisitList';
import { useGenerationBusy } from '@/features/itinerary/model/useGenerationBusy';
import { GeneratingScreen } from '@/features/itinerary/ui/GeneratingScreen';
import type {
  GenerateItineraryRequestGenerationMode,
  Itinerary,
} from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
  useGetTripsTripIdMustVisits,
  usePostTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { getAccessToken } from '@/shared/api/tokenManager';
import type { MapCenter, MapPin } from '@/shared/map';
import { showToast } from '@/shared/ui/Toast';

const LEAVE_TOAST_MESSAGE = '백그라운드에서 계속 만들고 있어요';

/**
 * h09 배선(TRIP-305) — 생성 POST 를 소유·발화하고 진행/성공/실패/이탈을 화면에 잇는다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **`mode` 가 있으면 마운트 시 POST 를 정확히 1회 쏜다.** `{ generationMode: mode }` 하나만 담는다
 *     (여분 키 0, BR-U3-03). 완전AI 씨앗은 `FULLY_AI`, copick 씨앗은 `CO_PLAN` 을 명시해 넘긴다
 *     (TRIP-462 · TRIP-1006 A5). **`mode` 가 없으면 관찰 모드**다(아래 `ObserveGeneration`, TRIP-1006
 *     A3·A4) — 이미 도는 생성을 다시 쏘지 않고 일정 GET 만 한다. 모드를 기본값으로 지어내면 재진입이
 *     생성을 다시 돌려 같이 짜기로 고른 슬롯을 덮는다(#083 · INV-4).
 *     `firedRef` 가드가 필요한 이유: react-query 반환 객체와 목 router 가 렌더마다 새 객체라 effect
 *     의존성이 매번 바뀌어 effect 가 재실행돼도 두 번 쏘지 않게 한다.
 *  2. **성공(201, day1 PARTIAL)이면 `successRoute` 로 `router.replace`.** 기본 draft(h11), copick
 *     씨앗은 허브(h16)를 주입받는다(TRIP-462). push 가 아니라 replace — 뒤로가면 생성 화면으로
 *     돌아오지 않게. 이후 PARTIAL→COMPLETE 폴링은 목적지 페이지 소관(중복 제거).
 *  3. **오류는 침묵하지 않는다(INV-4).** `isError` 를 화면에 내려 실패 표면을 띄우고, [다시 시도]가
 *     POST 를 재발화한다.
 *  4. **POST 경로는 자기 세션 GET 폴링·cancel 을 쓰지 않는다.** in-flight 라 sessionId 가 없다(Seed
 *     결정 3). 일정 GET 은 관찰 모드 가지(`ObserveGeneration`)에서만 부른다 — 그 가지는 mode 가 없을
 *     때만 마운트되므로 POST 경로는 여전히 GET 을 모른다. **예외(TRIP-1032)**: POST 가 409
 *     `GENERATION_IN_PROGRESS` 면 안내를 띄우고, 사용자가 [취소하고 새로 만들기]를 누를 때만 **다른
 *     여행**(`activeTripId`)의 일정 GET → cancel → 같은 body 로 재POST 한다(`useGenerationBusy`).
 *  5. **꼭 갈 곳 지도 좌표(TRIP-929).** 핀이 0개면 `pins`·`center` 둘 다 `undefined` 로 넘긴다 —
 *     화면 게이트 `pins && center` 를 두 겹으로 닫는 이중 방어다(INV-4 빈 지도 금지). 어느 한 겹도
 *     중복이 아니다: 서울 폴백 `center` 를 넣으면 `pins` 겹만 남고, `pins` 를 `[]` 그대로 넘기면
 *     (`[]` 는 참) `center` 겹만 남는다. 조회 오류는 지도만 생략하고 `failed` 에 합치지 않는다 —
 *     합치면 POST 가 진행 중인데 생성 실패가 뜬다.
 *  6. **진행 중 이탈 토스트(TRIP-1046).** 화면이 트리에서 빠질 때(‹ replace·스와이프 pop 모두
 *     언마운트) 마지막 렌더가 진행 중이고 성공 콜백 전이면 한 번 알린다. 발화는 언마운트 한 곳뿐 —
 *     `goHome` 은 409 [기다리기]·관찰 모드와 공유라 거기 넣으면 거짓 토스트가 샌다. 성공 표지는
 *     호출별 onSuccess 첫 줄: replace 가 결과 재렌더보다 먼저 화면을 내릴 수 있어서다.
 */
export function GeneratingPage({
  tripId,
  mode,
  successRoute = '/trips/[tripId]/itinerary/draft',
}: {
  tripId: string;
  /** 생성 모드. 미지정=관찰 모드(POST 0, GET 만 — TRIP-1006). 완전AI 는 FULLY_AI, copick 씨앗은
   * CO_PLAN 을 명시해 넘긴다(TRIP-462). */
  mode?: GenerateItineraryRequestGenerationMode;
  /** 성공 후 목적지 pathname. 미지정=draft(h11). copick 씨앗(TRIP-504)은 첫 슬롯 라우트 템플릿을
   * 넘기고, 이 화면이 생성 응답의 days 로 실 slotKey 를 채워 replace 한다.
   * (허브 라우트 `copick`(index)은 TRIP-796으로 삭제됨 — 죽은 유니온 멤버도 함께 제거.) */
  successRoute?:
    | '/trips/[tripId]/itinerary/draft'
    | '/trips/[tripId]/itinerary/copick/[slotKey]';
}): ReactElement {
  const router = useRouter();
  // 캐시 반영은 훅 옵션 자리에 둔다 — `mutate(…, { onSuccess })` 콜백은 화면이 떠나면 불리지 않아,
  // 생성 중 홈으로 이탈하면 홈이 들고 있던 404 가 남는다(TRIP-1015 A · QA #046).
  const generate = usePostTripsTripIdItinerary({
    mutation: {
      onSuccess: (data, vars, _onMutateResult, context) => {
        context.client.setQueryData(
          getGetTripsTripIdItineraryQueryKey(vars.tripId),
          data
        );
      },
    },
  });
  const firedRef = useRef(false);
  const succeededRef = useRef(false);
  const pendingRef = useRef(false);
  pendingRef.current = generate.isPending;
  useEffect(
    () => () => {
      if (pendingRef.current && !succeededRef.current) {
        showToast({
          message: LEAVE_TOAST_MESSAGE,
          testID: 'itinerary-generating-background-toast',
        });
      }
    },
    []
  );

  const mustVisits = useGetTripsTripIdMustVisits(tripId);
  const savedPlaces = useSavedPlaces({ isAuthed: getAccessToken() !== null });
  const pins = buildMustVisitPins({
    items: mustVisits.data ?? [],
    savedPlaces: savedPlaces.savedPlaces,
  });
  const firstPin = pins[0];

  const start = useCallback(() => {
    if (mode === undefined) return;
    generate.mutate(
      { tripId, data: { generationMode: mode } },
      {
        onSuccess: (data: Itinerary) => {
          succeededRef.current = true;
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

  const busy = useGenerationBusy(generate.error, start);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    start();
  }, [start]);

  const mapPins = firstPin ? pins : undefined;
  const mapCenter = firstPin
    ? { lat: firstPin.lat, lng: firstPin.lng }
    : undefined;
  // 앱바 뒤로 = 백그라운드 이탈(화면만 홈으로). 관찰 모드도 같은 결이다.
  const goHome = (): void => {
    router.replace('/(tabs)');
  };

  if (mode === undefined) {
    return (
      <ObserveGeneration
        tripId={tripId}
        pins={mapPins}
        center={mapCenter}
        onBackground={goHome}
      />
    );
  }

  return (
    <GeneratingScreen
      failed={generate.isError}
      busy={busy && { ...busy, onWait: goHome }}
      pins={mapPins}
      center={mapCenter}
      onRetry={start}
      onBackground={() => {
        // 앱바 뒤로 = 백그라운드 이탈(화면만 홈으로). 뮤테이션은 리셋하지 않는다 — 이미 나간
        // POST 는 언마운트로 취소되지 않아(axios+react-query) 서버가 백그라운드에서 일정을 완성한다
        // (Seed·openapi 767). 홈으로 보내는 이유: 일정 탭은 trips[0] 로 리다이렉트해 생성 중인 여행이
        // 아닌 옛 일정에 착지할 수 있다(traps-itinerary ③, 팀 확정 2026-09-11). [취소]=CANCELED(구
        // BR-U3-05)는 팀 확정으로 제거 — canon BR-U3-04/05 도 "취소 없음"으로 갱신됨(TRIP-789).
        goHome();
      }}
    />
  );
}

/**
 * TRIP-1006 · 관찰 모드 — 일정 탭 카드·홈 CTA 가 완전 AI 생성 중(PARTIAL) 여행을 다시 열 때 온다(D2).
 * 생성 POST 를 **쏘지 않고** 일정 GET 한 번의 결과로만 움직인다(Q1):
 *  - 일정이 있으면(PARTIAL·COMPLETE·FAILED 전부) 곧장 초안(h11)으로 replace — 1일차가 이미 있으니
 *    스피너로 가리지 않고(BR-U3-04), 남은 폴링은 초안 화면 몫이다.
 *  - 404(관찰할 생성이 없다)면 생성 방식(h01)으로 replace.
 *  - 그 밖의 조회 실패는 실패 얼굴로 말하고(INV-4), [다시 시도]는 **GET 만** 다시 한다(A6).
 *
 * 별도 컴포넌트인 이유: 훅은 조건부로 부를 수 없다. mode 가 없을 때만 이 컴포넌트가 마운트되므로
 * 일정 GET 훅도 그때만 불린다(홈 `PlanningHome` 의 조건부 자식과 같은 패턴).
 */
function ObserveGeneration({
  tripId,
  pins,
  center,
  onBackground,
}: {
  tripId: string;
  pins: MapPin[] | undefined;
  center: MapCenter | undefined;
  onBackground: () => void;
}): ReactElement {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const notFound = isNotFound(itinerary.error);
  const movedRef = useRef(false);

  useEffect(() => {
    // 목적지가 정해지는 순간 한 번만 이동한다(리렌더로 replace 가 두 번 나가지 않게).
    if (movedRef.current) return;
    if (itinerary.data !== undefined) {
      movedRef.current = true;
      router.replace({
        pathname: '/trips/[tripId]/itinerary/draft',
        params: { tripId },
      });
    } else if (notFound) {
      movedRef.current = true;
      router.replace({
        pathname: '/trips/[tripId]/itinerary/method',
        params: { tripId },
      });
    }
  }, [itinerary.data, notFound, router, tripId]);

  return (
    <GeneratingScreen
      failed={itinerary.isError && !notFound}
      pins={pins}
      center={center}
      onRetry={() => {
        void itinerary.refetch();
      }}
      onBackground={onBackground}
    />
  );
}
