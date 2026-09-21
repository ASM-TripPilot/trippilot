import type { ReactElement, ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  METHOD_PROGRESS,
  METHOD_SUBTITLE,
  METHOD_SWITCH_NOTE,
} from '../config/methodPicker';
import {
  BackChevronGlyph,
  ChevronRightGlyph,
  CoPickGlyph,
  FullAiGlyph,
  ManualGlyph,
} from './ItineraryGlyphs';

/**
 * h01 시작 방법 — Figma `3824:2128`. 세 방식(완전 AI · AI와 같이 · 직접) 중 하나를 고른다.
 *
 * 화면은 **완성된 콜백만** 받는다 — 조회도 게이트 판정도 하지 않는다. 세 방식 콜백
 * (`onPressFullAi`·`onPressManual`·`onPressCoPick`)은 전부 필수라 착지 화면은 배선이 소유한다
 * (생성 POST·진행/실패 표면은 h09·h19 각자 소유, TRIP-305·AC-7). 앱바 우측 진행 표시(3 / 4)와
 * 두 안내 문구는 `config/methodPicker` 가 든다. 생성 선행조건(거점 커버리지·겹침) 게이트도 이
 * 칸에 없다 — g02(여행 생성 2/2)가 소유한다.
 */

const SCREEN_TITLE = '일정 만들기';
const HEADING = '어떻게 만들까요?';

// 카드 그림자(Figma `0px 2px 10px rgba(0,0,0,0.06)`). RN 은 box-shadow 가 없어 스타일
// 프로퍼티로 옮긴다. `#000000` 은 raw-hex 가드의 브랜드 팔레트에 없어 그림자 색으로 정당하다
// (`PoiSlotCard.tsx` 선례).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

interface MethodCardProps {
  testID: string;
  icon: ReactNode;
  iconBg: string;
  highlighted?: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  onPress: () => void;
}

