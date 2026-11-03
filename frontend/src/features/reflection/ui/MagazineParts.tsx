import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CountUpText } from '@/shared/ui/CountUpText';
import { PlacePhoto } from '@/shared/ui/PlacePhoto';
import { RevealItem } from '@/shared/ui/RevealItem';

import { CATEGORY_PALETTES, MAGAZINE_TONES } from '../model/categoryPalette';
import type {
  MagazineCoverVM,
  MagazinePicture,
  MagazineQuoteVM,
  MagazineRouteStop,
  MagazineStatTile,
  MagazineVM,
} from '../model/magazineVM';
import { Highlight, KenBurns, StickerPop } from './MagazineMotion';

/**
 * TRIP-1665 · 매거진 부품 — 표지·인용문·장면 카드·일정 변경 띠·동선·숫자 타일·해시태그. 전부 props 만 받는 무상태 뷰다
 * (조회·계산 0). 색은 VM 의 팔레트 키로 `CATEGORY_PALETTES` 에서 찾아 `style` 로 칠한다(동적 hex 는 className 이 못 받는다).
 * testID 는 `{prefix}-…` — j04·j06 이 재사용할 때 서로 섞이지 않게 접두를 받는다.
 */

/** 사진(기기 사진 또는 카테고리 그림)이 칸을 채운다 — 천천히 확대. 부모가 크기와 overflow-hidden 을 준다. */
function MagazinePhoto({
  picture,
}: {
  picture: MagazinePicture;
}): ReactElement {
  return (
    <KenBurns>
      <PlacePhoto
        imageUrl={picture.uri}
        category={picture.category}
        poiId={picture.poiId}
        className="h-full w-full"
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    </KenBurns>
  );
}

export function MagazineCover({
  cover,
  testID,
  titleTestID,
}: {
  cover: MagazineCoverVM;
  testID: string;
  /** 있으면 제목 글자만 담은 Text 에 단다(j04 — 지역·기간과 한 노드로 섞지 않는다). */
  titleTestID?: string;
}): ReactElement {
  const palette = CATEGORY_PALETTES[cover.palette];
  const onPhoto = cover.picture !== null;
  const color = onPhoto ? MAGAZINE_TONES.onPhoto : palette.fg;
  return (
    <View
      testID={testID}
      className="h-[520px] w-full overflow-hidden"
      style={{ backgroundColor: palette.bg }}
    >
      {cover.picture ? <MagazinePhoto picture={cover.picture} /> : null}
      {onPhoto ? <View className="absolute inset-0 bg-scrim/45" /> : null}

      <View className="absolute left-xl top-[28px] flex-row gap-sm">
        {cover.region ? (
          <Text
            className="rounded-pill bg-scrim/40 px-md py-[7px] font-noto-bold text-label"
            style={{ color: MAGAZINE_TONES.onPhoto }}
          >
            {cover.region}
          </Text>
        ) : null}
        {cover.dateLabel ? (
          <Text
            className="rounded-pill bg-scrim/40 px-md py-[7px] font-noto-bold text-label"
            style={{ color: MAGAZINE_TONES.onPhoto }}
          >
            {cover.dateLabel}
          </Text>
        ) : null}
      </View>

      <View className="absolute right-xl top-[68px]">
        <StickerPop>
          <View
            className="h-[84px] w-[84px] items-center justify-center rounded-full"
            style={{ backgroundColor: MAGAZINE_TONES.highlight }}
          >
            {/* 시안처럼 두 줄("오늘의" / "회고") — 줄마다 따로 그려 헤더의 같은 글자와 한 노드로 겹치지 않는다. */}
            {cover.stickerLabel.split(' ').map((line) => (
              <Text
                key={line}
                className="text-center font-noto-bold text-[14px] leading-[17px]"
                style={{ color: MAGAZINE_TONES.ink }}
              >
                {line}
              </Text>
            ))}
          </View>
        </StickerPop>
      </View>

      <View className="absolute bottom-[44px] left-[22px] right-[22px] gap-lg">
        <Text
          testID={titleTestID}
          className="font-noto-bold text-[44px] leading-[50px]"
          style={{ color }}
        >
          {cover.title}
        </Text>
        <Text className="font-noto-bold text-body" style={{ color }}>
          {`${cover.visitLabel} · ${cover.photoLabel}`}
        </Text>
      </View>
    </View>
  );
}

/**
 * 인용문 — 머리말 줄 + 본문. 루트가 Fragment 라 본문 View(`testID`)가 부모 `RevealItem` 의 직접 자식이 된다(등장 모션 테스트가
 * 래퍼를 읽는 계약). 그래서 바깥 패딩은 한 겹 View 가 아니라 머리말 줄·본문에 나눠 얹었다(간격은 예전 `gap-md` = 12 를 머리말 아래 패딩으로).
 */
