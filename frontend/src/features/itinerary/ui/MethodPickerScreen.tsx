import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BackChevronGlyph,
  ChevronRightGlyph,
  CoPickGlyph,
  FullAiGlyph,
  ManualGlyph,
} from './ItineraryGlyphs';

/**
 * h04 시작 방법 — Figma `1903:1083`. 세 방식(완전 AI · AI와 같이 · 직접) 중 하나를 고른다.
 *
 * 화면은 **완성된 콜백만** 받는다 — 조회도 게이트 판정도 하지 않는다. 완전AI 탭은 배선의
 * `onPressFullAi`(h09 생성 중으로 navigate)로 넘긴다 — 생성 POST·진행/실패 표면은 h09 가 소유하므로
 * (TRIP-305·AC-7) 이 화면에는 없다. 여기서 지는 유일한 로컬 상태는 준비 중 안내(`soon`) 뿐 —
 * copick·manual 은 착지 화면이 아직 없어(01b D2·D3) 서버 효과·라우팅 없이 이 상태만 켠다.
 * 생성 선행조건(거점 커버리지·겹침) 게이트도 이 칸에 없다 — g02(여행 생성 2/2)가 소유한다.
 */

const SCREEN_TITLE = '일정 만들기';
const HEADING = '어떻게 만들까요?';
const SUBTITLE = '설정한 취향·거리는 세 방법 모두에 적용돼요';
const SWITCH_NOTE = '세 방법은 언제든 서로 전환할 수 있어요';
const BADGE_LABEL = '추천';
const SOON_LABEL = '준비 중이에요 — 곧 만나요';

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
  badge?: ReactNode;
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
  badge,
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
        <View className="flex-row items-center gap-sm">
          <Text className="font-noto-bold text-[16px] font-bold text-ink">
            {title}
          </Text>
          {badge}
        </View>
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

export interface MethodPickerScreenProps {
  onBack: () => void;
  /** 완전AI 탭 — 배선이 h09(생성 중)로 navigate 한다(POST 는 h09 소유). */
  onPressFullAi: () => void;
  /** 직접 짜기 탭 — 배선이 h19(빈 일정)로 navigate 한다(TRIP-460). 미전달 시 "준비 중" 폴백
   * (후방호환 옵셔널 — `confirmLocked?`·`saveError?` 선례. 프리뷰는 폴백을 그대로 쓴다). */
  onPressManual?: () => void;
  /** 진행 중인 다른 여행이 있으면(서버 판정면) 생성 진입을 막고 사유를 표시한다. null/미전달 = 미차단. */
  activeGeneration?: ActiveGeneration | null;
  /** 사유 안내의 "진행 중인 여행으로 가기". */
  onPressActiveGeneration?: () => void;
}

export function MethodPickerScreen({
  onBack,
  onPressFullAi,
  onPressManual,
  activeGeneration,
  onPressActiveGeneration,
}: MethodPickerScreenProps): ReactElement {
  const [soon, setSoon] = useState(false);
  const showSoon = () => setSoon(true);
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
        </View>

        <ScrollView contentContainerClassName="gap-[14px] px-lg pb-2xl pt-[10px]">
          <View className="w-full gap-[6px] pb-[6px]">
            <Text className="font-noto-bold text-[24px] font-bold text-ink">
              {HEADING}
            </Text>
            <Text className="font-noto text-label text-muted">{SUBTITLE}</Text>
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
            badge={
              <View
                testID="itinerary-method-copick-badge"
                className="flex-row items-center rounded-pill bg-primary-pale px-sm py-[3px]"
              >
                <Text className="font-noto-bold text-micro font-bold text-primary-text">
                  {BADGE_LABEL}
                </Text>
              </View>
            }
            onPress={showSoon}
          />
          <MethodCard
            testID="itinerary-method-manual"
            icon={<ManualGlyph />}
            iconBg="bg-surface-strong"
            title="직접 짜기"
            description="빈 일정에 원하는 장소를 직접 추가"
            onPress={onPressManual ?? showSoon}
          />

          {soon ? (
            <View
              testID="itinerary-method-soon"
              className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-lg py-md"
            >
              <Text className="font-noto text-label text-muted">
                {SOON_LABEL}
              </Text>
            </View>
          ) : null}

          <Text className="w-full text-center font-noto text-[12.5px] text-muted-soft">
            {SWITCH_NOTE}
          </Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
