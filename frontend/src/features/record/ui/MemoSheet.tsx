import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import { MemoInline } from './MemoInline';
import { CloseGlyph } from './RecordGlyphs';

/**
 * TRIP-1117 · i01 허브 메모 시트(Figma 4741:2833 · 시트 4741:2984) — 순수 바텀시트(props + 콜백만).
 *
 * 허브 [메모]를 누르면 페이지가 이 시트를 허브의 **형제로 조건부 마운트**한다(열림 = 트리에 있음, i03 선례).
 * 입력은 `MemoInline`(blur 저장 · 공백만 무저장 · 2000자) 그대로 — 시트 안이라 `BottomSheetTextInput` 문맥이
 * 선다. ✕·스크림 탭·아래로 끌기 → onClose(초안은 버린다, Q2). 저장·실패 상태는 페이지가 쥔다.
 *
 * 다시 열 때 저장본이 심기는 것은 **새로 마운트**되기 때문이다(MemoInline 은 첫 마운트에만 `text` 를 읽는다).
 * ★ 바텀시트 목 통과형(repo-traps): 딤 전면 커버·키보드 밀어 올림·끌어 닫기는 jest 사각(6-b 실기).
 */

export interface MemoSheetProps {
  /** 관람 중 장소 이름 — 제목 `{placeName} · 메모`. */
  placeName: string;
  /** 세션 저장본(없으면 빈 입력). */
  text?: string | null;
  /** 저장 실패 안내 한 줄(INV-4). 비면 안 그린다. */
  notice?: string | null;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

// gorhom 배경 — canvas(#FFFFFF)·위 라운드 24·위쪽 그림자(Figma 0 -3 16 rgba(0,0,0,.12), i08 자매 값).
// 그림자 토큰이 없어 스타일 객체(RiskDetailSheet 관례). 내용 컨테이너는 overflow:hidden 이라 여기 단다.
const SHEET_BACKGROUND = {
  backgroundColor: '#FFFFFF',
  borderRadius: 0,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: -3 },
  shadowOpacity: 0.12,
  shadowRadius: 16,
  elevation: 8,
} as const;

const MEMO_MAX = 2000;

export function MemoSheet({
  placeName,
  text,
  notice,
  onSubmit,
  onClose,
}: MemoSheetProps): ReactElement {
  // 글자 수 — MemoInline 이 초안을 쥐므로 바뀔 때마다 길이만 받아 둔다. 시작값 = 시드(저장본) 길이.
  const [count, setCount] = useState((text ?? '').length);

  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      // 기본 핸들은 끈다 — grabber 는 아래 본문이 토큰으로 그린다.
      handleComponent={null}
      backgroundStyle={SHEET_BACKGROUND}
      backdropComponent={() => (
        // 목/실라이브러리 모두 backdrop 에 prop 을 안 넘길 수 있어 onClose 를 클로저로 문다(RiskDetailSheet 선례).
        <Pressable
          testID="live-memo-scrim"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          className="absolute inset-0 bg-scrim/40"
        />
      )}
    >
      <BottomSheetView
        testID="live-memo-sheet"
        className="gap-lg rounded-t-sheet-top bg-canvas px-lg pb-2xl pt-xs"
      >
        <View className="h-[4px] w-[40px] self-center rounded-pill bg-hairline-strong" />

        <View className="flex-row items-center justify-between">
          <Text
            testID="live-memo-title"
            numberOfLines={1}
            className="shrink font-noto-bold text-card-title font-bold text-ink"
          >
            {`${placeName} · 메모`}
          </Text>
          {/* 44 터치 타깃 · 아이콘 24(Figma 4741:2993). */}
          <Pressable
            testID="live-memo-close"
            accessibilityRole="button"
            accessibilityLabel="닫기"
            onPress={onClose}
            className="h-[44px] w-[44px] items-center justify-center"
          >
            <CloseGlyph size={24} />
          </Pressable>
        </View>

        {/* 입력 상자 — 배경·테두리는 감싸는 View 에(MemoInline 입력 className 에 bg 를 넣지 않는다). */}
        <View className="h-[140px] justify-between rounded-input border border-hairline-strong bg-surface-soft px-lg py-md">
          <MemoInline
            text={text}
            onSubmit={onSubmit}
            onChangeDraft={(draft) => setCount(draft.length)}
            className="max-h-[96px] p-0 font-noto text-body text-ink"
          />
          <Text
            testID="live-memo-count"
            className="text-right font-noto text-caption text-muted"
          >
            {`${count}/${MEMO_MAX}`}
          </Text>
        </View>

        {notice ? (
          <Text
            testID="live-memo-notice"
            className="font-noto text-caption text-muted"
          >
            {notice}
          </Text>
        ) : null}
      </BottomSheetView>
    </BottomSheet>
  );
}
