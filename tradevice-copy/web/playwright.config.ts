import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e', timeout:30000, retries:0, workers:1,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:3000',trace:'off',screenshot:'only-on-failure'},
  webServer:{command:'npm run start -- -p 3000 -H 127.0.0.1',url:'http://127.0.0.1:3000/api/health',reuseExistingServer:false},
});
