import type { ReactElement } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapView, type MapPin } from '@/shared/map';
import { StateNotice } from '@/shared/ui/StateNotice';

import {
  MUST_VISIT_NAME_PLACEHOLDER,
  type MustVisitListItem,
  type MustVisitListView,
} from '../model/mustVisitList';
import {
  BackChevronGlyph,
  CloseGlyph,
  InfoCircleGlyph,
  LockGlyph,
  PencilGlyph,
} from './ItineraryGlyphs';

/**
 * h05 필수 방문지 (선택) — Figma `1875:1083`.
 *
 * 화면은 완성된 값만 받는다. 조회도 조인도 하지 않고 **핀 번호도 다시 매기지 않는다**(조합은
 * `pages` 층 몫 — `features` 간 직접 import 금지).
 *
 * **Figma 보다 짧다** — 검색 필 · `＋ 필수 방문지 추가` 타일(POST 대상을 고를 화면이 없다) ·
 * `지도에서 지정` 칩(좌표를 실을 계약 자체가 없다 · 01b D4) · `© Kakao` 표기와 축척 바
 * (카카오 SDK 가 자체 렌더한다 · 01b D8)는 그리지 않는다. 눌러도 아무 일 없는 표면은 침묵
 * 실패의 다른 이름이다.
 *
 * **얼굴마다 크롬이 다르다** — 헤드라인 제목은 `listed` 에서 숨고(그때만 서브카피만 남는다),
 * 건너뛰기는 `failed` 에서만 뜬다(에러에서 빠져나갈 유일한 문). CTA 는 `listed` 가 아니면
 * 잠긴다(로딩·에러·빈 목록은 아직 갈 다음 단계가 없다) — 색도 함께 바뀌어 "빨간데 안 눌리는"
 * 상태를 남기지 않는다(문제로그 2026-08-08).
 */

const SCREEN_TITLE = '필수 방문지';
const SKIP_LABEL = '건너뛰기';
const INTRO_TITLE = '꼭 가고 싶은 곳을 먼저 담아요';
const INTRO_NOTE = 'AI가 시간·동선을 맞춰 배치해요';

const CHIP_MUST = '필수';
const CHIP_FIXED = '고정';
/** ANYTIME 항목의 보조행. Figma 는 항목마다 다른 문구를 그리지만(`오전 방문 추천`) 그 값을
 * 만들 데이터가 계약에 없다 — 모든 `ANYTIME` 에 참인 한 문장만 쓴다. */
const ANYTIME_NOTE = '영업시간 맞춰 자동 배치';
/** 좌표를 못 얻은 항목의 보조행. 핀 수와 목록 수가 다른 **이유**가 여기서 드러난다 —
 * 빈칸으로 두면 침묵 실패와 구별되지 않는다(BR-U1-55). */
const NO_COORDS_NOTE = '위치를 확인할 수 없어요';

const TIMEMODE_ANYTIME = '아무 때나';
const TIMEMODE_FIXED = '시간 정해두기';

const PROCEED_LABEL = '이 구성으로 일정 짜기';

const EMPTY_TITLE = '아직 담은 필수 방문지가 없어요';
const EMPTY_NOTE = '꼭 가고 싶은 곳을 담으면 AI가 알아서 배치해요';
/** 조회 실패 부제는 0곳 얼굴과 반드시 구분한다(정본 `frontend-components` L132). */
const FAILED_TITLE = '담은 곳을 불러오지 못했어요';
const FAILED_NOTE = '네트워크를 확인하고 다시 시도해 주세요';
const RETRY_LABEL = '다시 시도';

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
  /** 지도 핀. **번호는 이미 정해져 있다** — 좌표를 못 얻은 항목이 빠져 ①③ 처럼 뛸 수 있고
   * 화면은 그것을 그대로 그린다. 비었으면 지도 카드를 아예 안 그린다(01b D9).
   * 아예 안 넘기면 "핀을 아직 모른다" 는 뜻이라 좌표 안내도 붙이지 않는다. */
  pins?: MapPin[];
  /** 다음 단계가 막힌 사유. `null`·미지정이면 사유 문구를 안 띄운다. 비활성 판정 자체는
   * `view.kind !== 'listed'` 가 소유한다(이 값은 그 위에 얹는 보조 사유일 뿐이다). */
  proceedBlockedReason?: string | null;
  onBack?(): void;
  /** 카드 본문 누름 → h07(01b D3). Figma 가 그린 우측 아이콘은 그대로 두고 동선만 연다. */
  onPressItem?(sourcePoiId: string): void;
  onRemove?(input: { mustVisitId: string; sourcePoiId: string }): void;
  onRetry?(): void;
  onProceed?(): void;
  onSkip?(): void;
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
 * `아무 때나 / 시간 정해두기` 두 칸짜리 셀렉터의 한 칸(Figma `timeMode`).
 *
 * 선택 상태를 **색과 접근성 상태 둘 다로** 낸다 — 색만 쓰면 스크린리더도 jest 도 어느 쪽이
 * 켜졌는지 알 수 없다(`SegmentItem` 선례). `onPress` 를 안 주면 표시 전용이다 — h02 에서 이
 * 셀렉터는 강등을 일으키지 않는다(Q1, 시간 변경은 연필→h07 경유).
 */
