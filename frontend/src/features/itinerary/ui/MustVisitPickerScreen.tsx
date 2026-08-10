import type { ReactElement } from 'react';
import { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KakaoMapView, type MapPin } from '@/shared/map';
import { StateNotice } from '@/shared/ui/StateNotice';

import {
  MUST_VISIT_NAME_PLACEHOLDER,
  type MustVisitListItem,
  type MustVisitListView,
} from '../model/mustVisitList';
import {
  AlertCircleGlyph,
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
 * **CTA 와 건너뛰기는 예외로 그린다**(01b D6) — 갈 다음 단계(h09)가 아직 없지만 **사유를
 * 함께** 내므로 침묵이 아니다. 사유가 있으면 둘 다 실제로 잠기고 색도 함께 바뀐다: 접근성
 * 상태만 잠그면 "빨간 활성 버튼처럼 보이는데 안 눌리는" 상태가 남는다(문제로그 2026-08-08).
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

/** 강등 확인 시트 — 정본 공백이라 01b D1 이 정한 발명값이다. 이 시트가 붙는 유일한 이유가
 * **무엇을 잃는지 말하는 것**이다: 계약에 수정(PATCH)이 없어 강등은 DELETE→POST 2단이고
 * 되돌리려면 h07 에서 날짜·시각을 다시 입력해야 한다. */
const DEMOTE_TITLE = '아무 때나로 바꿀까요?';
const DEMOTE_NOTE = '정해둔 날짜와 시각이 지워져요';
const DEMOTE_CONFIRM = '바꾸기';
const DEMOTE_CANCEL = '취소';

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
  /** 지도 핀. **번호는 이미 정해져 있다** — 좌표를 못 얻은 항목이 빠져 ①③ 처럼 뛸 수 있고
   * 화면은 그것을 그대로 그린다. 비었으면 지도 카드를 아예 안 그린다(01b D9).
   * 아예 안 넘기면 "핀을 아직 모른다" 는 뜻이라 좌표 안내도 붙이지 않는다. */
  pins?: MapPin[];
  /** 다음 단계가 막힌 사유. `null`·미지정이면 CTA·건너뛰기가 활성이다(정본 선례 —
   * `frontend-components` §4 h04 "차단 시 CTA 비활성 + 사유(판정값은 prop)"). */
  proceedBlockedReason?: string | null;
  /** 강등 실패 안내. 목록 **곁에** 덧붙는다 — 얼굴을 갈아 끼우지 않는다(AC-M1). */
  demoteErrorText?: string;
  onBack?(): void;
  /** 카드 본문 누름 → h07(01b D3). Figma 가 그린 우측 아이콘은 그대로 두고 동선만 연다. */
  onPressItem?(sourcePoiId: string): void;
  onRemove?(input: { mustVisitId: string; sourcePoiId: string }): void;
  onRetry?(): void;
  onProceed?(): void;
  onSkip?(): void;
  /**
   * 확인 시트에서 사용자가 **승인했을 때만** 불린다 — 칩을 누른 시점에는 안 불린다(01b D1).
   *
   * `false` 를 돌려주면 **요청을 받지 못했다**는 뜻이고 시트는 열린 채로 남는다(앞 강등이
   * 아직 날아가는 중이라 잠겨 있을 때). 아무것도 안 돌려주는 호출부는 예전처럼 닫는다.
   */
  onDemote?(input: {
    mustVisitId: string;
    sourcePoiId: string;
  }): boolean | void;
  /** 강등 재시도. 복구 가능한 실패(`lost`)일 때만 배선이 넘긴다(h07 `onRetry` 선례) —
   * 다시 낼 요청이 없는 실패에 헛된 버튼을 세우지 않는다. */
  onRetryDemote?(): void;
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
 * 켜졌는지 알 수 없다(`SegmentItem` 선례).
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
  onPress(): void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`rounded-pill px-[10px] py-[3px] ${
        selected ? 'bg-primary-pale' : 'bg-surface-strong'
      }`}
    >
      <Text
        className={`font-noto-bold text-micro font-bold ${
          selected ? 'text-primary-text' : 'text-muted'
        }`}
      >
        {label}
      </Text>
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
  onRequestDemote,
}: {
  index: number;
  item: MustVisitListItem;
  /** 이 항목이 지도에 못 올라갔다. 보조행을 그 사실로 **바꾼다**(Figma `no-coords` 프레임) —
   * 지도에 못 뜨는 이유가 시작 시각보다 급한 소식이다. */
  noCoords: boolean;
  onPressItem?(sourcePoiId: string): void;
  onRemove?(input: { mustVisitId: string; sourcePoiId: string }): void;
  onRequestDemote(input: { mustVisitId: string; sourcePoiId: string }): void;
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
            // 이미 ANYTIME 이면 할 일이 없다 — 같은 상태로 보내는 DELETE→POST 는 요청만 늘린다.
            onPress={() => {
              if (fixed) {
                onRequestDemote({
                  mustVisitId: item.mustVisitId,
                  sourcePoiId: item.sourcePoiId,
                });
              }
            }}
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

/** 목록 곁에 **덧붙는** 알림. 얼굴을 갈아 끼우지 않는 것이 이 행의 전부다(AC-M1) — 조회
 * 최신화 실패와 강등 실패가 같은 모양을 쓴다. */
function AlertRow({
  testID,
  text,
  retryTestID,
  onRetry,
}: {
  testID?: string;
  text: string;
  /** 주지 않으면 재시도 버튼이 서지 않는다 — 다시 낼 요청이 없는 실패가 그 자리다. */
  retryTestID?: string;
  onRetry?(): void;
}): ReactElement {
  return (
    <View
      testID={testID}
      className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-[14px] py-md"
    >
      <AlertCircleGlyph />
      <Text className="flex-1 font-noto text-label text-body">{text}</Text>
      {retryTestID === undefined ? null : (
        <Pressable
          testID={retryTestID}
          accessibilityRole="button"
          onPress={onRetry}
          hitSlop={6}
        >
          <Text className="font-noto-bold text-label font-bold text-primary">
            {RETRY_LABEL}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function MustVisitPickerScreen({
  view,
  pins,
  proceedBlockedReason,
  demoteErrorText,
  onBack,
  onPressItem,
  onRemove,
  onRetry,
  onProceed,
  onSkip,
  onDemote,
  onRetryDemote,
}: MustVisitPickerScreenProps): ReactElement {
  // 화면이 스스로 쥐는 상태는 하나뿐이다 — "확인 시트가 누구를 대상으로 열려 있는가".
  // 순수 표시 상태라 배선이 알 이유가 없다(`MustVisitTimeScreen.startSheetOpen` 과 같은 배치).
  const [demoteTarget, setDemoteTarget] = useState<{
    mustVisitId: string;
    sourcePoiId: string;
  } | null>(null);

  const pinNumbers = new Set((pins ?? []).map((pin) => pin.number));
  // 얼굴이 핀보다 세다 — 빈 목록·조회 실패 프레임에는 핀을 받아도 지도가 없다(Figma
  // `empty`·`error`). 항목은 있는데 좌표를 가진 것이 하나도 없을 때도 안 그린다(01b D9).
  const mapPins = view.kind === 'listed' ? (pins ?? []) : [];
  const blocked = proceedBlockedReason != null;

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
          <Pressable
            testID="itinerary-mustvisit-screen-skip"
            accessibilityRole="button"
            disabled={blocked}
            onPress={onSkip}
            hitSlop={8}
          >
            <Text
              className={`font-noto text-body ${
                blocked ? 'text-muted-soft' : 'text-muted'
              }`}
            >
              {SKIP_LABEL}
            </Text>
          </Pressable>
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

          {mapPins.length === 0 ? null : (
            <View
              testID="itinerary-mustvisit-screen-map"
              className="h-[170px] w-full overflow-hidden rounded-card border border-hairline-strong"
            >
              {/* `KakaoMapView` 는 마운트 시 문서를 한 번만 조립한다(그 컴포넌트의 동결
                  계약) — 다른 핀 묶음을 그리는 유일한 수단이 key remount 다. 열쇠를 핀
                  자체로 만들면 같은 핀에서는 다시 태어나지 않는다(React 는 key 를 값으로
                  비교한다). `DraftScreen` 선례와 같은 형태. */}
              {/* 연결선을 끈다 — 여기 핀 번호는 사용자가 **담은 순서**이지 돌아볼 순서가
                  아니다. 선을 그으면 아직 정해지지 않은 동선을 정해진 것처럼 말하게 되고,
                  다음 화면에서 솔버가 재배치하면 앱이 말을 바꾼 것으로 보인다. */}
              <KakaoMapView
                key={JSON.stringify(mapPins)}
                center={{ lat: mapPins[0].lat, lng: mapPins[0].lng }}
                pins={mapPins}
                viewOnly
                connectPins={false}
              />
            </View>
          )}

          {demoteErrorText === undefined ? null : (
            <AlertRow
              text={demoteErrorText}
              retryTestID={
                onRetryDemote === undefined
                  ? undefined
                  : 'itinerary-mustvisit-screen-demote-retry'
              }
              onRetry={onRetryDemote}
            />
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
              {view.staleFailed ? (
                <AlertRow
                  testID="itinerary-mustvisit-screen-stale-failed"
                  text={STALE_FAILED_NOTE}
                  retryTestID="itinerary-mustvisit-screen-stale-retry"
                  onRetry={onRetry}
                />
              ) : null}
              {view.items.map((item, index) => (
                <MustVisitCard
                  key={item.mustVisitId}
                  index={index}
                  item={item}
                  noCoords={pins !== undefined && !pinNumbers.has(index + 1)}
                  onPressItem={onPressItem}
                  onRemove={onRemove}
                  onRequestDemote={setDemoteTarget}
                />
              ))}
            </>
          ) : null}

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

        {demoteTarget === null ? null : (
          <View className="absolute inset-0 justify-end">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={DEMOTE_CANCEL}
              className="absolute inset-0 bg-scrim/40"
              onPress={() => setDemoteTarget(null)}
            />
            <View
              testID="itinerary-mustvisit-screen-demote"
              className="w-full gap-xs rounded-t-sheet-top bg-canvas px-lg pb-2xl pt-xl"
            >
              <Text className="font-noto-bold text-section font-bold text-ink">
                {DEMOTE_TITLE}
              </Text>
              <Text className="font-noto text-label text-muted">
                {DEMOTE_NOTE}
              </Text>
              <View className="w-full flex-row items-center gap-sm pt-md">
                <Pressable
                  testID="itinerary-mustvisit-screen-demote-cancel"
                  accessibilityRole="button"
                  onPress={() => setDemoteTarget(null)}
                  className="flex-1 items-center justify-center rounded-button border border-hairline-strong py-md"
                >
                  <Text className="font-noto-bold text-card-title font-bold text-muted">
                    {DEMOTE_CANCEL}
                  </Text>
                </Pressable>
                <Pressable
                  testID="itinerary-mustvisit-screen-demote-confirm"
                  accessibilityRole="button"
                  onPress={() => {
                    // 배선이 **요청을 못 받았다**(`false`)고 하면 시트를 그대로 둔다. 닫으면
                    // 확인까지 거친 조작이 아무 신호 없이 사라진다 — 사용자는 "바꿨는데 안
                    // 바뀌었다" 를 이유 없이 겪는다(BR-U1-55 침묵 실패 금지).
                    if (onDemote?.(demoteTarget) === false) return;
                    setDemoteTarget(null);
                  }}
                  className="flex-1 items-center justify-center rounded-button bg-primary py-md"
                >
                  <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                    {DEMOTE_CONFIRM}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
