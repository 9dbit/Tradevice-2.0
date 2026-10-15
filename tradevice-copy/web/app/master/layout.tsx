import type {Viewport} from 'next';
import type {ReactNode} from 'react';
export const viewport:Viewport={themeColor:'#000000'};
export default function MasterLayout({children}:{children:ReactNode}){return children;}
