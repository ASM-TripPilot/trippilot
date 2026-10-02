import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { router } from 'expo-router';

import { buildSlotKey } from '@/entities/itinerary-slot';
import { buildStatePins } from '@/entities/itinerary-slot';
import { formatDayLabel } from '@/entities/trip';
import { deriveStayAttribution } from '../model/stayAttribution';
import {
  useRecordBases,
  useRecordSavedStays,
  useTripRecords,
} from '../model/useTripRecords';
import { useAdjustVisitTimes } from '../model/useAdjustVisitTimes';
import { useSpontaneousNames } from '@/features/check-visit';
import { useVisitCheck } from '@/features/check-visit';
import { orderByArrival } from '../model/visitOrder';
import { isOptimisticVisit } from '@/features/check-visit';
import { SkipVisitDialog } from './SkipVisitDialog';
import type { VisitRecordCardVM } from './VisitRecordCard';
import { VisitRecordCardContainer } from './VisitRecordCardContainer';
import { VisitTimeSheet } from './VisitTimeSheet';
import {
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { ArriveRequestSource } from '@/shared/api/generated/schemas';
import type { MapCenter } from '@/shared/map';
import { seoulDate, seoulTime } from '@/shared/date';
import { guardPress } from '@/shared/press';

import { TripRecordsView, type RecordPlanRowVM } from './TripRecordsView';

/**
 * TRIP-565 · trip-records 페이지 — 조회·조립·배선의 단일 출처(FSD).
 *
 * itinerary 를 한 번 조회해 셋을 함께 얻는다: 일차 칩(days[].date)·장소명 맵(slots.poiId→nameKo)·
 * 지도 핀(slots.lat/lng). 방문 기록은 `useTripRecords(tripId, activeDay)` 로 따로 받아 카드 VM 으로
 * 조립한다(VisitCheck 엔 장소명이 없어 itinerary 로 조인). 낙관 갱신(complete/skip)은
 * `useVisitCheck` 가 진다. 뷰(`TripRecordsView`, 셸 조립)는 무상태 — 여기서 내린 VM·콜백만 그린다.
 * TRIP-1085 — 전면 지도 + 바텀시트라 하단 탭바가 없다(결정 1(b)). 시트 헤더 여행명은 `GET /trips/{tripId}`
 * 에서 오고, 실패하면 그 조각만 빠진다(INV-4).
 *
 * 카드의 `arrivedLabel` 은 서버 순간(UTC)을 **서울 시계** HH:mm 로 읽어 내린다(TRIP-1069 · BR-U5-27 —
 * 시각 표시일 뿐 소요시간이 아니다, INV-3). 카드는 도착 이른 순, 도착 없는 카드는 끝(결정 2(a)).
 *
 * TRIP-1069 — 시각 수정 시트·건너뛰기 확인 다이얼로그는 이 페이지가 연다(열린 id 를 쥔다). 결과는 화면에
 * 글로 알린다(시각 저장 충돌·실패 = `record-trip-visit-time-result`, 건너뛰기 실패 = 다이얼로그 안, INV-4).
 */

export interface TripRecordsPageProps {
  tripId: string;
  /** 'YYYY-MM-DD' — 딥링크/캘린더(j07) 경유 진입 시 시작 일자. 없으면 첫 일자. */
  day?: string;
  /** TRIP-1021 'YYYY-MM-DD' 오늘 주입 seam(LiveItineraryPage 선례) — 계획 행 "방문 체크"는 이 날 탭에서만. */
  today?: string;
}

const DEFAULT_CENTER: MapCenter = { lat: 37.5665, lng: 126.978 };

/** TRIP-761 · 수동 체크인 모드 안내문 — 법 근거 문구 `(좌표 자동기록 비활성)`(INV-U5-04·BR-U5-12)가
 * load-bearing 이라 자구가 곧 계약이다. 권한이 있으면 이 문자열을 안 내려 화면이 default 를 쓴다. */
const MANUAL_NOTICE =
  '수동 체크인 · 방문한 곳을 직접 선택해 기록하세요 (좌표 자동기록 비활성)';

/** TRIP-1069 D6 — 시각 저장 404·네트워크 실패 안내(충돌은 훅의 `VISIT_CONFLICT_NOTICE`). */
const TIME_SAVE_FAILED = '방문 시각을 저장하지 못했어요';

export function TripRecordsPage({
  tripId,
  day,
  today = seoulDate(new Date()),
}: TripRecordsPageProps): React.ReactElement {
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const trip = useGetTripsTripId(tripId);
  const days = itinerary.data?.days ?? [];

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const activeDay = selectedDay ?? day ?? days[0]?.date ?? '';

  // TRIP-761 모드 seam — 위치 권한을 "다시 묻지 않고" 현재 상태만 조회해(LocationPage 선례) 없으면
  // (BR-U5-54 "권한 없거나 거부") 수동 체크인 모드로 전환한다. 조회 실패는 일반 모드 유지(INV-4
  // 결정론 폴백 — 배너·⊘ 배지가 안 뜰 뿐 기록은 그대로 된다).
  const [manualCheckin, setManualCheckin] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const current = await Location.getForegroundPermissionsAsync();
        setManualCheckin(!current.granted);
      } catch {
        // 무해 — 일반 모드 유지.
      }
    })();
  }, []);

  const records = useTripRecords(tripId, activeDay);
  const bases = useRecordBases(tripId);
  const savedStays = useRecordSavedStays();
  const visitCheck = useVisitCheck({ tripId, day: activeDay });
  const adjustTimes = useAdjustVisitTimes({ tripId, day: activeDay });
  const spontaneousNames = useSpontaneousNames(tripId);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [timeResult, setTimeResult] = useState<string | null>(null);
  // 건너뛰기 확인 대상 — pending(확정 뒤 응답 전) 동안 다이얼로그 두 버튼이 막힌다(연타·취소 경합 차단).
  const [skipTarget, setSkipTarget] = useState<{
    visitCheckId: string;
    status: 'idle' | 'pending' | 'failed';
  } | null>(null);

  const dayTabs = days.map((d, index) => ({
    day: d.date,
    label: formatDayLabel(index + 1),
  }));

  // TRIP-569 귀속 파생 — 활성 일자를 덮는 base 를 찾아 숙소명을 해소한다(저장 안 함, 매 렌더
  // bases 로 다시 계산 = BR-U5-25). dayLabel('N일차') 조립은 페이지 몫(stayAttribution 은
  // 날짜·숙소만 준다). 활성 일자가 없거나 방문이 없으면 헤더를 안 내린다.
  const attributionGroups = deriveStayAttribution({
    visits: records.data?.visits ?? [],
    bases: bases.data ?? [],
    savedStays: savedStays.data ?? [],
  });
  const activeIndex = days.findIndex((d) => d.date === activeDay);
  const activeGroup = attributionGroups.find((g) => g.date === activeDay);
  const attribution =
    activeIndex >= 0
      ? {
          dayLabel: formatDayLabel(activeIndex + 1),
          stayName: activeGroup?.baseStay?.name ?? null,
        }
      : undefined;

  // 장소명 조인 — VisitCheck 엔 poiId 만 있어 itinerary 슬롯에서 이름을 가져온다. 즉석 방문은 계획에
  // 없어 피커가 남긴 세션 이름(TRIP-1072)으로, 그것도 없으면(앱 재시작 등) poiId 로 폴백.
  const nameByPoi = new Map(
    days
      .flatMap((d) => d.slots)
      .map((slot) => [slot.poiId, slot.nameKo ?? slot.poiId])
  );

  const activeSlots = days.find((d) => d.date === activeDay)?.slots ?? [];
  // TRIP-1085 결정 3(c) — 방문 기준 핀. 그날 계획 슬롯 순서 그대로(번호 제자리, 좌표 없는 슬롯은 건너뜀).
  // 슬롯 키가 같은 방문이 도착했고 건너뛰지 않았으면 체크 핀(done), 아니면 번호 핀(upcoming). poiId 로
  // 맞추면 같은 장소의 즉석 방문(slotKey null)이 계획 핀을 체크한다 — 계획 행과 같은 슬롯 키 판정을 쓴다.
  // 즉석 방문은 좌표가 없어(VisitCheck) 핀이 없다. `kind` 를 붙이면 지도가 기록 마커족으로 그린다(금지).
  const arrivedSlotKeys = new Set(
    (records.data?.visits ?? [])
      .filter((visit) => visit.arrivedAt != null && visit.skippedAt == null)
      .map((visit) => visit.slotKey)
  );
  const pins = buildStatePins(
    activeSlots.map((slot) => ({
      lat: slot.lat,
      lng: slot.lng,
      progress: arrivedSlotKeys.has(buildSlotKey(activeDay, slot.poiId))
        ? 'done'
        : 'upcoming',
    }))
  );
  const firstPin = pins[0];
  const mapCenter: MapCenter = firstPin
    ? { lat: firstPin.lat, lng: firstPin.lng }
    : DEFAULT_CENTER;

  const cards: VisitRecordCardVM[] = orderByArrival(
    records.data?.visits ?? []
  ).map((visit) => ({
    visitCheckId: visit.visitCheckId,
    slotKey: visit.slotKey ?? null,
    poiId: visit.poiId,
    nameKo:
      nameByPoi.get(visit.poiId) ??
      spontaneousNames[visit.poiId] ??
      visit.poiId,
    arrivedAt: visit.arrivedAt ?? null,
    completedAt: visit.completedAt ?? null,
    skippedAt: visit.skippedAt ?? null,
    arrivedLabel: visit.arrivedAt ? seoulTime(new Date(visit.arrivedAt)) : null,
  }));

  // TRIP-1021 계획 행 — 그날 계획 슬롯 중 방문 레코드(슬롯 키 기준)가 없는 것. 방문이 있어도 남는다
  // (Q4 — 첫 체크 뒤에도 다음 곳을 여기서 체크할 수 있게). 도착하면 낙관 레코드가 그 키를 채워 행이 빠진다.
  // 그날 기록이 아직 안 왔으면 행을 안 그린다 — 이미 기록된 곳이 잠깐 행으로 떠 다시 체크(409)되지 않게.
  const visitsOfDay = records.data?.visits;
  const recordedSlotKeys = new Set(
    (visitsOfDay ?? []).map((visit) => visit.slotKey)
  );
  const planRows: RecordPlanRowVM[] = visitsOfDay
    ? activeSlots
        .map((slot) => ({
          slotKey: buildSlotKey(activeDay, slot.poiId),
          poiId: slot.poiId,
          nameKo: slot.nameKo ?? slot.poiId,
        }))
        .filter((row) => !recordedSlotKeys.has(row.slotKey))
    : [];

  const handleComplete = (id: string): void => {
    void visitCheck.complete(id);
  };
  // 건너뛰기는 확인을 거친다(결정 3(c)) — 카드 press 는 다이얼로그만 연다. 요청·낙관은 확정 뒤.
  const handleSkip = (id: string): void => {
    setSkipTarget({ visitCheckId: id, status: 'idle' });
  };
  const handleConfirmSkip = async (): Promise<void> => {
    if (skipTarget == null) return;
    const { visitCheckId } = skipTarget;
    setSkipTarget({ visitCheckId, status: 'pending' });
    const outcome = await visitCheck.skip(visitCheckId);
    setSkipTarget(
      outcome.kind === 'skipped' ? null : { visitCheckId, status: 'failed' }
    );
  };

  const editingCard = cards.find((card) => card.visitCheckId === editingId);
  const handleEditTime = (id: string): void => {
    setTimeResult(null);
    setEditingId(id);
  };
  // 시트는 바로 닫고(낙관 반영은 훅이 한다) 결과만 알린다. 성공은 안내 없음(D6). 빈 patch 는 요청 0회(AC-7).
  const handleSaveTimes = (patch: {
    arrivedAt?: string;
    completedAt?: string;
  }): void => {
    setEditingId(null);
    if (editingId == null || Object.keys(patch).length === 0) return;
    void adjustTimes
      .adjust({ visitCheckId: editingId, ...patch })
      .then((outcome) => {
        if (outcome.kind === 'conflict') setTimeResult(outcome.message);
        else if (outcome.kind === 'failed') setTimeResult(TIME_SAVE_FAILED);
      });
  };
  // TRIP-761 "방문 체크"(arrive) — 새 HTTP 없이 기존 arrive 재사용. source=MANUAL 로 도착을 생성한다
  // (complete 아님 — 완료 게이트 불변). arrive 는 무효화 대신 응답 레코드로 낙관 삽입을 교체한다.
  // TRIP-1021 — 슬롯 키를 반드시 싣는다. 비면 서버가 계획한 곳을 "계획에 없던 곳"(즉석 방문)으로 기록한다.
  const handleManualCheck = (poiId: string): void => {
    void visitCheck.arrive({
      // pill 은 도착 전(UPCOMING) 카드에만 선다 — 같은 poi 의 다른 카드(즉석 방문 등)를 집지 않게 좁힌다.
      slotKey:
        cards.find((card) => card.poiId === poiId && card.arrivedAt === null)
          ?.slotKey ?? null,
      poiId,
      source: ArriveRequestSource.MANUAL,
    });
  };
  const handlePlanCheck = (row: RecordPlanRowVM): void => {
    void visitCheck.arrive({
      slotKey: row.slotKey,
      poiId: row.poiId,
      source: ArriveRequestSource.MANUAL,
    });
  };

  return (
    <View className="flex-1">
      <TripRecordsView
        tripTitle={trip.data?.title}
        dayTabs={dayTabs}
        activeDay={activeDay}
        onSelectDay={setSelectedDay}
        mapCenter={mapCenter}
        mapPins={pins}
        cards={cards}
        attribution={attribution}
        // TRIP-761 — 권한 부재면 수동 체크인 모드로 하향(배너·⊘ 배지·"방문 체크" pill) + 안내문을 manual
        // 카피로 교체. 권한이 있으면 noticeCopy 를 안 내려 화면이 default 안내문을 쓴다(상호배타).
        manualCheckin={manualCheckin}
        noticeCopy={manualCheckin ? MANUAL_NOTICE : undefined}
        onPressManualCheck={handleManualCheck}
        planRows={planRows}
        // TRIP-1021 — 지난·미래 날에 체크하면 그날 슬롯에 오늘 도착이 찍힌다. 행은 두고 버튼만 뺀다.
        // TRIP-1069 결정 1(c) — 위치 권한과 무관하게 오늘 탭에만(지난 날 사후 기록은 BE 선행, AC-24 미충족).
        onPressPlanCheck={activeDay === today ? handlePlanCheck : undefined}
        // 빈 안내는 기록이 실제로 0건일 때만 — 로딩 중엔 아무것도, 실패면 오류 표면 + 재조회.
        recordsStatus={
          records.data ? 'ready' : records.isError ? 'error' : 'loading'
        }
        onPressRetryRecords={() => {
          void records.refetch();
        }}
        // TRIP-1069 D3 — 도착한(완료 포함) 실 레코드 카드는 전부 사진/메모 컨테이너로 그린다(메모 PUT 은
        // 방문 기록만 있으면 된다). 건너뛴 카드·도착 전 카드·낙관 자리표시자는 undefined → 화면의 기본 카드
        // (슬롯 없음 = 사진·메모 칸 없음). 낙관 카드는 아직 서버에 없어 시각 수정·메모·사진이 404 로 간다(D7).
        renderCard={(card) =>
          card.arrivedAt != null &&
          card.skippedAt == null &&
          !isOptimisticVisit(card.visitCheckId) ? (
            <VisitRecordCardContainer
              tripId={tripId}
              card={card}
              onPressComplete={handleComplete}
              onPressSkip={handleSkip}
              onPressEditTime={handleEditTime}
            />
          ) : undefined
        }
        onPressComplete={handleComplete}
        onPressSkip={handleSkip}
        // TRIP-1072 — [방문 추가]는 오늘 탭에만(다른 탭에서 추가하면 오늘 날짜로 묶여 그 탭엔 안 보인다).
        // 피커에 활성 일자를 실어 두 화면이 같은 (tripId, day) 방문 캐시를 보게 한다. 연타는 guardPress.
        onPressSpontaneous={
          activeDay === today
            ? guardPress(() =>
                router.push(
                  `/trips/${tripId}/records/add-visit?day=${activeDay}`
                )
              )
            : undefined
        }
        // TRIP-1088 — 선택된 일차의 j03 으로(오늘 고정 아님). 미래 일차엔 없다(결정 2, ISO 날짜 사전순 =
        // 시간순), 끝난 여행은 가르지 않는다(결정 3). '' <= today 는 참이라 일정 로딩 전(빈 날짜)을 따로 막는다.
        onPressReflection={
          activeDay !== '' && activeDay <= today
            ? guardPress(() =>
                router.push(`/trips/${tripId}/records/reflection/${activeDay}`)
              )
            : undefined
        }
        onPressBack={() => {
          if (router.canGoBack()) router.back();
        }}
      />

      {timeResult != null ? (
        // 탭하면 닫힌다 — 다음 시각 수정을 열 때도 지운다. TRIP-1085 — 탭바가 빠져 화면 맨 아래(홈 인디케이터
        // 위)에 뜬다. 시트보다 뒤 형제라 시트 위에 그려진다(실제 겹침은 6-b).
        <SafeAreaView
          edges={['bottom']}
          pointerEvents="box-none"
          className="absolute inset-x-0 bottom-0 px-lg pb-md"
        >
          <Pressable
            onPress={() => setTimeResult(null)}
            className="rounded-button bg-ink px-lg py-md"
          >
            <Text
              testID="record-trip-visit-time-result"
              className="font-noto text-label text-white"
            >
              {timeResult}
            </Text>
          </Pressable>
        </SafeAreaView>
      ) : null}

      {editingCard != null ? (
        // key — 시트가 뜬 채 다른 카드를 열면 새로 마운트해 그 카드 값으로 다시 시드한다(useState 는 첫 마운트만 읽는다).
        <VisitTimeSheet
          key={editingCard.visitCheckId}
          visitCheckId={editingCard.visitCheckId}
          placeName={editingCard.nameKo}
          arrivedAt={editingCard.arrivedAt ?? null}
          completedAt={editingCard.completedAt ?? null}
          now={new Date().toISOString()}
          onSave={handleSaveTimes}
          onCancel={() => setEditingId(null)}
        />
      ) : null}

      {skipTarget != null ? (
        <SkipVisitDialog
          pending={skipTarget.status === 'pending'}
          failed={skipTarget.status === 'failed'}
          onCancel={() => setSkipTarget(null)}
          onConfirm={() => {
            void handleConfirmSkip();
          }}
        />
      ) : null}
    </View>
  );
}
