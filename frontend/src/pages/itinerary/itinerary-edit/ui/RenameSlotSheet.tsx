import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '@/shared/ui/Button';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { COLOR_TOKENS } from '@/shared/config';
import { PoiCategory } from '@/shared/api/index.schemas';
import { respectPressGuard } from '@/shared/lib/pressGuard';
import { CloseGlyph } from '@/shared/ui/glyphs';

/**
 * TRIP-1795 · 「이름·분류 고치기」 시트(Figma `5225:4083`) — 이 여행에서만 쓰는 장소 이름·분류를 고른다. 장소 시트(`MoveDaySheet`)를 **대신해**
 * 열리고(페이지가 교체), 확정 라벨은 Figma 의 `저장하기` 가 아니라 `적용`이다 — 서버 저장은 `일정 저장하기` 뿐이고 이 버튼은 편집 드래프트에만
 * 반영한다(같은 드래프트 반영인 시각 시트가 이미 `적용`).
 *
 * 이름 입력은 현재 표시 이름으로 시작하고, 분류 칩은 서버 닫힌 10종(`PoiCategory` 생성 상수 순서·값 그대로 라벨, 줄바꿈)이며 현재 분류만 선택 표식이다.
 * 분류를 못 고치는 장소(숙소 등 — `categoryEditable=false`)는 칩이 없다. 공백뿐·60 코드포인트 초과면 `적용`이 비활성이고 안내 한 줄이 뜬다
 * (서버가 60자를 코드포인트로 세므로 `[...s].length` — 이모지 한 글자는 1). `원래대로`는 덮어쓴 게 있을 때만 켜진다.
 * 닫기(X·딤·끌어내림)는 전부 `onClose` — 아무것도 알리지 않는다.
 * 칩·`원래대로`·`적용`·X 는 연타 창을 따른다 — 「이름·분류 고치기」 연타의 둘째 탭이 올라오는 시트의 분류를 바꾸지 않게(통합 QA D3).
 *
 * ★ 입력은 반드시 `BottomSheetTextInput`(시트 밖에서 그리면 실기 throw). 시트 실제 열림·딤·키보드 밀림·칩 줄바꿈은 통과형 목이 못 본다 — 6-b.
 */

/** 서버 `displayName` maxLength(60)의 UX 사본 — 권위는 서버. 단위는 코드포인트. */
const MAX_NAME_LENGTH = 60;
const CATEGORIES = Object.values(PoiCategory);

export interface RenameSlotSheetProps {
  /** 지금 화면에 보이는 이름 — 입력 시드. */
  name: string;
  /** 지금 화면에 보이는 분류(닫힌 10종 밖이면 선택 표식 없음). */
  category: string | null;
  /** 원본 분류가 닫힌 10종일 때만 true — 숙소 등은 이름만 고친다. */
  categoryEditable: boolean;
  /** 이 슬롯에 덮어쓴 값이 있나 — `원래대로` 활성 조건. */
  canReset: boolean;
  onApply: (patch: {
    displayName: string | null;
    displayCategory: PoiCategory | null;
  }) => void;
  onReset: () => void;
  onClose: () => void;
}

function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

const asCategory = (value: string | null): PoiCategory | null =>
  CATEGORIES.find((candidate) => candidate === value) ?? null;

