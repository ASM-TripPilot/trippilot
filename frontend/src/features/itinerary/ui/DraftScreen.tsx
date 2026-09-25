import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import { MapView } from '@/shared/map';
import { StateNotice } from '@/shared/ui/StateNotice';

import type { DraftDayTab, DraftPin, DraftView } from '../model/draftView';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { timeBandLabel } from '../model/timeBandLabel';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  CheckCircleGlyph,
  InfoCircleGlyph,
  LockGlyph,
} from './ItineraryGlyphs';

/**
 * h11 [완전AI] AI 추천안 초안 — Figma `1870:1083`.
 *
 * 이 화면의 존재 이유는 **표시 정책 하나**다: 같은 응답을 두고 고정이 아닌 슬롯은 시각을
 * 감추고(INV-U3-07 · DEC-U3-3) 고정 블록만 예외로 시각을 보인다(BR-U3-07). 초안 시각은
 * 슬롯이 교체될 때마다 흔들려 신뢰를 깎으므로, 값이 있어도 그리지 않는다.
 *
 * 화면은 완성된 값만 받는다 — 조회도 판정도 하지 않는다. 선택된 날의 슬롯을 `days` 에서
 * 고르는 것은 규칙 판정이 아니라 키 조회다(정렬·번호·좌표 거르기는 전부 model 몫).
 *
 * **Figma 보다 짧다** — 추천 강도 세그먼트(요청 바디에 파라미터가 없다) · `다른 후보 N`
 * (개수를 알려면 슬롯마다 별도 POST)는 이번 범위 밖이라 정직한 스텁조차 그리지 않는다
 * (TRIP-483 이연). 우상단 `직접 고르기`·하단 `처음부터 직접`은 수동 짜기 라우트로 배선됐다
 * (`onManualPlan`). 시간대 라벨의 성격 축(`· 활동`)은 매핑 정본이 없어 시간 축만 낸다(01b D4).
 */

const SCREEN_TITLE = 'AI 추천안';
/** h11→h25 완성 CTA 라벨. Figma 하단 2버튼 정합으로 `이 일정으로 완성`→`이대로 확정`(TRIP-483). */
const COMPLETE_LABEL = '이대로 확정';
/** 하단 좌측 secondary 버튼 · 우상단 링크 라벨 — 둘 다 수동 짜기 라우트로 간다(TRIP-483 AC-4). */
const MANUAL_LABEL = '처음부터 직접';
const PICK_MANUAL_LABEL = '직접 고르기';
const REASON_TITLE = '취향·거리로 채운 추천안이에요';
/** reason 블록 부제(정적 · 상태 비의존 — YAGNI). Figma "바꾸는 중"은 상호작용 중 캡처라 정지
 * 배너엔 부적합해 티켓 의도 문구로 둔다(01b 결정 5 · em-dash `—`). */
const REASON_SUBTITLE = '슬롯 하나만 다른 후보로 바꿔도 좋고 — 나머지는 그대로';
/** 초안을 새로 생성한다(POST 재호출). 확정된 일정에서는 확정이 풀리므로 비활성이다. */
const RETRY_LABEL = '다시 만들기';
const AI_BADGE = 'AI 추천';
const FIXED_CHIP = '고정';
/** 비고정 슬롯의 교체 트리거 라벨. h24 `ItineraryEditScreen.ALT_LABEL` 과 같은 값 —
 * 카운트를 안 붙인다(후보 수는 슬롯별 POST 조회 뒤에만 알아 pre-fetch 불가, 01b Q3). */
const ALT_LABEL = '다른 후보 ›';
/** 고정 블록만 예외로 여는 시각 줄. 앞 5자(`HH:mm`)만 쓴다 — 절삭 규칙은 01b D5. */
const FIXED_NOTE_SUFFIX = ' 도착 · 변경 불가';

/** 목록 곁에 덧붙는 한 줄이지 얼굴이 아니다 — 받은 것은 그대로 살아 있다.
 * **원인을 특정하지 않는다**: 여기로 오는 사건이 여러 가지다(여행 정보 조회 실패 · 일정
 * 조회 실패 · 2차 생성 실패 · 재생성 실패 · 폴링 상한 도달). 한 원인을 문구에 박으면 나머지
 * 경우에 **틀린 이유**를 말하게 된다. */
