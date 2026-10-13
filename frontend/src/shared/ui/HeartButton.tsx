import { useEffect, useRef, type ReactElement } from 'react';
import { Animated, Pressable } from 'react-native';

import { startUnlessReduceMotion } from '@/shared/lib/reduceMotion';

import { HeartFilledGlyph, HeartOutlineGlyph } from './HeartGlyphs';

/**
 * 카드 사진 위 저장 하트(TRIP-1049) — Figma HeartButton `4462:1407`: 32 흰 원 + 18 하트.
 * 장소 카드(entities/place)와 홈 스팟 카드(features/home)가 함께 쓴다. 위치는 소비처가
 * `className` 으로 주고, 모양은 여기서 고정한다.
 *
 * 담김/안 담김은 색이 아니라 `accessibilityState.selected` + 서로 다른 글리프 testID 로 갈린다
 * (SVG fill 은 jest 사각). `pending` 이면 disabled 다 — 단 disabled 하트 press 는 부모
 * Pressable 로 새므로(RNTL Probe C) 누를 수 있는 카드는 자기 onPress 에 `!pending` 가드를 둔다.
 *
 * TRIP-1125 — **이 하트를 누른 뒤** 안 담김 → 담김으로 바뀌는 순간만 글리프가 한 번 튄다. 누름 1회가
 * 튐 자격 1개를 만들고, 누른 뒤 첫 `saved` 변화가 그 자격을 쓴다(담김이면 튀고, 취소면 소비만). 누르지
 * 않은 변화(저장 목록 늦은 도착·로그인 뒤 도착)·처음부터 담김·동작 줄이기는 안 튄다. 튐은 루트가 아니라 글리프 감싸개에 건다 — 루트는 소비처 위치 className 과 판정
 * 속성(testID·selected·disabled)을 그대로 가진다. 튐 크기·박자는 발명값(6-b 육안 조정).
 *
 * TRIP-1281 — 라벨은 담김과 무관하게 `{name} 저장` 하나다(담김은 selected 로만). 이름은 소비처가 준다.
 */
export interface HeartButtonProps {
  saved: boolean;
  pending?: boolean;
  onPress: () => void;
  testID: string;
  filledTestID: string;
  outlineTestID: string;
  className?: string;
  /** 저장 대상 이름 — 라벨 `{name} 저장`. 비었거나 공백뿐이면 `담기`. */
  name?: string;
}

/** 저장 하트 라벨(TRIP-1281) — 하트를 따로 그리는 카드·행도 이걸 쓴다. */
export function heartSaveLabel(name?: string): string {
  return name?.trim() ? `${name} 저장` : '담기';
}

export function HeartButton({
  saved,
  pending,
  onPress,
  testID,
  filledTestID,
  outlineTestID,
  className = '',
  name,
}: HeartButtonProps): ReactElement {
  const scale = useRef(new Animated.Value(1)).current;
  const wasSaved = useRef(saved);
  const pressed = useRef(false);

  useEffect(() => {
    if (saved === wasSaved.current) return;
    wasSaved.current = saved;
    const justSaved = saved && pressed.current;
    pressed.current = false;
    if (!justSaved) return;
    const stop = startUnlessReduceMotion(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.25,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 4,
          useNativeDriver: true,
        }),
      ])
    );
    // 튐 도중 담기 취소·언마운트면 중간 크기에 남지 않게 되돌린다.
    return () => {
      stop();
      scale.setValue(1);
    };
  }, [saved, scale]);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={heartSaveLabel(name)}
      accessibilityState={{ selected: saved }}
      disabled={pending}
      onPress={() => {
        pressed.current = true;
        onPress();
      }}
      className={`${className} h-8 w-8 items-center justify-center rounded-pill bg-on-primary`}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {saved ? (
          <HeartFilledGlyph testID={filledTestID} size={18} />
        ) : (
          <HeartOutlineGlyph testID={outlineTestID} size={18} />
        )}
      </Animated.View>
    </Pressable>
  );
}
