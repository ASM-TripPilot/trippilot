import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import {
  DEFAULT_DWELL_KEY,
  buildFixedMustVisitRequest,
  mustVisitTimeBlockReason,
  startTimeOptions,
  tripDayChips,
  type MustVisitTimeForm,
} from '@/features/itinerary/model/mustVisitTimeForm';
import { MustVisitTimeScreen } from '@/features/itinerary/ui/MustVisitTimeScreen';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import type { AddMustVisitRequest } from '@/shared/api/generated/schemas';
import {
  deleteTripsTripIdMustVisitsMustVisitId,
  getGetTripsTripIdMustVisitsQueryKey,
  postTripsTripIdMustVisits,
  useGetTripsTripId,
  useGetTripsTripIdMustVisits,
} from '@/shared/api/generated/trips/trips';
import { getAccessToken } from '@/shared/api/tokenManager';

/**
 * h07 배선(TRIP-296) — `ANYTIME` 항목을 시각 고정 블록으로 **승격**한다.
 *
 * ⚠️ **계약에 수정 오퍼레이션이 없다.** must-visits 는 POST·GET·DELETE 셋뿐이고
 * `PATCH`/`PUT` 이 없다. 같은 `sourcePoiId` 재-POST 는 중복 금지(INV-U1-18)로 409다. 그래서
 * 승격 경로가 **DELETE → POST 2단**뿐이고(01b D1), 그 경로에는 원자성이 없다 — DELETE 가
 * 성공한 뒤 POST 가 실패하면 항목이 통째로 사라진다.
 *
 * 그 위험을 이 파일이 세 가지로 감당한다:
 *  1. **순서를 지킨다** — DELETE 가 먼저다. POST 를 먼저 보내면 실제 서버에서 409로 전부 막힌다.
 *  2. **침묵하지 않는다** — 실패하면 사실을 말하고 되돌아가지 않는다(INV-4 · BR-U1-55).
 *  3. **재시도는 POST 만 다시 낸다** — DELETE 를 또 내면 없는 id 로 404 가 나거나 방금 성공한
 *     등록을 지운다. 그래서 실패 상태가 "다시 낼 요청" 을 통째로 들고 있는다.
 *
 * ponytail: 원자성 없음 — 서버에 must-visit 수정 오퍼레이션(`PATCH`)이 생기면 이 2단 전체가
 * 1회 호출로 대체된다(그때 `PromoteFailure`·재시도 슬롯도 함께 사라진다).
 */

/** 01b D5 동결 문구 — 은퇴한 `[보관] g03` 의 `이미 담은 곳이에요` 를 이 화면 대상에 맞춘 것. */
const DUPLICATE_NOTICE = '이미 추가된 곳이에요';
/** DELETE 는 성공했고 POST 가 실패했다 — 사용자의 항목이 실제로 사라진 상태다. */
const LOST_MESSAGE = '고정하지 못해 목록에서 빠졌어요. 다시 시도해 주세요';
/** DELETE 자체가 실패했다 — 항목은 그대로다. */
const KEPT_MESSAGE = '고정하지 못했어요. 다시 시도해 주세요';
const LOAD_FAILED_MESSAGE = '여행 정보를 불러오지 못했어요';

type PromoteFailure =
  /** 잃었다 — 되돌리려면 이 요청을 다시 내야 한다. */
  | { kind: 'lost'; request: AddMustVisitRequest }
  /** 지키고 있다 — 서버 상태가 안 바뀌었으므로 처음부터 다시 하면 된다. */
  | { kind: 'kept' };

/** 서버는 `HH:mm[:ss]` 를 준다(계약). 시각 목록은 `HH:mm` 이라 그대로 두면 선택 표시가 안 붙는다. */
function toHourMinute(value: string | null | undefined): string | null {
  return value == null ? null : value.slice(0, 5);
}

