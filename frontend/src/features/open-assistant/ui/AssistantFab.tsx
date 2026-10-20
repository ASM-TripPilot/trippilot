import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable } from 'react-native';

import { useRaisedToastBottom } from '@/shared/ui/Toast';
import { SparkleGlyph } from './AssistantGlyphs';

/**
 * ✦ AI 도우미 FAB(TRIP-1321 · BR-U8-50~53). 56×56 원형, 기존 FAB 스택 맨 위.
 *
 * - **라우팅만 한다** — 누름은 `onPress` 로 올리고 목적지(`assistantHref`)는 페이지가 정한다. 페이지마다
 *   expo-router 를 쓰는 방식(훅/정적 router)이 달라 FAB 가 라우터를 직접 물지 않는다. 도우미 서버 훅은
 *   import 하지 않는다(features 형제 격리 — ESLint 층 zone 이 강제).
 * - `bottom` 을 주면 그 바닥(px)에 우측 16 으로 절대 배치(탭 화면 = `assistantFabBottom`), 없으면 흐름
 *   배치(여행 중 허브 앵커 열 안).
 * - `toastBottom` 을 주면 붙어 있는 동안 토스트 바닥을 그만큼 올린다(BR-U8-52, G-U8-10).
 * - 시트가 열린 동안 숨기는 것(BR-U8-53)은 그 상태를 아는 페이지가 이 컴포넌트를 트리에서 빼서 한다.
 *   키보드가 떠 있는 동안은 이 컴포넌트가 스스로 빠진다(TRIP-1514) — 입력이 있는 화면마다 중복하지 않으려고.
 *
 * 크기는 `h-[56px]` 브래킷(`h-14` 는 rem 49px 함정 — HomeScreen CreateTripFab 주석). 실제 겹침은 6-b 실기.
 */

const FAB_SHADOW = {
  shadowColor: '#000000',
  shadowOpacity: 0.18,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
} as const;

export interface AssistantFabProps {
  onPress: () => void;
  /** 절대 배치 바닥(px). 없으면 흐름 배치. */
  bottom?: number;
  /** 붙어 있는 동안 올릴 토스트 바닥(px). */
  toastBottom?: number;
}

export function AssistantFab({
  onPress,
  bottom,
  toastBottom,
}: AssistantFabProps): ReactElement | null {
  // TripRecordsView(TRIP-1280)와 같은 감지 — Android 는 Will* 이벤트가 오지 않아 Did* 도 함께 받는다.
  const [keyboardShown, setKeyboardShown] = useState(false);
  useEffect(() => {
    const show = (): void => setKeyboardShown(true);
    const hide = (): void => setKeyboardShown(false);
    const subs = [
      Keyboard.addListener('keyboardWillShow', show),
      Keyboard.addListener('keyboardDidShow', show),
      Keyboard.addListener('keyboardWillHide', hide),
      Keyboard.addListener('keyboardDidHide', hide),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);
  // 빠진 동안은 토스트도 내린다 — 없는 FAB 위로 뜨지 않게.
  useRaisedToastBottom(keyboardShown ? undefined : toastBottom);
  if (keyboardShown) return null;
  return (
    <Pressable
      testID="assistant-fab"
      accessibilityRole="button"
      accessibilityLabel="AI 도우미"
      onPress={onPress}
      style={[
        FAB_SHADOW,
        bottom === undefined
          ? null
          : { position: 'absolute', bottom, right: 16 },
      ]}
      className="h-[56px] w-[56px] items-center justify-center rounded-full bg-primary"
    >
      <SparkleGlyph size={24} />
    </Pressable>
  );
}
