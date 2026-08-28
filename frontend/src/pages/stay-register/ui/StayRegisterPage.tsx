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
import type { KakaoMapMessage } from '@/shared/map';

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
  const [pinAddressStatus, setPinAddressStatus] =
    useState<StayRegisterFlow['pinAddressStatus']>('idle');
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
    activeTab,
    query,
    name,
    searchStatus,
    candidates,
    selectedCandidate,
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
    // 새 검색은 이전 핀 세션의 잔상도 지운다 — 안 지우면 검색으로 후보가 비었는데도 옛
    // 핀의 "역지오코딩 실패" 배너가 핀 탭에 남아 있는 것처럼 보일 수 있다.
    setPinAddressStatus('idle');
    // 재검색은 제출 실패도 지운다(5-b W-3). 안 지우면 "등록에 실패했어요" 배너가 다음
    // 검색을 넘어 살아남고, 후보가 초기화된 상태라 그 버튼이 침묵 no-op가 된다 —
    // B-1과 같은 뿌리(재검색이 submitStatus를 안 건드린다)에서 나온 두 번째 증상이다.
    setSubmitStatus('idle');
  }

  /** 5-b 2차(B-2 잔여) — 핀 탭을 벗어나면 `PinPanel`의 지도(WebView 문서)가 언마운트된다
   * (조건부 렌더, `StayRegisterScreen`의 `activeTab === 'pin'` 분기 — 시트 여닫기와 달리
   * 이건 이번 칸 이전부터 있던 동작이라 손대지 않는다, §7-7). 역지오코딩이 진행 중일 때
   * 그 문서가 죽으면 응답이 다시는 안 오므로, 손대지 않으면 `pinAddressStatus`가 'loading'에
   * 영구히 갇힌다(P-9가 loading을 무표시로 잠가서 화면은 완전히 조용해진다 — INV-4 위반).
   * 문서가 죽었다는 사실 자체를 상태에 반영해 실패로 떨어뜨린다 — 다시 핀 탭에 돌아와도
   * 그 요청의 결과는 이제 영원히 안 올 것이므로, "실패했으니 이름을 직접 치라"는 안내가
   * "아무 말 없이 멈춰 있다"보다 사실에 더 가깝다(P-2 계약). */
  function handleSelectTab(tab: StayRegisterTab): void {
    if (
      activeTab === 'pin' &&
      tab !== 'pin' &&
      pinAddressStatus === 'loading'
    ) {
      setPinAddressStatus('error');
    }
    setActiveTab(tab);
  }

  function handleSelectCandidate(candidate: GeocodeCandidate): void {
    setSelectedCandidate(candidate);
    // 검색 후보(GeocodeCandidate)는 lat/lng가 required라 신뢰 가능한 좌표를 이미 가진다 —
    // 담는 순간이 곧 확정이다(TRIP-600 A안 "좌표 존재=확정"). 좌표를 다시 찍으라고 시트를
    // 강요하지 않는다(핀 경로는 좌표를 처음 얻으므로 handlePinMessage에서 false로 남긴다).
    setCoordConfirmed(true);
    setCoordSource('MAP_SEARCH');
    setPinAddressStatus('idle');
  }

  /** 핀 지정 탭의 지도가 올려보낸 메시지 — 해석은 전부 여기서 한다(화면은 무상태, G-2).
   * 좌표 슬롯은 하나뿐이라(★10) 핀 좌표도 selectedCandidate에 담고 coordSource로만 출처를
   * 구분한다. 새 핀은 항상 이전 확정을 푼다(D4 — 탭 전환은 제외지만 재핀은 포함). */
  function handlePinMessage(message: KakaoMapMessage): void {
    if (message.type === 'PIN_DROP') {
      setSelectedCandidate({
        name: '',
        address: '',
        lat: message.lat,
        lng: message.lng,
      });
      setCoordSource('PIN');
      setCoordConfirmed(false);
      setPinAddressStatus('loading');
      return;
    }
    if (message.type === 'GEOCODE_OK') {
      const buildingName = message.buildingName ?? '';
      setSelectedCandidate((prev) =>
        prev === null
          ? null
          : { ...prev, address: message.address, name: buildingName }
      );
      setPinAddressStatus('ok');
      // TRIP-199 5-a(W-1) — 숙소명 입력 상태(name)는 자동으로 채우지 않는다. 예전에는
      // 여기서 건물명을 name에 채웠는데, 그 값이 name 상태에 남아 지도 검색 탭으로
      // 되돌아가도 따라가고(그 화면엔 이름 칸이 없어 보지도 지우지도 못한다), 엉뚱한
      // 후보를 확정해도 그 이름으로 나갔다. 건물명은 selectedCandidate.name에 이미
      // 담기고 buildStayRegisterRequest의 폴백이 그것을 쓰므로, 자동 채움 없이도 핀 등록
      // 결과는 그대로다.
      return;
    }
    // GEOCODE_FAIL — 침묵 실패 금지(INV-4). 좌표는 이미 확보돼 있으니 등록 자체는
    // 막지 않는다(D3) — canSubmitStayRegister는 pinAddressStatus를 보지 않는다.
    setPinAddressStatus('error');
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
      onSelectTab={handleSelectTab}
      onChangeQuery={setQuery}
      onChangeName={setName}
      onSubmitQuery={handleSubmitQuery}
      onRetrySearch={() => geocodeQuery.refetch()}
      onSelectCandidate={handleSelectCandidate}
      onPinMessage={handlePinMessage}
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