export function MagazineQuote({
  quote,
  testID,
  heading,
  onEdit,
  editTestID,
}: {
  quote: MagazineQuoteVM;
  testID: string;
  /** 머리말 — j03 `오늘을 한 줄로`, j04 `이번 여행`. */
  heading: string;
  /** 있을 때만 "수정" 링크를 그린다. */
  onEdit?: () => void;
  editTestID?: string;
}): ReactElement {
  const { head, mark } = quote;
  return (
    <>
      <View className="flex-row items-center px-[24px] pb-md pt-[40px]">
        <Text
          className="font-noto-bold text-caption"
          style={{ color: MAGAZINE_TONES.ink, opacity: 0.55, letterSpacing: 2 }}
        >
          {heading}
        </Text>
        <View className="flex-1" />
        {onEdit ? (
          <Pressable
            testID={editTestID}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={onEdit}
          >
            <Text className="font-noto-bold text-label text-primary">수정</Text>
          </Pressable>
        ) : null}
      </View>
      {/* 이 노드의 글자 내용 = 표시본 완전 일치(머리말·"수정"은 밖). 형광펜은 중첩 Text. */}
      <View testID={testID} className="px-[24px] pb-[36px]">
        <Text
          className="font-noto-bold text-[24px] leading-[36px]"
          style={{ color: MAGAZINE_TONES.ink }}
        >
          {head}
          {mark !== '' ? (
            <Highlight color={MAGAZINE_TONES.highlight}>{mark}</Highlight>
          ) : null}
        </Text>
      </View>
    </>
  );
}

export function MagazineSceneCard({
  scene,
  testID,
}: {
  scene: MagazineVM['scenes'][number];
  testID: string;
}): ReactElement {
  const palette = CATEGORY_PALETTES[scene.palette];
  return (
    <View
      testID={testID}
      className={`mx-xl min-h-[156px] overflow-hidden rounded-[28px] ${
        scene.photoSide === 'left' ? 'flex-row' : 'flex-row-reverse'
      }`}
      style={{ backgroundColor: palette.bg }}
    >
      {scene.picture ? (
        <View className="w-[128px] overflow-hidden">
          <MagazinePhoto picture={scene.picture} />
        </View>
      ) : null}
      <View className="min-w-0 flex-1 justify-between gap-md px-lg pb-[14px] pt-lg">
        <View className="flex-row items-center justify-between gap-sm">
          <Text
            className="font-noto-bold text-[34px] leading-[38px]"
            style={{ color: palette.fg }}
          >
            {scene.number}
          </Text>
          {scene.placeName ? (
            <Text
              numberOfLines={1}
              className="shrink rounded-pill px-[10px] py-[6px] font-noto-bold text-caption"
              style={{ backgroundColor: palette.fg, color: palette.bg }}
            >
              {scene.placeName}
            </Text>
          ) : null}
        </View>
        <Text
          className="font-noto-bold text-[17px] leading-[24px]"
          style={{ color: palette.fg }}
        >
          {scene.caption}
        </Text>
      </View>
    </View>
  );
}

export function MagazinePlanChange({
  change,
  testID,
}: {
  change: MagazineVM['planChanges'][number];
  testID: string;
}): ReactElement {
  const palette = CATEGORY_PALETTES[change.palette];
  return (
    <View testID={testID} className="gap-lg py-md">
      <View
        className="h-[48px] justify-center px-xl"
        style={{
          backgroundColor: palette.bg,
          transform: [{ rotate: '-2deg' }],
        }}
      >
        <Text
          className="font-noto-bold text-card-title"
          style={{ color: palette.accent, letterSpacing: 1 }}
        >
          {change.event === 'PLAN_B' ? 'PLAN B · 일정 변경' : '건너뜀'}
        </Text>
      </View>
      <Text
        className="px-[24px] font-noto-bold text-[19px] leading-[27px]"
        style={{ color: MAGAZINE_TONES.ink }}
      >
        {change.caption}
      </Text>
    </View>
  );
}

/**
 * 동선 — `MapView` 가 아니라 번호 목록. 한 곳씩 차례로 나타난다(RevealItem). `firstIndex` 는 이 박스가 시작하는 등장 순번,
 * `firstDelayMs` 는 첫 정류장이 나오기까지의 지연(j03 300 기본, j04 는 경로 그리기가 끝난 뒤 1050).
 * `stopTestID` 를 주면 모든 정류장이 그 testID 를 쓴다(j04), 없으면 `{testID}-stop-{N}`(j03).
 * 정류장에 `dayLabel` 이 있으면 이름 오른쪽에 별도 Text 로 그린다.
 */
