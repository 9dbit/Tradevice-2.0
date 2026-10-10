// Opt-in REAL login test for explicitly supplied, already-created pilot accounts.
// Never creates users, enables registration or changes customer data.
import {test,expect} from '@playwright/test';
const target='https://copy-web-staging.up.railway.app';
const a=process.env.COPY_PILOT_A_EMAIL,ap=process.env.COPY_PILOT_A_PASSWORD;
const b=process.env.COPY_PILOT_B_EMAIL,bp=process.env.COPY_PILOT_B_PASSWORD;
test('[pilot-real] two invited members can sign in and out',async({browser})=>{
 test.skip(!a||!ap||!b||!bp,'Real pilot credentials are not configured. Mock tests are not a substitute.');
 for(const [email,password] of [[a!,ap!],[b!,bp!]]){
  const context=await browser.newContext();const page=await context.newPage();
  try{await page.goto(target);await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByText('Verified member session',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();}finally{await context.close();}
 }
});
