import type {AssistantRegistry} from './assistantIdentity.js';
export interface RegistrySourceCreated {sourceCreated?:boolean}
export function synchronizePlannerRoster<T>(state:T,portal:{assistants:string[];assistantRanks?:Record<string,number>;assistantRegistry?:AssistantRegistry},options:{fromMonth:string;currentMonth:string}):{state:T;changed:boolean;warnings:Array<{code:string;message:string;personId?:string;month?:string}>};