function TimeModeChip({
  testID,
  label,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  onPress?(): void;
}): ReactElement {
  const className = `rounded-pill px-[10px] py-[3px] ${
    selected ? 'bg-primary-pale' : 'bg-surface-strong'
  }`;
  const labelNode = (
    <Text
      className={`font-noto-bold text-micro font-bold ${
        selected ? 'text-primary-text' : 'text-muted'
      }`}
    >
      {label}
    </Text>
  );
  // onPress 가 없으면 표시 전용이다 — `Pressable`+`button` 역할로 두면 VoiceOver 가 "버튼" 으로
  // 알리고 double-tap 이 무반응이라 침묵 실패가 된다(머리말 원칙). 어포던스 자체를 없애고 선택
  // 상태만 `accessibilityState` 로 남긴다. 상호작용 칩(시간 정해두기)은 onPress 가 있어 버튼이다.
  if (onPress === undefined) {
    return (
      <View
        testID={testID}
        accessibilityState={{ selected }}
        className={className}
      >
        {labelNode}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={className}
    >
      {labelNode}
    </Pressable>
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
  noCoords,
  onPressItem,
  onRemove,
}: {
  index: number;
  item: MustVisitListItem;
  /** 이 항목이 지도에 못 올라갔다. 보조행을 그 사실로 **바꾼다**(Figma `no-coords` 프레임) —
   * 지도에 못 뜨는 이유가 시작 시각보다 급한 소식이다. */
  noCoords: boolean;
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
        {noCoords ? (
          <Text
            numberOfLines={1}
            className="font-noto text-caption text-primary-text"
          >
            {NO_COORDS_NOTE}
          </Text>
        ) : (
          <Text numberOfLines={1} className="font-noto text-caption text-muted">
            {fixed ? (item.fixedStart ?? '') : ANYTIME_NOTE}
          </Text>
        )}
        <View className="flex-row items-center gap-[6px]">
          <TimeModeChip
            testID={`itinerary-mustvisit-timemode-anytime-${item.sourcePoiId}`}
            label={TIMEMODE_ANYTIME}
            selected={!fixed}
            // 표시 전용 — 강등(FIXED→ANYTIME)은 h02 에서 일으키지 않는다(Q1). 되돌릴 수 없는
            // DELETE→POST 2단이라 h03/h07 을 거친다.
          />
          <TimeModeChip
            testID={`itinerary-mustvisit-timemode-fixed-${item.sourcePoiId}`}
            label={TIMEMODE_FIXED}
            selected={fixed}
            // 켜져 있든 아니든 목적지는 h07 이다. 날짜·시각 없는 FIXED 는 INV-U1-17 위반이라
            // 이 화면에서 바로 바꿀 수 없고, 이미 FIXED 인 항목에는 시각을 고치러 가는 문이다.
            onPress={() => onPressItem?.(item.sourcePoiId)}
          />
        </View>
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

/**
 * 도착 전 자리표시. **글자를 넣지 않는다** — "담은 곳이 없어요" 를 미리 그리면 담아 둔
 * 사용자에게 한 순간 거짓말을 하게 된다(`MustVisitSection` 선례). 지도 자리와 카드 3장을
 * 회색 블록으로 흉내 낸다(실지도 재마운트 아님 · 색은 토큰) — 카드마다 원+사각+바 2줄로
 * 도착할 카드의 골격을 미리 비운다(빈칸이 아니라 명시적 자리표시 · UX-U1-02).
 */
function LoadingFace(): ReactElement {
  return (
    <View
      testID="itinerary-mustvisit-screen-loading"
      className="w-full gap-lg"
      accessibilityLabel="목록을 불러오는 중"
    >
      <View
        testID="itinerary-mustvisit-screen-map-skeleton"
        className="h-[170px] w-full rounded-card bg-surface-soft"
      />
      {[0, 1, 2].map((slot) => (
        <View
          key={slot}
          testID="itinerary-mustvisit-screen-card-skeleton"
          className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas py-md pl-md pr-[14px]"
        >
          <View
            testID="itinerary-mustvisit-screen-skeleton-thumb"
            className="h-[26px] w-[26px] rounded-pill bg-surface-soft"
          />
          <View
            testID="itinerary-mustvisit-screen-skeleton-box"
            className="h-[78px] w-[78px] rounded-thumb bg-surface-soft"
          />
          <View className="flex-1 gap-xs">
            <View
              testID="itinerary-mustvisit-screen-skeleton-bar"
              className="h-[14px] w-1/3 rounded-pill bg-surface-soft"
            />
            <View
              testID="itinerary-mustvisit-screen-skeleton-bar"
              className="h-[14px] w-2/3 rounded-pill bg-surface-soft"
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * 조회 실패 얼굴 — 로컬 블록(StateNotice 아님). Figma 는 상단 원형 배지 없이 빨강 아웃라인
 * `다시 시도` pill 만 그린다. StateNotice 는 아이콘 배지가 필수 + outline 이 회색이라 그 얼굴을
 * 못 낸다(01b) — 그래서 여기서만 쓰는 로컬 블록으로 그린다. 빨강은 토큰(`border-primary` ·
 * `text-primary`), 상단 `bg-primary-pale` 배지·글리프 없음(AC-14 · C41).
 */
function FailedFace({ onRetry }: { onRetry?(): void }): ReactElement {
  return (
    <View
      testID="itinerary-mustvisit-screen-failed"
      className="w-full items-center gap-md rounded-card px-lg py-3xl"
    >
      <Text className="text-center font-noto-bold text-[16px] font-bold text-ink">
        {FAILED_TITLE}
      </Text>
      <Text className="text-center font-noto text-label text-muted">
        {FAILED_NOTE}
      </Text>
      <Pressable
        testID="itinerary-mustvisit-screen-retry"
        accessibilityRole="button"
        onPress={onRetry}
        className="rounded-pill border border-primary px-lg py-md"
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
  pins,
  proceedBlockedReason,
  onBack,
  onPressItem,
  onRemove,
  onRetry,
  onProceed,
  onSkip,
}: MustVisitPickerScreenProps): ReactElement {
  const pinNumbers = new Set((pins ?? []).map((pin) => pin.number));
  // 얼굴이 핀보다 세다 — 빈 목록·조회 실패 프레임에는 핀을 받아도 지도가 없다(Figma
  // `empty`·`error`). 항목은 있는데 좌표를 가진 것이 하나도 없을 때도 안 그린다(01b D9).
  const mapPins = view.kind === 'listed' ? (pins ?? []) : [];
  // 다음 단계는 목록이 도착한 뒤에만 열린다 — 로딩·에러·빈 목록은 갈 곳이 없어 잠근다.
  const blocked = view.kind !== 'listed' || proceedBlockedReason != null;

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
          <View className="flex-1" />
          {view.kind === 'failed' ? (
            <Pressable
              testID="itinerary-mustvisit-screen-skip"
              accessibilityRole="button"
              onPress={onSkip}
              hitSlop={8}
            >
              <Text className="font-noto text-body text-muted">
                {SKIP_LABEL}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          contentContainerClassName="gap-lg px-lg pb-2xl pt-[14px]"
          keyboardShouldPersistTaps="handled"
        >
          <View className="w-full gap-xs">
            {view.kind === 'listed' ? null : (
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {INTRO_TITLE}
              </Text>
            )}
            <Text className="font-noto text-caption text-muted">
              {INTRO_NOTE}
            </Text>
          </View>

          {mapPins.length === 0 ? null : (
            <View
              testID="itinerary-mustvisit-screen-map"
              className="h-[170px] w-full overflow-hidden rounded-card border border-hairline-strong"
            >
              {/* 연결선을 끈다 — 여기 핀 번호는 사용자가 **담은 순서**이지 돌아볼 순서가
                  아니다. 선을 그으면 아직 정해지지 않은 동선을 정해진 것처럼 말하게 되고,
                  다음 화면에서 솔버가 재배치하면 앱이 말을 바꾼 것으로 보인다. */}
              <MapView
                center={{ lat: mapPins[0].lat, lng: mapPins[0].lng }}
                pins={mapPins}
                viewOnly
                connectPins={false}
              />
            </View>
          )}

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

          {view.kind === 'failed' ? <FailedFace onRetry={onRetry} /> : null}

          {view.kind === 'listed'
            ? view.items.map((item, index) => (
                <MustVisitCard
                  key={item.mustVisitId}
                  index={index}
                  item={item}
                  noCoords={pins !== undefined && !pinNumbers.has(index + 1)}
                  onPressItem={onPressItem}
                  onRemove={onRemove}
                />
              ))
            : null}

          {/* Figma `ctaPrimary` 는 `body` 의 마지막 자식이다 — 하단 고정 바가 아니라 스크롤
              흐름 안에 있다. 리포 표준 `CtaBar` 를 쓰면 자리가 달라진다. */}
          <View className="w-full gap-sm">
            {proceedBlockedReason == null ? null : (
              <Text className="text-center font-noto text-caption text-muted">
                {proceedBlockedReason}
              </Text>
            )}
            <Pressable
              testID="itinerary-mustvisit-screen-proceed"
              accessibilityRole="button"
              disabled={blocked}
              onPress={onProceed}
              className={`w-full items-center justify-center rounded-button py-lg ${
                blocked ? 'bg-hairline-strong' : 'bg-primary'
              }`}
            >
              <Text
                className={`font-noto-bold text-[16px] font-bold ${
                  blocked ? 'text-muted' : 'text-on-primary'
                }`}
              >
                {PROCEED_LABEL}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
