import MasterConsole from './master-console';
export const metadata = {
  title:'Master Trader Control Center | Tradevice',
  description:'Private, paper-only Tradevice master operations console.',
  robots:{index:false,follow:false},
};
export default function MasterPage(){return <MasterConsole/>;}
