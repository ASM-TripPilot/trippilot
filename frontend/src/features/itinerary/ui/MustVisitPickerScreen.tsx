import type { ReactElement } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateNotice } from '@/shared/ui/StateNotice';

import {
  MUST_VISIT_NAME_PLACEHOLDER,
  type MustVisitListItem,
  type MustVisitListView,
} from '../model/mustVisitList';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  CheckGlyph,
  CloseGlyph,
  InfoCircleGlyph,
  LockGlyph,
  PencilGlyph,
} from './ItineraryGlyphs';

/**
 * h05 필수 방문지 (선택) — Figma `1875:1083`.
 *
 * 화면은 완성된 `view` 하나만 받는다. 조회도 조인도 하지 않으므로 얼굴이 두 층으로 갈리지
 * 않는다(조합은 `pages` 층 몫 — `features` 간 직접 import 금지).
 *
 * **Figma 보다 짧다(01b D6)** — 지도 카드 · 검색 필 · `＋ 필수 방문지 추가` 타일은 이번 범위
 * 밖이라 정직한 스텁조차 그리지 않는다. 눌러도 아무 일 없는 표면은 침묵 실패의 다른 이름이다.
 * 앱바의 `건너뛰기` 도 같은 이유로 없다(오케 판정 2026-08-08) — 갈 **다음 단계가 아직 없어**
 * 뒤로 화살표와 동작이 같았고, 그 라벨은 존재하지 않는 앞 화면이 있다고 믿게 한다.
 */

const SCREEN_TITLE = '필수 방문지';
const INTRO_TITLE = '꼭 가고 싶은 곳을 먼저 담아요';
const INTRO_NOTE = 'AI가 시간·동선을 맞춰 배치해요';

const CHIP_MUST = '필수';
const CHIP_FIXED = '고정';
const CHIP_TIME_FIXED = '시각 고정';
/** ANYTIME 항목의 보조행. Figma 는 항목마다 다른 문구를 그리지만(`오전 방문 추천`) 그 값을
 * 만들 데이터가 계약에 없다 — 모든 `ANYTIME` 에 참인 한 문장만 쓴다. */
const ANYTIME_NOTE = '영업시간 맞춰 자동 배치';

const EMPTY_TITLE = '아직 담은 필수 방문지가 없어요';
const EMPTY_NOTE = '꼭 가고 싶은 곳을 담으면 AI가 알아서 배치해요';
const FAILED_TITLE = '목록을 불러오지 못했어요';
const FAILED_NOTE = '네트워크를 확인하고 다시 시도해주세요';
const RETRY_LABEL = '다시 시도';
/** 목록은 살아 있고 최신화만 실패한 자리 — 조회 실패와 해제 실패가 함께 여기로 온다. */
const STALE_FAILED_NOTE = '목록을 최신 상태로 맞추지 못했어요';

// 카드 그림자(Figma `0px 4px 16px rgba(0,0,0,0.08)`). RN 은 box-shadow 가 없어 스타일
// 프로퍼티로 옮긴다 — 그림자는 토큰 대상이 아니다(`HomeScreen.heroCardShadow` 와 같은 값).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 4,
} as const;

export interface MustVisitPickerScreenProps {
  view: MustVisitListView;
  onBack?(): void;
  /** 카드 본문 누름 → h07(01b D3). Figma 가 그린 우측 아이콘은 그대로 두고 동선만 연다. */
  onPressItem?(sourcePoiId: string): void;
  onRemove?(input: { mustVisitId: string; sourcePoiId: string }): void;
  onRetry?(): void;
}

function Chip({
  testID,
  label,
  icon,
}: {
  testID: string;
  label: string;
  icon?: ReactElement;
}): ReactElement {
  return (
    <View
      testID={testID}
      className={`flex-row items-center gap-[3px] rounded-pill bg-primary-pale py-[3px] ${
        icon === undefined ? 'px-[9px]' : 'pl-[7px] pr-[9px]'
      }`}
    >
      {icon}
      <Text className="font-noto-bold text-micro font-bold text-primary-text">
        {label}
      </Text>
    </View>
  );
}

/**
 * 카드 한 장. **끝 시각을 그리지 않는다(오케 판정 2026-08-08)** — Figma 목업의 `13:00–14:30`
 * 에서 끝 시각은 `fixedStart + dwellMin` 에서만 나오는데, `dwellMin` 은 솔버 입력이지 표시값이
 * 아니고(INV-3) 그 끝 시각은 솔버 검증값도 아니다(INV-2). 시작 시각만 낸다.
 */
