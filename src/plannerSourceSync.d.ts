export interface PlannerSourceWarning { code: string; message: string; personId?: string; month?: string; start?: string; end?: string }
export interface PlannerSourceOptions { fromMonth: string; currentMonth: string; rosterPolicy: 'preserve-active' | 'portal-all' }
export interface PlannerSourcePortal {
  assistants: string[];
  assistantRanks?: Record<string, number>;
  locations: Array<{ id: string; kind: string; site?: string; name?: string; activeFrom?: string; activeUntil?: string | null }>;
  locationOwnersByMonth?: Record<string, Record<string, string[]>>;
  postDutyPoolByMonth?: Record<string, string[]>;
}
/** Preserves existing identities, lifetimes, membership and scheduling records. */
export function synchronizePlannerSource<T>(draft: T, portal: PlannerSourcePortal, options: PlannerSourceOptions): { state: T; changed: boolean; warnings: PlannerSourceWarning[] };
