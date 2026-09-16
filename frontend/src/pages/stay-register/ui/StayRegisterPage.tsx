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
 * 지도 시트가 어떤 얼굴(open · open-map-failed)을 쓸지는 네이버 지도 Client ID
 * (`EXPO_PUBLIC_NAVER_MAP_CLIENT_ID`)의 유무로 정한다 — `MapView` 자신도 같은 판단을 하므로
 * 키 유무가 지도 성공 여부와 정확히 같은 값이다(02a ★6). 이 읽기는 `mapBridgeStructure.test.ts`
 * A-2(env 참조는 `shared/map` 하나)의 모집단(`src/shared/map/**`) 밖이라 그 가드를 깨지 않는다.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import type { GeocodeCandidate } from '@/shared/api/generated/schemas';
import { usePostSavedStays } from '@/shared/api/generated/saved-stays/saved-stays';
import {
  useGetStaysGeocode,
  useGetStaysReverseGeocode,
} from '@/shared/api/generated/stays/stays';
import type { MapCenter } from '@/shared/map';

import {
  applyDatePick,
  shiftMonth,
  type StayDateRange,
} from '@/features/stay/model/stayDates';
import {
  buildStayRegisterRequest,
  canSubmitStayRegister,
  type StayRegisterFlow,
  type StayRegisterTab,
} from '@/features/stay/model/stayRegisterForm';
import { StayRegisterScreen } from '@/features/stay/ui/StayRegisterScreen';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

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

/** `baseDate`는 달력 기준 '오늘' 주입점(TRIP-390 · 선례 `TripNewStep1Page`) — 페이지 달력
 *  테스트를 결정론으로 만든다. 미지정이면 실시계(`todayIso()`)로 폴백한다(프로덕션 경로). */
