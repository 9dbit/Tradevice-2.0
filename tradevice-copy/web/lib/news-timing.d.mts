import type {NewsSnapshot,NewsEvent} from './news-calendar.mjs';
export function newsTiming(raw:unknown,now?:number):{calendar:NewsSnapshot;group:{start:number;end:number;events:NewsEvent[]}|null;active:boolean;release:number|null};
export function remaining(at:number|null,now:number):string;
export function wib(at:number):string;
