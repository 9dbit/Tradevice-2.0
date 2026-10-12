import MasterConsole from '../master-console';
export const metadata = {
  title:'Master Trader Preview | Tradevice',
  description:'Clearly-labelled synthetic master operations dashboard preview.',
  robots:{index:false,follow:false},
};
export default function MasterPreview(){return <MasterConsole preview/>;}
