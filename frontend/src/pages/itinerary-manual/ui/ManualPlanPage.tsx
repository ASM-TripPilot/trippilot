import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  buildDraftPins,
  formatDraftDayHeader,
} from '@/features/itinerary/model/draftView';
import { PlusGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import { SlotStopCard } from '@/entities/itinerary-slot/ui/SlotStopCard';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import { SheetHeader } from '@/widgets/map-sheet-shell/ui/SheetHeader';
import {
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';

/**
 * h19 배선(TRIP-338) — **TRIP-797 묶음 C 로 소비 화면을 옛 `ManualPlanScreen`(features) → h12 통일
 * 편집기 표면(지도+3스냅 시트 `MapSheetShell`) 으로 재조립**한다. MANUAL 생성 POST 가드는 배선 계약이라
 * 무변경이고, 셸 루트만 `itinerary-manual-root` → `map-sheet-shell-root` 로 바뀐다.
 *
 * ⚠️ **왜 `EditorView`(h24 편집기 순수 뷰)를 재사용하지 않고 여기서 셸을 직접 조립하나:** `EditorView`
 * 는 형제 pages 슬라이스(`pages/itinerary-edit`)에 살고, pages 형제 슬라이스 간 직접 import 는 층 린트
 * (`eslint.config.js` 의 pages zone)가 막는다. 그래서 h07/h08 `DraftPage`·h14/h16 `ItineraryPlanPage`
 * 가 각자 `MapSheetShell` 을 조립하는 것과 같은 패턴으로 여기서도 직접 조립한다(공용 부품은 `MapSheetShell`
 * ·`SheetHeader`·`SlotStopCard` 로 이미 공유). h19 편집 배선은 스코프상 최소 — **루트+슬롯 렌더까지**가
 * 이 티켓 심판 대상이라 편집 스토어 시드·저장 PUT·시트는 h24(ItineraryEditPage) 몫으로 남는다.
 *
 * 이 파일이 지는 책임:
 *  1. **마운트 시 MANUAL 생성 POST 를 정확히 1회** `{ generationMode:'MANUAL' }` 하나만 담아 쏜다(여분 키
 *     0, BR-U3-03). `firedRef` 가드가 필요한 이유: react-query 반환 객체가 렌더마다 새 객체라 effect 가
 *     재실행돼도 두 번 쏘지 않게 한다(GeneratingPage 선례).
 *  2. **기존 초안 보존** — GET `days.length>0`(정착)이면 재-POST 를 막아 직접 고르기 진입이 이미 만든
 *     슬롯을 빈 MANUAL 로 덮어쓰지 않는다. GET 로딩 중엔 보류(도착할 초안을 못 보고 쏘면 덮어씀 —
 *     서버가 재생성 POST 를 안 막으므로 이 보류가 유일한 방어선).
 *  3. **빈 일정 조회를 셸에 그린다.** MANUAL 은 `solveMode=MINIMAL` 이지만 `isFallback=false`(실패가
 *     아니라 선택)라 폴백·실패 배너를 **띄우지 않는다** — 이 배선은 폴백 판정을 아예 타지 않는다(AC-2).
 */

// 슬롯 좌표가 없을 때(계약 공백)의 안전 폴백 center — 지도는 목이라 값은 심판 대상이 아니다
// (DraftPage·ItineraryPlanPage 폴백 선례와 동형).
const FALLBACK_CENTER = { lat: 0, lng: 0 };

export function ManualPlanPage({ tripId }: { tripId: string }): ReactElement {
  const router = useRouter();
  const generate = usePostTripsTripIdItinerary();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const firedRef = useRef(false);

  // 직접 고르기 진입이 기존 초안을 빈 MANUAL 로 덮어쓰지 않게 한다(TRIP-601 가드 a · BR-U3-06). 판정 축은
  // `days.length>0` — slots 만 빈 정상 MANUAL 재진입도 보존해 재-POST 를 막는다.
  const hasExisting = (itinerary.data?.days.length ?? 0) > 0;

  useEffect(() => {
    if (firedRef.current) return;
    // GET 로딩 중엔 보류 — 도착할 기존 초안을 못 보고 쏘면 그대로 덮어쓴다(fail-safe, ItineraryMethodPage 선례).
    if (itinerary.isPending) return;
    if (hasExisting) return;
    firedRef.current = true;
    generate.mutate({ tripId, data: { generationMode: 'MANUAL' } });
  }, [generate, tripId, itinerary.isPending, hasExisting]);

  const days = itinerary.data?.days ?? [];
  const slots = days[0]?.slots ?? [];
  const activeDate = days[0]?.date ?? '';
  const pins = buildDraftPins(slots);
  const center =
    pins.length > 0 ? { lat: pins[0].lat, lng: pins[0].lng } : FALLBACK_CENTER;

  return (
    <MapSheetShell
      center={center}
      pins={pins}
      onBack={() => router.back()}
      header={
        <SheetHeader
          title="일정 편집"
          dayLabel="1일차"
          dateLabel={activeDate !== '' ? formatDraftDayHeader(activeDate) : ''}
          meta={`${slots.length}곳`}
        />
      }
    >
      <View className="gap-md px-lg pb-2xl pt-xs">
        {slots.map((slot, index) => (
          <SlotStopCard
            key={slot.poiId}
            slot={slot}
            date={activeDate}
            index={index}
            timeLabel={
              slot.startAt
                ? `${slot.startAt.slice(0, 5)}–${slot.endAt.slice(0, 5)}`
                : null
            }
          />
        ))}

        {/* 점선 "장소 추가" → h13(장소 추가). 직접 짜기의 핵심 진입점. */}
        <Pressable
          testID="itinerary-manual-add-place"
          onPress={() =>
            router.push({
              pathname: '/trips/[tripId]/itinerary/manual/add',
              params: { tripId },
            })
          }
          className="flex-row items-center justify-center gap-xs rounded-card border border-dashed border-hairline-strong bg-canvas py-md"
        >
          <PlusGlyph size={20} tone="primary" />
          <Text className="font-noto-bold text-label font-bold text-primary-text">
            장소 추가
          </Text>
        </Pressable>
      </View>
    </MapSheetShell>
  );
}