const STALE_FAILED_NOTE = '일부 정보를 불러오지 못했어요';
// 폴백·강등 배너(deterministic·minimal·demoted)는 TRIP-791 로 전용 인터스티셜
// (GenerationFallbackScreen)으로 승격돼 이 화면에서 소멸했다 — 이 화면은 이제 목록만 남는다.
// 판정(resolveFallbackNotice)·라우팅은 DraftPage 가, 그림은 인터스티셜 화면이 진다(01b D1·D2).

const EMPTY_TITLE = '아직 만들어진 추천안이 없어요';
const EMPTY_NOTE = `위 ${RETRY_LABEL}를 누르면 AI가 일정을 짜요`;
const FAILED_TITLE = '추천안을 불러오지 못했어요';
const FAILED_NOTE = '네트워크를 확인하고 다시 시도해주세요';

// 카드 그림자(Figma `0px 2px 5px rgba(0,0,0,0.06)`). RN 은 box-shadow 가 없어 스타일
// 프로퍼티로 옮긴다 — 그림자는 토큰 대상이 아니다.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;

export interface DraftScreenProps {
  view: DraftView;
  /** 여행 기간 전체 — 데이터가 아직 안 온 날짜도 비활성으로 들어 있다. */
  tabs: DraftDayTab[];
  selectedDate: string;
  /** 선택 날짜의 핀. 좌표 없는 슬롯은 이미 걸러져 있고 번호는 카드 번호 그대로다. */
  pins: DraftPin[];
  dayHeader: string;
  canRetry: boolean;
  onSelectDay: (date: string) => void;
  onRetry: () => void;
  onBack: () => void;
  /** h25(완성 일정)로 가는 완성 CTA 콜백. 화면은 목적지를 모르고 이 콜백만 부른다 — 배선은
   * `DraftPage` 몫이다(TRIP-454 AC-5). `listed` 얼굴(PARTIAL 생성 중 포함) 하단에만 뜬다. */
  onComplete?: () => void;
  /** 비고정 슬롯의 "다른 후보 ›" 를 누르면 그 슬롯 slotKey 로 부르는 콜백(TRIP-467→483). 화면은
   * 어느 패널을 어떻게 여는지 모르고 이 콜백만 부른다 — 패널 토글·`SlotCandidatePanelContainer`
   * 마운트는 `DraftPage` 몫이다. **미배선이면 트리거를 아예 안 그린다**(후방호환 gated — 기본
   * 미배선=트리거 0이라 동결 화면 테스트·프리뷰 동작 불변). */
  onPressSlot?: (slotKey: string) => void;
  /** 어느 슬롯의 교체 패널이 펼쳐졌나(=그 slotKey). null/미지정=닫힘. 화면은 이 값과 일치하는
   * 카드 아래에만 패널을 그린다 — 위치만 알고, 무엇을 그리나는 `renderSlotPanel` 배선 몫이다. */
  expandedSlotKey?: string | null;
  /** 펼친 슬롯 아래에 그릴 패널을 조립해 주는 배선 함수(`DraftPage` 공급). 화면은 **매칭 카드
   * slotKey 로만** 이걸 부른다(패널 조립은 배선, 화면은 자리). */
  renderSlotPanel?: (slotKey: string) => ReactNode;
  /** 「처음부터 직접」(하단)·「직접 고르기」(우상단) 공통 콜백 — 둘 다 수동 짜기 라우트로 간다.
   * 미배선이면 두 어포던스를 아예 안 그린다(후방호환 gated · 死버튼 회피). */
  onManualPlan?: () => void;
}

function DayTab({
  tab,
  selected,
  onSelectDay,
}: {
  tab: DraftDayTab;
  selected: boolean;
  onSelectDay: (date: string) => void;
}): ReactElement {
  // `disabled` 를 실제로 걸어야 한다 — 회색으로 칠하기만 하면 눌려서 빈 날짜로 전환된다.
  return (
    <Pressable
      testID={`itinerary-draft-day-${tab.dayNumber}`}
      accessibilityRole="button"
      disabled={!tab.hasData}
      onPress={() => onSelectDay(tab.date)}
      className={`flex-row items-center rounded-pill px-md py-[5px] ${
        selected
          ? 'bg-primary-pale'
          : `border ${tab.hasData ? 'border-hairline-strong' : 'border-hairline'}`
      }`}
    >
      <Text
        className={`text-label ${
          selected
            ? 'font-noto-bold font-bold text-primary-text'
            : `font-noto ${tab.hasData ? 'text-body' : 'text-muted-soft'}`
        }`}
      >
        {`${tab.dayNumber}일차`}
      </Text>
    </Pressable>
  );
}