export function MagazineRoute({
  route,
  palette: key,
  testID,
  heading,
  firstIndex,
  firstDelayMs = 300,
  stopTestID,
}: {
  route: readonly MagazineRouteStop[];
  palette: MagazineVM['cover']['palette'];
  testID: string;
  /** 머리말 — j03 `오늘의 동선`, j04 `여행 동선`. */
  heading: string;
  firstIndex: number;
  firstDelayMs?: number;
  stopTestID?: string;
}): ReactElement {
  const palette = CATEGORY_PALETTES[key];
  return (
    <View
      testID={testID}
      className="mx-lg gap-lg rounded-[32px] px-[22px] pb-[28px] pt-[26px]"
      style={{ backgroundColor: palette.bg }}
    >
      <Text
        className="font-noto-bold text-caption"
        style={{ color: palette.accent, letterSpacing: 2 }}
      >
        {heading}
      </Text>
      {route.map((stop, i) => (
        <RevealItem
          key={stop.order}
          index={firstIndex + i}
          firstDelayMs={firstDelayMs}
        >
          <View
            testID={stopTestID ?? `${testID}-stop-${stop.order}`}
            className="flex-row items-center gap-[14px]"
          >
            <View
              className="h-[28px] w-[28px] items-center justify-center rounded-full"
              style={{ backgroundColor: palette.fg }}
            >
              <Text
                className="font-noto-bold text-caption"
                style={{ color: palette.bg }}
              >
                {stop.order}
              </Text>
            </View>
            <Text
              className="min-w-0 flex-1 font-noto-bold text-[18px] leading-[24px]"
              style={{ color: palette.fg }}
            >
              {stop.name}
            </Text>
            {stop.dayLabel ? (
              <Text
                className="font-noto-bold text-caption"
                style={{ color: palette.accent }}
              >
                {stop.dayLabel}
              </Text>
            ) : null}
          </View>
        </RevealItem>
      ))}
    </View>
  );
}

export function MagazineStats({
  stats,
  testID,
}: {
  stats: readonly MagazineStatTile[];
  testID: string;
}): ReactElement {
  const tile = (key: MagazineStatTile['key']) =>
    stats.find((s) => s.key === key);
  const visits = tile('visits');
  const photos = tile('photos');
  const distance = tile('distance');
  return (
    <View testID={testID} className="gap-md px-xl pb-sm pt-[30px]">
      <View className="flex-row gap-md">
        {visits ? (
          <View
            className="h-[160px] flex-1 justify-between rounded-[28px] p-xl"
            style={{ backgroundColor: MAGAZINE_TONES.highlight }}
          >
            <Text className="font-noto-bold text-label text-ink">
              {visits.label}
            </Text>
            <CountUpText
              value={visits.value}
              className="font-noto-bold text-[64px] leading-[70px] text-ink"
            />
          </View>
        ) : null}
        {photos ? (
          <View className="h-[160px] flex-1 justify-between rounded-[28px] bg-ink p-xl">
            <Text className="font-noto-bold text-label text-white">
              {photos.label}
            </Text>
            <CountUpText
              value={photos.value}
              className="font-noto-bold text-[64px] leading-[70px] text-white"
            />
          </View>
        ) : null}
      </View>
      {distance ? (
        <View className="flex-row items-end justify-between rounded-[28px] bg-canvas p-xl">
          <View className="gap-xs">
            <Text className="font-noto-bold text-label text-ink">
              {distance.label}
            </Text>
            {distance.note ? (
              <Text className="font-noto text-caption text-muted">
                {distance.note}
              </Text>
            ) : null}
          </View>
          <CountUpText
            value={distance.value}
            className="font-noto-bold text-[40px] leading-[46px] text-ink"
          />
        </View>
      ) : null}
    </View>
  );
}

export function MagazineHashtags({
  tags,
  testID,
}: {
  tags: readonly string[];
  testID: string;
}): ReactElement {
  return (
    <View
      testID={testID}
      className="flex-row flex-wrap gap-sm px-xl pb-[40px] pt-[22px]"
    >
      {tags.map((tag) => (
        <Text
          key={tag}
          className="rounded-pill bg-ink px-md py-[7px] font-noto-bold text-label"
          style={{ color: MAGAZINE_TONES.highlight }}
        >
          {`#${tag}`}
        </Text>
      ))}
    </View>
  );
}
