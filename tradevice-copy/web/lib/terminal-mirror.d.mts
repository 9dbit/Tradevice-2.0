export interface TerminalMirror {schema:string;source:string;readOnly:true;observedMs:number;batchId:string|null;status:string;lines:{atMs:number;event:string;cycle:string|null;sequence:number}[]}
export function validateTerminal(raw:unknown,now?:number):TerminalMirror|null;
export function terminalText(packet:TerminalMirror):string;
