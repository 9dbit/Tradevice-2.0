import type { ReactNode } from "react";
export default function RootLayout({children}:{children:ReactNode}) {
 return <html lang="en"><body style={{fontFamily:"system-ui",background:"#0b1422",color:"#f2f6fa",margin:0}}>{children}</body></html>;
}