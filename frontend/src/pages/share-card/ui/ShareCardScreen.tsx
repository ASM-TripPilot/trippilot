import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';

import { FormatSegment } from './FormatSegment';
import { BackArrowGlyph } from '@/features/reflection/ui/ReflectionGlyphs';
import { DownloadGlyph, ShareGlyph } from './ShareCardGlyphs';
import { ShareCardPreview } from './ShareCardPreview';
import {
  CAPTION_MAX_LENGTH,
  HASHTAG_MAX_COUNT,
  validateCaption,
  validateHashtags,
  type ShareCardVM,
  type ShareFormat,
} from '@/features/reflection/model/shareCard';
import {
  isShareCaptureArmed,
  saveShareCardImage,
  shareShareCardImage,
  type SaveShareCardResult,
} from '@/features/reflection/model/shareCapture';

/**
 * TRIP-574 · j06 공유 카드 화면(VM·formats 주입, 포맷·해시태그 편집·결과 안내는 로컬 상태).
 * 조회·조립은 `pages/share-card` 가 진다(이 파일은 `@/shared/*` 값 import 0 — 프리뷰 격리 렌더 안전).
 *
 * 무엇을 보장하나(승인 계약):
 *  - AC-1(정상 렌더): 제목·포맷 세그(3셀)·프리뷰 프레임·캡션·저장/공유 버튼이 그려진다.
 *  - AC-2(BR-U5-47): mode 'no-photo' → 안내 문구 표시 · 'default' → 부재(짝).
 *  - AC-3(US-REC-13): 포맷 셀 press → 선택 상태 전환 + 프리뷰 aspect(9:16→1:1→4:5) 전환.
 *  - TRIP-939(심사 2.1): 캡처 미장전(isShareCaptureArmed() false)이면 저장/공유 버튼 줄을 그리지 않는다.
 *  - TRIP-1071: 저장/공유는 프리뷰 프레임을 캡처해 앨범·공유 시트로 보내고 결과를 인라인으로 알린다
 *    (저장 성공·권한 거부·실패, 공유는 실패만 — 공유 시트는 실제 전송 여부를 모른다). 서버 호출 0.
 *    [편집]은 항상 있고 해시태그 줄만 인라인으로 고친다(서버 저장 없음, 한도는 validate* 재사용).
 */

// TRIP-1016(D10·INV-4): 지도 히어로가 없으므로(TRIP-634) 카드에 실제로 그린 것만 말한다.
const VISIT_ORDER_NOTICE = '사진이 없어 방문 순서로 카드를 만들었어요';
const NO_VISIT_NOTICE = '사진과 방문 기록이 없어 여행 정보로 카드를 만들었어요';

type ShareResult = SaveShareCardResult['status'];

const RESULT_TEXT: Record<ShareResult, string> = {
  saved: '사진 앨범에 저장했어요',
  'permission-denied': '사진 앨범 권한이 없어 저장하지 못했어요',
  failed: '이미지를 만들지 못했어요. 다시 시도해 주세요',
};
const HASHTAG_COUNT_ERROR = `해시태그는 ${HASHTAG_MAX_COUNT}개까지 넣을 수 있어요`;
const HASHTAG_LENGTH_ERROR = `${CAPTION_MAX_LENGTH}자까지 쓸 수 있어요`;

export interface ShareCardScreenProps {
  card: ShareCardVM;
  formats: ShareFormat[];
  caption: string;
  hashtagText: string;
  onBack: () => void;
}

