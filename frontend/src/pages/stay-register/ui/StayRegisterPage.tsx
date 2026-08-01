/**
 * e05 숙소 등록 배선(01b Seed 전체 · 02a G-2 FSD 상태 소유). `StayRegisterScreen`은 무상태라
 * 검색·후보·좌표확정·지도시트·날짜·제출 6축 상태를 전부 여기서 진다(선례 `StaySearchPage` →
 * `StaySearchScreen`).
 *
 * 검색은 키보드 검색 키(`onSubmitQuery`)에서만 실제 요청을 낸다 — `submittedQuery`가
 * `null`인 동안은 `useGetStaysGeocode`를 `enabled: false`로 꺼 둔다(02a ★14, `q`가 required라
 * 조건 없이 부르면 빈 문자열로 나간다). 재검색할 때마다 이전 후보 선택·좌표 확정을 함께
 * 초기화한다(§3-2 가중치 1.0) — 'A 호텔의 좌표'에 'B 호텔의 이름'이 붙어 서버로 가는 불일치를
 * 막는다.
 *
 * 지도 시트가 어떤 얼굴(open · open-map-failed)을 쓸지는 카카오 JS 키의 유무로 정한다 —
 * `KakaoMapView` 자신도 같은 판단을 하므로(같은 파일 내부) 키 유무가 지도 성공 여부와 정확히
 * 같은 값이다(02a ★6). 이 읽기는 `mapBridgeStructure.test.ts` A-2(env 참조는 `shared/map`
 * 하나)의 모집단(`src/shared/map/**`) 밖이라 그 가드를 깨지 않는다.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import type { GeocodeCandidate } from '@/shared/api/generated/schemas';
import { usePostSavedStays } from '@/shared/api/generated/saved-stays/saved-stays';
import { useGetStaysGeocode } from '@/shared/api/generated/stays/stays';

import {
  applyDatePick,
  commitDateRange,
  shiftMonth,
  type StayDateRange,
} from '@/features/stay/model/stayDates';
import {
  buildStayRegisterRequest,
  canSubmitStayRegister,
  type StayRegisterFlow,
} from '@/features/stay/model/stayRegisterForm';
import { StayRegisterScreen } from '@/features/stay/ui/StayRegisterScreen';

/** 로컬 달력 기준 오늘 — 과거 날짜 비활성(§3-4)의 기준값이라 UTC로 어긋나면 자정 근처에서
 * 하루가 밀린다. */
function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const EMPTY_RANGE: StayDateRange = { checkIn: null, checkOut: null };

