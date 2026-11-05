import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import {
  CATEGORY_PALETTES,
  MAGAZINE_TONES,
  MagazinePhoto,
  MagazineRoute,
  MagazineStats,
  type CategoryPalette,
  type MagazineStatTile,
  type PaletteKey,
} from '@/features/reflection/index.view';
import { RevealItem } from '@/shared/ui/RevealItem';

import type { StorySlide } from '../model/shareStory';

/**
 * TRIP-1667 · j06 스토리 덱의 장 4종(표지·일차·동선·숫자) — props 만 받는 무상태 뷰(조회·계산 0, `@/shared/api` 값 import 0).
 * 색은 팔레트 **키**로 `CATEGORY_PALETTES` 에서 찾아 `style` 로 칠한다. 줄별 등장·카운트업은 공용 `RevealItem`·`CountUpText` 가 맡고,
 * 이 장들은 덱이 `key={slide.key}` 로 "지금 장만" 마운트하므로 연출은 장이 나올 때 처음부터 한 번 재생된다.
 * 장 레이아웃·글자 크기는 HTML 시안 기준 가정이다(Figma 확인 전).
 */

const ID = 'reflection-share-deck';
/** 위쪽 진행 바·× 와 아래쪽 버튼 줄을 피하는 장 바깥 여백. */
const SLIDE_FRAME = 'absolute inset-0 px-[28px] pb-[132px] pt-[108px]';

function slidePalette(slide: StorySlide): PaletteKey {
  switch (slide.kind) {
    case 'cover':
      return slide.cover.palette;
    case 'day':
      return slide.day.palette;
    case 'route':
      return slide.palette;
    case 'stats':
      return 'STATS';
  }
}

/**
 * 장의 색 한 벌 — 덱 크롬(진행 바·×)과 표지 글자가 같이 읽는다. 사진 표지만 글자색이 사진 위 색(onPhoto)이고,
 * 바탕은 팔레트 그대로(사진이 뜨기 전·사진 뒤 바탕).
 */
export function slideTone(slide: StorySlide): CategoryPalette {
  const palette = CATEGORY_PALETTES[slidePalette(slide)];
  return slide.kind === 'cover' && slide.cover.picture
    ? { ...palette, fg: MAGAZINE_TONES.onPhoto }
    : palette;
}

