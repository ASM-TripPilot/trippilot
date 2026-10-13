export { deriveEndsNextDay, isValidTimeRange } from './lib/endsNextDay';
export { normalizeOpeningHours } from './lib/normalizeOpeningHours';
export { formatOpeningHoursLabel } from './lib/openingHoursLabel';
export { buildSlotKey, parseSlotKey } from './lib/slotKey';
export { buildStatePins } from './lib/slotMapPin';
export type { SlotProgressState } from './lib/slotMapPin';
export { projectSlotProgress } from './lib/slotProgress';
export type { ProjectedSlot } from './lib/slotProgress';
export { suggestNextSlotTime } from './lib/suggestNextSlotTime';
export { timeBandLabel } from './lib/timeBandLabel';
export { VIOLATION_NOTICE, violationNotice } from './lib/violationLabel';
export { deriveVisitProgress } from './lib/visitProgress';
export type { ItineraryDaysItemSlotsItem, ReplanSlotVM } from './model';
export { ReplanSlotRow } from './ui/ReplanSlotRow';
export {
  CategoryBuildingGlyph,
  CategoryCupGlyph,
  CategoryForkKnifeGlyph,
  CategoryImageGlyph,
  CategoryShoppingBagGlyph,
  CategoryTreeGlyph,
} from './ui/SlotGlyphs';
export { SlotProgressCard } from './ui/SlotProgressCard';
export { SlotStopCard } from './ui/SlotStopCard';