export function RenameSlotSheet({
  name,
  category,
  categoryEditable,
  canReset,
  onApply,
  onReset,
  onClose,
}: RenameSlotSheetProps): ReactElement {
  const [draft, setDraft] = useState(name);
  const [picked, setPicked] = useState<PoiCategory | null>(
    asCategory(category)
  );
  const violation =
    draft.trim() === ''
      ? '이름을 입력해 주세요'
      : // 서버는 앞뒤 공백을 자른 값을 받으므로 길이도 자른 값 기준으로 센다.
        [...draft.trim()].length > MAX_NAME_LENGTH
        ? `이름은 ${MAX_NAME_LENGTH}자까지 쓸 수 있어요`
        : null;

  return (
    // 스와이프·딤 탭 닫힘도 `onClose` 로 알린다 — 안 그러면 시트만 사라지고 페이지의 "열림" 상태가 남는다(MoveDaySheet 선례).
    // `accessible={false}` — gorhom 기본(true)은 시트 안 글자·입력칸을 접근성 트리에서 묶어 낭독기·자동화가 못 찾는다(SheetShell 선례).
    <BottomSheet
      accessible={false}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      keyboardBlurBehavior="restore"
      onClose={onClose}
    >
      <BottomSheetView
        testID="editor-rename-sheet"
        className="w-full gap-lg px-xl pb-[28px] pt-[10px]"
      >
        <View className="w-full flex-row items-center">
          <Text className="flex-1 font-noto-bold text-section font-bold text-ink">
            이름·분류 고치기
          </Text>
          <Pressable
            testID="editor-rename-close"
            accessibilityRole="button"
            accessibilityLabel="닫기"
            onPress={respectPressGuard(onClose)}
            className="h-[44px] w-[44px] items-center justify-center"
          >
            <CloseGlyph size={24} color="ink" />
          </Pressable>
        </View>

        <Text className="font-noto-bold text-label font-bold text-ink">
          이름
        </Text>
        <BottomSheetTextInput
          testID="editor-rename-input"
          accessibilityLabel="이름"
          value={draft}
          // 칸이 내용 따라 는다 — 한 줄 칸(UITextField)은 포커스가 없으면 긴 이름을 두 줄로 접어 잘랐고 접근성 트리에도 안 잡혔다(TRIP-1824).
          multiline
          scrollEnabled={false}
          submitBehavior="blurAndSubmit"
          // 이름에 줄바꿈은 없다 — 붙여넣기로 들어온 줄바꿈은 공백으로.
          onChangeText={(text) =>
            setDraft(text.replace(/[\n\r\v\f\u2028\u2029]+/g, ' '))
          }
          placeholderTextColor={COLOR_TOKENS['muted-soft']}
          // `maxLength` 를 걸지 않는다 — 걸면 초과 입력이 잘려 안내를 띄울 수 없다.
          className="min-h-[48px] w-full rounded-input border border-hairline-strong px-lg py-[13px] font-noto text-card-title text-ink"
        />
        {violation === null ? null : (
          <Text
            testID="editor-rename-error"
            className="font-noto text-caption text-primary-text"
          >
            {violation}
          </Text>
        )}

        {categoryEditable ? (
          <>
            <Text className="font-noto-bold text-label font-bold text-ink">
              분류
            </Text>
            <View className="w-full flex-row flex-wrap gap-sm">
              {CATEGORIES.map((candidate) => {
                const isSelected = candidate === picked;
                return (
                  <Pressable
                    key={candidate}
                    testID={`editor-rename-category-${candidate}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={respectPressGuard(() => setPicked(candidate))}
                    className={`rounded-[8px] px-[14px] py-sm ${
                      isSelected ? 'bg-primary-pale' : 'bg-surface-soft'
                    }`}
                  >
                    <Text
                      className={`font-noto-bold text-label font-bold ${
                        isSelected ? 'text-primary' : 'text-body'
                      }`}
                    >
                      {candidate}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Text
          testID="editor-rename-hint"
          className="font-noto text-caption text-muted"
        >
          이 여행에서만 바뀌어요 · 장소 정보 자체는 그대로예요
        </Text>

        <Pressable
          testID="editor-rename-reset"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canReset }}
          disabled={!canReset}
          onPress={respectPressGuard(onReset)}
          className="items-center py-xs"
        >
          <Text
            className={`font-noto-bold text-card-title font-bold ${
              canReset ? 'text-muted' : 'text-muted-soft'
            }`}
          >
            원래대로
          </Text>
        </Pressable>

        <Button
          testID="editor-rename-apply"
          disabled={violation !== null}
          onPress={respectPressGuard(() =>
            onApply({
              displayName: draft.trim(),
              displayCategory: categoryEditable ? picked : null,
            })
          )}
          className="w-full"
        >
          적용
        </Button>
      </BottomSheetView>
    </BottomSheet>
  );
}
