import type { ReactElement } from 'react';
import { router } from 'expo-router';

import { missingParts } from '@/features/reflection/model/missingParts';
import { resolveDisplayNarrative } from '@/features/reflection/model/reflectionFallback';
import { statsCard } from '@/features/reflection/model/statsCard';
import { useDailyReflection } from '@/features/reflection/model/useDailyReflection';
import {
  DailyReflectionScreen,
  type ReflectionDayTab,
  type ReflectionFace,
} from '@/features/reflection/ui/DailyReflectionScreen';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';
import type { ShellTabKey } from '@/shared/ui/BottomTabBar';

/**
 * TRIP-571 · daily-reflection 페이지 — 조회·표시본 조립·배선의 단일 출처(FSD).
 *
 * 표시본은 **여기서** 조립한다 — `resolveDisplayNarrative`(표시본 단일 결정, AC-8)·`statsCard`(0채움)·
 * `missingParts`(누락 표기)를 호출해 완성 VM 을 만들고 화면에 넘긴다. 화면(`DailyReflectionScreen`)은
 * 무상태 — draft/edited 필드명을 보지 않고 완성된 `narrative`·`editableText` 만 받는다.
 *
 * 얼굴 판정: error > (회고 없음)empty > (부분데이터)data-insufficient > default. 편집 시드는
 * `editedNarrative ?? draftNarrative`(내가 고친 최신 문장을 입력에 올림, 없으면 초안, empty 는 '').
 *
 * TRIP-762 · 일차 탭은 여행 기간(`Trip.startDate`~`endDate`, 실 계약 필드)에서 조립한다 — 회고 계약엔
 * 일차 소스가 없어 여행 조회로 얻는다(j01 TripRecordsPage 선례 동형, 단 거긴 itinerary.days, 여긴
 * 날짜 범위라 1-기반 번호로 센다). 보고 있는 날짜(`date`)가 곧 "오늘"이라 활성 탭이 오늘 탭이다
 * (Figma 2267:2021 의 "오늘 · Day2" 가 활성 pill 과 일치). 헤더 공유는 제거됐다(라이브 j03 에 공유 0).
 *
 * ⚠️ 계약 공백(01b 범위 밖·후속): 회고 응답(`Reflection`)에 사진 URL·지도 좌표·변경 요약이 없다 —
 * 사진(`photos=[]`)·지도 핀(미전달)·changeSummary(미전달)는 실제 소스가 정의되면 배선한다.
 */

export interface DailyReflectionPageProps {
  tripId: string;
  /** 'YYYY-MM-DD' — 라우트 `[date].tsx` 가 실어 온다. */
  date: string;
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
            // 보고 있는 날짜가 곧 "오늘" — 활성 탭이 오늘 탭이다(Figma 정합).
            return { day, today: day === activeDay };
          }
        )
      : [];

  const stats = statsCard(res?.stats);
  const missing = missingParts(stats);
  const narrative = resolveDisplayNarrative(res);
  const editableText = res?.editedNarrative ?? res?.draftNarrative ?? '';

  const face: ReflectionFace = daily.isError
    ? 'error'
    : !res
      ? 'empty'
      : missing.mapNotice !== null || missing.hidePhotoGrid
        ? 'data-insufficient'
        : 'default';

  const handleConfirm = () => {
    // error 얼굴의 "다시 시도" = 재조회, data 얼굴의 "저장/확인" = 닫기(mood/memo 비영속, narrative 는
    // 수정 경로. 통합 저장은 계약 확장 티켓 TRIP-823).
    if (face === 'error') {
      daily.refetch();
      return;
    }
    if (router.canGoBack()) router.back();
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
      onSelectDay={(day) => {
        if (!startDate) return;
        router.push(
          `/trips/${tripId}/records/reflection/${dateForDayNumber(startDate, day)}`
        );
      }}
      onPressTab={(key: ShellTabKey) =>
        router.replace(key === 'home' ? '/' : `/${key}`)
      }
      onEnterEdit={() => {
        // 편집 열림은 화면이 로컬로 진다. 생성 없이 PUT 경로(BR-U5-36)라 여기서 별도 조치 없음.
      }}
      onConfirm={handleConfirm}
      onSaveEdit={(text) => {
        daily.saveEdit(text);
      }}
    />
  );
}