function MustVisitCard({
  index,
  item,
  onPressItem,
  onRemove,
}: {
  index: number;
  item: MustVisitListItem;
  onPressItem?(sourcePoiId: string): void;
  onRemove?(input: { mustVisitId: string; sourcePoiId: string }): void;
}): ReactElement {
  const fixed = item.type === 'FIXED';
  return (
    <Pressable
      testID={`itinerary-mustvisit-${item.sourcePoiId}`}
      accessibilityRole="button"
      onPress={() => onPressItem?.(item.sourcePoiId)}
      style={cardShadow}
      className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas py-md pl-md pr-[14px]"
    >
      <View className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-primary">
        <Text className="font-inter-bold text-label font-bold text-on-primary">
          {String(index + 1)}
        </Text>
      </View>
      <View
        testID={`itinerary-mustvisit-image-${item.sourcePoiId}`}
        className="h-[78px] w-[78px] overflow-hidden rounded-thumb bg-surface-strong"
      >
        {item.imageUrl === null ? null : (
          <Image
            source={{ uri: item.imageUrl }}
            resizeMode="cover"
            className="h-full w-full"
          />
        )}
      </View>
      <View className="flex-1 items-start gap-xs">
        {fixed ? (
          <Chip
            testID={`itinerary-mustvisit-chip-fixed-${item.sourcePoiId}`}
            label={CHIP_FIXED}
            icon={<LockGlyph />}
          />
        ) : (
          <Chip
            testID={`itinerary-mustvisit-chip-must-${item.sourcePoiId}`}
            label={CHIP_MUST}
          />
        )}
        <Text
          testID={`itinerary-mustvisit-name-${item.sourcePoiId}`}
          numberOfLines={1}
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {item.name ?? MUST_VISIT_NAME_PLACEHOLDER}
        </Text>
        <Text numberOfLines={1} className="font-noto text-caption text-muted">
          {fixed ? (item.fixedStart ?? '') : ANYTIME_NOTE}
        </Text>
        {fixed ? (
          <Chip
            testID={`itinerary-mustvisit-chip-time-${item.sourcePoiId}`}
            label={CHIP_TIME_FIXED}
            icon={<CheckGlyph />}
          />
        ) : null}
      </View>
      {fixed ? (
        <Pressable
          testID={`itinerary-mustvisit-edit-${item.sourcePoiId}`}
          accessibilityRole="button"
          accessibilityLabel="시각 고치기"
          onPress={() => onPressItem?.(item.sourcePoiId)}
          hitSlop={8}
        >
          <PencilGlyph />
        </Pressable>
      ) : (
        <Pressable
          testID={`itinerary-mustvisit-remove-${item.sourcePoiId}`}
          accessibilityRole="button"
          accessibilityLabel="필수 방문지에서 빼기"
          onPress={() =>
            onRemove?.({
              mustVisitId: item.mustVisitId,
              sourcePoiId: item.sourcePoiId,
            })
          }
          hitSlop={8}
        >
          <CloseGlyph />
        </Pressable>
      )}
    </Pressable>
  );
}

/** 도착 전 자리표시. **글자를 넣지 않는다** — "담은 곳이 없어요" 를 미리 그리면 담아 둔
 * 사용자에게 한 순간 거짓말을 하게 된다(`MustVisitSection` 선례). */
function LoadingFace(): ReactElement {
  return (
    <View
      testID="itinerary-mustvisit-screen-loading"
      className="w-full gap-lg"
      accessibilityLabel="목록을 불러오는 중"
    >
      {[0, 1, 2].map((slot) => (
        <View
          key={slot}
          className="h-[102px] w-full rounded-card bg-surface-soft"
        />
      ))}
    </View>
  );
}

/** 목록 곁에 **덧붙는** 알림. 얼굴을 갈아 끼우지 않는 것이 이 행의 전부다(AC-M1). */
function StaleFailedRow({ onRetry }: { onRetry?(): void }): ReactElement {
  return (
    <View
      testID="itinerary-mustvisit-screen-stale-failed"
      className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-[14px] py-md"
    >
      <AlertCircleGlyph />
      <Text className="flex-1 font-noto text-label text-body">
        {STALE_FAILED_NOTE}
      </Text>
      <Pressable
        testID="itinerary-mustvisit-screen-stale-retry"
        accessibilityRole="button"
        onPress={onRetry}
        hitSlop={6}
      >
        <Text className="font-noto-bold text-label font-bold text-primary">
          {RETRY_LABEL}
        </Text>
      </Pressable>
    </View>
  );
}

export function MustVisitPickerScreen({
  view,
  onBack,
  onPressItem,
  onRemove,
  onRetry,
}: MustVisitPickerScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-sm bg-canvas py-[14px] pl-md pr-lg">
          <Pressable
            testID="itinerary-mustvisit-screen-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            {SCREEN_TITLE}
          </Text>
        </View>

        <ScrollView
          contentContainerClassName="gap-lg px-lg pb-2xl pt-[14px]"
          keyboardShouldPersistTaps="handled"
        >
          <View className="w-full gap-xs">
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {INTRO_TITLE}
            </Text>
            <Text className="font-noto text-caption text-muted">
              {INTRO_NOTE}
            </Text>
          </View>

          {view.kind === 'loading' ? <LoadingFace /> : null}

          {view.kind === 'empty' ? (
            <StateNotice
              testID="itinerary-mustvisit-screen-empty"
              dashed
              icon={<InfoCircleGlyph size={32} tone="primaryText" />}
              title={EMPTY_TITLE}
              description={EMPTY_NOTE}
              actions={[]}
            />
          ) : null}

          {view.kind === 'failed' ? (
            <StateNotice
              testID="itinerary-mustvisit-screen-failed"
              icon={<AlertCircleGlyph size={32} tone="primaryText" />}
              title={FAILED_TITLE}
              description={FAILED_NOTE}
              actions={[
                {
                  testID: 'itinerary-mustvisit-screen-retry',
                  label: RETRY_LABEL,
                  variant: 'outline',
                  onPress: onRetry,
                },
              ]}
            />
          ) : null}

          {view.kind === 'listed' ? (
            <>
              {view.staleFailed ? <StaleFailedRow onRetry={onRetry} /> : null}
              {view.items.map((item, index) => (
                <MustVisitCard
                  key={item.mustVisitId}
                  index={index}
                  item={item}
                  onPressItem={onPressItem}
                  onRemove={onRemove}
                />
              ))}
            </>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
