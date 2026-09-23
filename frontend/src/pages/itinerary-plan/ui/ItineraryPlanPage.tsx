import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';

import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { SlotStopCard } from '@/entities/itinerary-slot/ui/SlotStopCard';
import {
  buildDraftDayTabs,
  buildDraftPins,
  formatDraftDayHeader,
} from '@/features/itinerary/model/draftView';
import { legDistance } from '@/features/itinerary/model/legDistance';
import {
  isConfirmLocked,
  resolvePlanState,
} from '@/features/itinerary/model/planState';
import { timeBandLabel } from '@/features/itinerary/model/timeBandLabel';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  InfoCircleGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';
import { captureShareImage } from '@/features/reflection/model/shareCard';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItineraryConfirm,
} from '@/shared/api/generated/trips/trips';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import { isNotFound } from '@/shared/api/isNotFound';
import { StateNotice, type StateNoticeAction } from '@/shared/ui/StateNotice';
import { DistanceConnector } from '@/widgets/map-sheet-shell/ui/DistanceConnector';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import { SheetHeader } from '@/widgets/map-sheet-shell/ui/SheetHeader';

import { ConfirmedBanner } from './ConfirmedBanner';
import { NoBaseNoticeCard } from './NoBaseNoticeCard';

/**
 * h25/h34 완성·확정 일정 배선(TRIP-299·300·354) — 두 조회를 잇는다. 시간표/지도 세그먼트
 * 토글은 제거됐다(TRIP-354 결정 D · 지도 상시 인라인) — 뷰 로컬 상태는 활성 날짜 하나뿐이다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **헤더는 두 조회의 조립이다** — 제목·기간은 `GET /trips`, 곳 수는 `GET /itinerary` 슬롯 합계.
 *  2. **404 는 전면 실패가 아니라 별도 얼굴이다** — "일정이 아직 없다"(`isNotFound`)를 `notFound`
 *     로 갈라 `resolvePlanState` 의 우선순위가 실패 겹침을 정리한다(INV-4).
 *  3. **날짜 전환은 재조회를 유발하지 않는다** — 활성 날은 `useState` 라 쿼리 키가 그대로고, 캐시된
 *     쿼리는 리렌더에 다시 나가지 않는다. Zustand 는 pages 층 금지라 로컬 상태로 든다.
 *  4. **탈출구는 4얼굴 전부에 있다**(TRIP-402) — loading·notFound·failed·listed 어디에 착지해도
 *     `handleBack` 을 공유하는 뒤로가기가 있고, 뒤로 갈 히스토리가 없으면(딥링크로 직접 진입)
 *     조용히 무동작하지 않고 홈(`/(tabs)`)으로 간다(침묵 no-op 금지 · INV-4). 빈 얼굴(notFound)은
 *     나갈 길 대신 "일정 만들기" 다음 행동도 준다.
 */

/** 딥링크로 뒤로 갈 히스토리 없이 열렸을 때의 홈 폴백 목적지. `/(tabs)/itinerary` 는 `trips[0]`
 * 로 다시 리다이렉트해 딥링크로 들어온 여행이 아닌 옛 일정에 착지하므로 쓰지 않는다(홈 탭). */
const HOME_FALLBACK = '/(tabs)';

/** 탈출구 앱바 — loading·notFound·failed 얼굴 위에 얹는 뒤로가기 한 줄. `TimelineScreen`(listed)
 * 앱바와 같은 형태·같은 `itinerary-view-back` testID 를 쓴다 — 얼굴은 상호 배타라 한 번에 하나만
 * 렌더돼 testID 가 안 겹친다. */
function PlanAppBar({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-[6px] bg-canvas pb-sm pl-md pr-lg pt-lg">
      <Pressable
        testID="itinerary-view-back"
        accessibilityRole="button"
        accessibilityLabel="뒤로"
        onPress={onBack}
        hitSlop={8}
      >
        <BackChevronGlyph />
      </Pressable>
    </View>
  );
}

