import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';

import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import { formatRadiusUsed } from '@/features/itinerary/model/radiusUsedLabel';
import { parseSlotKey } from '@/features/itinerary/model/slotKey';
import { resolveSlotSwapError } from '@/features/itinerary/model/slotSwapError';
import { swapSlotPoi } from '@/features/itinerary/model/swapSlotPoi';
import { ConceptPickerScreen } from '@/features/itinerary/ui/ConceptPickerScreen';
import { SlotFillScreen } from '@/features/itinerary/ui/SlotFillScreen';
import type { SlotCandidatesRequest } from '@/shared/api/generated/schemas';
import {
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerarySlotCandidates,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';

/**
 * TRIP-335 슬라이스2 · h13→h14/h15 슬롯 채우기 배선 — 슬라이스1 코어(POST 후보 → `swapSlotPoi`
 * 치환 → PUT 전체교체)를 컨셉/반경 앞단과 잇는다.
 *
 * 흐름: 마운트=컨셉 화면(조회 0) → 컨셉 탭/스킵 → `slot-candidates` POST(slotKey + radiusM + concept)
 * → 후보 화면 → 반경 세그먼트로 radiusM 올려 재조회 → 라디오 단일선택 → "A로 선택" → GET 캐시의
 * days 에서 `swapSlotPoi` 로 대상 슬롯만 갈아 `buildEditItineraryRequest` 로 PUT 전체교체 → **성공만**
 * `router.back()`(허브 복귀). 실패는 이동 없이 인라인 오류.
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
 * OptionSwapPage(h18) 동형 재사용이다.
 */

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
  slotContextLabel?: string;
}

export function SlotFillPage({
  tripId,
  slotKey,
  slotContextLabel,
}: SlotFillPageProps): ReactElement {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const { mutate: fetchCandidates, data: candidatesData } =
    usePostTripsTripIdItinerarySlotCandidates();
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

  function handleChangeConcept(): void {
    setInFill(false);
    setSelectedPoiId(null);
  }

  function handleConfirm(): void {
    // itinerary GET 미도착(data undefined)이면 조기 반환 — 빈 days 전체교체 PUT(일정 소실) 방지(E1).
    if (
      firedRef.current ||
      selectedPoiId === null ||
      parsed.kind !== 'ok' ||
      itinerary.data === undefined
    ) {
      return;
    }
    firedRef.current = true;
    setErrorMessage(null);
    const nextDays = swapSlotPoi(
      itinerary.data.days,
      { date: parsed.date, poiId: parsed.poiId },
      selectedPoiId
    );
    putItinerary(
      { tripId, data: buildEditItineraryRequest(nextDays) },
      {
        onSuccess: () => router.back(),
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
        slotContextLabel={slotContextLabel}
        onPickConcept={handlePickConcept}
        onSkip={handleSkip}
        onBack={() => router.back()}
      />
    );
  }

  const candidates = candidatesData?.candidates ?? [];
  return (
    <SlotFillScreen
      candidates={candidates}
      radiusSteps={RADIUS_STEPS}
      selectedRadiusKey={selectedRadiusKey}
      radiusUsedLabel={
        candidatesData ? formatRadiusUsed(candidatesData.radiusMUsed) : null
      }
      candidateCountLabel={`후보 ${candidates.length}곳`}
      selectedPoiId={selectedPoiId}
      canExpandRadius={selectedRadiusKey !== MAX_RADIUS_KEY}
      isPending={isPending}
      errorMessage={errorMessage}
      onSelectRadius={handleSelectRadius}
      onSelectRadio={setSelectedPoiId}
      onConfirm={handleConfirm}
      onExpandRadius={handleExpandRadius}
      onChangeConcept={handleChangeConcept}
      onBack={handleChangeConcept}
    />
  );
}
