import type { ReactElement } from 'react';

import type { StorySlide } from '../model/shareStory';
import { useStoryDeck } from '../model/useStoryDeck';
import { StoryDeckView } from './StoryDeckView';

/**
 * TRIP-1667 · j06 스토리 덱 — 시간 훅(`useStoryDeck`)과 순수 뷰(`StoryDeckView`)를 잇는다. 조회·라우팅은 모른다(페이지 몫).
 * `startAt: 'last'` 는 내보내기 화면에서 뒤로 돌아온 덱이 마지막 장에서 시작하게 한다.
 */
export interface StoryDeckProps {
  slides: StorySlide[];
  /** 서버 캡션(150자 이하). 비면 표지의 문장 줄은 없고 자리만 있다. */
  caption: string;
  hashtagText: string;
  startAt?: 'first' | 'last';
  onClose: () => void;
  onMake: () => void;
}

export function StoryDeck({
  slides,
  caption,
  hashtagText,
  startAt = 'first',
  onClose,
  onMake,
}: StoryDeckProps): ReactElement {
  const deck = useStoryDeck(slides.length, startAt);
  return (
    <StoryDeckView
      slides={slides}
      index={deck.index}
      segments={deck.segments}
      fill={deck.fill}
      caption={caption}
      hashtagText={hashtagText}
      onPressIn={deck.onPressIn}
      onPressOut={deck.onPressOut}
      onLongPress={deck.onLongPress}
      onTap={deck.onTap}
      onClose={onClose}
      onMake={onMake}
    />
  );
}
