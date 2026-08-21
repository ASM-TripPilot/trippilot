/**
 * TRIP-484 여행 단위 취향 override 시트(g01) — **props만 받는 프레젠테이션**.
 *
 * 상태(열림·선택 초안·카탈로그)는 배선(`TripNewStep1Page`)이 소유하고, 이 컴포넌트는 넘겨받은
 * 옵션·선택·콜백만 그린다. 계정 취향(`preferenceStore`)은 이 흐름 어디에서도 건드리지 않는다 —
 * override는 여행 로컬이다(BR-U1-38 "계정 취향 불변").
 *
 * Figma에 '취향 바꾸기' 프레임이 **없다**(캔버스 전수 스캔 부재). 그래서 문구·레이아웃은
 * 발명값이고, 기존 시트 관례(`TripDateSheet`)를 재해석한다(TRIP-201·182 방침 — 새 프레임을
 * 그리지 않는다). 실제 딤·시트 개폐는 `@gorhom/bottom-sheet` 목이 통과형이라 jest가 못 본다 —
 * 6-b 실기 몫(repo-traps 바텀시트 함정).
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

/** 시트 스타일 선택지 — `slug`는 option testID(`trip-wizard-pref-option-{slug}`), `label`은 화면
 * 표시이자 토글 값(이미 한국어 도메인 값이라 스냅숏·칩에 그대로 실린다). */
export interface PrefStyleOption {
  slug: string;
  label: string;
}

export interface PrefOverrideSheetProps {
  options: PrefStyleOption[];
  /** 지금 고른 스타일(한국어 값). `null`=아무것도 안 고름(온보딩 `toggleMulti` 규약). */
  selected: readonly string[] | null;
  onToggle: (label: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function PrefOverrideSheet({
  options,
  selected,
  onToggle,
  onConfirm,
  onClose,
}: PrefOverrideSheetProps): ReactElement {
  return (
    <BottomSheet>
      <BottomSheetView testID="trip-wizard-pref-sheet" className="gap-md p-lg">
        <Text className="font-noto-bold text-section font-bold text-ink">
          취향 바꾸기
        </Text>
        <Text className="font-noto text-label text-muted">
          이 여행에만 적용돼요 — 계정 취향은 그대로예요
        </Text>

        <View className="flex-row flex-wrap gap-sm">
          {options.map(({ slug, label }) => {
            const isSelected = selected?.includes(label) ?? false;
            return (
              <Pressable
                key={slug}
                testID={`trip-wizard-pref-option-${slug}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onToggle(label)}
                className={`rounded-pill px-md py-[8px] ${
                  isSelected
                    ? 'border-[1.5px] border-primary bg-primary-pale'
                    : 'border border-hairline bg-canvas'
                }`}
              >
                <Text
                  className={
                    isSelected
                      ? 'text-[13px] font-noto-bold font-bold text-primary-text'
                      : 'text-[13px] font-noto text-body'
                  }
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="flex-row gap-sm pt-xs">
          <Pressable
            testID="trip-wizard-pref-sheet-close"
            accessibilityRole="button"
            onPress={onClose}
            className="flex-1 items-center justify-center rounded-button border border-hairline py-[13px]"
          >
            <Text className="font-noto-medium text-body font-medium text-muted">
              닫기
            </Text>
          </Pressable>
          <Pressable
            testID="trip-wizard-pref-sheet-confirm"
            accessibilityRole="button"
            onPress={onConfirm}
            className="flex-1 items-center justify-center rounded-button bg-primary py-[13px]"
          >
            <Text className="font-noto-bold text-body font-bold text-on-primary">
              적용
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
