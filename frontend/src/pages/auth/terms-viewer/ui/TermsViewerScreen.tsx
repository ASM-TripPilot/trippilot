/**
 * 약관 열람 프레젠테이션(TRIP-937 · 가이드라인 5.1.1(i) · LEGAL-01 · INV-4).
 * Figma 프레임이 없어 l06 하위 화면 헤더 + 본문 스크롤로 구성했다(Figma 역반영 후속).
 * props 만 받고 네트워크를 모른다 — 조회·재시도 배선은 `pages/auth/terms-viewer` 몫이다.
 */
import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackChevronGlyph } from '@/features/onboarding';

import {
  parseTermsMarkdown,
  type Block,
  type Span,
} from '../model/parseTermsMarkdown';

export interface TermsViewerScreenProps {
  /** 헤더 제목 = 문서 이름(예: '개인정보 처리방침'). */
  title: string;
  status: 'loading' | 'ready' | 'error';
  /** 서버가 준 약관 전문. `ready` 일 때만 그린다. */
  body: string | null;
  onPressBack: () => void;
  onRetry: () => void;
}

export function TermsViewerScreen({
  title,
  status,
  body,
  onPressBack,
  onRetry,
}: TermsViewerScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-canvas">
      <View className="flex-row items-center gap-sm border-b border-hairline px-lg pb-md pt-sm">
        <Pressable
          testID="terms-viewer-back"
          accessibilityRole="button"
          onPress={onPressBack}
        >
          <BackChevronGlyph />
        </Pressable>
        <Text className="text-[18px] font-noto-bold text-ink">{title}</Text>
      </View>

      {status === 'ready' ? (
        <ScrollView
          testID="terms-viewer-body"
          contentContainerClassName="px-2xl py-xl"
        >
          {parseTermsMarkdown(body ?? '').map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
        </ScrollView>
      ) : status === 'error' ? (
        <View className="flex-1 items-center justify-center gap-md px-2xl">
          <Text
            testID="terms-viewer-error"
            className="text-center font-noto text-body text-primary-text"
          >
            약관을 불러오지 못했어요. 다시 시도해 주세요.
          </Text>
          <Pressable
            testID="terms-viewer-retry"
            accessibilityRole="button"
            onPress={onRetry}
            className="rounded-button border-[1.5px] border-hairline-strong px-lg py-sm"
          >
            <Text className="font-noto-medium text-body font-medium text-ink">
              다시 시도
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      )}
    </SafeAreaView>
  );
}

function Spans({ spans }: { spans: Span[] }): ReactElement {
  return (
    <>
      {spans.map((s, i) =>
        s.bold ? (
          <Text key={i} className="font-noto-bold">
            {s.text}
          </Text>
        ) : (
          s.text
        )
      )}
    </>
  );
}

/** 약관 본문 마크다운 한 블록 — 서버 시드가 쓰는 문법만 그린다(`parseTermsMarkdown`). */
function BlockView({ block }: { block: Block }): ReactElement {
  switch (block.kind) {
    case 'heading':
      return (
        <Text
          className={`font-noto-bold text-ink ${
            block.level === 1
              ? 'pb-md text-[20px]'
              : block.level === 2
                ? 'pb-sm pt-xl text-[16px]'
                : 'pb-xs pt-lg text-body'
          }`}
        >
          <Spans spans={block.spans} />
        </Text>
      );
    case 'quote':
      return (
        <Text className="pb-md font-noto text-body text-muted">
          <Spans spans={block.spans} />
        </Text>
      );
    case 'item':
      return (
        <View className="flex-row gap-sm pb-xs pl-sm">
          <Text className="font-noto text-body text-ink">{block.marker}</Text>
          <Text className="flex-1 font-noto text-body text-ink">
            <Spans spans={block.spans} />
          </Text>
        </View>
      );
    case 'rule':
      return <View className="my-lg h-px bg-hairline" />;
    case 'table':
      // 폰 폭에서 4열 표는 못 읽는다 — 행마다 카드로 쌓고 첫 칸을 제목으로, 나머지는 '머리: 값'.
      return (
        <View className="gap-sm pb-md">
          {block.rows.map((row, r) => (
            <View
              key={r}
              className="gap-xs rounded-button border border-hairline px-md py-sm"
            >
              <Text className="font-noto-bold text-body text-ink">
                <Spans spans={row[0] ?? []} />
              </Text>
              {row.slice(1).map((cell, c) => (
                <Text key={c} className="font-noto text-body text-ink">
                  {block.header[c + 1]}
                  {': '}
                  <Spans spans={cell} />
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    default:
      return (
        <Text className="pb-md font-noto text-body text-ink">
          <Spans spans={block.spans} />
        </Text>
      );
  }
}