export function StayRegisterPage(): ReactElement {
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] =
    useState<GeocodeCandidate | null>(null);
  const [coordConfirmed, setCoordConfirmed] = useState(false);
  const [mapSheetState, setMapSheetState] =
    useState<StayRegisterFlow['mapSheetState']>('closed');
  const [dateRange, setDateRange] = useState<StayDateRange>(EMPTY_RANGE);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  /** 달력이 보여주는 달 'YYYY-MM'. 시트를 열 때마다 체크인(없으면 오늘)의 달로 되맞춘다.
   *  달력이 한 달만 그려 월 경계를 넘는 범위를 못 고르던 결함(5-b W-1) 때문에 생긴 상태다. */
  const [calendarMonth, setCalendarMonth] = useState(() =>
    todayIso().slice(0, 7)
  );
  const [submitStatus, setSubmitStatus] =
    useState<StayRegisterFlow['submitStatus']>('idle');

  // 빈 검색어로는 부르지 않는다(5-b W-2). `!== null`만으로는 빈 입력창에서 검색 키를
  // 누른 경로가 열려 `?q=`가 나가고, 서버 400이 "지도 검색을 사용할 수 없어요"로 표시돼
  // 검색어를 안 넣었을 뿐인 사용자가 지도 장애 문구를 본다. 02a ★14가 지목한 함정의
  // 나머지 절반이다(초기 렌더만 막혀 있었다).
  const geocodeQuery = useGetStaysGeocode(
    { q: submittedQuery ?? '' },
    { query: { enabled: (submittedQuery ?? '').trim() !== '' } }
  );
  const postSavedStays = usePostSavedStays();

  const candidates = geocodeQuery.data ?? [];
  const searchStatus: StayRegisterFlow['searchStatus'] =
    submittedQuery === null
      ? 'idle'
      : geocodeQuery.isPending
        ? 'loading'
        : geocodeQuery.isError
          ? 'error'
          : candidates.length > 0
            ? 'success'
            : 'empty';

  const flow: StayRegisterFlow = {
    query,
    searchStatus,
    candidates,
    selectedCandidate,
    coordConfirmed,
    mapSheetState,
    checkIn: dateRange.checkIn,
    checkOut: dateRange.checkOut,
    dateSheetOpen,
    submitStatus,
  };

  function handleSubmitQuery(): void {
    setSubmittedQuery(query);
    setSelectedCandidate(null);
    setCoordConfirmed(false);
    setMapSheetState('closed');
    // 재검색은 제출 실패도 지운다(5-b W-3). 안 지우면 "등록에 실패했어요" 배너가 다음
    // 검색을 넘어 살아남고, 후보가 초기화된 상태라 그 버튼이 침묵 no-op가 된다 —
    // B-1과 같은 뿌리(재검색이 submitStatus를 안 건드린다)에서 나온 두 번째 증상이다.
    setSubmitStatus('idle');
  }

  function handleSelectCandidate(candidate: GeocodeCandidate): void {
    setSelectedCandidate(candidate);
    setCoordConfirmed(false);
  }

  function handleOpenMapSheet(): void {
    const hasMapKey = Boolean(process.env.EXPO_PUBLIC_KAKAO_MAP_JS_KEY);
    setMapSheetState(hasMapKey ? 'open' : 'open-map-failed');
  }

  function handleConfirmCoord(): void {
    setCoordConfirmed(true);
    setMapSheetState('closed');
  }

  function handleOpenDateSheet(): void {
    setCalendarMonth((dateRange.checkIn ?? todayIso()).slice(0, 7));
    setDateSheetOpen(true);
  }

  function handleCloseDateSheet(): void {
    setDateRange((prev) => commitDateRange(prev));
    setDateSheetOpen(false);
  }

  async function handleSubmit(): Promise<void> {
    // 좌표 게이트는 호출자에 둔다 — 버튼의 disabled에만 두면 그것을 안 건 버튼이
    // 통째로 우회한다. 실제로 제출 실패 배너의 "다시 시도"가 그 구멍이었다(5-b B-1):
    // 실패 후 후보를 다시 탭하면 coordConfirmed가 false로 풀리는데, 그 버튼은
    // 여전히 눌려 coordConfirmed:false 본문이 서버로 나갔다. AC-3은 서버 400에
    // 기대는 것을 위반으로 규정한다.
    if (!canSubmitStayRegister(flow)) return;

    const request = buildStayRegisterRequest(flow);
    if (request === null) return;

    setSubmitStatus('submitting');
    try {
      await postSavedStays.mutateAsync({ data: request });
      router.back();
    } catch {
      setSubmitStatus('error');
    }
  }

  return (
    <StayRegisterScreen
      flow={flow}
      today={todayIso()}
      onChangeQuery={setQuery}
      onSubmitQuery={handleSubmitQuery}
      onRetrySearch={() => geocodeQuery.refetch()}
      onSelectCandidate={handleSelectCandidate}
      onOpenMapSheet={handleOpenMapSheet}
      onConfirmCoord={handleConfirmCoord}
      onCloseMapSheet={() => setMapSheetState('closed')}
      onOpenDateSheet={handleOpenDateSheet}
      calendarMonth={calendarMonth}
      onShiftCalendarMonth={(delta) =>
        setCalendarMonth((prev) => shiftMonth(prev, delta))
      }
      onPickDate={(date) => setDateRange((prev) => applyDatePick(prev, date))}
      onCloseDateSheet={handleCloseDateSheet}
      onSubmit={handleSubmit}
    />
  );
}
