import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest {
 return {
  id:'/master',name:'Tradevice',short_name:'Tradevice',
  description:'Tradevice master dashboard',lang:'en',start_url:'/master',scope:'/',
  display:'standalone',background_color:'#080808',theme_color:'#080808',
  icons:[
   {src:'/icons/tradevice-192-v3.png',sizes:'192x192',type:'image/png',purpose:'any'},
   {src:'/icons/tradevice-512-v3.png',sizes:'512x512',type:'image/png',purpose:'any'},
   {src:'/icons/tradevice-maskable-v3.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
  ],
 };
}
