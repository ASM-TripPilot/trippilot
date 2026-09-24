import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { router } from 'expo-router';

import { formatDayLabel } from '@/entities/trip/lib/formatDayLabel';
import { deriveStayAttribution } from '@/features/record/model/stayAttribution';
import {
  useRecordBases,
  useRecordSavedStays,
  useTripRecords,
} from '@/features/record/model/useTripRecords';
import { useVisitCheck } from '@/features/record/model/useVisitCheck';
import { TripRecordsScreen } from '@/features/record/ui/TripRecordsScreen';
import type { VisitRecordCardVM } from '@/features/record/ui/VisitRecordCard';
import { VisitRecordCardContainer } from '@/features/record/ui/VisitRecordCardContainer';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { ArriveRequestSource } from '@/shared/api/generated/schemas';
import type { MapCenter, MapPin } from '@/shared/map';
import type { ShellTabKey } from '@/shared/ui/BottomTabBar';

/**
 * TRIP-565 · trip-records 페이지 — 조회·조립·배선의 단일 출처(FSD).
 *
 * itinerary 를 한 번 조회해 셋을 함께 얻는다: 일자 탭(days[].date)·장소명 맵(slots.poiId→nameKo)·
 * 지도 핀(slots.lat/lng). 방문 기록은 `useTripRecords(tripId, activeDay)` 로 따로 받아 카드 VM 으로
 * 조립한다(VisitCheck 엔 장소명이 없어 itinerary 로 조인). 낙관 갱신(complete/skip)은
 * `useVisitCheck` 가 진다. 화면(`TripRecordsScreen`)은 무상태 — 여기서 내린 VM·콜백만 그린다.
 *
 * 카드의 `arrivedLabel` 은 여기서 HH:mm 로 잘라 완성 문자열로 내린다(ISO 의 11~16 슬라이스 —
 * 시각 표시일 뿐 소요시간이 아니다, INV-3). 체류시간은 어디에도 싣지 않는다.
 */

export interface TripRecordsPageProps {
  tripId: string;
  /** 'YYYY-MM-DD' — 딥링크/캘린더(j07) 경유 진입 시 시작 일자. 없으면 첫 일자. */
  day?: string;
}

const DEFAULT_CENTER: MapCenter = { lat: 37.5665, lng: 126.978 };

/** TRIP-761 · 수동 체크인 모드 안내문 — 법 근거 문구 `(좌표 자동기록 비활성)`(INV-U5-04·BR-U5-12)가
 * load-bearing 이라 자구가 곧 계약이다. 권한이 있으면 이 문자열을 안 내려 화면이 default 를 쓴다. */
const MANUAL_NOTICE =
  '수동 체크인 · 방문한 곳을 직접 선택해 기록하세요 (좌표 자동기록 비활성)';

export function TripRecordsPage({
  tripId,
  day,
}: TripRecordsPageProps): React.ReactElement {
  const itinerary = useGetTripsTripIdItinerary(tripId);
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

  // 장소명 조인 — VisitCheck 엔 poiId 만 있어 itinerary 슬롯에서 이름을 가져온다(즉석 방문은
  // 계획에 없어 poiId 로 폴백).
  const nameByPoi = new Map(
    days
      .flatMap((d) => d.slots)
      .map((slot) => [slot.poiId, slot.nameKo ?? slot.poiId])
  );

  const activeSlots = days.find((d) => d.date === activeDay)?.slots ?? [];
  const pins: MapPin[] = activeSlots.flatMap((slot, index) =>
    typeof slot.lat === 'number' && typeof slot.lng === 'number'
      ? [{ number: index + 1, lat: slot.lat, lng: slot.lng }]
      : []
  );
  const firstPin = pins[0];
  const mapCenter: MapCenter = firstPin
    ? { lat: firstPin.lat, lng: firstPin.lng }
    : DEFAULT_CENTER;

  const cards: VisitRecordCardVM[] = (records.data?.visits ?? []).map(
    (visit) => ({
      visitCheckId: visit.visitCheckId,
      slotKey: visit.slotKey ?? null,
      poiId: visit.poiId,
      nameKo: nameByPoi.get(visit.poiId) ?? visit.poiId,
      arrivedAt: visit.arrivedAt ?? null,
      completedAt: visit.completedAt ?? null,
      skippedAt: visit.skippedAt ?? null,
      arrivedLabel: visit.arrivedAt ? visit.arrivedAt.slice(11, 16) : null,
    })
  );

  const handleComplete = (id: string): void => {
    void visitCheck.complete(id);
  };
  const handleSkip = (id: string): void => {
    void visitCheck.skip(id);
  };
  // TRIP-761 "방문 체크"(arrive) — 새 HTTP 없이 기존 arrive 재사용. source=MANUAL 로 도착을 생성한다
  // (complete 아님 — 완료 게이트 불변). arrive 는 무효화 대신 응답 레코드로 낙관 삽입을 교체한다.
  const handleManualCheck = (poiId: string): void => {
    void visitCheck.arrive({ source: ArriveRequestSource.MANUAL, poiId });
  };

  return (
    <TripRecordsScreen
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
      // 완료 방문 카드만 사진/메모 슬롯을 실데이터로 배선한다(useVisitAttachments 를 카드당 1회
      // 부르는 per-card 컨테이너). 미완료 카드는 undefined → 화면이 정적 스캐폴딩으로 폴백한다.
      renderCard={(card) =>
        card.completedAt != null ? (
          <VisitRecordCardContainer
            tripId={tripId}
            card={card}
            onPressComplete={handleComplete}
            onPressSkip={handleSkip}
          />
        ) : undefined
      }
      onPressComplete={handleComplete}
      onPressSkip={handleSkip}
      // onPressSpontaneous 는 넘기지 않는다(TRIP-939 — [방문 추가] 숨김). 즉석 방문은 장소를 골라야
      // poiId 가 생긴다(useVisitCheck.arrive 의 입력) — 장소 선택 진입은 후속 티켓(US-REC-01 후반).
      // ponytail: 장소 피커 라우트가 생기면 onPressSpontaneous 로 router.push 를 넘기면 버튼이 되살아난다.
      onPressBack={() => {
        if (router.canGoBack()) router.back();
      }}
      onPressTab={(key: ShellTabKey) =>
        router.replace(key === 'home' ? '/' : `/${key}`)
      }
    />
  );
}