function CoverSlide({
  slide,
  caption,
}: {
  slide: Extract<StorySlide, { kind: 'cover' }>;
  caption: string;
}): ReactElement {
  const { cover } = slide;
  const palette = slideTone(slide);
  const chipStyle = { borderColor: palette.fg, color: palette.fg };
  return (
    <View
      testID={`${ID}-slide-cover`}
      className={`${SLIDE_FRAME} justify-between overflow-hidden`}
      style={{ backgroundColor: palette.bg }}
    >
      {cover.picture ? (
        <>
          <MagazinePhoto picture={cover.picture} testID={`${ID}-cover-photo`} />
          <View
            testID={`${ID}-cover-scrim`}
            className="absolute inset-0 bg-scrim/45"
          />
        </>
      ) : null}
      <RevealItem index={0} firstDelayMs={0}>
        <View className="flex-row flex-wrap gap-sm">
          <Text
            className="rounded-pill px-md py-[7px] font-noto-bold text-label"
            style={{ backgroundColor: palette.accent, color: palette.bg }}
          >
            {cover.stickerLabel}
          </Text>
          {cover.region ? (
            <Text
              className="rounded-pill border px-md py-[7px] font-noto-bold text-label"
              style={chipStyle}
            >
              {cover.region}
            </Text>
          ) : null}
          {cover.dateLabel ? (
            <Text
              className="rounded-pill border px-md py-[7px] font-noto-bold text-label"
              style={chipStyle}
            >
              {cover.dateLabel}
            </Text>
          ) : null}
        </View>
      </RevealItem>
      <View>
        <RevealItem index={1} firstDelayMs={0}>
          <Text
            testID={`${ID}-cover-title`}
            className="font-noto-bold text-[56px] leading-[60px]"
            style={{ color: palette.fg }}
          >
            {cover.title}
          </Text>
        </RevealItem>
        {/* 문장 자리는 늘 있다 — 서버 문장이 늦게 와도 레이아웃이 밀리지 않는다. */}
        <View
          testID={`${ID}-cover-caption-slot`}
          className="mt-lg min-h-[72px]"
        >
          {caption !== '' ? (
            <Text
              testID={`${ID}-cover-caption`}
              className="font-noto text-body"
              style={{ color: palette.fg }}
            >
              {caption}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function DaySlide({
  slide,
}: {
  slide: Extract<StorySlide, { kind: 'day' }>;
}): ReactElement {
  const { day } = slide;
  const palette = CATEGORY_PALETTES[day.palette];
  return (
    <View
      testID={`${ID}-slide-${slide.key}`}
      className={`${SLIDE_FRAME} justify-center gap-lg`}
      style={{ backgroundColor: palette.bg }}
    >
      <RevealItem index={0} firstDelayMs={0}>
        <View className="gap-xs">
          <Text
            testID={`${ID}-day-label`}
            className="font-noto-bold text-[72px] leading-[78px]"
            style={{ color: palette.fg }}
          >
            {day.dayLabel}
          </Text>
          <Text
            testID={`${ID}-day-count`}
            className="font-noto-bold text-[28px] leading-[34px]"
            style={{ color: palette.accent }}
          >
            {day.visitCountLabel}
          </Text>
        </View>
      </RevealItem>
      <View className="gap-md">
        {day.places.map((place, i) => (
          <RevealItem
            // 같은 이름이 한 날에 두 번 나올 수 있어 순번을 키에 섞는다.
            key={`${i}-${place}`}
            index={1 + i}
            firstDelayMs={0}
          >
            <Text
              testID={`${ID}-day-place`}
              numberOfLines={1}
              className="font-noto-bold text-[26px] leading-[34px]"
              style={{ color: palette.fg }}
            >
              {place}
            </Text>
          </RevealItem>
        ))}
      </View>
      {day.distance ? (
        <RevealItem index={1 + day.places.length} firstDelayMs={0}>
          <Text
            testID={`${ID}-day-distance`}
            className="font-noto text-body"
            style={{ color: palette.accent }}
          >
            {day.distance}
          </Text>
        </RevealItem>
      ) : null}
    </View>
  );
}

function RouteSlide({
  slide,
}: {
  slide: Extract<StorySlide, { kind: 'route' }>;
}): ReactElement {
  const palette = CATEGORY_PALETTES[slide.palette];
  return (
    <View
      testID={`${ID}-slide-route`}
      className={`${SLIDE_FRAME} justify-center`}
      style={{ backgroundColor: palette.bg }}
    >
      <MagazineRoute
        route={slide.stops.map((stop) => ({
          order: stop.order,
          name: stop.place,
          named: true,
          dayLabel: stop.dayLabel,
        }))}
        palette={slide.palette}
        testID={`${ID}-route`}
        stopTestID={`${ID}-route-stop`}
        heading="여행 동선"
        firstIndex={0}
        firstDelayMs={0}
      />
    </View>
  );
}

function StatsSlide({
  slide,
  hashtagText,
}: {
  slide: Extract<StorySlide, { kind: 'stats' }>;
  hashtagText: string;
}): ReactElement {
  const palette = CATEGORY_PALETTES.STATS;
  const { cells } = slide;
  // 라벨은 j04 숫자 타일과 같은 낱말이다 — 숫자 값은 대표 카드와 같은 `cells` 그대로.
  const tiles: MagazineStatTile[] = [
    { key: 'visits', label: '방문', value: String(cells.totalVisits) },
    {
      key: 'distance',
      label: '이동',
      value: cells.distanceText,
      ...(slide.distanceNote ? { note: slide.distanceNote } : {}),
    },
    { key: 'photos', label: '사진', value: String(cells.totalPhotos) },
  ];
  return (
    <View
      testID={`${ID}-slide-stats`}
      className={`${SLIDE_FRAME} justify-center`}
      style={{ backgroundColor: palette.bg }}
    >
      <MagazineStats stats={tiles} testID={`${ID}-stats`} />
      {hashtagText !== '' ? (
        <Text
          testID={`${ID}-hashtags`}
          className="px-xl pt-lg font-noto-bold text-body"
          style={{ color: MAGAZINE_TONES.highlight }}
        >
          {hashtagText}
        </Text>
      ) : null}
    </View>
  );
}

export function StorySlideView({
  slide,
  caption,
  hashtagText,
}: {
  slide: StorySlide;
  caption: string;
  hashtagText: string;
}): ReactElement {
  switch (slide.kind) {
    case 'cover':
      return <CoverSlide slide={slide} caption={caption} />;
    case 'day':
      return <DaySlide slide={slide} />;
    case 'route':
      return <RouteSlide slide={slide} />;
    case 'stats':
      return <StatsSlide slide={slide} hashtagText={hashtagText} />;
  }
}
