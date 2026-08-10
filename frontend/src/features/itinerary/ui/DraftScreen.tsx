import type { ReactElement } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import { KakaoMapView } from '@/shared/map';
import { StateNotice } from '@/shared/ui/StateNotice';

import type { DraftDayTab, DraftPin, DraftView } from '../model/draftView';
import { buildSlotKey } from '../model/slotKey';
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
 * (개수를 알려면 슬롯마다 별도 POST) · 우상단 `직접 고르기`(CO_PLAN 화면 부재)는 이번
 * 범위 밖이라 정직한 스텁조차 그리지 않는다. 시간대 라벨의 성격 축(`· 활동`)도 매핑 정본이
 * 없어 시간 축만 낸다(01b D4).
 */

const SCREEN_TITLE = 'AI 추천안';
const REASON_TITLE = '취향·거리로 채운 추천안이에요';
/** 초안을 새로 생성한다(POST 재호출). 확정된 일정에서는 확정이 풀리므로 비활성이다. */
const RETRY_LABEL = '다시 만들기';
const AI_BADGE = 'AI 추천';
const FIXED_CHIP = '고정';
/** 고정 블록만 예외로 여는 시각 줄. 앞 5자(`HH:mm`)만 쓴다 — 절삭 규칙은 01b D5. */
const FIXED_NOTE_SUFFIX = ' 도착 · 변경 불가';

/** 목록 곁에 덧붙는 한 줄이지 얼굴이 아니다 — 받은 것은 그대로 살아 있다.
 * **원인을 특정하지 않는다**: 여기로 오는 사건이 여러 가지다(여행 정보 조회 실패 · 일정
 * 조회 실패 · 2차 생성 실패 · 재생성 실패 · 폴링 상한 도달). 한 원인을 문구에 박으면 나머지
 * 경우에 **틀린 이유**를 말하게 된다. */
const STALE_FAILED_NOTE = '일부 정보를 불러오지 못했어요';
/** 후보 강등 안내(BR-U3-11 · TRIP-298). 위 `STALE_FAILED_NOTE` 와 같은 성격 — 목록 곁에
 * 붙는 한 줄이지 얼굴이 아니다.
 *
 * **개수를 말하지 않는다.** 계약의 `poolSize` 는 AI 가 안 주면 없는 값이라 `?? 0` 으로 채우면
 * "모른다"가 "후보 0건"이라는 **다른 사건**으로 바뀐다(openapi 원문의 경고). 이번 표면에는
 * 개수 자리 자체를 두지 않는다. 시각·소요시간 어휘도 쓰지 않는다(INV-3 · BR-U3-10). */
const DEMOTED_NOTE = '조건에 맞는 후보가 적어 일부 추천이 빠졌어요';
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
  /** 후보 강등 안내를 켤 것인가. **판정은 model 몫**이고 화면은 결과만 받는다.
   * 미지정(기본 false)이 당분간의 정상 경로다 — 서버가 요약을 아직 안 준다. */
  demoted?: boolean;
  onSelectDay: (date: string) => void;
  onRetry: () => void;
  onBack: () => void;
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
}: {
  slot: ItineraryDaysItemSlotsItem;
  date: string;
  index: number;
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
  demoted = false,
  onSelectDay,
  onRetry,
  onBack,
}: DraftScreenProps): ReactElement {
  const slots =
    view.kind === 'listed'
      ? (view.days.find((day) => day.date === selectedDate)?.slots ?? [])
      : [];

  /**
   * 지도를 다시 태어나게 하는 열쇠. **날짜만으로는 부족하다** — 같은 날짜를 보는 채로
   * 재생성하면 핀이 통째로 바뀌는데 열쇠가 그대로라 지도가 옛 핀을 든 채 남는다(그 컴포넌트는
   * 마운트할 때 문서를 한 번만 조립한다). 그래서 **그날 그릴 핀 묶음까지** 열쇠에 넣는다.
   *
   * 매 렌더마다 문자열을 새로 만들어도 안전하다 — React 는 `key` 를 **값으로** 비교하므로
   * 내용이 같으면 같은 열쇠이고 다시 태어나지 않는다(객체였다면 매번 remount 됐을 것이다).
   */
  const mapKey = `${selectedDate}|${JSON.stringify(pins)}`;

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

          {/* 얼굴과 무관하게 뜬다 — 강등은 "무엇을 보여줄까"가 아니라 "받은 것에 무엇이
              빠졌나"라서, 목록이 그대로 있는 채로 곁에 붙는다(01b D5 4행 · D6). */}
          {demoted ? (
            <View
              testID="itinerary-draft-fallback-banner"
              className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-md py-md"
            >
              <InfoCircleGlyph />
              <Text className="flex-1 font-noto text-label text-body">
                {DEMOTED_NOTE}
              </Text>
            </View>
          ) : null}

          <View className="w-full flex-row items-start gap-[10px]">
            <CheckCircleGlyph />
            <Text className="flex-1 font-noto-bold text-body font-bold text-ink">
              {REASON_TITLE}
            </Text>
          </View>

          {pins.length === 0 ? null : (
            <View className="h-[230px] w-full overflow-hidden rounded-card border border-hairline">
              {/* `KakaoMapView` 는 마운트 시 한 번만 문서를 조립한다(그 컴포넌트의 동결
                  계약) — 다른 핀을 그리는 유일한 수단이 key remount 다. */}
              <KakaoMapView
                key={mapKey}
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
              {slots.map((slot, index) => (
                <DraftSlotCard
                  key={buildSlotKey(selectedDate, slot.poiId)}
                  slot={slot}
                  date={selectedDate}
                  index={index}
                />
              ))}
            </>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