/**
 * 카드 한 장. 서버가 안 준 것은 **요소 자체를 그리지 않는다** — 기본 이미지·플레이스홀더
 * 문구를 지어내면 사용자는 그것이 서버가 준 값인지 구별할 수 없다(INV-1 · TRIP-219).
 */
function DraftSlotCard({
  slot,
  date,
  index,
  onPressSlot,
}: {
  slot: ItineraryDaysItemSlotsItem;
  date: string;
  index: number;
  onPressSlot?: (slotKey: string) => void;
}): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  const tagText =
    slot.tags.length > 0 ? slot.tags.map((tag) => `#${tag}`).join(' · ') : null;
  const distance = slot.distanceRange ?? null;

  return (
    <View
      testID={`itinerary-draft-slot-${slotKey}`}
      style={cardShadow}
      className="w-full flex-row items-center gap-md rounded-[14px] border border-hairline bg-canvas py-[10px] pl-[10px] pr-md"
    >
      <View className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-primary">
        <Text
          testID={`itinerary-draft-slot-no-${slotKey}`}
          className="font-inter-bold text-label font-bold text-on-primary"
        >
          {String(index + 1)}
        </Text>
      </View>

      {slot.imageUrl === null || slot.imageUrl === undefined ? null : (
        <View
          testID={`itinerary-draft-slot-image-${slotKey}`}
          className="h-[78px] w-[78px] overflow-hidden rounded-thumb bg-surface-strong"
        >
          <Image
            source={{ uri: slot.imageUrl }}
            resizeMode="cover"
            className="h-full w-full"
          />
        </View>
      )}

      <View className="flex-1 items-start gap-[3px]">
        <View className="flex-row items-center gap-[6px]">
          <Text
            testID={`itinerary-draft-slot-band-${slotKey}`}
            className="font-noto text-caption text-muted"
          >
            {timeBandLabel(slot.startAt)}
          </Text>
          {slot.isFixed ? null : (
            <View
              testID={`itinerary-draft-slot-badge-${slotKey}`}
              className="flex-row items-center justify-center rounded-pill bg-primary-pale px-[7px] py-[2px]"
            >
              <Text className="font-noto-bold text-micro font-bold text-primary-text">
                {AI_BADGE}
              </Text>
            </View>
          )}
        </View>

        {slot.nameKo === null || slot.nameKo === undefined ? null : (
          <Text
            testID={`itinerary-draft-slot-name-${slotKey}`}
            numberOfLines={1}
            className="font-noto-bold text-card-title font-bold text-ink"
          >
            {slot.nameKo}
          </Text>
        )}

        {slot.isFixed ? (
          <Text
            testID={`itinerary-draft-slot-fixed-${slotKey}`}
            className="font-noto text-caption text-muted"
          >
            {`${slot.startAt.slice(0, 5)}${FIXED_NOTE_SUFFIX}`}
          </Text>
        ) : tagText === null && distance === null ? null : (
          <Text numberOfLines={1} className="font-noto text-caption text-muted">
            {tagText === null ? null : (
              <Text testID={`itinerary-draft-slot-tags-${slotKey}`}>
                {tagText}
              </Text>
            )}
            {tagText !== null && distance !== null ? ' · ' : null}
            {distance}
          </Text>
        )}

        {/* 슬롯 교체 트리거 — 비고정 슬롯에만, 그리고 배선(`onPressSlot`)이 있을 때만 그린다.
            고정(숙소 앵커)엔 안 그려 교체 대상에서 뺀다(Q1 · INV). testID 는 카드 접두
            `itinerary-draft-slot-` **밖**이라 카드 개수 셀렉터에 오계수되지 않는다(02a 함정①). */}
        {slot.isFixed || onPressSlot === undefined ? null : (
          <Pressable
            testID={`itinerary-draft-alt-${slotKey}`}
            accessibilityRole="button"
            onPress={() => onPressSlot(slotKey)}
            hitSlop={6}
            className="self-start pt-[2px]"
          >
            <Text className="font-noto-bold text-caption font-bold text-primary-text">
              {ALT_LABEL}
            </Text>
          </Pressable>
        )}
      </View>

      {slot.isFixed ? (
        <View className="flex-row items-center justify-center gap-xs rounded-pill bg-primary-pale py-xs pl-sm pr-[10px]">
          <LockGlyph />
          <Text className="font-noto-bold text-caption font-bold text-primary-text">
            {FIXED_CHIP}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** 도착 전 자리표시. **글자를 넣지 않는다** — "아직 없어요" 를 미리 그리면 곧 도착할
 * 사용자에게 한 순간 거짓말을 하게 된다(`MustVisitPickerScreen` 선례). */
function LoadingFace(): ReactElement {
  return (
    <View
      testID="itinerary-draft-loading"
      className="w-full gap-md"
      accessibilityLabel="추천안을 만드는 중"
    >
      {[0, 1, 2].map((row) => (
        <View
          key={row}
          className="h-[98px] w-full rounded-[14px] bg-surface-soft"
        />
      ))}
    </View>
  );
}

export function DraftScreen({
  view,
  tabs,
  selectedDate,
  pins,
  dayHeader,
  canRetry,
  onSelectDay,
  onRetry,
  onBack,
  onComplete,
  onPressSlot,
  expandedSlotKey,
  renderSlotPanel,
  onManualPlan,
}: DraftScreenProps): ReactElement {
  // PARTIAL(2단계 생성 중) 얼굴은 이제 DraftPage 가 공용 지도+시트 셸로 그린다(TRIP-790 · D1) —
  // 이 화면은 view.generating 을 읽지 않고 listed 얼굴만 그린다(완성 CTA 는 그대로 · C16 무회귀).
  const slots =
    view.kind === 'listed'
      ? (view.days.find((day) => day.date === selectedDate)?.slots ?? [])
      : [];

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] bg-canvas pb-md pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-draft-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[19px] font-bold text-ink">
            {SCREEN_TITLE}
          </Text>
          <View className="flex-1" />
          {/* 우상단 「직접 고르기」 — 수동 짜기로 나가는 링크(gated · TRIP-483 AC-4). 재생성
              「다시 만들기」는 별개 어포던스라 나란히 공존한다(무회귀 · INV-4). */}
          {onManualPlan === undefined ? null : (
            <Pressable
              testID="itinerary-draft-pick-manual"
              accessibilityRole="button"
              onPress={onManualPlan}
              hitSlop={8}
            >
              <Text className="font-noto text-body text-muted">
                {PICK_MANUAL_LABEL}
              </Text>
            </Pressable>
          )}
          <Pressable
            testID="itinerary-draft-retry"
            accessibilityRole="button"
            disabled={!canRetry}
            onPress={onRetry}
            hitSlop={8}
          >
            <Text
              className={`font-noto text-body ${
                canRetry ? 'text-muted' : 'text-muted-soft'
              }`}
            >
              {RETRY_LABEL}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-[14px] px-lg pb-lg pt-md">
          {view.kind === 'listed' && view.staleFailed ? (
            <View
              testID="itinerary-draft-stale-failed"
              className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-md py-md"
            >
              <AlertCircleGlyph />
              <Text className="flex-1 font-noto text-label text-body">
                {STALE_FAILED_NOTE}
              </Text>
            </View>
          ) : null}

          <View className="w-full flex-row items-start gap-[10px]">
            <CheckCircleGlyph />
            <View className="flex-1 gap-[3px]">
              <Text className="font-noto-bold text-body font-bold text-ink">
                {REASON_TITLE}
              </Text>
              {/* 부제는 슬롯 교체를 권하는 행동 유도 문구라 바꿀 슬롯이 실재하는
                  `listed` 얼굴에서만 뜬다 — loading·failed·empty(슬롯 0건)에선 감춘다
                  (제목은 이 티켓 이전부터 무조건 렌더라 그대로 둔다 · 03b 참고-1). */}
              {view.kind === 'listed' ? (
                <Text
                  testID="itinerary-draft-reason-subtitle"
                  className="font-noto text-caption text-muted"
                >
                  {REASON_SUBTITLE}
                </Text>
              ) : null}
            </View>
          </View>

          {pins.length === 0 ? null : (
            <View className="h-[230px] w-full overflow-hidden rounded-card border border-hairline">
              <MapView
                center={{ lat: pins[0].lat, lng: pins[0].lng }}
                pins={pins}
                viewOnly
              />
            </View>
          )}

          {tabs.length === 0 ? null : (
            <View className="flex-row gap-sm">
              {tabs.map((tab) => (
                <DayTab
                  key={tab.date}
                  tab={tab}
                  selected={tab.date === selectedDate}
                  onSelectDay={onSelectDay}
                />
              ))}
            </View>
          )}

          {view.kind === 'loading' ? <LoadingFace /> : null}

          {view.kind === 'failed' ? (
            <StateNotice
              testID="itinerary-draft-failed"
              icon={<AlertCircleGlyph size={32} tone="primaryText" />}
              title={FAILED_TITLE}
              description={FAILED_NOTE}
              actions={[]}
            />
          ) : null}

          {view.kind === 'empty' ? (
            <StateNotice
              testID="itinerary-draft-empty"
              dashed
              icon={<InfoCircleGlyph size={32} tone="primaryText" />}
              title={EMPTY_TITLE}
              description={EMPTY_NOTE}
              actions={[]}
            />
          ) : null}

          {view.kind === 'listed' ? (
            <>
              <View className="w-full flex-row items-center gap-sm pt-[6px]">
                <View className="h-[18px] w-[4px] rounded-[2px] bg-primary" />
                <Text className="font-noto text-label text-muted">
                  {dayHeader}
                </Text>
                <View className="flex-1" />
                <Text className="font-noto text-label text-muted">
                  {`${slots.length}곳`}
                </Text>
              </View>
              {slots.map((slot, index) => {
                // 패널은 이 카드 **바로 아래** 스크롤 흐름에 인라인으로 삽입된다(바텀시트 아님).
                // 펼친 슬롯 하나만(expandedSlotKey 일치) 그리고, 무엇을 그리나는 배선(renderSlotPanel)
                // 몫이라 화면은 "어느 카드 자리인가"만 안다(TRIP-483 · ★B).
                const slotKey = buildSlotKey(selectedDate, slot.poiId);
                return (
                  <Fragment key={slotKey}>
                    <DraftSlotCard
                      slot={slot}
                      date={selectedDate}
                      index={index}
                      onPressSlot={onPressSlot}
                    />
                    {expandedSlotKey === slotKey &&
                    renderSlotPanel !== undefined
                      ? renderSlotPanel(slotKey)
                      : null}
                  </Fragment>
                );
              })}
            </>
          ) : null}

          {/* 하단 2버튼(TRIP-483 · 스크롤 흐름의 마지막 자식이지 고정 바 아님 · `MustVisitPickerScreen`
              ctaPrimary 선례). 우 완성 CTA 는 `listed` 얼굴에만 뜨고(PARTIAL 생성 중 포함) CONFIRMED 면
              잠긴다 — 재시도+완성 공용 확정 가드(canRetry=status!==CONFIRMED). PARTIAL 은 status 가
              PLANNED 라 canRetry=true 로 활성 유지(생성 중은 막지 않는다). disabled 가 press 가드다 —
              회색만 칠하면 responder 가 살아 눌린다(retry·confirm-cta 선례 · TRIP-466). */}
          {view.kind === 'listed' ? (
            <View className="w-full flex-row gap-[10px]">
              {/* 좌 secondary 「처음부터 직접」 — 수동 짜기 라우트(gated · TRIP-483 AC-4). 미배선이면
                  안 그려 완성 CTA 하나만 남는다(동결 화면 테스트·프리뷰 무회귀). */}
              {onManualPlan === undefined ? null : (
                <Pressable
                  testID="itinerary-draft-manual"
                  accessibilityRole="button"
                  onPress={onManualPlan}
                  className="flex-1 items-center justify-center rounded-button border border-hairline-strong py-lg"
                >
                  <Text className="font-noto-bold text-[16px] font-bold text-ink">
                    {MANUAL_LABEL}
                  </Text>
                </Pressable>
              )}
              <Pressable
                testID="itinerary-draft-complete"
                accessibilityRole="button"
                disabled={!canRetry}
                onPress={onComplete}
                className={`flex-1 items-center justify-center rounded-button py-lg ${
                  canRetry ? 'bg-primary' : 'bg-hairline-strong'
                }`}
              >
                <Text
                  className={`font-noto-bold text-[16px] font-bold ${
                    canRetry ? 'text-on-primary' : 'text-muted-soft'
                  }`}
                >
                  {COMPLETE_LABEL}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
