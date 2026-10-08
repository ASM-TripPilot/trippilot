import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CloseGlyph } from '@/features/itinerary/index.view';
import { DoneCheckGlyph } from './GenerationDoneBarGlyphs';

/**
 * TRIP-788 · AC-7 — 완료 도킹 배너(prop-driven, 소비처가 이 page 하나라 TRIP-1143 에 widgets 에서 이동). BottomTab 위에 뜨는 흰 카드로
 * "{여행명} 일정이 완성됐어요 · 보기"를 그린다. **표시 조건(마지막 확인 이후 완성된 여행 =
 * last-seen 영속)은 범위 밖** — 이 위젯은 여행명 + onPressView 만 받고, 실배선은 후속(이번 소비처는
 * 프리뷰 h05-my-trips-done-bar 뿐).
 *
 * presentation-only(useState 0) · 그림자 없음 border 만(Figma 실측 —
 * 티켓 "그림자"는 어긋남). 체크 색(success)·절대배치·화면 덮음은 jest 사각(6-b 육안).
 */

export interface GenerationDoneBarProps {
  tripName: string;
  onPressView: () => void;
  /** TRIP-1241 — 주면 오른쪽 끝에 ✕ 닫기를 그린다(Figma 미반영 — 디자인 확인 필요). 없으면 기존 모양. */
  onPressClose?: () => void;
  /** TRIP-1297 — true 면 떠 있지 않은(일반 흐름) 모양. 기본은 현행 도킹 모양. */
  inline?: boolean;
}

const DONE_SUFFIX = ' 일정이 완성됐어요';
const VIEW_LABEL = '보기';

export function GenerationDoneBar({
  tripName,
  onPressView,
  onPressClose,
  inline = false,
}: GenerationDoneBarProps): ReactElement {
  return (
    <View
      testID="generation-done-bar"
      className={
        inline
          ? // 폭은 목록 스크롤 칸(px-lg)에 늘어나 카드 열과 맞는다 — 고정 358 을 두면 좁은 기기에서 넘친다.
            'min-h-[52px] flex-row items-center gap-[12px] rounded-card border border-hairline bg-canvas px-lg py-[12px]'
          : 'absolute bottom-[108px] left-[16px] min-h-[52px] w-[358px] flex-row items-center gap-[12px] rounded-card border border-hairline bg-canvas px-lg py-[12px]'
      }
    >
      <DoneCheckGlyph size={20} testID="generation-done-bar-check" />
      <Text
        testID="generation-done-bar-text"
        className="flex-1 font-noto text-card-title leading-[20px] text-ink"
      >
        {`${tripName}${DONE_SUFFIX}`}
      </Text>
      <Pressable
        testID="generation-done-bar-view"
        accessibilityRole="button"
        onPress={onPressView}
      >
        <Text className="font-noto-bold text-card-title font-bold text-primary">
          {VIEW_LABEL}
        </Text>
      </Pressable>
      {onPressClose ? (
        <Pressable
          testID="generation-done-bar-close"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          hitSlop={12}
          onPress={onPressClose}
          className="-my-[12px] -mr-[12px] h-[44px] w-[44px] items-center justify-center"
        >
          <CloseGlyph size={20} />
        </Pressable>
      ) : null}
    </View>
  );
}
