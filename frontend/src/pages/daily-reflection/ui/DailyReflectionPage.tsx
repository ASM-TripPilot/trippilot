import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { router } from 'expo-router';

import {
  missingParts,
  type LocationPermissionState,
} from '@/features/reflection/model/missingParts';
import { resolveDisplayNarrative } from '@/features/reflection/model/reflectionFallback';
import { statsCard } from '@/features/reflection/model/statsCard';
import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import {
  DailyReflectionScreen,
  type ReflectionDayTab,
  type ReflectionFace,
} from '@/features/reflection/ui/DailyReflectionScreen';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';
import { seoulDate } from '@/shared/date/seoulDate';
import type { ShellTabKey } from '@/shared/ui/BottomTabBar';
import { shellTabHref } from '@/shared/ui/BottomTabBar';

/**
 * TRIP-571 · daily-reflection 페이지 — 조회·표시본 조립·배선의 단일 출처(FSD).
 *
 * 표시본은 **여기서** 조립한다 — `resolveDisplayNarrative`(표시본 단일 결정, AC-8)·`statsCard`(0채움)·
 * `missingParts`(누락 표기)를 호출해 완성 VM 을 만들고 화면에 넘긴다. 화면(`DailyReflectionScreen`)은
 * 무상태 — draft/edited 필드명을 보지 않고 완성된 `narrative`·`editableText` 만 받는다.
 *
 * 얼굴 판정: 조회 error > 조회 중 pending > (레코드 0·0 ∧ 수정본 없음)empty > (부분데이터)data-insufficient
 * > default, 레코드가 없으면 생성 error > (오늘 이하)pending > (미래)empty. 편집 시드는
 * 서버가 고른 표시 카드의 `card.subtitle`(클라가 edited/draft 를 다시 고르지 않는다, empty 는 '').
 *
 * TRIP-1068 · 레코드 없음 ≠ 활동 없음 — 그 날 레코드가 없고 날짜가 KST 오늘 이하면 마운트당 1회 POST 로
 * 만든다(결정 1·2, 미래·레코드 있음·조회 실패는 0회). 목록 도착 ~ 발사 사이 렌더도 pending 이라 empty 가
 * 비치지 않는다(INV-4). "활동 없음"은 서버 stats 0·0 으로만 말한다(결정 3) — 단 직접 쓴 수정본이 있으면
 * 그 글을 보인다(저장 직후 글이 사라지지 않게). 생성 실패 뒤 자동 재발사 없음, "다시 시도"만 다시 쏜다.
 *
 * TRIP-762 · 일차 탭은 여행 기간(`Trip.startDate`~`endDate`, 실 계약 필드)에서 조립한다 — 회고 계약엔
 * 일차 소스가 없어 여행 조회로 얻는다(j01 TripRecordsPage 선례 동형, 단 거긴 itinerary.days, 여긴
 * 날짜 범위라 1-기반 번호로 센다). 활성 탭 = 보고 있는 날짜(`date`)의 탭. 헤더 공유는 제거됐다(라이브 j03 에 공유 0).
 *
 * TRIP-980 · "오늘"은 보고 있는 날짜가 아니라 **KST 실제 오늘**(`today`, 기본 `seoulDate(new Date())`)로
 * 정한다(사용자 확정 D1·D2) — `오늘 ·` 칩은 날짜가 오늘인 탭에만, 활성과 따로 판정한다. 보고 있는 날이
 * 오늘이 아니면 화면이 헤더·empty 문구를 중립으로 바꾼다(`isToday`).
 *
 * TRIP-1118 · 지도 자리 사유는 단말 위치 권한을 **조회만** 해서 고른다(request 0회 — 다시 묻지 않음).
 * `granted`/`denied` 외(undetermined·조회 실패·결과 없음)는 모름으로 접는다 — 모르면 권한 사유를 말하지
 * 않는다(Seed Q3, j01 `!granted` 와 의도적으로 다른 어휘). 얼굴 판정은 사유와 떼어 방문<2(`distanceDash`)로 한다.
 *
 * ⚠️ 계약 공백(01b 범위 밖·후속): 회고 응답(`Reflection`)에 사진 URL·지도 좌표·변경 요약이 없다 —
 * 사진(`photos=[]`)·지도 핀(미전달)·changeSummary(미전달)는 실제 소스가 정의되면 배선한다.
 */

export interface DailyReflectionPageProps {
  tripId: string;
  /** 'YYYY-MM-DD' — 라우트 `[date].tsx` 가 실어 온다. */
  date: string;
  /** TRIP-980 · 'YYYY-MM-DD' KST 오늘 — 테스트 주입 seam(미주입이면 기기 시계). */
  today?: string;
}

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' 를 UTC 자정 밀리초로(파싱·역산 모두 UTC 로 통일해 DST 흔들림 없음). NaN=파싱 실패. */
function toUtcMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** startDate 기준 target 의 1-기반 일차 번호(같은 날=1). 파싱 실패면 1. */
function dayNumberFor(startDate: string, target: string): number {
  const s = toUtcMs(startDate);
  const t = toUtcMs(target);
  if (Number.isNaN(s) || Number.isNaN(t)) return 1;
  return Math.round((t - s) / DAY_MS) + 1;
}

