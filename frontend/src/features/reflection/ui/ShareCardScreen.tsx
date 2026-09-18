import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormatSegment } from './FormatSegment';
import { BackArrowGlyph } from './ReflectionGlyphs';
import { DownloadGlyph, ShareGlyph } from './ShareCardGlyphs';
import { ShareCardPreview } from './ShareCardPreview';
import {
  captureShareImage,
  type ShareCardVM,
  type ShareFormat,
} from '../model/shareCard';

/**
 * TRIP-574 · j06 공유 카드 화면(무상태 프레젠테이션 — VM·formats 주입, 포맷·degrade 로컬 상태만).
 * 조회·조립은 `pages/share-card` 가 진다(이 파일은 `@/shared/*` 값 import 0 — 프리뷰 격리 렌더 안전).
 *
 * 무엇을 보장하나(승인 계약):
 *  - AC-1(정상 렌더): 제목·포맷 세그(3셀)·프리뷰 프레임·캡션·저장/공유 버튼이 그려진다.
 *  - AC-2(BR-U5-47): mode 'no-photo' → 안내 문구 표시 · 'default' → 부재(짝).
 *  - AC-3(US-REC-13): 포맷 셀 press → 선택 상태 전환 + 프리뷰 aspect(9:16→1:1→4:5) 전환.
 *  - degrade 정직성(INV-4): 저장/공유 press → captureShareImage() 가 armed:false → "준비 중" 안내만
 *    (가짜 성공·크래시 0, 서버 호출은 화면이 api 미접근이라 구조적으로 0). 실 캡처는 Blocker A 후속.
 */

const NO_PHOTO_NOTICE = '사진이 없어도 동선 지도만으로 멋진 카드를 만들었어요';

export interface ShareCardScreenProps {
  card: ShareCardVM;
  formats: ShareFormat[];
  caption: string;
  hashtagText: string;
  onEditCaption?: () => void;
  onBack: () => void;
}

export function ShareCardScreen({
  card,
  formats,
  caption,
  hashtagText,
  onEditCaption,
  onBack,
}: ShareCardScreenProps): ReactElement {
  const [selectedFormatId, setSelectedFormatId] = useState<ShareFormat['id']>(
    formats[0]?.id ?? 'story'
  );
  const [degradeVisible, setDegradeVisible] = useState(false);

  const selectedFormat =
    formats.find((format) => format.id === selectedFormatId) ?? formats[0];

  // 저장·공유는 네이티브 캡처 미장전(armed:false)이라 가짜 성공을 내지 않고 "준비 중"만 알린다(INV-4).
  const handleExportAttempt = () => {
    const result = captureShareImage();
    if (!result.armed) {
      setDegradeVisible(true);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      {/* 헤더 — 뒤로 · 제목(현 j06 엔 편집/공유 액션 없음, 하단 버튼이 진다) */}
      <View className="w-full flex-row items-center bg-canvas pb-[12px] pl-[12px] pr-lg pt-[4px]">
        <Pressable
          testID="reflection-share-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onBack}
          className="pr-[4px]"
        >
          <BackArrowGlyph size={24} />
        </Pressable>
        <Text className="font-noto-bold text-section text-ink">공유 카드</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-md px-lg pb-[24px] pt-[8px]"
      >
        <FormatSegment
          formats={formats}
          selectedId={selectedFormatId}
          onSelect={setSelectedFormatId}
        />

        <ShareCardPreview
          card={card}
          aspectRatio={selectedFormat.aspectRatio}
        />

        {card.mode === 'no-photo' ? (
          <View
            testID="reflection-share-no-photo-notice"
            className="w-full rounded-card border border-hairline bg-surface-soft px-lg py-md"
          >
            <Text className="text-center font-noto text-caption text-muted">
              {NO_PHOTO_NOTICE}
            </Text>
          </View>
        ) : null}

        {/* 캡션 카드 — 캡션·해시태그(link 색). 편집 진입은 additive(onEditCaption). */}
        <View className="w-full gap-sm rounded-card border border-hairline bg-canvas px-lg py-md">
          <View className="flex-row items-center">
            <Text className="font-noto-bold text-caption text-muted">캡션</Text>
            <View className="flex-1" />
            <Pressable
              testID="reflection-share-caption-edit"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={onEditCaption}
            >
              <Text className="font-noto-bold text-label text-primary">
                편집
              </Text>
            </Pressable>
          </View>
          <Text className="font-noto text-body text-ink">{caption}</Text>
          <Text className="font-noto text-body text-link">{hashtagText}</Text>
        </View>

        {degradeVisible ? (
          <View
            testID="reflection-share-degrade"
            className="w-full items-center rounded-card border border-hairline-strong bg-surface-soft px-lg py-md"
          >
            <Text className="text-center font-noto text-label text-muted">
              이미지 저장·공유는 준비 중이에요
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* 하단 버튼 2개 — 이미지 저장(흰 배경) · 공유하기(코랄) */}
      <View className="w-full flex-row gap-md bg-canvas px-lg pb-[24px] pt-[8px]">
        <Pressable
          testID="reflection-share-save"
          onPress={handleExportAttempt}
          className="h-[50px] flex-1 flex-row items-center justify-center gap-sm rounded-button border border-hairline-strong bg-canvas"
        >
          <DownloadGlyph size={18} />
          <Text className="font-noto-bold text-card-title text-ink">
            이미지 저장
          </Text>
        </Pressable>
        <Pressable
          testID="reflection-share-export"
          onPress={handleExportAttempt}
          className="h-[50px] flex-1 flex-row items-center justify-center gap-sm rounded-button bg-primary"
        >
          <ShareGlyph size={18} />
          <Text className="font-noto-bold text-card-title text-on-primary">
            공유하기
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
