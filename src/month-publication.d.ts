export interface PublicationIssue { code: string; message: string; date?: string; personId?: string }
export interface PublishedDuty { name: string; site: 'Sancaktepe' | 'Feriha Öz' | 'Çekmeköy' }
export interface PublicationDraft {
  people: Array<{ id: string; name: string; groupId: string; groupHistory?: Array<{ from: string; groupId: string }>; from: string; until?: string | null }>;
  groups: Array<{ id: string; from: string; until?: string | null }>;
  assignments: Array<{ id?: string; personId: string; date: string; site: string; overrides?: unknown[] }>;
}
export interface PublicationPortal {
  assistants: string[];
  assistantRanks?: Record<string, number>;
  dutyRoster: Record<string, PublishedDuty[]>;
  manualAssignments: Record<string, Record<string, string[]>>;
  locations: Array<{ id: string; kind: string; name?: string; site?: string }>;
}
export interface RemovedRoomAssignment {
  date: string; dutyDate: string; name: string; locationId: string; locationName: string; site: string;
}
export interface PublicationPreview {
  month: string; count: number; changedDays: string[]; addedCount: number; removedCount: number;
  removedRoomAssignments: RemovedRoomAssignment[];
  warnings: PublicationIssue[]; errors: PublicationIssue[]; canPublish: boolean; hasChanges: boolean;
  monthRoster: Record<string, PublishedDuty[]>;
  nextDutyRoster: Record<string, PublishedDuty[]>;
  nextManualAssignments: Record<string, Record<string, string[]>>;
  portalSignature: string;
  draftSignature: string;
  draftSnapshot: PublicationDraft | null;
}
export function normalizePublicationName(value: unknown): string;
export function createPublicationPreview(draft: PublicationDraft, portal: PublicationPortal, month: string, options?: { warnings?: PublicationIssue[] }): PublicationPreview;
export function applyPublication<T extends PublicationPortal>(portal: T, preview: PublicationPreview, currentDraft?: PublicationDraft | null): T;
