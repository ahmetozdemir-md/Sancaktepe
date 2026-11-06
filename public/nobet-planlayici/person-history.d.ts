export interface PersonGroupHistory {from:string;groupId:string}
export interface GroupRankHistory {from:string;rank:number}
export interface PersonHistoryView {groupId?:string;groupHistory?:PersonGroupHistory[];rosterHistory?:Array<{from:string;enabled:boolean}>;from?:string;until?:string|null}
export interface GroupRankView {rankHistory?:GroupRankHistory[]}
export interface PersonRankSyncWarning {code:string;message:string;personId?:string;groupId?:string}
export function personGroupId(person:PersonHistoryView|null|undefined,month:string):string|undefined;
export function personRosterEnabled(person:PersonHistoryView|null|undefined,month:string):boolean|null;
export function personDutyActive(person:PersonHistoryView|null|undefined,date:string):boolean;
export function groupActiveInMonth(state:unknown,group:unknown,month:string):boolean;
export function groupRankAt(group:GroupRankView|null|undefined,month:string,fallback?:number|null):number|null;
export function personAtMonth<T extends PersonHistoryView>(person:T,month:string):T;
export function synchronizePersonRanks<T>(state:T,portalPlannerState:unknown,options:{fromMonth:string;currentMonth:string}):{state:T;changed:boolean;warnings:PersonRankSyncWarning[]};
