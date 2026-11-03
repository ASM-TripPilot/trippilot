import { formatDayLabel, formatShareCardPeriod } from '@/entities/trip';
import { dominantPaletteKey } from './categoryPalette';
import { formatKm } from './formatKm';
import type {
  MagazineCoverVM,
  MagazineQuoteVM,
  MagazineRouteStop,
  MagazineStatTile,
} from './magazineVM';
import { splitHighlight } from './magazineVM';
import { summaryStats } from './summaryStats';
import { distanceSourceLabel, toOrderedVisitList } from './summaryView';
import type { PaletteKey } from './categoryPalette';
import type {
  ItineraryDaysItem,
  Trip,
  TripSummary,
  TripSummaryStatsDistanceSource,
} from '@/shared/api/index.schemas';

/**
 * TRIP-1666 · j04 여행 요약 매거진 VM — 요약·여행·일정 재료를 "화면이 계산 없이 그대로 그릴 값"으로 바꾸는 순수 함수.
 * 초심자용: VM(뷰 모델) = 화면 전용으로 미리 계산해 둔 값 묶음. 색은 hex 가 아니라 팔레트 **키**(`'맛집'`)로 담는다.
 *
 * 규칙(테스트가 곧 명세 — `summaryMagazineVM.test.ts`): 제목은 여행 제목, 비면 `이번 여행`(그때 `tripTitleKnown=false`).
 * 표지 색은 전 일차 방문 카테고리 최빈, 일차 카드 색은 "그 날짜 일정 슬롯 중 이름이 방문지(places)와 완전히 같은 것"의 최빈,
 * 일정을 모르면(`itineraryDays` undefined)·못 맞추면 전부 중립 'STATS'. 일차 거리는 서버 km 가 있고 방문 2곳 이상일 때만
 * (측정 못 함을 0km 로 쓰지 않는다). 소요시간 필드 없음(INV-3). `@/shared/api` 는 타입만 import — 프리뷰가 네트워크 계층을 끌어오지 않게.
 */

export interface SummaryMagazineInput {
  summary: TripSummary;
  /** 여행 조회 전·실패면 없음 — 제목 폴백, 지역·기간 없음. */
  trip?: Pick<Trip, 'title' | 'startDate' | 'endDate' | 'destinations'>;
  /** undefined = 일정을 모름(전부 중립). */
  itineraryDays?: readonly ItineraryDaysItem[];
  /** 위치 자동화가 파생한 거리 출처(`distanceSourceByDate` 반환 모양). 서버 값이 없을 때만 쓴다. */
  routeSources?: {
    overall: TripSummaryStatsDistanceSource;
    byDate: Readonly<Record<string, TripSummaryStatsDistanceSource>>;
  } | null;
}

export interface SummaryDayCardVM {
  /** 날짜(`YYYY-MM-DD`) — 목록 key. */
  key: string;
  dayLabel: string;
  visitCountLabel: string;
  places: string[];
  /** `1.9km · 근사` — 없으면 null(줄을 그리지 않는다). */
  distance: string | null;
  palette: PaletteKey;
}

export interface SummaryMagazineVM {
  cover: MagazineCoverVM & { picture: null };
  tripTitleKnown: boolean;
  quote: MagazineQuoteVM | null;
  days: SummaryDayCardVM[];
  stats: MagazineStatTile[];
  route: (MagazineRouteStop & { dayLabel: string })[];
  routePalette: PaletteKey;
}

export function buildSummaryMagazineVM(
  input: SummaryMagazineInput
): SummaryMagazineVM {
  const { summary, trip, routeSources } = input;
  const cells = summaryStats(summary.stats);

  // 날짜별 "방문지 이름과 완전히 같은 슬롯"의 카테고리 열 — 다른 날짜의 같은 이름·부분 일치·이름 없는 슬롯은 안 센다.
  const categoriesOn = (date: string, places: readonly string[]) =>
    (input.itineraryDays ?? [])
      .filter((d) => d.date === date)
      .flatMap((d) => d.slots)
      .filter((s) => typeof s.nameKo === 'string' && places.includes(s.nameKo))
      .map((s) => s.category);

  const days: SummaryDayCardVM[] = summary.highlights.map((h) => {
    const source =
      h.distanceSource ?? routeSources?.byDate[h.date] ?? 'VISIT_LINE';
    return {
      key: h.date,
      dayLabel: formatDayLabel(h.dayOrder),
      visitCountLabel: `${h.visitCount}곳`,
      places: h.places,
      distance:
        h.distanceKm != null && h.visitCount >= 2
          ? `${formatKm(h.distanceKm)} · ${distanceSourceLabel(source)}`
          : null,
      palette: dominantPaletteKey(categoriesOn(h.date, h.places)),
    };
  });
  // 표지 색 = 일차를 이어 붙인 같은 열의 최빈(동률은 앞 일차·앞 슬롯).
  const palette = dominantPaletteKey(
    summary.highlights.flatMap((h) => categoriesOn(h.date, h.places))
  );

  const rawTitle = trip?.title ?? '';
  const tripTitleKnown = rawTitle.trim() !== '';
  const narrative = summary.narrative;

  return {
    cover: {
      title: tripTitleKnown ? rawTitle : '이번 여행',
      stickerLabel: '여행 회고',
      region: trip?.destinations[0]?.region || undefined,
      dateLabel:
        trip?.startDate && trip.endDate
          ? formatShareCardPeriod(trip.startDate, trip.endDate)
          : undefined,
      visitLabel: `${cells.totalVisits}곳`,
      photoLabel: `사진 ${cells.totalPhotos}장`,
      picture: null,
      palette,
    },
    tripTitleKnown,
    quote:
      narrative.trim() === ''
        ? null
        : { text: narrative, ...splitHighlight(narrative) },
    days,
    stats: [
      { key: 'visits', label: '방문', value: String(cells.totalVisits) },
      {
        key: 'distance',
        label: '이동',
        value: cells.distanceText,
        ...(cells.distanceText === '—'
          ? {}
          : {
              note: distanceSourceLabel(
                routeSources?.overall ?? summary.stats.distanceSource
              ),
            }),
      },
      { key: 'photos', label: '사진', value: String(cells.totalPhotos) },
    ],
    route: toOrderedVisitList(summary.highlights).map((v) => ({
      order: v.order,
      name: v.place,
      named: true,
      dayLabel: v.dayLabel,
    })),
    routePalette: palette,
  };
}
