"use client";
import { useEffect, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
export default function Home() {
 const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
 const [session,setSession]=useState(false); const [message,setMessage]=useState("");
 useEffect(()=>{if(!supabase)return;void supabase.auth.getUser().then(({data})=>setSession(!!data.user)); const {data}=supabase.auth.onAuthStateChange((_event,s)=>setSession(!!s));return()=>data.subscription.unsubscribe()},[]);
 async function auth(mode:"signIn"|"signUp"){if(!supabase){setMessage("Supabase is not configured");return;}const {error}=mode==="signIn"?await supabase.auth.signInWithPassword({email,password}):await supabase.auth.signUp({email,password});setMessage(error?.message??(mode==="signUp"?"Check your email for confirmation.":"Signed in."))}
 return <main style={{maxWidth:1000,margin:"auto",padding:32}}>
 <header style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><h1>Tradevice Copy</h1><span style={{color:"#75e0ac"}}>PAPER / RESEARCH ONLY</span></header>
 <p>AI-assisted trading research portal. Live copy trading and funding are disabled.</p>
 {!session?<section style={{maxWidth:420,display:"grid",gap:12,marginTop:32}}><h2>Member Access</h2><input aria-label="Email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/><input aria-label="Password" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/><button onClick={()=>auth("signIn")}>Sign in</button><button onClick={()=>auth("signUp")}>Create account</button><p>{message}</p></section>:<section><h2>Member Dashboard</h2><p>Connected to Supabase Auth. Brokerage account linking is not yet enabled.</p><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:16}}>{["Equity: Not connected","Trades: Not connected","Copy Status: Disabled","Funding: Broker only","Referral: Pending broker approval"].map(x=><article key={x} style={{padding:20,border:"1px solid #40516b",borderRadius:12}}>{x}</article>)}</div><button style={{marginTop:24}} onClick={()=>supabase?.auth.signOut()}>Sign out</button></section>}
 </main>;
}