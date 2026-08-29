import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KakaoMapView, type MapCenter } from '@/shared/map';

import { ChecklistDoneGlyph } from './PlanbGlyphs';
import { ReplanSlotRow, type ReplanSlotVM } from './ReplanSlotRow';

/**
 * TRIP-563 · AC-2·AC-3 — i13 AI 재계획안 화면(순수 props+콜백, 라우팅·훅 모름).
 *
 * 세 덩어리를 그린다: ① 헤더 근거(서버 reasons 통과 — 클라 창작 금지, INV-2) ② 지도(재정렬 동선)
 * ③ 슬롯 리스트(주입 VM 만). 하단에 [직접 수정]·[이대로 적용] 두 CTA. **단일 안 하나**(2~3안 선택 UI
 * 없음, BR-U4-20).
 *
 * ★ degrade(AC-3): 슬롯 배열이 비면 헤더 근거·이월 안내만으로 정직하게 degrade한다 — 빈 화면·결함이
 *   아니라 "계약이 못 받치는 슬롯은 아예 안 그린다"의 실현(실 슬롯 바인딩은 ReplanSession.draft 계약
 *   확장 뒤 후속). 일차 스위치·일자 헤더·사진·번호도 draft 계약 공백이라 이번 골격엔 없다.
 * ★ 지도 center 는 계약 공백(originLat/Lng 미바인딩)이라 골격 플레이스홀더 상수로 감싼다 — map 영역
 *   존재만 세우고 실 지도(center 바인딩·타일)는 6-b 실기(선례 ReplanSolvingScreen 고정 66% 동형).
 * ★ 이월 안내는 개수만 노출한다(poiId 원문 비노출, INV-1).
 */

// 골격 플레이스홀더 center(부산 중심) — 실 center 바인딩은 후속(개발로그 후속 후보).
const MAP_CENTER: MapCenter = { lat: 35.1587, lng: 129.1604 };

const APPBAR_TITLE = 'AI 재계획안';
const MANUAL_LINK_LABEL = '직접 고르기';
const MANUAL_LABEL = '직접 수정';
const APPLY_LABEL = '이대로 적용';

export interface ReplanDraftScreenProps {
  reasons: string[];
  slots: ReplanSlotVM[];
  excludedPoiIds: string[];
  onManualEdit: () => void;
  onApply: () => void;
  onPressCandidates: (slotKey: string) => void;
}

export function ReplanDraftScreen({
  reasons,
  slots,
  excludedPoiIds,
  onManualEdit,
  onApply,
  onPressCandidates,
}: ReplanDraftScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        {/* 앱바 — 제목 + 우측 "직접 고르기"(= 직접 수정과 같은 목적지, Figma 상단 링크) */}
        <View className="flex-row items-center justify-between px-lg py-md">
          <Text className="font-noto-bold text-section font-bold text-ink">
            {APPBAR_TITLE}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onManualEdit}
            hitSlop={8}
          >
            <Text className="font-noto text-body text-muted">
              {MANUAL_LINK_LABEL}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-[14px] px-lg pb-2xl pt-sm">
          {/* 헤더 근거 — 서버가 준 근거를 그대로 실어 그린다. 없으면 안 그림(정직 degrade) */}
          {reasons.length > 0 ? (
            <View
              testID="planb-draft-reason"
              className="flex-row items-start gap-sm"
            >
              <ChecklistDoneGlyph size={22} />
              <View className="flex-1 gap-[3px]">
                {reasons.map((reason) => (
                  <Text
                    key={reason}
                    className="font-noto-bold text-body font-bold text-ink"
                  >
                    {reason}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}

          {/* 지도 — 재정렬 동선. center 는 골격 플레이스홀더, 실 지도는 6-b */}
          <View
            testID="planb-draft-map"
            className="h-[230px] w-full overflow-hidden rounded-card border border-hairline"
          >
            <KakaoMapView center={MAP_CENTER} viewOnly />
          </View>

          {/* 이월 안내 — 제외 개수만(BR-U4-25, poiId 원문 비노출 INV-1). 없으면 안 그림 */}
          {excludedPoiIds.length > 0 ? (
            <View
              testID="planb-draft-carryover"
              className="w-full rounded-button bg-surface-soft px-md py-md"
            >
              <Text className="font-noto text-label text-body">
                이번엔 못 넣어 다음으로 미룬 곳 {excludedPoiIds.length}곳이
                있어요
              </Text>
            </View>
          ) : null}

          {/* 슬롯 리스트 — 주입 VM 만. 빈 배열이면 아무 행도 안 그린다(정직 degrade, AC-3) */}
          <View className="gap-md">
            {slots.map((slot) => (
              <ReplanSlotRow
                key={slot.slotKey}
                vm={slot}
                onPressCandidates={onPressCandidates}
              />
            ))}
          </View>
        </ScrollView>

        {/* 하단 CTA — [직접 수정](테두리)·[이대로 적용](primary). 안은 하나뿐(BR-U4-20) */}
        <View className="flex-row gap-sm border-t border-hairline px-lg pb-lg pt-md">
          <Pressable
            testID="planb-draft-manual"
            accessibilityRole="button"
            onPress={onManualEdit}
            className="flex-1 items-center justify-center rounded-button border border-hairline-strong py-[15px]"
          >
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {MANUAL_LABEL}
            </Text>
          </Pressable>
          <Pressable
            testID="planb-draft-apply"
            accessibilityRole="button"
            onPress={onApply}
            className="flex-1 items-center justify-center rounded-button bg-primary py-[15px]"
          >
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              {APPLY_LABEL}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
