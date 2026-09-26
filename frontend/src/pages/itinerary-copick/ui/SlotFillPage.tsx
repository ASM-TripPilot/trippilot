import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import { nextCoPickSlotKey } from '@/features/itinerary/model/coPickSlots';
import {
  DRAFT_POLL_INTERVAL_MS,
  formatCoPickDayHeader,
} from '@/features/itinerary/model/draftView';
import { isConfirmLocked } from '@/features/itinerary/model/planState';
import { formatRadiusUsed } from '@/features/itinerary/model/radiusUsedLabel';
import { parseSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { resolveSlotSwapError } from '@/features/itinerary/model/slotSwapError';
import { swapSlotPoi } from '@/features/itinerary/model/swapSlotPoi';
import { timeBandLabel } from '@/features/itinerary/model/timeBandLabel';
import {
  ConceptPickerScreen,
  type ConceptProgress,
} from '@/features/itinerary/ui/ConceptPickerScreen';
import { SlotFillScreen } from '@/features/itinerary/ui/SlotFillScreen';
import type {
  ItineraryDaysItemSlotsItem,
  SlotCandidatesRequest,
} from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerarySlotCandidates,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import {
  CoPickStepper,
  type CoPickStep,
} from '@/widgets/copick-stepper/ui/CoPickStepper';

/**
 * TRIP-335 슬라이스2 · h13→h14/h15 슬롯 채우기 배선 — 슬라이스1 코어(POST 후보 → `swapSlotPoi`
 * 치환 → PUT 전체교체)를 컨셉/반경 앞단과 잇는다.
 *
 * 흐름: 마운트=컨셉 화면(조회 0) → 컨셉 탭/스킵 → `slot-candidates` POST(slotKey + radiusM + concept)
 * → 후보 화면 → 반경 세그먼트로 radiusM 올려 재조회 → 라디오 단일선택 → "A로 선택" → GET 캐시의
 * days 에서 `swapSlotPoi` 로 대상 슬롯만 갈아 `buildEditItineraryRequest` 로 PUT 전체교체 → **성공 시
 * 다음 비고정 슬롯으로 `router.replace`(선형 전진, TRIP-504), 다음이 없으면 h17(완성 확인)로.** 구
 * `router.back()`(허브 복귀)은 폐기. 실패는 이동 없이 인라인 오류.
 *
 * 계약이 아직 못 받치는 것:
 *  - 컨셉 목록·반경 단계 정수값은 **정본 부재라 이 사이클이 동결**한 발명값이다(3-a 결정). 반경 3단째는
 *    **명시적 `radiusM: null`**(서버가 AI 기본 반경으로 확대), 컨셉 스킵은 **`concept` 미전송**(undefined).
 *    두 필드의 부재 표현이 다르다(radiusM=null 전송 / concept=키 자체 생략).
 *  - 서버가 어느 반경을 실제로 썼는지는 응답 `radiusMUsed`(미터)로 온다 — 클라가 지어내지 않고
 *    `formatRadiusUsed` 로 포맷만 한다(INV-2).
 *
 * 이중발사 방지 `firedRef`(useRef — 같은 틱 둘째 탭이 옛 값을 읽어 못 막는 useState 잠금 회피) ·
 * 콜드캐시 가드(itinerary GET 미도착 중 확정하면 `swapSlotPoi([], …)` 로 빈 days PUT = 일정 소실)는
 * `SlotCandidatePanelContainer`(h08) 동형 재사용이다.
 *
 * TRIP-978 · 생성 중(PARTIAL) 일정에 갇히지 않는다: PARTIAL 인 동안만 일정 GET 을 폴링하고(상한 없음 —
 * 서버가 멈춘 생성을 FAILED 로 내린다, openapi POST /itinerary), 그동안 확정은 잠금 사유와 함께 비활성.
 * 후보 조회 실패(409 포함)는 0건 얼굴이 아니라 사유 문구로 말한다 — 실서버 409 코드는 세 갈래 모두
 * `CONFLICT` 라 "생성 중" 여부는 코드가 아니라 캐시의 generationState 로 가른다.
 */

const CONFIRM_LOCKED_TEXT = '나머지 일정을 만드는 중이에요';

const CONCEPTS: readonly { key: string; label: string }[] = [
  { key: 'meal', label: '식사' },
  { key: 'cafe', label: '카페' },
  { key: 'culture', label: '전시·문화' },
  { key: 'outdoor', label: '야외·산책' },
  { key: 'shopping', label: '쇼핑' },
];

const RADIUS_STEPS: readonly {
  key: string;
  label: string;
  radiusM: number | null;
}[] = [
  { key: 'near', label: '700m', radiusM: 700 },
  { key: 'mid', label: '1.1km', radiusM: 1100 },
  { key: 'max', label: '최대', radiusM: null },
];
const DEFAULT_RADIUS_KEY = 'mid';
const MAX_RADIUS_KEY = RADIUS_STEPS[RADIUS_STEPS.length - 1].key;

export interface SlotFillPageProps {
  tripId: string;
  slotKey: string;
}

export function SlotFillPage({
  tripId,
  slotKey,
}: SlotFillPageProps): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  // PARTIAL 인 동안만 2초마다 다시 부르고 COMPLETE·FAILED 에서 멈춘다(함수형 refetchInterval — 매 응답
  // 뒤 다음 간격을 정한다). 상한은 두지 않는다 — 짧은 상한은 반쪽 일정에서 조용히 멈춘다(openapi).
  const itinerary = useGetTripsTripIdItinerary(tripId, {
    query: {
      refetchInterval: (query) =>
        isConfirmLocked(query.state.data?.generationState)
          ? DRAFT_POLL_INTERVAL_MS
          : false,
    },
  });
  const {
    mutate: fetchCandidates,
    data: candidatesData,
    error: candidatesError,
    isError: candidatesFailed,
    isPending: candidatesPending,
    variables: candidatesVariables,
  } = usePostTripsTripIdItinerarySlotCandidates<unknown>();
  const { mutate: putItinerary, isPending } =
    usePutTripsTripIdItinerary<unknown>();

  const [inFill, setInFill] = useState(false);
  const [concept, setConcept] = useState<string | undefined>(undefined);
  const [selectedRadiusKey, setSelectedRadiusKey] =
    useState(DEFAULT_RADIUS_KEY);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const firedRef = useRef(false);

  const parsed = parseSlotKey(slotKey);
  const confirmLocked = isConfirmLocked(itinerary.data?.generationState);

  // 잠금이 풀리는 순간(PARTIAL → COMPLETE·FAILED) 후보 얼굴에서 마지막 조회가 실패였다면 그 요청
  // (같은 컨셉·반경)을 한 번 다시 보낸다 — 안 하면 폴링으로 풀려도 사용자는 오류 문구 앞에 남는다(Q2).
  // ref 가 직전 잠금값을 기억해 다른 의존값 변화로 다시 돌아도 해제 전이에서만 발사된다.
  const wasLockedRef = useRef(confirmLocked);
  useEffect(() => {
    if (
      wasLockedRef.current &&
      !confirmLocked &&
      inFill &&
      candidatesFailed &&
      candidatesVariables !== undefined
    ) {
      fetchCandidates(candidatesVariables);
    }
    wasLockedRef.current = confirmLocked;
  }, [
    confirmLocked,
    inFill,
    candidatesFailed,
    candidatesVariables,
    fetchCandidates,
  ]);

  // h13 상단 문맥 줄("오후 슬롯 · △△ 다음") — 채울 슬롯의 시간대(timeBandLabel)와 그 직전
  // 슬롯의 이름을 GET 캐시(itinerary.data, 이미 조회돼 있음)에서 그대로 읽는다. 이름 미도착
  // (nameKo null)이면 그 구간만 접어 "N 슬롯"만 보인다 — 플레이스홀더 문구를 문맥 줄에 새지
  // 않게 한다(INV-1 정신, SlotCandidateCard의 "이름 준비 중" 표기 함정과 동형 회피).
  function slotContextLabel(): string | undefined {
    if (parsed.kind !== 'ok' || itinerary.data === undefined) return undefined;
    const day = itinerary.data.days.find((d) => d.date === parsed.date);
    if (day === undefined) return undefined;
    const index = day.slots.findIndex((slot) => slot.poiId === parsed.poiId);
    if (index === -1) return undefined;
    const band = timeBandLabel(day.slots[index].startAt);
    const prevName = index > 0 ? day.slots[index - 1].nameKo : undefined;
    return prevName !== null && prevName !== undefined && prevName !== ''
      ? `${band} 슬롯 · ${prevName} 다음`
      : `${band} 슬롯`;
  }

  // h09 진행 줄·스텝퍼 데이터를 itinerary GET 캐시(이미 조회돼 있음)에서 조립한다 — 화면은 순수라 값만
  // 받는다(AC-9). co-pick 은 **비고정 슬롯**을 하나씩 채우므로 그 목록에서 현재 슬롯의 위치가 곧 진행이다.
  function coPickContext(): {
    dayNumber: number;
    totalDays: number;
    date: string;
    nonFixed: ItineraryDaysItemSlotsItem[];
    index: number;
  } | null {
    if (parsed.kind !== 'ok' || itinerary.data === undefined) return null;
    const days = itinerary.data.days;
    const dayIndex = days.findIndex((day) => day.date === parsed.date);
    if (dayIndex === -1) return null;
    const nonFixed = days[dayIndex].slots.filter((slot) => !slot.isFixed);
    const index = nonFixed.findIndex((slot) => slot.poiId === parsed.poiId);
    if (index === -1) return null;
    return {
      dayNumber: dayIndex + 1,
      totalDays: days.length,
      date: days[dayIndex].date,
      nonFixed,
      index,
    };
  }

  // 현재/다음 단 제목 — category 있으면 '{시간대} · {컨셉}', 없으면 시간대 라벨만(정직 degrade, D1).
  // "오후"는 시간대 라벨이라 INV-3(소요시간 비표시) 안전 — 시각·분/시간은 안 낸다.
  function bandTitle(slot: ItineraryDaysItemSlotsItem): string {
    const band = timeBandLabel(slot.startAt);
    return slot.category !== null &&
      slot.category !== undefined &&
      slot.category !== ''
      ? `${band} · ${slot.category}`
      : band;
  }

  function conceptProgress(): ConceptProgress | undefined {
    const ctx = coPickContext();
    if (ctx === null) return undefined;
    // 우 슬롯 N/M(slotCurrent/Total)은 슬롯 진행, 진행바(barFilled/Total)는 일차 진행 — 서로 다른 축이라
    // Figma 처럼 어긋날 수 있다(브리프 §B, 화면은 안 고침).
    return {
      dayLabel: `${ctx.dayNumber}일차 / ${ctx.totalDays} · ${formatCoPickDayHeader(
        ctx.date
      )}`,
      slotCurrent: ctx.index + 1,
      slotTotal: ctx.nonFixed.length,
      barFilled: ctx.dayNumber,
      barTotal: ctx.totalDays,
    };
  }

  // 이전(고름) → 현재(지금 고르는 중) → 다음(비어 있음) 상태를 슬롯 위치로 결정론 도출한다(seed D1).
  // 첫 비고정 슬롯(index 0)엔 아직 고른 '이전'이 없어 스텝퍼를 안 그린다 — role 3슬롯 중 current 만
  // 남는 비대칭을 피하고, 동결 문맥 줄 가드(첫 슬롯엔 "…다음" 꼬리 없음)와도 어긋나지 않게 한다.
  function conceptStepper(): ReactElement | undefined {
    const ctx = coPickContext();
    if (ctx === null || ctx.index === 0) return undefined;
    const prevSlot = ctx.nonFixed[ctx.index - 1];
    const currentSlot = ctx.nonFixed[ctx.index];
    const prev: CoPickStep = {
      title: prevSlot.nameKo ?? '',
      status: '고름',
      done: true,
    };
    const current: CoPickStep = {
      title: bandTitle(currentSlot),
      status: '지금 고르는 중',
    };
    const next: CoPickStep | undefined =
      ctx.index + 1 < ctx.nonFixed.length
        ? { title: bandTitle(ctx.nonFixed[ctx.index + 1]), status: '비어 있음' }
        : undefined;
    return <CoPickStepper prev={prev} current={current} next={next} />;
  }

  // slotKey + radiusM(항상) + concept(스킵이면 생략) 로 후보를 조회한다. radiusM 3단째는 null 을
  // 그대로 실어 서버가 AI 기본 반경으로 확대하게 한다(§계약).
  function requestCandidates(
    nextConcept: string | undefined,
    radiusKey: string
  ): void {
    const step =
      RADIUS_STEPS.find((entry) => entry.key === radiusKey) ?? RADIUS_STEPS[1];
    const data: SlotCandidatesRequest = { slotKey, radiusM: step.radiusM };
    if (nextConcept !== undefined) data.concept = nextConcept;
    fetchCandidates({ tripId, data });
  }

  function handlePickConcept(label: string): void {
    setConcept(label);
    setInFill(true);
    requestCandidates(label, selectedRadiusKey);
  }

  function handleSkip(): void {
    setConcept(undefined);
    setInFill(true);
    requestCandidates(undefined, selectedRadiusKey);
  }

  function handleSelectRadius(key: string): void {
    setSelectedRadiusKey(key);
    requestCandidates(concept, key);
  }

  function handleExpandRadius(): void {
    const index = RADIUS_STEPS.findIndex(
      (entry) => entry.key === selectedRadiusKey
    );
    const next = RADIUS_STEPS[index + 1];
    if (next === undefined) return; // 마지막 단계 — 더 넓힐 곳이 없다(E3)
    setSelectedRadiusKey(next.key);
    requestCandidates(concept, next.key);
  }

  // 반경 좁히기(TRIP-795, D10) — 마지막 단계에서 한 단계 뒤 반경으로 재조회. 첫 단계면 더 좁힐 곳이
  // 없어 no-op(handleExpandRadius 의 대칭).
  function handleShrinkRadius(): void {
    const index = RADIUS_STEPS.findIndex(
      (entry) => entry.key === selectedRadiusKey
    );
    const prev = RADIUS_STEPS[index - 1];
    if (prev === undefined) return;
    setSelectedRadiusKey(prev.key);
    requestCandidates(concept, prev.key);
  }

  function handleChangeConcept(): void {
    setInFill(false);
    setSelectedPoiId(null);
  }

  function handleConfirm(): void {
    // itinerary GET 미도착(data undefined)이면 조기 반환 — 빈 days 전체교체 PUT(일정 소실) 방지(E1).
    // generationState==='PARTIAL'(2단계 생성 중, day1 만 도착)이면 확정도 잠근다 — day1-only 전체교체
    // PUT 이 뒷날을 덮어쓰기 전에 막는다(TRIP-601 가드 b · 서버 409 의 클라 사본, 심층 방어).
    if (
      firedRef.current ||
      selectedPoiId === null ||
      parsed.kind !== 'ok' ||
      itinerary.data === undefined ||
      isConfirmLocked(itinerary.data.generationState)
    ) {
      return;
    }
    firedRef.current = true;
    setErrorMessage(null);
    // ⚠️ 전진 계산은 **스왑 전** 원본 days·**원본 slotKey** 로 한다(01b ★11). 스왑 후 days 로 원본
    // 키를 찾으면 그 슬롯의 poiId 는 이미 X 라 못 찾는다. 콜드캐시 가드가 days 존재를 이미 보장.
    const days = itinerary.data.days;
    const nextKey = nextCoPickSlotKey(days, slotKey);
    const nextDays = swapSlotPoi(
      days,
      { date: parsed.date, poiId: parsed.poiId },
      selectedPoiId
    );
    putItinerary(
      { tripId, data: buildEditItineraryRequest(nextDays) },
      {
        // 확정 성공 = 허브 복귀(구 `router.back()`)가 아니라 **다음 비고정 슬롯으로 선형 전진**.
        // 다음이 없으면 h17(완성 확인)로. 스택에 안 쌓이게 replace(01b 순회 세부).
        onSuccess: () => {
          // 전진 전에 GET 캐시를 무효화(재조회)한다 — 안 하면 다음 슬롯 SlotFillPage 가 같은
          // 쿼리키를 stale 한 옛 days 로 읽어, 방금 확정한 앞 슬롯을 되돌린 채 PUT 한다(순차
          // 채우기 데이터 손실). 형제 SlotCandidatePanelContainer 와 같은 패턴.
          void queryClient.invalidateQueries({
            queryKey: getGetTripsTripIdItineraryQueryKey(tripId),
          });
          if (nextKey === null) {
            router.replace({
              pathname: '/trips/[tripId]/itinerary/copick/complete',
              params: { tripId },
            });
            return;
          }
          router.replace({
            pathname: '/trips/[tripId]/itinerary/copick/[slotKey]',
            params: { tripId, slotKey: nextKey },
          });
        },
        onError: (error) => {
          firedRef.current = false;
          setErrorMessage(resolveSlotSwapError(error).message);
        },
      }
    );
  }

  if (!inFill) {
    return (
      <ConceptPickerScreen
        concepts={CONCEPTS}
        progress={conceptProgress()}
        stepperSlot={conceptStepper()}
        slotContextLabel={slotContextLabel()}
        onPickConcept={handlePickConcept}
        onSkip={handleSkip}
        onBack={() => router.back()}
      />
    );
  }

  const candidates = candidatesData?.candidates ?? [];
  // 반경 라벨(Q3·Q6) — 요청 radiusM × 응답 radiusMUsed 로 가른다. 최대(null) 조회면 셋째 칸이 서버값,
  // 숫자 요청을 서버가 넓혔으면 캡션이 그 사실을 말한다. 그 밖(요청 그대로 씀)은 둘 다 없음.
  const requestedRadiusM = candidatesVariables?.data.radiusM;
  const maxRadiusLabel =
    candidatesData !== undefined && requestedRadiusM === null
      ? formatRadiusUsed(candidatesData.radiusMUsed)
      : null;
  const radiusUsedLabel =
    candidatesData !== undefined &&
    typeof requestedRadiusM === 'number' &&
    candidatesData.radiusMUsed > requestedRadiusM
      ? formatRadiusUsed(candidatesData.radiusMUsed)
      : null;
  const candidatesErrorMessage = !candidatesFailed
    ? null
    : confirmLocked
      ? CONFIRM_LOCKED_TEXT
      : resolveSlotSwapError(candidatesError).message;
  return (
    <SlotFillScreen
      candidates={candidates}
      radiusSteps={RADIUS_STEPS}
      selectedRadiusKey={selectedRadiusKey}
      radiusUsedLabel={radiusUsedLabel}
      maxRadiusLabel={maxRadiusLabel}
      confirmLocked={confirmLocked}
      candidatesErrorMessage={candidatesErrorMessage}
      candidatesPending={candidatesPending}
      candidateCountLabel={`후보 ${candidates.length}곳`}
      selectedPoiId={selectedPoiId}
      canExpandRadius={selectedRadiusKey !== MAX_RADIUS_KEY}
      isPending={isPending}
      errorMessage={errorMessage}
      // h09 진행 줄·스텝퍼(GET 캐시 도출) 재사용 — 후보 얼굴에도 내린다(D9). 첫 슬롯이면
      // conceptStepper()가 undefined 라 스텝퍼는 미렌더(h09 승계). concept 은 앱바 제목으로.
      concept={concept}
      progress={conceptProgress()}
      stepperSlot={conceptStepper()}
      // mapView 는 전달하지 않는다 — candidates 응답에 좌표가 없어 프로덕션은 지도 미표시(정직 degrade,
      // D6). 지도 픽스처는 프리뷰 전용.
      onSelectRadius={handleSelectRadius}
      onSelectRadio={setSelectedPoiId}
      onConfirm={handleConfirm}
      onExpandRadius={handleExpandRadius}
      onShrinkRadius={handleShrinkRadius}
      onChangeConcept={handleChangeConcept}
      onBack={handleChangeConcept}
    />
  );
}