/** startDate 기준 1-기반 일차 번호 → 'YYYY-MM-DD'. */
function dateForDayNumber(startDate: string, dayNumber: number): string {
  return new Date(toUtcMs(startDate) + (dayNumber - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function DailyReflectionPage({
  tripId,
  date,
  today = seoulDate(new Date()),
}: DailyReflectionPageProps): ReactElement {
  const daily = useDailyReflection(tripId, date);
  const res = daily.reflection;

  // 여행 기간에서 일차 탭을 조립한다(TRIP-762). 회고 계약엔 일차 소스가 없어 여행 조회로 얻는다.
  const trip = useGetTripsTripId(tripId);
  const startDate = trip.data?.startDate;
  const endDate = trip.data?.endDate;
  const activeDay =
    startDate && endDate ? dayNumberFor(startDate, date) : undefined;
  const dayTabs: ReflectionDayTab[] =
    startDate && endDate
      ? Array.from(
          { length: Math.max(0, dayNumberFor(startDate, endDate)) },
          (_, index) => {
            const day = index + 1;
            return { day, today: dateForDayNumber(startDate, day) === today };
          }
        )
      : [];

  const [permission, setPermission] =
    useState<LocationPermissionState>('unknown');
  useEffect(() => {
    void (async () => {
      try {
        const current = await Location.getForegroundPermissionsAsync();
        if (current?.status === 'granted' || current?.status === 'denied')
          setPermission(current.status);
      } catch {
        // 조회 실패 = 모름 유지(권한 사유를 쓰지 않는다).
      }
    })();
  }, []);

  const stats = statsCard(res?.stats);
  const missing = missingParts(stats, permission);
  const narrative = resolveDisplayNarrative(res);
  const editableText = res?.card?.subtitle ?? '';
  // ISO 'YYYY-MM-DD' 는 사전순 = 시간순(monthGrid.isDateInRange 선례).
  const notFuture = date <= today;

  const shouldGenerate =
    !daily.isPending && !daily.isError && !res && notFuture;
  const firedRef = useRef(false);
  const { create } = daily;
  useEffect(() => {
    if (!shouldGenerate || firedRef.current) return;
    firedRef.current = true;
    create();
  }, [shouldGenerate, create]);

  const face: ReflectionFace = daily.isError
    ? 'error'
    : daily.isPending
      ? 'pending'
      : res
        ? stats.visitCount === 0 && stats.photoCount === 0 && !res.editedCard
          ? 'empty'
          : missing.distanceDash || missing.hidePhotoGrid
            ? 'data-insufficient'
            : 'default'
        : daily.isCreateError
          ? 'error'
          : notFuture
            ? 'pending'
            : 'empty';

  // TRIP-1119 · 딥링크(푸시 REFLECTION_DAILY) 콜드 스타트면 히스토리가 없어 canGoBack()===false —
  // 침묵 no-op(죽은 버튼) 대신 기록 탭으로 replace(TravelStylePage 선례 동형, INV-4). ‹ 와 「확인」이 공유.
  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/records');
  };

  const handleConfirm = () => {
    // error 얼굴의 "다시 시도" = 생성 실패면 POST 1회 재발사(Seed Q1), 조회 실패면 재조회. data 얼굴의
    // "저장/확인" = 닫기(mood/memo 비영속, narrative 는 수정 경로. 통합 저장은 계약 확장 티켓 TRIP-823).
    if (face === 'error') {
      if (daily.isCreateError) daily.create();
      else daily.refetch();
      return;
    }
    handleBack();
  };

  return (
    <DailyReflectionScreen
      face={face}
      narrative={narrative}
      editableText={editableText}
      stats={stats}
      distanceDash={missing.distanceDash}
      mapNotice={missing.mapNotice}
      hidePhotoGrid={missing.hidePhotoGrid}
      photos={[]}
      dayTabs={dayTabs}
      activeDay={activeDay}
      isToday={date === today}
      onSelectDay={(day) => {
        if (!startDate) return;
        router.push(
          `/trips/${tripId}/records/reflection/${dateForDayNumber(startDate, day)}`
        );
      }}
      onPressTab={(key: ShellTabKey) => router.replace(shellTabHref(key))}
      onEnterEdit={() => {
        // 편집 열림은 화면이 로컬로 진다. 생성 없이 PUT 경로(BR-U5-36)라 여기서 별도 조치 없음.
      }}
      onBack={handleBack}
      onConfirm={handleConfirm}
      onSaveEdit={daily.saveEdit}
    />
  );
}