export function MustVisitTimePage({
  tripId,
  sourcePoiId,
}: {
  tripId: string;
  sourcePoiId: string;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();

  const isAuthed = getAccessToken() !== null;
  const trip = useGetTripsTripId(tripId);
  const mustVisits = useGetTripsTripIdMustVisits(tripId);
  const savedPlaces = useSavedPlaces({ isAuthed });

  const [edited, setEdited] = useState<MustVisitTimeForm | null>(null);
  const [failure, setFailure] = useState<PromoteFailure | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  // 응답이 오기 전 두 번째 누름이 두 번째 승격을 만들면 DELETE 가 두 번 나간다. 상태 갱신은
  // 다음 렌더에야 보이므로 같은 틱의 두 번째 누름을 못 막는다 — ref 는 쓰는 즉시 보인다
  // (`TripNewStep1Page.submitLockedRef` 와 같은 이유).
  const submitLockedRef = useRef(false);

  const registered = (mustVisits.data ?? []).find(
    (entry) => entry.sourcePoiId === sourcePoiId
  );
  const place = savedPlaces.savedPlaces.find(
    (entry) => entry.place.poiId === sourcePoiId
  )?.place;

  // 여행 기간과 **현재 등록 상태**가 둘 다 도착해야 조작할 수 있다 — 등록 건을 모르면 승격이
  // DELETE 를 건너뛰어 409로 막힌다. 그래서 날짜 칩 자체를 그때까지 내지 않는다.
  const ready = !trip.isPending && !mustVisits.isPending;
  const dayChips = ready
    ? tripDayChips({
        startDate: trip.data?.startDate ?? '',
        endDate: trip.data?.endDate ?? '',
      })
    : [];

  // 사용자가 손대기 전에는 서버가 아는 값이 폼이다(연필로 들어온 `FIXED` 항목의 값 보존).
  // 토글 초기값은 Figma default 프레임대로 켜짐 — 이 화면에 온 목적이 시각 지정이다.
  const form: MustVisitTimeForm = edited ?? {
    fixed: true,
    fixedDate: registered?.fixedDate ?? null,
    fixedStart: toHourMinute(registered?.fixedStart),
    dwellKey: DEFAULT_DWELL_KEY,
  };

  function patchForm(next: Partial<MustVisitTimeForm>): void {
    setEdited({ ...form, ...next });
  }

  async function sendPost(request: AddMustVisitRequest): Promise<void> {
    // 상태(`duplicate`)는 다음 렌더에야 보인다 — 이 함수 안에서 갈래를 가르려면 지역 값이어야 한다.
    let duplicated = false;
    try {
      await postTripsTripIdMustVisits(tripId, request);
    } catch (error) {
      if (!isAlreadyRegistered(error)) {
        // DELETE 는 이미 성공했다 — 되돌리려면 이 요청을 그대로 다시 내야 한다.
        setFailure({ kind: 'lost', request });
        submitLockedRef.current = false;
        return;
      }
      // 409 = 목표 상태와 결과 상태가 같다. 실패로 세지 않되 침묵하지도 않는다.
      duplicated = true;
      setDuplicate(true);
      submitLockedRef.current = false;
    }
    setFailure(null);
    void queryClient.invalidateQueries({
      queryKey: getGetTripsTripIdMustVisitsQueryKey(tripId),
    });
    // 409 는 여기서 멈춘다(게이트①-3 · AC-7) — 안내를 세운 직후 떠나면 그 안내가 실기에서
    // 한 프레임도 보이지 않아 침묵과 같아진다. 나가는 것은 사용자가 뒤로 눌러서 한다.
    if (duplicated) return;
    router.back();
  }

  async function submit(): Promise<void> {
    if (!ready || submitLockedRef.current) return;
    // 화면의 `disabled` 는 접근성 상태만으로도 매처를 통과할 수 있으므로 배선도 스스로 문을
    // 잠근다. 여기서는 그 이상이다 — **되돌릴 수 없는 DELETE 를 검증 전에 보내지 않는 것**이
    // 이 한 줄의 실질이다.
    const request = buildFixedMustVisitRequest({ poiId: sourcePoiId, form });
    if (request === null) return;

    submitLockedRef.current = true;
    setDuplicate(false);

    if (registered !== undefined) {
      try {
        await deleteTripsTripIdMustVisitsMustVisitId(
          tripId,
          registered.mustVisitId
        );
      } catch {
        // 항목은 그대로다 — POST 를 보내지 않는다(보내면 409로 막히고 요청만 는다).
        setFailure({ kind: 'kept' });
        submitLockedRef.current = false;
        return;
      }
    }

    await sendPost(request);
  }

  function retry(): void {
    if (failure?.kind !== 'lost' || submitLockedRef.current) return;
    submitLockedRef.current = true;
    void sendPost(failure.request);
  }

  const loadFailed = trip.isError || mustVisits.isError;
  const errorText =
    failure?.kind === 'lost'
      ? LOST_MESSAGE
      : failure?.kind === 'kept'
        ? KEPT_MESSAGE
        : loadFailed
          ? LOAD_FAILED_MESSAGE
          : undefined;

  return (
    <MustVisitTimeScreen
      sourcePoiId={sourcePoiId}
      placeName={place?.nameKo ?? null}
      region={place?.region ?? null}
      imageUrl={place?.imageUrl ?? null}
      dayChips={dayChips}
      startOptions={startTimeOptions()}
      form={form}
      // 사용자가 손대기 전에는 사유를 내지 않는다 — `edited` 가 곧 touched 다
      // (`TripNewStep1Page` 의 touched 와 같은 형태). 들어오자마자 잘못했다고 말하지 않는다.
      blockReason={
        edited === null ? null : (mustVisitTimeBlockReason(form) ?? null)
      }
      errorText={errorText}
      duplicateText={duplicate ? DUPLICATE_NOTICE : undefined}
      onBack={() => router.back()}
      onToggleFixed={(next) => patchForm({ fixed: next })}
      onPickDate={(date) => patchForm({ fixedDate: date })}
      onPickStart={(start) => patchForm({ fixedStart: start })}
      onPickDwell={(dwellKey) => patchForm({ dwellKey })}
      onSubmit={() => void submit()}
      onRetry={failure?.kind === 'lost' ? retry : undefined}
    />
  );
}
