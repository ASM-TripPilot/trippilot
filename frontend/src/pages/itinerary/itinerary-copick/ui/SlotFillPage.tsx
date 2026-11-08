import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { buildEditItineraryRequest } from '@/features/edit-itinerary';
import { resolveCandidateSelection } from '../model/candidateSelection';
import {
  countPickedCoPickSlots,
  nextCoPickSlotKey,
} from '@/features/itinerary';
import { pollIntervalMs, formatCoPickDayHeader } from '@/features/itinerary';
import { regionForDay } from '@/entities/trip';
import { tripDayChips } from '@/features/add-must-visit';
import { isConfirmLocked } from '@/features/itinerary';
import {
  AUTO_CENTER,
  buildCenter,
  centerRejectionNotice,
  POINT_UNAVAILABLE_NOTICE,
  type CenterChoiceKey,
  type CenterSel,
} from '../model/centerChoice';
import { formatRadiusUsed } from '../model/radiusUsedLabel';
import { formatDistance } from '@/entities/place';
import { parseSlotKey } from '@/entities/itinerary-slot';
import { resolveSlotSwapError } from '@/features/edit-itinerary';
import { swapSlotPoi } from '@/features/edit-itinerary';
import { timeBandLabel } from '@/entities/itinerary-slot';
import {
  slotDisplayCategory,
  slotDisplayName,
} from '@/entities/itinerary-slot';
import {
  ConceptPickerScreen,
  type ConceptProgress,
} from './ConceptPickerScreen';
import { CenterPointPicker } from './CenterPointPicker';
import { CoPickLeaveDialog } from './CoPickLeaveDialog';
import { SlotFillScreen } from './SlotFillScreen';
import type { MapCenter } from '@/shared/map';
import type {
  Itinerary,
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
import { isNotFound } from '@/shared/api';
import { usePressLock } from '@/shared/lib/pressGuard';
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
 * TRIP-1669 · 찾는 중심: 후보 요청은 언제나 `coPick:true`(같이 고르기 — 직전 슬롯이 중심, TRIP-1252)이고, 사용자가
 * '다른 기준 보기'에서 고른 `center`(PREVIOUS·REGION·STAY·POINT)를 더 싣는다. 자동이면 `center` 키 자체가 없다.
 * 중심은 이 컴포넌트의 상태(`centerSel`) 하나이고 후보를 묻는 모든 입구(컨셉·건너뛰기·반경 세그·넓히기/좁히기·0건
 * 버튼)가 `requestCandidates` 한 곳에서 같은 값을 읽는다 — 칸을 넘어가면 새로 마운트돼 자동으로 시작한다.
 *
 * 이중발사 방지 `firedLock`(usePressLock — 같은 틱 둘째 탭이 옛 값을 읽어 못 막는 useState 잠금 회피) ·
 * 콜드캐시 가드(itinerary GET 미도착 중 확정하면 `swapSlotPoi([], …)` 로 빈 days PUT = 일정 소실)는
 * `SlotCandidatePanelContainer`(h08) 동형 재사용이다.
 *
 * TRIP-978 · 생성 중(PARTIAL) 일정에 갇히지 않는다: PARTIAL 인 동안만 일정 GET 을 폴링하고(상한 없음 —
 * 서버가 멈춘 생성을 FAILED 로 내린다, openapi POST /itinerary), 그동안 확정은 잠금 사유와 함께 비활성.
 * 후보 조회 실패(409 포함)는 0건 얼굴이 아니라 사유 문구로 말한다 — 실서버 409 코드는 세 갈래 모두
 * `CONFLICT` 라 "생성 중" 여부는 코드가 아니라 캐시의 generationState 로 가른다.
 */

const CONFIRM_LOCKED_TEXT = '나머지 일정을 만드는 중이에요';
const ITINERARY_LOAD_FAILED =
  '일정을 불러오지 못했어요. 잠시 후 다시 눌러 주세요';

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

function slotCoords(
  slot: ItineraryDaysItemSlotsItem | undefined
): MapCenter | undefined {
  return typeof slot?.lat === 'number' && typeof slot.lng === 'number'
    ? { lat: slot.lat, lng: slot.lng }
    : undefined;
}

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
  // PARTIAL 인 동안만 2초(15회 뒤 5초, pollIntervalMs)마다 다시 부르고 COMPLETE·FAILED 에서 멈춘다(함수형 refetchInterval — 매 응답
  // 뒤 다음 간격을 정한다). 상한은 두지 않는다 — 짧은 상한은 반쪽 일정에서 조용히 멈춘다(openapi).
  // TRIP-1614 · 화면 포커스 게이트를 걸지 않는다 — 생성을 지켜보는 화면이라 복귀 시 최신이 곧바로 필요하다. 장소 검색 등을
  // 위에 쌓는 경로(router.push)가 있어 그동안 뒤에서 계속 묻고, 상한이 없어 서버가 FAILED 로 닫을 때까지(약 11분) 이어질 수
  // 있다. 게이트 확대가 필요하면 새 티켓. 앱 셸의 감시(`useGenerationWatch`, TRIP-1618)는 이 여행의 이 화면이 최상단인
  // 동안 묻지 않는다(양보) — 위에 다른 화면이 쌓이면 셸이 이어받는다.
  const itinerary = useGetTripsTripIdItinerary(tripId, {
    query: {
      refetchInterval: (query) =>
        isConfirmLocked(query.state.data?.generationState)
          ? pollIntervalMs(query.state.dataUpdateCount)
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
  const firedLock = usePressLock();

  const candidates = candidatesData?.candidates ?? [];
  const selectedPoiId = resolveCandidateSelection(candidates, tappedPoiId);
  const parsed = parseSlotKey(slotKey);
  const confirmLocked = isConfirmLocked(itinerary.data?.generationState);

  // TRIP-1669 · 찾는 중심. `centerSel` 하나가 모든 후보 요청 입구의 중심이다(AC-5). 칸을 확정해 다음 칸으로 가면
  // 라우터가 새로 마운트하므로 늘 자동으로 시작한다(AC-17) — 컴포넌트 밖(모듈·전역 스토어)에 두지 않는다.
  const [centerSel, setCenterSel] = useState<CenterSel>(AUTO_CENTER);
  const [centerExpanded, setCenterExpanded] = useState(false);
  const [centerNotice, setCenterNotice] = useState<string | null>(null);
  // '지도에서 찍기' 선택 화면이 열려 있으면 그 시작 좌표(닫힘 = null). 확정 전엔 요청도 선택도 바뀌지 않는다.
  const [pointStart, setPointStart] = useState<MapCenter | null>(null);

  // 후보 요청의 단일 출구. 중심을 실은 요청이 "그 중심 때문에" 거절되면(REGION·STAY 409 · POINT 400) 자동 추천으로
  // 돌려 안내하고 `center` 없는 요청을 **딱 한 번** 다시 보낸다 — 그 재요청에는 되돌림 콜백을 달지 않고 바디에도
  // center 가 없어 구조적으로 루프가 불가능하다(또 실패하면 종전 오류 문구 경로). 생성 잠금(PARTIAL) 중의 409 는
  // 중심 탓이 아니므로 건드리지 않는다(잠금 문구가 이긴다, AC-12) — 잠금은 콜백이 도는 시점의 캐시에서 읽는다.
  // `origin: 'system'`(되돌림·잠금 해제 재발사)은 성공해도 안내를 지우지 않는다 — 후보가 다시 떠도 왜 바뀌었는지
  // 남아야 한다(AC-13). 사용자가 일으킨 요청의 성공에서만 지운다.
  const sendCandidates = useCallback(
    (
      vars: { tripId: string; data: SlotCandidatesRequest },
      origin: 'user' | 'system' = 'user'
    ): void => {
      fetchCandidates(vars, {
        onSuccess: () => {
          if (origin === 'user') setCenterNotice(null);
        },
        onError: (error) => {
          const sent = vars.data.center;
          const locked = isConfirmLocked(
            queryClient.getQueryData<Itinerary>(
              getGetTripsTripIdItineraryQueryKey(vars.tripId)
            )?.generationState
          );
          if (locked || sent === undefined || sent === null) return;
          const notice = centerRejectionNotice(sent.mode, error);
          if (notice === null) return;
          setCenterSel(AUTO_CENTER);
          setCenterNotice(notice);
          const data = { ...vars.data };
          delete data.center;
          // 빈 옵션 객체가 필요하다 — 콜백 안에서 옵션 없이 다시 mutate 하면 라이브러리가 방금 쓴 옵션 자리를 비워
          // 뒤이은 `onSettled` 읽기에서 TypeError 가 난다(`{}` 면 안전).
          fetchCandidates({ tripId: vars.tripId, data }, {});
        },
      });
    },
    [fetchCandidates, queryClient]
  );

  // 잠금이 풀리는 순간(PARTIAL → COMPLETE·FAILED) 후보 얼굴에서 마지막 조회가 실패였다면 그 요청
  // (같은 컨셉·반경·중심 — `candidatesVariables` 가 마지막 바디를 그대로 쥐고 있다)을 한 번 다시 보낸다 — 안 하면
  // 폴링으로 풀려도 사용자는 오류 문구 앞에 남는다(Q2).
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
      sendCandidates(candidatesVariables, 'system');
    }
    wasLockedRef.current = confirmLocked;
  }, [
    confirmLocked,
    inFill,
    candidatesFailed,
    candidatesVariables,
    sendCandidates,
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
    const prevName =
      index > 0 ? slotDisplayName(day.slots[index - 1]) : undefined;
    return prevName !== null && prevName !== undefined
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

  // AC-14 · 반경 원·기준 핀의 중심은 **서버가 실제로 쓰는 중심**과 같아야 한다. 자동·방금 고른 곳 = 그날 **전체**
  // 슬롯 배열(고정 숙소 포함 — `coPickContext().nonFixed` 가 아니다)에서 채우는 슬롯의 `index-1`, 첫 칸이면 교체 대상
  // 자신. 지도에서 찍기 = 확정한 점. 지역 중심·숙소 근처는 서버가 좌표를 정하고 클라는 모르니 원을 그리지 않는다.
  // 쓸 좌표가 null 이면 채우는 슬롯 좌표로 대신 그리지 않는다(거짓 원 금지, BR-U1-06 · INV-4).
  function circleCenterOf(): MapCenter | undefined {
    if (centerSel.key === 'point') return centerSel.point ?? undefined;
    if (centerSel.key === 'region' || centerSel.key === 'stay') {
      return undefined;
    }
    if (parsed.kind !== 'ok' || itinerary.data === undefined) return undefined;
    const slots = itinerary.data.days.find(
      (day) => day.date === parsed.date
    )?.slots;
    const index = slots?.findIndex((slot) => slot.poiId === parsed.poiId) ?? -1;
    if (slots === undefined || index === -1) return undefined;
    return slotCoords(slots[Math.max(index - 1, 0)]);
  }

  // 지도 카메라 중심 — 원이 있으면 그 중심, 없으면(지역·숙소·직전 좌표 없음) 채우는 슬롯 좌표.
  function cameraCenterOf(): MapCenter | undefined {
    const ctx = coPickContext();
    return (
      circleCenterOf() ??
      (ctx === null ? undefined : slotCoords(ctx.nonFixed[ctx.index]))
    );
  }

  // 현재/다음 단 제목 — category 있으면 '{시간대} · {컨셉}', 없으면 시간대 라벨만(정직 degrade, D1).
  // "오후"는 시간대 라벨이라 INV-3(소요시간 비표시) 안전 — 시각·분/시간은 안 낸다.
  function bandTitle(slot: ItineraryDaysItemSlotsItem): string {
    const band = timeBandLabel(slot.startAt);
    const category = slotDisplayCategory(slot);
    return category !== null ? `${band} · ${category}` : band;
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
      title: slotDisplayName(prevSlot) ?? '',
      status: '선택함',
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

  // slotKey + radiusM(항상) + concept(스킵이면 생략) + coPick:true + center(자동이면 키 자체 생략)로 후보를 조회한다.
  // radiusM 3단째는 null 을 그대로 실어 서버가 AI 기본 반경으로 확대하게 한다(§계약). `sel` 은 중심을 방금 바꾼
  // 핸들러가 새 값을 직접 넘기는 자리다(setState 는 같은 틱에 안 보인다) — 나머지 입구는 지금 상태를 쓴다.
  function requestCandidates(
    nextConcept: string | undefined,
    radiusKey: string,
    sel: CenterSel = centerSel
  ): void {
    const step =
      RADIUS_STEPS.find((entry) => entry.key === radiusKey) ?? RADIUS_STEPS[1];
    const data: SlotCandidatesRequest = {
      slotKey,
      radiusM: step.radiusM,
      coPick: true,
    };
    if (nextConcept !== undefined) data.concept = nextConcept;
    const center = buildCenter(sel);
    if (center !== undefined) data.center = center;
    sendCandidates({ tripId, data });
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

  // 중심 선택지를 눌렀다. '지도에서 찍기'는 요청을 보내지 않고 선택 화면만 연다(확정 버튼에서만 POINT 요청).
  // 이미 고른 중심을 다시 누르면 아무 일도 없다(같은 요청을 또 보내지 않는다). 중심이 바뀌는 순간 안내는 지운다.
  function handleSelectCenter(key: CenterChoiceKey): void {
    if (key === 'point') {
      // 선택 화면의 처음 위치 = 지금 지도 원의 중심(원이 없으면 카메라 중심). 둘 다 없으면 거짓 좌표로 열지 않는다.
      const start = cameraCenterOf();
      if (start === undefined) {
        setCenterNotice(POINT_UNAVAILABLE_NOTICE);
        return;
      }
      setPointStart(start);
      return;
    }
    if (key === centerSel.key) return;
    const next: CenterSel = { key, point: null };
    setCenterNotice(null);
    setCenterSel(next);
    requestCandidates(concept, selectedRadiusKey, next);
  }

  function handleConfirmPoint(point: MapCenter): void {
    const next: CenterSel = { key: 'point', point };
    setPointStart(null);
    setCenterNotice(null);
    setCenterSel(next);
    requestCandidates(concept, selectedRadiusKey, next);
  }

  function handleConfirm(): void {
    // itinerary GET 미도착(data undefined)이면 조기 반환 — 빈 days 전체교체 PUT(일정 소실) 방지(E1).
    // 단 조회가 404 아닌 오류로 끝났으면 무반응 대신 사유를 알리고 한 번 다시 묻는다(INV-4). 로딩·404 는 그대로 무반응.
    // firedLock 을 쥐기 전에 돌려야 한 번 실패한 뒤에도 다음 [확정]이 영구 잠기지 않는다.
    if (
      itinerary.data === undefined &&
      itinerary.isError &&
      !isNotFound(itinerary.error)
    ) {
      setErrorMessage(ITINERARY_LOAD_FAILED);
      void itinerary.refetch();
      return;
    }
    // generationState==='PARTIAL'(2단계 생성 중, day1 만 도착)이면 확정도 잠근다 — day1-only 전체교체
    // PUT 이 뒷날을 덮어쓰기 전에 막는다(TRIP-601 가드 b · 서버 409 의 클라 사본, 심층 방어).
    if (
      selectedPoiId === null ||
      parsed.kind !== 'ok' ||
      itinerary.data === undefined ||
      isConfirmLocked(itinerary.data.generationState) ||
      !firedLock.acquire()
    ) {
      return;
    }
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
        onSuccess: (data) => {
          // 전진 전에 GET 캐시를 PUT 응답으로 교체한다(재조회 0, TRIP-1348) — 안 하면 다음 슬롯
          // SlotFillPage 가 같은 쿼리키를 stale 한 옛 days 로 읽어, 방금 확정한 앞 슬롯을 되돌린 채
          // PUT 한다(순차 채우기 데이터 손실). 형제 SlotCandidatePanelContainer 와 같은 패턴.
          queryClient.setQueryData(
            getGetTripsTripIdItineraryQueryKey(tripId),
            data
          );
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
          firedLock.release();
          setErrorMessage(resolveSlotSwapError(error).message);
        },
      }
    );
  }

  if (!inFill) {
    // TRIP-1006 (B) · 컨셉 얼굴 ‹ 는 `router.back()` 이 아니다 — 스택상 뒤는 필수 방문지(h02)라, 거기서
    // CTA 를 누르면 생성이 다시 돌아 고른 슬롯이 사라졌다(#072). 대신 일정 탭 목록으로 나가고(TRIP-1428 —
    // 나가도 고른 곳은 남으니 그 여행을 다시 열 자리로), 앞에서 1곳 이상 골랐으면 확인부터 띄운다(D3). 고른 곳 수는 일자를
    // 건너 센다 — `coPickContext().index` 는 그날 안 순번이라 2일차 첫 슬롯에서 0이 된다.
    const pickedCount = countPickedCoPickSlots(
      itinerary.data?.days ?? [],
      slotKey
    );
    const leave = (): void => {
      // TRIP-1243 — replace 는 현재 화면 하나만 바꿔 끼워 아래 위저드 화면(3/4 등)이 스택에 남는다.
      // dismissTo 는 스택의 그 경로까지 사이 화면을 걷어낸다(없으면 현재 화면을 그 경로로 replace).
      router.dismissTo('/(tabs)/itinerary');
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
  // 지도 카드(TRIP-1043) — 기준점은 서버가 후보를 찾는 중심이다(`circleCenterOf` — TRIP-1669 전엔 채우는 슬롯 자신이었다.
  // 사용자 위치가 아니라 currentLocation·'현재 위치' 라벨을 쓰지 않는다). 지도 카메라 좌표가 하나도 없으면 지도를
  // 안 그린다(0,0·폴백 좌표 금지).
  // 원 반경은 서버가 실제로 쓴 radiusMUsed 우선, 조회 중엔 요청 반경, 최대(null) 조회 중엔 원 없음.
  // 기준 핀은 맨 앞 하나(label '' 로 번호를 안 그린다). 후보 핀(TRIP-1081)은 응답 후보 중 lat·lng 가
  // 둘 다 숫자인 것만 — 없는 좌표를 0,0·기준점으로 대신 찍지 않는다(BR-U1-06·INV-4). 글자는 카드 배지와
  // 같은 **카드 index** 기준이라 좌표 없는 후보를 건너뛰어도 당겨 붙지 않는다(A·C). 번호는 SDK 마커
  // key 라 서로 달라야 한다(기준 1, 후보 index+2). 후보 핀이 2개 이상이면 원 대신 핀 묶음에 카메라를
  // 맞춘다(결정 2(b)) — 서버가 12km 로 넓히면 원 기준 카메라에선 핀이 중심에 뭉친다. 원은 그대로 그린다.
  const circleCenter = circleCenterOf();
  const circleRadiusM =
    candidatesData?.radiusMUsed ??
    (typeof requestedRadiusM === 'number' ? requestedRadiusM : undefined);
  const mapCenter = cameraCenterOf();
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
            circleCenter === undefined || circleRadiusM === undefined
              ? undefined
              : { center: circleCenter, radiusM: circleRadiusM },
          pins:
            circleCenter === undefined
              ? candidatePins
              : [{ number: 1, ...circleCenter, label: '' }, ...candidatePins],
          fitPins: candidatePins.length >= 2,
        };
  const candidatesErrorMessage = !candidatesFailed
    ? null
    : confirmLocked
      ? CONFIRM_LOCKED_TEXT
      : resolveSlotSwapError(candidatesError).message;
  // '지도에서 찍기' 선택 화면은 후보 화면 위에 조건부로 덮는 absolute 오버레이다(`CoPickLeaveDialog` 선례 — 별도 라우트·
  // 시트보다 단순하고, 후보 화면은 그대로 마운트돼 취소하면 펼침·선택이 그대로 남는다).
  return (
    <View className="flex-1">
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
          candidates.map(({ poiId, nameKo, tags, imageUrl, imageLicense }) => [
            poiId,
            { nameKo, tags, imageUrl, imageLicense },
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
        centerChoice={{
          selected: centerSel.key,
          expanded: centerExpanded,
          // 등록 숙소가 0곳이면 '숙소 근처'를 숨긴다(서버가 반드시 409). 박 일부만 비는 여행은 서버 409 가 안내한다.
          // 여행 조회가 아직 안 왔으면 모르니 숨긴다.
          stayAvailable: (trip.data?.baseCount ?? 0) > 0,
          notice: centerNotice,
          onToggleExpanded: () => setCenterExpanded((open) => !open),
          onSelect: handleSelectCenter,
        }}
      />
      {pointStart === null ? null : (
        <CenterPointPicker
          center={pointStart}
          onConfirm={handleConfirmPoint}
          onCancel={() => setPointStart(null)}
        />
      )}
    </View>
  );
}
