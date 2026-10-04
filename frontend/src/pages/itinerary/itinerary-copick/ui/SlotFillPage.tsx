import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { buildEditItineraryRequest } from '@/features/edit-itinerary';
import { resolveCandidateSelection } from '../model/candidateSelection';
import {
  countPickedCoPickSlots,
  nextCoPickSlotKey,
} from '@/features/itinerary';
import {
  DRAFT_POLL_INTERVAL_MS,
  formatCoPickDayHeader,
} from '@/features/itinerary';
import { regionForDay } from '@/entities/trip';
import { tripDayChips } from '@/features/add-must-visit';
import { isConfirmLocked } from '@/features/itinerary';
import { formatRadiusUsed } from '../model/radiusUsedLabel';
import { formatDistance } from '@/entities/place';
import { parseSlotKey } from '@/entities/itinerary-slot';
import { resolveSlotSwapError } from '@/features/edit-itinerary';
import { swapSlotPoi } from '@/features/edit-itinerary';
import { timeBandLabel } from '@/entities/itinerary-slot';
import {
  ConceptPickerScreen,
  type ConceptProgress,
} from './ConceptPickerScreen';
import { CoPickLeaveDialog } from './CoPickLeaveDialog';
import { SlotFillScreen } from './SlotFillScreen';
import type {
  ItineraryDaysItemSlotsItem,
  SlotCandidatesRequest,
} from '@/shared/api/index.schemas';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerarySlotCandidates,
  usePutTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import { CoPickStepper, type CoPickStep } from './CoPickStepper';

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
  // 진행 줄 앞 그날 여행지(TRIP-1043)용 — 기다리지 않는다. 조회 중·실패·빈 목록이면 접두 없이 그린다(INV-4).
  const trip = useGetTripsTripId(tripId, { query: { retry: false } });
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
  // 사용자가 **직접 탭한** 후보만 상태로 든다 — 화면에 내리는 선택은 매 렌더 지금 목록에서 도출한다
  // (TRIP-1073 B: 탭한 후보가 목록에 있으면 그것, 아니면 첫 후보). 재조회가 탭 기록을 지우지 않는다.
  const [tappedPoiId, setTappedPoiId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const firedRef = useRef(false);

  const candidates = candidatesData?.candidates ?? [];
  const selectedPoiId = resolveCandidateSelection(candidates, tappedPoiId);
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

  // h13 상단 문맥 줄("오후 일정 · △△ 다음") — 채울 슬롯의 시간대(timeBandLabel)와 그 직전
  // 슬롯의 이름을 GET 캐시(itinerary.data, 이미 조회돼 있음)에서 그대로 읽는다. 이름 미도착
  // (nameKo null)이면 그 구간만 접어 "N 일정"만 보인다 — 플레이스홀더 문구를 문맥 줄에 새지
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
      ? `${band} 일정 · ${prevName} 다음`
      : `${band} 일정`;
  }

  // h09 진행 줄·스텝퍼 데이터를 itinerary GET 캐시(이미 조회돼 있음)에서 조립한다 — 화면은 순수라 값만
  // 받는다(AC-9). co-pick 은 **비고정 슬롯**을 하나씩 채우므로 그 목록에서 현재 슬롯의 위치가 곧 진행이다.
  function coPickContext(): {
    dayNumber: number;
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
    // 분모는 여행 기간(tripDayChips), 분자는 itinerary days 안 순번이다(TRIP-1096 결정 2 — 분자를 trip.startDate
    // 로 세지 않는다). days.length 는 생성 중(PARTIAL)·2차 실패(FAILED)에 day1 만 담겨 1이 되므로 분모로 못 쓴다.
    // 여행을 모르면(조회 중·실패·기간 비었음) 분모와 진행바 칸을 통째로 뺀다 — 틀린 숫자를 사실처럼 안 보인다(결정 1).
    const region =
      trip.data === undefined
        ? null
        : regionForDay(trip.data.destinations, ctx.dayNumber);
    const totalDays =
      trip.data === undefined ? 0 : tripDayChips(trip.data).length;
    const known = totalDays > 0;
    const dayHeader = formatCoPickDayHeader(ctx.date);
    const dayText = known
      ? `${ctx.dayNumber}일차 / ${totalDays} · ${dayHeader}`
      : `${ctx.dayNumber}일차 · ${dayHeader}`;
    return {
      dayLabel: region === null ? dayText : `${region} · ${dayText}`,
      slotCurrent: ctx.index + 1,
      slotTotal: ctx.nonFixed.length,
      barFilled: known ? ctx.dayNumber : 0,
      barTotal: totalDays,
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
    // TRIP-1006 (B) · 컨셉 얼굴 ‹ 는 `router.back()` 이 아니다 — 스택상 뒤는 필수 방문지(h02)라, 거기서
    // CTA 를 누르면 생성이 다시 돌아 고른 슬롯이 사라졌다(#072). 대신 홈으로 나가고(Q2, 생성 중 화면의
    // 백그라운드 이탈과 같은 결), 앞에서 1곳 이상 골랐으면 확인부터 띄운다(D3). 고른 곳 수는 일자를
    // 건너 센다 — `coPickContext().index` 는 그날 안 순번이라 2일차 첫 슬롯에서 0이 된다.
    const pickedCount = countPickedCoPickSlots(
      itinerary.data?.days ?? [],
      slotKey
    );
    const leave = (): void => {
      router.replace('/(tabs)');
    };
    return (
      <View className="flex-1">
        <ConceptPickerScreen
          concepts={CONCEPTS}
          progress={conceptProgress()}
          stepperSlot={conceptStepper()}
          slotContextLabel={slotContextLabel()}
          onPickConcept={handlePickConcept}
          onSkip={handleSkip}
          onBack={() => (pickedCount === 0 ? leave() : setLeaveOpen(true))}
        />
        {leaveOpen ? (
          <CoPickLeaveDialog
            pickedCount={pickedCount}
            onStay={() => setLeaveOpen(false)}
            onLeave={leave}
          />
        ) : null}
      </View>
    );
  }

  // 반경 라벨(Q3·Q6) — 요청 radiusM × 응답 radiusMUsed 로 가른다. 최대(null) 조회면 셋째 칸이 서버값,
  // 숫자 요청을 서버가 넓혔으면 캡션이 그 사실을 말한다. 그 밖(요청 그대로 씀)은 둘 다 없음.
  // TRIP-1081 결정 1(a) · 넓혔을 때 칩은 사용자가 고른 그대로 두고, 캡션이 "요청 반경 안에 없어 서버가
  // 넓혔다"를 문장으로 말한다(QA #067 — 숫자만 따로 뜨면 칩과 모순돼 보였다).
  const requestedRadiusM = candidatesVariables?.data.radiusM;
  const maxRadiusLabel =
    candidatesData !== undefined && requestedRadiusM === null
      ? formatRadiusUsed(candidatesData.radiusMUsed)
      : null;
  const radiusUsedLabel =
    candidatesData !== undefined &&
    typeof requestedRadiusM === 'number' &&
    candidatesData.radiusMUsed > requestedRadiusM
      ? `${formatDistance(requestedRadiusM)} 안에 없어 ${formatRadiusUsed(
          candidatesData.radiusMUsed
        )}까지 넓혔어요`
      : null;
  // 지도 카드(TRIP-1043) — 기준점은 지금 채우는 슬롯의 장소다(사용자 위치가 아니라 currentLocation·
  // '현재 위치' 라벨을 쓰지 않는다). 좌표가 하나라도 없으면 지도를 안 그린다(0,0·폴백 좌표 금지).
  // 원 반경은 서버가 실제로 쓴 radiusMUsed 우선, 조회 중엔 요청 반경, 최대(null) 조회 중엔 원 없음.
  // 기준 핀은 맨 앞 하나(label '' 로 번호를 안 그린다). 후보 핀(TRIP-1081)은 응답 후보 중 lat·lng 가
  // 둘 다 숫자인 것만 — 없는 좌표를 0,0·기준점으로 대신 찍지 않는다(BR-U1-06·INV-4). 글자는 카드 배지와
  // 같은 **카드 index** 기준이라 좌표 없는 후보를 건너뛰어도 당겨 붙지 않는다(A·C). 번호는 SDK 마커
  // key 라 서로 달라야 한다(기준 1, 후보 index+2). 후보 핀이 2개 이상이면 원 대신 핀 묶음에 카메라를
  // 맞춘다(결정 2(b)) — 서버가 12km 로 넓히면 원 기준 카메라에선 핀이 중심에 뭉친다. 원은 그대로 그린다.
  const ctx = coPickContext();
  const currentSlot = ctx === null ? undefined : ctx.nonFixed[ctx.index];
  const circleRadiusM =
    candidatesData?.radiusMUsed ??
    (typeof requestedRadiusM === 'number' ? requestedRadiusM : undefined);
  const mapCenter =
    typeof currentSlot?.lat === 'number' && typeof currentSlot.lng === 'number'
      ? { lat: currentSlot.lat, lng: currentSlot.lng }
      : undefined;
  const candidatePins = candidates.flatMap(({ lat, lng }, index) =>
    typeof lat === 'number' && typeof lng === 'number'
      ? [
          {
            number: index + 2,
            lat,
            lng,
            label: String.fromCharCode('A'.charCodeAt(0) + index),
          },
        ]
      : []
  );
  const mapView =
    mapCenter === undefined
      ? undefined
      : {
          center: mapCenter,
          radiusCircle:
            circleRadiusM === undefined
              ? undefined
              : { center: mapCenter, radiusM: circleRadiusM },
          pins: [{ number: 1, ...mapCenter, label: '' }, ...candidatePins],
          fitPins: candidatePins.length >= 2,
        };
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
      // 후보 응답의 이름·태그·사진을 카드까지 내린다(TRIP-1024, QA #070 "이름 준비 중"·회색 사진).
      candidateViews={Object.fromEntries(
        candidates.map(({ poiId, nameKo, tags, imageUrl }) => [
          poiId,
          { nameKo, tags, imageUrl },
        ])
      )}
      mapView={mapView}
      onSelectRadius={handleSelectRadius}
      onSelectRadio={setTappedPoiId}
      onConfirm={handleConfirm}
      onExpandRadius={handleExpandRadius}
      onShrinkRadius={handleShrinkRadius}
      onChangeConcept={handleChangeConcept}
      onBack={handleChangeConcept}
      emptyReason={candidatesData?.emptyReason}
      onPressPlaceSearch={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/manual/add',
          params: { tripId },
        })
      }
    />
  );
}
