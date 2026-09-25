/**
 * 제휴 고지 시트 — l07 default(Figma 1615:2440) · error(1616:2440) 두 얼굴(TRIP-781 · TRIP-457 ·
 * BR-U1-30 · BR-U1-55).
 *
 * 딥링크 이동 **전** 제휴 고지를 띄우는 법정성 UX. default 는 본문 + 수수료 안내 박스 + "다시 보지 않기"
 * 체크박스 + [취소]/[{OTA명}으로 이동], error 는 이동이 실패했을 때 [취소]/[다시 시도]로 바뀐 얼굴이다.
 * 계약이 단일 OTA(`externalSource`)·단일 최저가만 주므로 default 의 OTA 행은 1개다(01b — l07엔 없지만
 * 결정문대로 유지, 6-b 알려진 차이). **완전 제어 컴포넌트**(useState 0) — 열림·체크·error 상태의 주인은
 * 페이지다(`features/stay/ui`는 구조 가드가 useState를 0건 강제한다). 저장소도 모른다(G6).
 *
 * 실제 시트 열림/딤/슬라이드는 gorhom 목이 통과 컴포넌트라 jest 무심판(6-b 실기).
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { StayItem } from '@/shared/api/generated/schemas';

import { formatPrice } from '@/entities/stay/lib/formatPrice';
import { otaConfirmLabel } from '../config/affiliateNotice';
import {
  CheckGlyph,
  ChevronRightGlyph,
  InfoGlyph,
  WarningTriangleGlyph,
} from './StayGlyphs';

// 법정성 문구(BR-U1-30 → l07 두 문장). 각 문장을 한 Text 노드로 렌더해 오탈자가 완전일치 red 가 되게 한다.
// 가운뎃점은 Figma 원문 그대로 U+00B7.
const BODY =
  '외부 OTA 사이트로 이동하며, 실제 예약·결제는 해당 사이트에서 진행됩니다.';
const NOTICE =
  '이 링크를 통한 예약 시 TripPilot이 제휴 수수료를 받을 수 있습니다 (추가 비용 없음).';

// gorhom 기본 배경(라운드 15)을 Figma r24 로 덮는다(RiskDetailSheet 선례 — 색은 기본 흰 그대로).
const SHEET_BACKGROUND = {
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
} as const;

export interface OtaChoiceSheetProps {
  item: StayItem;
  /** 생략 = 'default'. 'error' 는 이동 실패 뒤의 얼굴(BR-U1-55). */
  variant?: 'default' | 'error';
  dontShowAgain: boolean;
  onToggleDontShowAgain: () => void;
  /** 생략 = true. false 면 "다시 보지 않기"를 그리지 않는다 — 게스트는 저장할 곳이 없다(TRIP-778 D9). */
  showDontShowAgain?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}

function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={0.55}
    />
  );
}

export function OtaChoiceSheet({
  item,
  variant = 'default',
  dontShowAgain,
  onToggleDontShowAgain,
  showDontShowAgain = true,
  onCancel,
  onConfirm,
  onRetry,
}: OtaChoiceSheetProps): ReactElement {
  const isError = variant === 'error';
  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onCancel}
      backdropComponent={renderBackdrop}
      backgroundStyle={SHEET_BACKGROUND}
    >
      <BottomSheetView
        testID="stay-ota-sheet"
        className="w-full gap-lg px-xl pb-2xl pt-sm"
      >
        <Text className="font-noto-bold text-[20px] font-bold text-ink">
          {isError ? '링크를 열 수 없습니다' : '외부 사이트로 이동'}
        </Text>
        <Text className="font-noto text-body leading-[21px] text-body">
          {isError ? '잠시 후 다시 시도하세요.' : BODY}
        </Text>

        {isError ? (
          <View
            testID="stay-ota-error-box"
            className="w-full flex-row items-center gap-[10px] rounded-button border-[1.4px] border-dashed border-hairline-strong p-[14px]"
          >
            <WarningTriangleGlyph size={18} />
            <Text className="flex-1 font-noto text-caption leading-[18px] text-muted">
              외부 링크 URL을 확인할 수 없거나 연결에 실패했습니다.
            </Text>
          </View>
        ) : (
          <>
            {/* 단일 OTA 행 — externalSource 이름 + 최저가(복수 OTA·정확가는 이연, 01b Q2). */}
            <View
              testID={`stay-ota-option-${item.externalSource}`}
              className="w-full flex-row items-center gap-md rounded-[14px] border-[1.5px] border-primary bg-canvas py-md pl-lg pr-md"
            >
              {/* 라디오 = View 조합(SVG 글리프 아님) — 단일 행이라 항상 선택. 선택 관측은 색이
                  아니라 accessibilityState.selected + 채움 inner 존재 두 신호(StayPriceSheet 미러). */}
              <View
                testID={`stay-ota-radio-${item.externalSource}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: true }}
                className="h-[22px] w-[22px] items-center justify-center rounded-pill border-[1.5px] border-primary"
              >
                <View
                  testID={`stay-ota-radio-fill-${item.externalSource}`}
                  className="h-[11px] w-[11px] rounded-pill bg-primary"
                />
              </View>
              <View className="flex-1 flex-row items-center gap-xs">
                <Text className="font-inter-bold text-body font-bold text-ink">
                  {item.externalSource}
                </Text>
                <Text className="font-noto text-label text-muted-soft">·</Text>
                <Text className="font-inter-bold text-body font-bold text-ink">
                  {formatPrice(item.price)}
                </Text>
              </View>
              <ChevronRightGlyph size={18} />
            </View>

            <View
              testID="stay-ota-notice-box"
              className="w-full flex-row items-start gap-[10px] rounded-button bg-surface-soft p-[14px]"
            >
              <InfoGlyph size={18} />
              <Text className="flex-1 font-noto text-caption leading-[18px] text-muted">
                {NOTICE}
              </Text>
            </View>

            {/* 체크 표시는 prop 으로만 — 누름은 콜백만 올린다(TermsScreen 체크박스 모양 선례). */}
            {showDontShowAgain ? (
              <Pressable
                testID="stay-ota-dont-show"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: dontShowAgain }}
                onPress={onToggleDontShowAgain}
                className="flex-row items-center gap-[10px]"
              >
                <View
                  testID="stay-ota-dont-show-box"
                  className={`h-[22px] w-[22px] items-center justify-center rounded-[6px] ${
                    dontShowAgain
                      ? 'bg-primary'
                      : 'border-[1.6px] border-hairline-strong bg-canvas'
                  }`}
                >
                  {dontShowAgain ? <CheckGlyph size={14} /> : null}
                </View>
                <Text className="font-noto text-label text-body">
                  이 안내를 다시 보지 않기
                </Text>
              </Pressable>
            ) : null}
          </>
        )}

        <View className="w-full flex-row gap-[10px]">
          <Pressable
            testID="stay-ota-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="h-[50px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              취소
            </Text>
          </Pressable>
          <Pressable
            testID={isError ? 'stay-ota-retry' : 'stay-ota-confirm'}
            accessibilityRole="button"
            onPress={isError ? onRetry : onConfirm}
            className="h-[50px] flex-1 items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              {isError ? '다시 시도' : otaConfirmLabel(item.externalSource)}
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