export function StayRegisterPage({
  baseDate,
}: { baseDate?: string } = {}): ReactElement {
  const router = useRouter();
  const today = baseDate ?? todayIso();

  // 여행 기간(위저드 스토어)을 달력 상·하한으로 흘려보낸다(TRIP-390 · Seed Q1). features/stay는
  // features/trip를 직접 못 읽으므로(조합은 pages 몫) 페이지가 구독해 문자열 prop으로 내린다.
  // 시작·종료 둘 다 있을 때만 제한하고, 하나라도 비면 상·하한 없음(현행 오늘+ 유지, AC-6).
  const startDate = useTripWizardStore((state) => state.startDate);
  const endDate = useTripWizardStore((state) => state.endDate);
  const hasTripPeriod = startDate !== undefined && endDate !== undefined;
  const minDate = hasTripPeriod ? startDate : undefined;
  const maxDate = hasTripPeriod ? endDate : undefined;

  const [activeTab, setActiveTab] = useState<StayRegisterTab>('mapsearch');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] =
    useState<GeocodeCandidate | null>(null);
  const [coordSource, setCoordSource] =
    useState<StayRegisterFlow['coordSource']>('MAP_SEARCH');
  const [coordConfirmed, setCoordConfirmed] = useState(false);
  const [mapSheetState, setMapSheetState] =
    useState<StayRegisterFlow['mapSheetState']>('closed');
  const [dateRange, setDateRange] = useState<StayDateRange>(EMPTY_RANGE);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  /** 달력이 보여주는 달 'YYYY-MM'. 시트를 열 때마다 체크인(없으면 여행 시작 달, 그것도 없으면
   *  오늘)의 달로 되맞춘다. 여행 기간이 오늘과 다른 달이면 오늘의 달로 열려 전 칸이 disabled가
   *  되던 것을 minDate로 clamp한다(5-c). 달력이 한 달만 그려 월 경계를 넘는 범위를 못 고르던
   *  결함(5-b W-1) 때문에 생긴 상태다. */
  const [calendarMonth, setCalendarMonth] = useState(() => today.slice(0, 7));
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

  // 핀 좌표의 역지오코딩 — **단일 경로**(TRIP-866 S4). 옛 WebView 브리지(PIN_DROP→GEOCODE_OK)를
  // 걷어내고, 핀으로 찍은 좌표를 이 훅으로 주소로 바꾼다. 핀 좌표(coordSource='PIN' + 좌표 있음)가
  // 있을 때만 켠다 — 그 외에는 조회 자체가 안 나간다(빈 좌표 헛호출 차단, useGetStaysGeocode 선례).
  const pinCoords =
    coordSource === 'PIN' && selectedCandidate !== null
      ? { lat: selectedCandidate.lat, lng: selectedCandidate.lng }
      : null;
  const reverseGeocode = useGetStaysReverseGeocode(
    { lat: pinCoords?.lat ?? 0, lng: pinCoords?.lng ?? 0 },
    { query: { enabled: pinCoords !== null } }
  );

  // 핀 주소 상태는 조회가 **단일 출처**다(별도 state 없음) — 옛 handlePinMessage 가 상태를 손으로
  // 밀어 넣던 것을 조회 결과에서 파생한다. PIN 모드가 아니면 'idle'. 조회 중이면 'loading',
  // 벤더 장애(503)면 'error', 도착하면 'ok'(주소가 없어도 'ok' — null 은 장애가 아니다). enabled
  // 게이트를 먼저 보므로, 조회가 꺼진 동안(react-query 는 그때 isPending=true) 'loading' 으로 새지 않는다.
  const pinAddressStatus: StayRegisterFlow['pinAddressStatus'] =
    pinCoords === null
      ? 'idle'
      : reverseGeocode.isError
        ? 'error'
        : reverseGeocode.isPending
          ? 'loading'
          : 'ok';
  // 표시용 주소 — 성공이고 주소 문자열이면 그 값, 그 좌표에 주소가 없으면(null) 빈 값
  // ("주소 미확인"은 화면이 그린다). 저장 정본은 좌표라 이 주소는 표시 사본일 뿐이다.
  const pinAddress =
    pinCoords !== null &&
    !reverseGeocode.isError &&
    typeof reverseGeocode.data?.address === 'string'
      ? reverseGeocode.data.address
      : '';

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

  // PIN 좌표에는 역지오코딩 주소를 실어 화면에 내린다(MAP_SEARCH 후보는 자체 주소를 유지).
  // 저장 본문(buildStayRegisterRequest)은 address 를 안 쓰므로 이 주입은 표시에만 영향을 준다.
  const flowCandidate =
    pinCoords !== null && selectedCandidate !== null
      ? { ...selectedCandidate, address: pinAddress }
      : selectedCandidate;

  const flow: StayRegisterFlow = {
    activeTab,
    query,
    name,
    searchStatus,
    candidates,
    selectedCandidate: flowCandidate,
    coordSource,
    pinAddressStatus,
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
    // 핀 주소 상태는 조회에서 파생되므로 따로 지울 필요가 없다(TRIP-866 S4) — 후보가 null 이 되고
    // coordSource 가 그대로 'PIN' 이어도 pinCoords 가 null 이 되어 파생값이 'idle' 로 돌아간다.
    // 재검색은 제출 실패도 지운다(5-b W-3). 안 지우면 "등록에 실패했어요" 배너가 다음
    // 검색을 넘어 살아남고, 후보가 초기화된 상태라 그 버튼이 침묵 no-op가 된다 —
    // B-1과 같은 뿌리(재검색이 submitStatus를 안 건드린다)에서 나온 두 번째 증상이다.
    setSubmitStatus('idle');
  }

  function handleSelectCandidate(candidate: GeocodeCandidate): void {
    setSelectedCandidate(candidate);
    // 검색 후보(GeocodeCandidate)는 lat/lng가 required라 신뢰 가능한 좌표를 이미 가진다 —
    // 담는 순간이 곧 확정이다(TRIP-600 A안 "좌표 존재=확정"). 좌표를 다시 찍으라고 시트를
    // 강요하지 않는다(핀 경로는 좌표를 처음 얻으므로 handlePickCoord에서 false로 남긴다).
    setCoordConfirmed(true);
    // coordSource 를 MAP_SEARCH 로 되돌리면 pinCoords 가 null 이 되어 역지오코딩이 꺼지고
    // 파생 pinAddressStatus 가 자연히 'idle' 로 돌아간다(핀 세션 잔상 자동 정리).
    setCoordSource('MAP_SEARCH');
  }

  /** 핀 지정 탭의 중앙 고정 핀이 보고한 중심 좌표를 받는다(TRIP-866 S4 · 화면은 무상태, G-2).
   * 좌표 슬롯은 하나뿐이라(★10) 핀 좌표도 selectedCandidate에 담고 coordSource로만 출처를
   * 구분한다. 좌표만 담고 확정하지 않는다(coordConfirmed:false — 확정은 기존 bottom-sheet
   * 단일 경로가 진다). 주소는 위 useGetStaysReverseGeocode 가 이 좌표로 따로 얻는다(단일 경로).
   * 이름(name)은 자동으로 안 채운다(TRIP-199 W-1 계승 — 검색 탭으로 이름이 새는 것 방지). */
  function handlePickCoord(center: MapCenter): void {
    setSelectedCandidate({
      name: '',
      address: '',
      lat: center.lat,
      lng: center.lng,
    });
    setCoordSource('PIN');
    setCoordConfirmed(false);
  }

  function handleOpenMapSheet(): void {
    const hasMapKey = Boolean(process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID);
    setMapSheetState(hasMapKey ? 'open' : 'open-map-failed');
  }

  function handleConfirmCoord(): void {
    setCoordConfirmed(true);
    setMapSheetState('closed');
  }

  function handleOpenDateSheet(): void {
    setCalendarMonth((dateRange.checkIn ?? minDate ?? today).slice(0, 7));
    setDateSheetOpen(true);
  }

  /** AC-4 — 체크인만 고르고 닫아도 그 선택을 버리지 않는다(INV-4 침묵 금지). 예전엔 여기서
   * `commitDateRange`로 반쪽을 `{null,null}`로 되돌렸는데, 그러면 눌린 체크인이 아무 말 없이
   * 사라졌다. 순수 함수 `commitDateRange`(PBT 동결)는 손대지 않고 이 자리에서 리셋 호출만
   * 없앤다 — dateRange가 그대로 남아 요약이 '체크아웃도 선택하세요'를 보인다. 반쪽이 서버로
   * 새는 것은 `buildStayRegisterRequest`가 날짜 둘 다 있을 때만 키를 실어(both-or-nothing) 막는다. */
  function handleCloseDateSheet(): void {
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
      today={today}
      minDate={minDate}
      maxDate={maxDate}
      onBack={() => router.back()}
      onSelectTab={setActiveTab}
      onChangeQuery={setQuery}
      onChangeName={setName}
      onSubmitQuery={handleSubmitQuery}
      onRetrySearch={() => geocodeQuery.refetch()}
      onSelectCandidate={handleSelectCandidate}
      onPickCoord={handlePickCoord}
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
