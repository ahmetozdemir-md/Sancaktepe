export type LocationKind = 'normal' | 'leave' | 'duty' | 'postDuty'

export type LocationTone = 'sand' | 'sage' | 'amber' | 'sky' | 'rose'

export type DutySite = 'Sancaktepe' | 'Feriha Öz' | 'Çekmeköy'

export type SpecialistDutySite =
  | 'Sancaktepe'
  | 'Çekmeköy'
  | 'Feriha C123'
  | 'Feriha C456'
  | 'Feriha G123'

export type SeniorityLevel = number

export type ManualAssignments = Record<string, Record<string, string[]>>

export type DutyRoster = Record<string, DutyAssignment[]>

export type SpecialistWorkAssignments = Record<string, Record<string, string[]>>

export type SpecialistWorkDayAssignments = Record<string, string[]>

export type SpecialistDutyRoster = Record<string, SpecialistDutyAssignment[]>

export type RotatorRoster = Record<string, string[]>

export type RotatorAssignments = Record<string, Record<string, string[]>>

export type RotatorDayAssignments = Record<string, string[]>

export type LocationOwners = Record<string, string[]>

export type LocationOwnersByMonth = Record<string, LocationOwners>

export type PostDutyPoolByMonth = Record<string, string[]>

export type AssistantRanks = Record<string, SeniorityLevel>

export interface DutyAssignment {
  name: string
  site: DutySite
}

export interface SpecialistDutyAssignment {
  name: string
  site: SpecialistDutySite
}

export interface WorkLocation {
  id: string
  site: string
  name: string
  kind: LocationKind
  tone: LocationTone
  order?: number
  orderHistory?: Array<{ from: string; value: number }>
  activeFrom?: string
  activeUntil?: string | null
}

export interface PlannerState {
  assistantRegistry?: import('./assistantIdentity.js').AssistantRegistry
  assistants: string[]
  assistantRanks: AssistantRanks
  locations: WorkLocation[]
  locationOwners: LocationOwners
  locationOwnersByMonth: LocationOwnersByMonth
  postDutyPoolByMonth: PostDutyPoolByMonth
  manualAssignments: ManualAssignments
  dutyRoster: DutyRoster
  specialistWorkAssignments: SpecialistWorkAssignments
  specialistDutyRoster: SpecialistDutyRoster
  rotatorRoster: RotatorRoster
  rotatorAssignments: RotatorAssignments
  weekStartISO: string
}
