export interface AssistantIdentity {name:string;dutyEnabled:boolean;plannerPersonId?:string;archived?:boolean;aliases?:string[];dutyHistory?:Array<{from:string;enabled:boolean}>}
export type AssistantRegistry = Record<string,AssistantIdentity>;
export interface IdentityWarning {code:string;message:string}
export interface RegistryPlannerPerson {id:string;name:string;from:string;until?:string|null}
export function assistantNameKey(value:unknown):string;
export function validateAssistantRegistry(value:unknown):{valid:boolean;errors:string[]};
export function ensureAssistantRegistry(assistants:string[],supplied:AssistantRegistry|undefined,plannerPeople:RegistryPlannerPerson[]|undefined,month:string):{registry:AssistantRegistry;changed:boolean;warnings:IdentityWarning[]};
export function assistantDutyEnabled(entry:AssistantIdentity|null|undefined,month:string):boolean|null;
export function setAssistantArchived(registry:AssistantRegistry,id:string,archived:boolean,month?:string):AssistantRegistry;
export function setAssistantDutyEnabled(registry:AssistantRegistry,id:string,enabled:boolean,month?:string):AssistantRegistry;
export function assistantIdentityForName(registry:AssistantRegistry,name:string):({id:string}&AssistantIdentity)|null;
export function renameAssistantInPlanner<T extends {assistants:string[];assistantRegistry?:AssistantRegistry}>(planner:T,id:string,name:string):T;
export function renameAssistantBindings(bindings:Record<string,string>,previousName:string,nextName:string):Record<string,string>;
export function retainAssistantRanks(assistants:string[],ranks:Record<string,number>):Record<string,number>;
export function updateAssistantProfileInPlanner<T extends {assistants:string[];assistantRanks:Record<string,number>;assistantRegistry?:AssistantRegistry}>(planner:T,id:string,name:string,rank:number):T;