export function ShareCardScreen({
  card,
  formats,
  caption,
  hashtagText,
  onBack,
}: ShareCardScreenProps): ReactElement {
  const [selectedFormatId, setSelectedFormatId] = useState<ShareFormat['id']>(
    formats[0]?.id ?? 'story'
  );
  const [hashtags, setHashtags] = useState(hashtagText);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [result, setResult] = useState<ShareResult | null>(null);
  const frameRef = useRef<View>(null);

  const selectedFormat =
    formats.find((format) => format.id === selectedFormatId) ?? formats[0];
  const exportArmed = isShareCaptureArmed();

  // 실행 함수는 reject 하지 않는 계약이지만, 뜻밖의 예외도 실패로 드러낸다(INV-4 — 침묵 금지).
  const handleSave = async () => {
    const outcome = await saveShareCardImage(frameRef).catch(
      () => ({ status: 'failed' }) as const
    );
    setResult(outcome.status);
  };
  const handleShare = async () => {
    const outcome = await shareShareCardImage(frameRef).catch(
      () => ({ status: 'failed' }) as const
    );
    setResult(outcome.status === 'failed' ? 'failed' : null);
  };

  const openEditor = () => {
    setDraft(hashtags);
    setDraftError(null);
  };
  // 공백으로 나눠 빈 토큰을 버린 개수 · 줄 전체 길이로 검사한다. `#` 는 붙이지 않고 입력 그대로 둔다.
  const commitDraft = () => {
    if (draft === null) return;
    const tags = draft.split(/\s+/).filter(Boolean);
    if (!validateHashtags(tags).valid) {
      setDraftError(HASHTAG_COUNT_ERROR);
      return;
    }
    if (!validateCaption(draft).valid) {
      setDraftError(HASHTAG_LENGTH_ERROR);
      return;
    }
    setHashtags(draft);
    setDraft(null);
    setDraftError(null);
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
          frameRef={frameRef}
        />

        {card.mode === 'no-photo' ? (
          // TRIP-766: 박스 크롬 제거 → 좌정렬 플레인 텍스트(테두리·배경·라운드·가운데정렬 없음).
          <View testID="reflection-share-no-photo-notice" className="w-full">
            <Text className="font-noto text-caption text-muted">
              {card.orderedVisits.length > 0
                ? VISIT_ORDER_NOTICE
                : NO_VISIT_NOTICE}
            </Text>
          </View>
        ) : null}

        {/* 캡션 카드 — 캡션·해시태그(link 색). [편집]은 해시태그 줄을 인라인 입력칸으로 바꾼다. */}
        <View className="w-full gap-sm rounded-card border border-hairline bg-canvas px-lg py-md">
          <View className="flex-row items-center">
            <Text className="font-noto-bold text-caption text-muted">캡션</Text>
            <View className="flex-1" />
            {draft === null ? (
              <Pressable
                testID="reflection-share-caption-edit"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={openEditor}
              >
                <Text className="font-noto-bold text-label text-primary">
                  편집
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Text className="font-noto text-body text-ink">{caption}</Text>
          {draft === null ? (
            <Text className="font-noto text-body text-link">{hashtags}</Text>
          ) : (
            <View className="gap-sm">
              <TextInput
                testID="reflection-share-caption-input"
                value={draft}
                onChangeText={setDraft}
                autoFocus
                className="rounded-button border border-hairline-strong bg-canvas px-md py-sm font-noto text-body text-ink"
              />
              {draftError ? (
                <View testID="reflection-share-caption-error">
                  <Text className="font-noto text-label text-primary-text">
                    {draftError}
                  </Text>
                </View>
              ) : null}
              <Pressable
                testID="reflection-share-caption-save"
                onPress={commitDraft}
                className="h-12 items-center justify-center rounded-button bg-primary"
              >
                <Text className="font-noto-bold text-card-title text-on-primary">
                  완료
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {result ? (
          <View
            testID="reflection-share-result"
            className="w-full items-center gap-sm rounded-card border border-hairline-strong bg-surface-soft px-lg py-md"
          >
            <Text
              className={`text-center font-noto text-label ${
                result === 'saved' ? 'text-ink' : 'text-primary-text'
              }`}
            >
              {RESULT_TEXT[result]}
            </Text>
            {result === 'permission-denied' ? (
              <Pressable
                testID="reflection-share-open-settings"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => {
                  void Linking.openSettings();
                }}
              >
                <Text className="font-noto-bold text-label text-primary">
                  설정 열기
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* 하단 버튼 2개 — 이미지 저장(흰 배경) · 공유하기(코랄). 캡처 장전 전에는 그리지 않는다. */}
      {exportArmed ? (
        <View className="w-full flex-row gap-md bg-canvas px-lg pb-[24px] pt-[8px]">
          <Pressable
            testID="reflection-share-save"
            onPress={() => {
              void handleSave();
            }}
            className="h-[50px] flex-1 flex-row items-center justify-center gap-sm rounded-button border border-hairline-strong bg-canvas"
          >
            <DownloadGlyph size={18} />
            <Text className="font-noto-bold text-card-title text-ink">
              이미지 저장
            </Text>
          </Pressable>
          <Pressable
            testID="reflection-share-export"
            onPress={() => {
              void handleShare();
            }}
            className="h-[50px] flex-1 flex-row items-center justify-center gap-sm rounded-button bg-primary"
          >
            <ShareGlyph size={18} />
            <Text className="font-noto-bold text-card-title text-on-primary">
              공유하기
            </Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