function PlanFace({
  testID,
  icon,
  title,
  description,
  actions,
  onBack,
}: {
  testID: string;
  icon: ReactNode;
  title: string;
  description: string;
  actions: StateNoticeAction[];
  onBack: () => void;
}): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <PlanAppBar onBack={onBack} />
        <View className="flex-1 items-center justify-center px-lg">
          <StateNotice
            testID={testID}
            icon={icon as ReactElement}
            title={title}
            description={description}
            actions={actions}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

/** 확정 실패 인라인 안내(INV-4 침묵 금지). 409 세 원인·404 를 상태코드로 구별 못 하므로 문구는
 * 원인 단정 없이 재시도를 안내한다 — 정확한 문구는 심판이 아니라 비-공백만 잠근다(02a §8). */
const CONFIRM_ERROR_NOTE =
  '일정을 확정하지 못했어요. 잠시 후 다시 시도해 주세요';

/** h16 휴관 경고 문구(TRIP-801 D4 · 발명 display copy, 정본 부재). 트리거는 서버 신호
 * `openingHoursKnown === false` 이고, 문구는 이 상수다(요일 발명 금지 · 02a ★5). */
const OPENING_HOURS_WARNING = '휴관일 확인';

/** 고정 슬롯(숙소) 부제 — `{도착 시간대} · 숙소 · 변경 불가`(01b D3, 발명 display copy · h11 동형).
 * h14 숙소는 항상 저녁(21:00)이라 `timeBandLabel` 이 `저녁` 을 낸다(CoPickCompletePage 와 동형). */
function fixedSlotSubtitle(startAt: string): string {
  return `${timeBandLabel(startAt)} · 숙소 · 변경 불가`;
}