function MethodCard({
  testID,
  icon,
  iconBg,
  highlighted = false,
  disabled = false,
  title,
  description,
  onPress,
}: MethodCardProps): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={cardShadow}
      className={`w-full flex-row items-center gap-[14px] rounded-card bg-canvas px-lg py-[18px] ${
        highlighted ? 'border-[1.5px] border-primary' : 'border border-hairline'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <View
        className={`h-12 w-12 items-center justify-center rounded-pill ${iconBg}`}
      >
        {icon}
      </View>
      <View className="min-w-0 flex-1 gap-[4px]">
        <Text className="font-noto-bold text-[16px] font-bold text-ink">
          {title}
        </Text>
        <Text className="font-noto text-label text-muted">{description}</Text>
      </View>
      <ChevronRightGlyph />
    </Pressable>
  );
}

/** 다른 여행의 생성이 진행 중임을 알리는 서버 판정면(선행 BE 칸이 신설). 권한은 서버 — 화면은
 * 스스로 세지 않고 주입받은 이 값만 그린다. */
export interface ActiveGeneration {
  tripId: string;
  label?: string;
}

const BLOCKED_REASON =
  '다른 여행의 일정을 만들고 있어요 — 한 번에 하나만 만들 수 있어요';
const GOTO_ACTIVE_LABEL = '진행 중인 여행으로 가기';

// TRIP-504 재생성 확인 — 문구는 일반형이다. "직접 바꾼 N곳이 사라져요"의 N 을 FE 가 셀 계약이
// 없어(01b 맹점 5) 곳 수를 발명하지 않고 일반 문구로 낮춘다. 리비전 스냅숏은 서버(U3) 책임.
const REGENERATE_TITLE = '기존 일정을 새로 만들어요';
const REGENERATE_BODY =
  'AI와 같이 다시 짜면 지금 일정이 새 초안으로 바뀌어요. 계속할까요?';
const REGENERATE_CONTINUE_LABEL = '계속';
const REGENERATE_CANCEL_LABEL = '취소';

export interface MethodPickerScreenProps {
  onBack: () => void;
  /** 완전AI 탭 — 배선이 h09(생성 중)로 navigate 한다(POST 는 h09 소유). */
  onPressFullAi: () => void;
  /** 직접 짜기 탭 — 배선이 h19(빈 일정)로 navigate 한다(TRIP-460). TRIP-784 로 필수화(soon 폴백 소멸). */
  onPressManual: () => void;
  /** AI와 같이 짜기 탭 — 배선이 CO_PLAN 씨앗(h09 생성 중)으로 navigate 한다(TRIP-462).
   * TRIP-784 로 필수화(soon 폴백 소멸). */
  onPressCoPick: () => void;
  /** 진행 중인 다른 여행이 있으면(서버 판정면) 생성 진입을 막고 사유를 표시한다. null/미전달 = 미차단. */
  activeGeneration?: ActiveGeneration | null;
  /** 사유 안내의 "진행 중인 여행으로 가기". */
  onPressActiveGeneration?: () => void;
  /** TRIP-504 재생성 확인 — 기존 일정이 있을 때 copick 이 곧장 진행하지 않고 이 확인을 먼저 띄운다.
   * 판정(조회로 기존 일정 유무)과 상태는 배선(ItineraryMethodPage)이 쥐고, 화면은 이 세 값으로만
   * 그린다(후방호환 옵셔널 — `onPressManual?`·`activeGeneration?` 선례). 미전달=확인 없음. */
  showRegenerateConfirm?: boolean;
  onRegenerateContinue?: () => void;
  onRegenerateCancel?: () => void;
}

export function MethodPickerScreen({
  onBack,
  onPressFullAi,
  onPressManual,
  onPressCoPick,
  activeGeneration,
  onPressActiveGeneration,
  showRegenerateConfirm = false,
  onRegenerateContinue,
  onRegenerateCancel,
}: MethodPickerScreenProps): ReactElement {
  const blocked = activeGeneration != null;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] bg-canvas py-[14px] pl-md pr-lg">
          <Pressable
            testID="itinerary-method-back"
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
          {/* 진행 표시 — 앱바 우측. 채움/빈 점을 서로 다른 testID 로 세어 SVG 한 장 fill 색만
              바꾼 거짓 통과를 막는다(repo-traps 글리프 fill 사각). 색은 토큰(채움 primary·빈 hairline). */}
          <View className="flex-row items-center gap-sm">
            <View className="flex-row items-center gap-[4px]">
              {Array.from({ length: METHOD_PROGRESS.total }, (_, index) => {
                const filled = index < METHOD_PROGRESS.current;
                return (
                  <View
                    key={index}
                    testID={
                      filled
                        ? 'itinerary-method-progress-dot-filled'
                        : 'itinerary-method-progress-dot-empty'
                    }
                    className={`h-[6px] w-[6px] rounded-pill ${
                      filled ? 'bg-primary' : 'bg-hairline'
                    }`}
                  />
                );
              })}
            </View>
            <Text className="font-noto text-label text-muted">
              {`${METHOD_PROGRESS.current} / ${METHOD_PROGRESS.total}`}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerClassName="gap-[14px] px-lg pb-2xl pt-[10px]">
          <View className="w-full gap-[6px] pb-[6px]">
            <Text className="font-noto-bold text-[24px] font-bold text-ink">
              {HEADING}
            </Text>
            <Text className="font-noto text-label text-muted">
              {METHOD_SUBTITLE}
            </Text>
          </View>

          <MethodCard
            testID="itinerary-method-fullai"
            icon={<FullAiGlyph />}
            iconBg="bg-surface-strong"
            title="완전 AI가 짜기"
            description="취향·동선 맞춰 자동으로 완성"
            disabled={blocked}
            onPress={blocked ? () => {} : onPressFullAi}
          />

          {blocked ? (
            <View
              testID="itinerary-method-blocked-reason"
              className="w-full gap-sm rounded-button border border-hairline bg-surface-soft px-lg py-md"
            >
              <Text className="font-noto text-label text-muted">
                {BLOCKED_REASON}
              </Text>
              <Pressable
                testID="itinerary-method-goto-active"
                accessibilityRole="button"
                onPress={onPressActiveGeneration}
                hitSlop={6}
              >
                <Text className="font-noto-bold text-label font-bold text-primary-text">
                  {GOTO_ACTIVE_LABEL}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <MethodCard
            testID="itinerary-method-copick"
            icon={<CoPickGlyph />}
            iconBg="bg-primary-pale"
            highlighted
            title="AI와 같이 짜기"
            description="AI 추천 위에서 골라가며 완성"
            onPress={onPressCoPick}
          />

          {showRegenerateConfirm ? (
            <View
              testID="itinerary-method-regenerate-confirm"
              className="w-full gap-md rounded-card border border-primary bg-primary-pale px-lg py-lg"
            >
              <Text className="font-noto-bold text-[16px] font-bold text-ink">
                {REGENERATE_TITLE}
              </Text>
              <Text className="font-noto text-label text-body">
                {REGENERATE_BODY}
              </Text>
              <View className="flex-row items-center justify-end gap-sm">
                <Pressable
                  testID="itinerary-method-regenerate-confirm-cancel"
                  accessibilityRole="button"
                  onPress={onRegenerateCancel}
                  className="rounded-button border border-hairline bg-canvas px-lg py-sm"
                  hitSlop={6}
                >
                  <Text className="font-noto-bold text-label font-bold text-muted">
                    {REGENERATE_CANCEL_LABEL}
                  </Text>
                </Pressable>
                <Pressable
                  testID="itinerary-method-regenerate-confirm-continue"
                  accessibilityRole="button"
                  onPress={onRegenerateContinue}
                  className="rounded-button bg-primary px-lg py-sm"
                  hitSlop={6}
                >
                  <Text className="font-noto-bold text-label font-bold text-on-primary">
                    {REGENERATE_CONTINUE_LABEL}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <MethodCard
            testID="itinerary-method-manual"
            icon={<ManualGlyph />}
            iconBg="bg-surface-strong"
            title="직접 짜기"
            description="빈 일정에 원하는 장소를 직접 추가"
            onPress={onPressManual}
          />

          <Text className="w-full text-center font-noto text-[12.5px] text-muted-soft">
            {METHOD_SWITCH_NOTE}
          </Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
