import { PlusGlyph as SharedPlusGlyph } from '@/shared/ui/glyphs';
// 공용 글리프(shared/ui/glyphs) 재수출 — 소비처 import 경로는 그대로다 (TRIP-1358)
export { InfoCircleGlyph, TrashGlyph } from '@/shared/ui/glyphs';

// TRIP-921 · h12 편집 뷰(EditorView·SlotDropZone) 전용 인라인 SVG 글리프. widgets 는 `@/features` 를
// import 하지 않으므로 `features/itinerary/ui/ItineraryGlyphs` 의
// Plus·InfoCircle 을 **바이트 복제**한다(MapSheetGlyphs 와 같은 로컬 복제 관례). Trash 는 Figma
// `4197:2469`(드롭존 20px · ink) 에셋 그대로다. 색은 이 파일에서만 raw hex 로 고정한다(`*Glyphs.tsx`
// raw-hex 스캔 제외 관례).

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 카드 사이 "+"·"장소 추가" — PlusGlyph(ItineraryGlyphs) 바이트 복제(편집 뷰가 쓰는 ink·primary 톤만).
export function PlusGlyph({
  size = 18,
  tone = 'ink',
  testID,
}: GlyphProps & { tone?: 'ink' | 'primary' }) {
  return <SharedPlusGlyph size={size} color={tone} testID={testID} />;
}