export function ItineraryPlanPage({
  tripId,
}: {
  tripId: string;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // 4얼굴 공통 뒤로가기. `router.canGoBack()` 은 expo-router 가 주는, 뒤로 갈 히스토리 유무를
  // boolean 으로 답하는 함수다 — 있으면 이전 화면으로, 없으면(딥링크로 직접 진입) 조용히
  // 무동작하지 않고 홈으로 `replace`(현재 화면을 히스토리에 안 남김) 한다(침묵 no-op 금지 · INV-4).
  function handleBack(): void {
    // 확정(CONFIRMED) 얼굴은 생성/확정 흐름 스택으로 되돌아가지 않고 내 여행 목록으로 간다
    // (TRIP-505 AC-1). `/(tabs)/itinerary` 는 `GeneratingPage.tsx` 가 이미 쓰는 typedRoutes 통과
    // 목적지다. 그 외 얼굴은 기존 딥링크 폴백(`canGoBack()?back():replace(HOME_FALLBACK)`) 그대로.
    if (itinerary.data?.status === 'CONFIRMED') {
      router.replace('/(tabs)/itinerary');
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(HOME_FALLBACK);
    }
  }

  // 빈 얼굴(notFound)의 "일정 만들기" 다음 행동 — 방식 선택(h04)으로 push. 리포 동적 라우트 push
  // 관용구(객체 1인자, DraftPage·MethodPage 선례)로 tripId 를 경로 파라미터에 싣는다.
  function goCreate(): void {
    router.push({
      pathname: '/trips/[tripId]/itinerary/method',
      params: { tripId },
    });
  }

  // 완성/확정 일정 → h12 편집 진입(TRIP-482·801 AC-2). `goCreate` 의 동적 라우트 push 관용구(객체
  // 1인자)를 복제해 tripId 를 경로 파라미터에 싣는다. 셸은 라우팅을 모르므로 여기서 배선한다.
  function goEdit(): void {
    router.push({
      pathname: '/trips/[tripId]/itinerary/edit',
      params: { tripId },
    });
  }

  // 확정(h16) 셸의 [공유하기] → j06 공유 카드 진입(TRIP-801 AC-2). `goEdit` 의 객체형 push 관용구
  // 복제(pathname·params 완전일치가 심판, 02a ★2). j06 라우트(`records/share`)는 이미 실재한다.
  function goShare(): void {
    router.push({
      pathname: '/trips/[tripId]/records/share',
      params: { tripId },
    });
  }

  const trip = useGetTripsTripId(tripId);
  const itinerary = useGetTripsTripIdItinerary(tripId);
  // TError=unknown 으로 열어 onError 의 error 를 axios 판정(isNotFound)에 그대로 태운다.
  const confirm = usePostTripsTripIdItineraryConfirm<unknown>();

  function handleConfirm(): void {
    setConfirmError(null);
    confirm.mutate(
      { tripId },
      {
        onSuccess: (data) => {
          // 응답이 곧 최신 Itinerary(CONFIRMED)라 조회 캐시에 직접 써넣는다 — 재조회 0회로
          // 읽기전용으로 전환된다. resetQueries/removeQueries 는 data 까지 버려 금지(02a ★3).
          queryClient.setQueryData(
            getGetTripsTripIdItineraryQueryKey(tripId),
            data
          );
          // 이 여행의 위저드 세션은 확정으로 끝났다 — 다음 "여행 만들기"는 항상 새 세션이므로
          // 드래프트(여행지·날짜·인원·예산·꼭 갈 곳 시드)를 여기서 전부 비운다. 위저드 진입
          // 시점(`trips/new/_layout.tsx`)의 `resetMustVisits()`는 시드 3필드만 지워 그 외 값이
          // 다음 여행에 새어 들어가던 것을 막는다(BR-U1-33 왕복 보존은 이 지점 이전에만 적용).
          useTripWizardStore.getState().reset();
        },
        onError: (error) => {
          setConfirmError(CONFIRM_ERROR_NOTE);
          // 재조회는 **409 에서만** 건다 — 409 는 서버 진실이 이미 확정일 수 있어 무효화로
          // 재조회해 정합한다(무효화만 — data 는 보존). 404·500·네트워크는 재조회하지 않는다:
          // itinerary 상태가 안 바뀌었고, 백엔드가 넓게 죽은 outage 에서 재조회마저 실패하면
          // itinerary.isError → resolvePlanState 가 failed 로 판정해 타임라인이 통째로 사라진다
          // (INV-4 정반대). 인라인 안내(위 setConfirmError)만으로 침묵을 깬다(TRIP-355).
          if (isAlreadyRegistered(error)) {
            void queryClient.invalidateQueries({
              queryKey: getGetTripsTripIdItineraryQueryKey(tripId),
            });
          }
        },
      }
    );
  }

  const days = itinerary.data?.days ?? [];
  const state = resolvePlanState({
    loading: trip.isPending || itinerary.isPending,
    notFound: isNotFound(itinerary.error),
    failed: trip.isError || itinerary.isError,
    days,
  });

  if (state.kind === 'loading') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas">
          <PlanAppBar onBack={handleBack} />
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'notFound') {
    return (
      <PlanFace
        testID="itinerary-view-notfound"
        icon={<InfoCircleGlyph size={32} tone="primaryText" />}
        title="아직 완성된 일정이 없어요"
        description="일정을 만들면 여기에서 볼 수 있어요"
        onBack={handleBack}
        actions={[
          {
            testID: 'itinerary-plan-create-cta',
            label: '일정 만들기',
            variant: 'filled',
            onPress: goCreate,
          },
        ]}
      />
    );
  }

  if (state.kind === 'failed') {
    return (
      <PlanFace
        testID="itinerary-view-failed"
        icon={<AlertCircleGlyph size={32} tone="primaryText" />}
        title="일정을 불러오지 못했어요"
        description="네트워크를 확인하고 다시 시도해주세요"
        onBack={handleBack}
        actions={[]}
      />
    );
  }

  // listed(완성/확정) — 전면 지도 + 2스냅 시트 셸. CONFIRMED(h16)·PLANNED(h14) 둘 다 이 셸을 조립한다
  // (TRIP-801 계약 플립 — CONFIRMED 도 옛 `TimelineScreen` 대신 셸로 갈아끼웠다). `features→widgets`
  // 상향 참조 금지라 셸 조립은 페이지가 진다(h07/h08 `DraftPage`·h11 `CoPickCompletePage` 선례). 두
  // 얼굴의 차이(성공 배너·"확정됨" meta 접두·휴관 경고·CTA 2버튼)는 `isConfirmed` 하나로 갈린다. 탭·
  // 날짜·일차는 여행 기간(`buildDraftDayTabs`)에서 나오고 선택 날짜는 로컬 `activeDayIndex` 로 든다.
  const isConfirmed = itinerary.data?.status === 'CONFIRMED';
  const tabs = buildDraftDayTabs({
    startDate: trip.data?.startDate ?? '',
    endDate: trip.data?.endDate ?? '',
    days: state.days,
  });
  const selectedDayIndex =
    activeDayIndex >= 0 && activeDayIndex < tabs.length ? activeDayIndex : 0;
  const selectedTab = tabs[selectedDayIndex];
  const selectedDate = selectedTab?.date ?? '';
  const selectedDayNumber = selectedTab?.dayNumber ?? 1;

  const slots =
    state.days.find((day) => day.date === selectedDate)?.slots ?? [];
  const pins = buildDraftPins(slots);
  const center =
    pins.length > 0
      ? { lat: pins[0].lat, lng: pins[0].lng }
      : { lat: 0, lng: 0 };

  // meta = "[확정됨 · ]N곳[ · X.Xkm]". N 은 **선택일 비고정 슬롯 수**(숙소 제외 · 01b D3 —
  // totalPlaces·coPickProgress 재사용 금지). km 은 커넥터가 그리는 leg(`slots.slice(1)`)의
  // `legDistance` 합에서 "이동 " 접두를 뗀 값, 없으면(거리 계산 중) 곳 수만 그린다(01b D3·D5 · h08
  // 선례). 확정(h16)이면 앞에 "확정됨 · " 접두를 단다(TRIP-801 AC-3).
  const nonFixedCount = slots.filter((slot) => !slot.isFixed).length;
  const legLabel = legDistance(
    slots.slice(1).map((slot) => slot.distanceRange)
  );
  const kmPart = legLabel === null ? null : legLabel.replace('이동 ', '');
  const metaBody =
    kmPart === null ? `${nonFixedCount}곳` : `${nonFixedCount}곳 · ${kmPart}`;
  const meta = isConfirmed ? `확정됨 · ${metaBody}` : metaBody;

  // 거점 없음 판정 = 선택일 슬롯에 고정 숙소 부재(클라 휴리스틱 · 01b D4 — itinerary 응답에
  // baseAssignment 필드가 없어 슬롯만으로 유추한다).
  const hasBase = slots.some(
    (slot) => slot.isFixed && slot.category === '숙소'
  );

  return (
    <MapSheetShell
      center={center}
      pins={pins}
      days={tabs.map((tab) => ({ label: `${tab.dayNumber}일차` }))}
      selectedDayIndex={selectedDayIndex}
      onSelectDay={setActiveDayIndex}
      onBack={handleBack}
      // 확정(h16)이면 지도 위 일차 칩 아래에 성공 배너를 얹는다(추가 슬롯 · TRIP-801 AC-1). 미확정은
      // 미주입(후방호환).
      mapCard={isConfirmed ? <ConfirmedBanner /> : undefined}
      header={
        <SheetHeader
          title={trip.data?.title ?? ''}
          dayLabel={`${selectedDayNumber}일차`}
          dateLabel={formatDraftDayHeader(selectedDate)}
          meta={meta}
        />
      }
      // 확정(h16)은 읽기전용이라 [일정 수정](h12)·[공유하기](j06) 2버튼(둘 다 활성 · AC-2). 미확정(h14)은
      // [일정 저장하기] 1버튼 — PARTIAL(생성 중)이면 확정을 예방 잠근다(계약 409 의 클라 사본 · 01b D6).
      // [공유하기]는 공유 카드 캡처가 장전됐을 때만 싣는다(TRIP-939 Q2 — 미장전이면 j06 이 막다른 화면).
      cta={
        isConfirmed
          ? captureShareImage().armed
            ? [
                { label: '일정 수정', variant: 'outline', onPress: goEdit },
                { label: '공유하기', variant: 'primary', onPress: goShare },
              ]
            : [{ label: '일정 수정', variant: 'outline', onPress: goEdit }]
          : [
              {
                label: '일정 저장하기',
                variant: 'primary',
                onPress: handleConfirm,
                disabled: isConfirmLocked(itinerary.data?.generationState),
              },
            ]
      }
    >
      <View className="gap-md px-lg pb-2xl pt-xs">
        {/* 확정 실패는 셸 안에서 침묵하지 않는다(INV-4) — 옛 TimelineScreen 이 그리던 testID 를 계승. */}
        {confirmError !== null ? (
          <View
            testID="itinerary-confirm-error"
            className="rounded-card border border-hairline bg-primary-pale px-md py-sm"
          >
            <Text className="font-noto text-label text-primary-text">
              {confirmError}
            </Text>
          </View>
        ) : null}
        {slots.flatMap((slot, index) => {
          // 전 슬롯 검증 시각 칩(BR-U3-07 · 01b D3). 비고정=범위(en-dash U+2013), 고정 숙소=단일 시각.
          const timeLabel = slot.isFixed
            ? slot.startAt.slice(0, 5)
            : `${slot.startAt.slice(0, 5)}–${slot.endAt.slice(0, 5)}`;
          const items: ReactElement[] = [
            <SlotStopCard
              key={`card-${slot.poiId}`}
              slot={slot}
              date={selectedDate}
              index={index}
              timeLabel={timeLabel}
              fixed={slot.isFixed}
              subtitle={
                // "…· 숙소 · 변경 불가" 부제는 **고정 숙소**에만(거점없음 판정 hasBase 와 같은
                // isFixed&&숙소 정의). 시각 고정 must-visit(비숙소)까지 붙이면 미술관을 "숙소"로
                // 오표기한다(5-b 경고-1). 고정 비숙소는 부제 없음(정본 카피 부재).
                slot.isFixed && slot.category === '숙소'
                  ? fixedSlotSubtitle(slot.startAt)
                  : undefined
              }
              // 휴관 경고는 확정(h16)에서 서버 신호 `openingHoursKnown === false` 일 때만(TRIP-801 D4·
              // AC-4). 문구는 상수(요일 발명 금지). true/null/undefined·미확정 얼굴은 미주입=미렌더.
              warning={
                isConfirmed && slot.openingHoursKnown === false
                  ? OPENING_HOURS_WARNING
                  : undefined
              }
            />,
          ];
          if (index < slots.length - 1) {
            const nextSlot = slots[index + 1];
            items.push(
              <DistanceConnector
                key={`conn-${slot.poiId}`}
                slotKey={buildSlotKey(selectedDate, slot.poiId)}
                distanceRange={nextSlot.distanceRange}
              />
            );
          }
          return items;
        })}
        {/* 거점 없음 안내 카드(01b D4) — 시트 children 말미. 링크는 h15("동선 기준 추천")로 항법한다.
            h15 라우트는 아직 없어(TRIP-800) `as Href` 캐스트로 tsc 를 통과시킨다(planb-request 선례). */}
        {hasBase ? null : (
          <NoBaseNoticeCard
            onPress={() =>
              router.push(`/trips/${tripId}/itinerary/stay-recommend` as Href)
            }
          />
        )}
      </View>
    </MapSheetShell>
  );
}
