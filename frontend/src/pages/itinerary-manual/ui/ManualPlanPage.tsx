import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';

import { ManualPlanScreen } from '@/features/itinerary/ui/ManualPlanScreen';
import {
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';

/**
 * h19 배선(TRIP-338) — MANUAL 생성 POST 를 소유·발화하고 빈 일정을 `ManualPlanScreen` 에 잇는다.
 * `GeneratingPage`(FULLY_AI, h09) 와 **대칭**이되 h09(생성 중 폴링)는 건너뛴다 — MANUAL 은 AI 를
 * 안 불러 즉시 빈 일자라 2단계 폴링이 불필요하다(01b Q2).
 *
 * 이 파일이 지는 책임:
 *  1. **마운트 시 POST 를 정확히 1회** `{ generationMode:'MANUAL' }` 하나만 담아 쏜다(여분 키 0,
 *     BR-U3-03 · FULLY_AI 심판 대칭). `firedRef` 가드가 필요한 이유: react-query 반환 객체가 렌더마다
 *     새 객체라 effect 가 재실행돼도 두 번 쏘지 않게 한다(GeneratingPage 선례).
 *  2. **빈 일정 조회를 화면에 내린다.** MANUAL 은 `solveMode=MINIMAL` 이지만 `isFallback=false`(실패가
 *     아니라 선택)라 폴백·실패 배너를 **띄우지 않는다**(§8① · AC-2). 그래서 이 배선은 폴백 판정을 아예
 *     타지 않는다 — MANUAL 경로엔 폴백 배너가 존재하지 않는다(draftView `resolveFallbackNotice` 는
 *     `isFallback` 을 함께 보므로 혹시 재사용해도 (MINIMAL,false)→null, F-7 green 로 확인함).
 */
export function ManualPlanPage({ tripId }: { tripId: string }): ReactElement {
  const router = useRouter();
  const generate = usePostTripsTripIdItinerary();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const firedRef = useRef(false);

  // 직접 고르기 진입이 기존 초안을 빈 MANUAL 로 덮어쓰지 않게 한다(TRIP-601 가드 a · BR-U3-06
  // "방식 전환이 이미 만든 슬롯을 지우지 않는다"). 판정 축은 `days.length>0` — slots 만 빈 정상
  // MANUAL 재진입도 보존해 재-POST 를 막는다.
  const hasExisting = (itinerary.data?.days.length ?? 0) > 0;

  useEffect(() => {
    if (firedRef.current) return;
    // GET 로딩 중엔 보류 — 도착할 기존 초안을 못 보고 쏘면 그대로 덮어쓴다(fail-safe, 서버가 재생성
    // POST 를 안 막으므로 이 보류가 유일한 방어선 · ItineraryMethodPage 선례).
    if (itinerary.isPending) return;
    if (hasExisting) return;
    firedRef.current = true;
    generate.mutate({ tripId, data: { generationMode: 'MANUAL' } });
  }, [generate, tripId, itinerary.isPending, hasExisting]);

  return (
    <ManualPlanScreen
      days={itinerary.data?.days ?? []}
      contextChips={MANUAL_CONTEXT_CHIPS}
      onBack={() => router.back()}
      onPressSearchAdd={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/manual/add',
          params: { tripId },
        })
      }
    />
  );
}

/** 정적 컨텍스트 칩(Q3) — trip 설정 파생 계약이 아직 없어 정적 표시. MANUAL 엔 AI 밀도("적당히")가
 * 무의미해 뺐다(Q3 관측). trip 데이터 배선이 생기면 파생값으로 교체한다. */
const MANUAL_CONTEXT_CHIPS = ['09:00 출발', '숙소 기준'];
