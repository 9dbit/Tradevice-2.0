import test from 'node:test';
import assert from 'node:assert/strict';
import { canApplySessionResult, readItems, authErrorMessage } from '../lib/member-contract.mjs';
test('response from previous user cannot update current session', () => assert.equal(canApplySessionResult(1,2),false));
test('response from signed-out session cannot update UI', () => assert.equal(canApplySessionResult(3,4),false));
test('current session response can update UI', () => assert.equal(canApplySessionResult(4,4),true));
test('invalid epoch cannot pass identity guard', () => assert.equal(canApplySessionResult(NaN,NaN),false));
test('successful empty collection is allowed', () => assert.deepEqual(readItems({items:[]}),[]));
test('real collection retains exact values', () => assert.deepEqual(readItems({items:[{id:'paper-a'}]}),[{id:'paper-a'}]));
for (const body of [null,{}, {items:null}, {items:{}}, {items:[null]}, {items:[{id:42}]}]) {
 test('invalid payload is an error: '+JSON.stringify(body), () => assert.throws(() => readItems(body)));
}
test('unconfirmed email gets actionable message', () => assert.match(authErrorMessage({code:'email_not_confirmed'}),/Confirm your email/));
test('rate limiting gets retry message', () => assert.match(authErrorMessage({status:429}),/wait/));
test('network failure distinguished from wrong password', () => assert.match(authErrorMessage({name:'AuthRetryableFetchError'}),/temporarily/));
test('raw errors cannot expose tokens', () => assert.ok(!authErrorMessage({message:'secret-token-xyz'}).includes('secret-token-xyz')));
