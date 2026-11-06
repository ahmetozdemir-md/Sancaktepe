export function sourceSignature(value: unknown): string;
export function createSourceRevisionTracker(limit?: number): {record(before:number,after:number):void;resolve(revision:number):number};
export function invalidateSourceCompletion<T>(before:T,after:T,cutoffMonth:string):T;
