// Local workerd integration tests. All outbound requests go to a mock Worker.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const entry = fileURLToPath(new URL('./src/index.ts', import.meta.url));
const bundle = await build({ stdin: { contents: `
    import worker, { CoachVoiceSession } from ${JSON.stringify(entry)};
    export class TestVoiceSession extends CoachVoiceSession {
        async expire() { const a = await this.ctx.storage.get('active'); if (a) { a.deadline = Date.now() - 1; await this.ctx.storage.put('active', a); } await this.alarm(); }
        async snapshot() { return { active: await this.ctx.storage.get('active'), usage: await this.ctx.storage.get('usage:'+new Date().toISOString().slice(0,10)) }; }
        async legacyLimit() { await this.ctx.storage.put('budget', {day:new Date().toISOString().slice(0,10),count:3}); }
        async rollover() {
            const today=new Date().toISOString().slice(0,10), yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
            await this.ctx.storage.put('usage:'+yesterday,await this.ctx.storage.get('usage:'+today) ?? {tokens:0,estimatedTokens:0});
            await this.ctx.storage.delete('usage:'+today);
            const active=await this.ctx.storage.get('active');
            if(active) { for(const entry of Object.values(active.usage ?? {})) entry.day=yesterday; await this.ctx.storage.put('active',active); }
        }
    }
    export default { async fetch(req, env) {
        const path = new URL(req.url).pathname;
        if(path === '/test-expire') { await env.VOICE_SESSIONS.getByName('${A}').expire(); return Response.json({ok:true}); }
        if(path === '/test-state') return Response.json(await env.VOICE_SESSIONS.getByName('${A}').snapshot());
        if(path === '/test-legacy-limit') { await env.VOICE_SESSIONS.getByName('${A}').legacyLimit(); return Response.json({ok:true}); }
        if(path === '/test-rollover') { await env.VOICE_SESSIONS.getByName('${A}').rollover(); return Response.json({ok:true}); }
        return worker.fetch(req, env);
    }};`, resolveDir: process.cwd(), sourcefile: 'voice-test-entry.ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], target: 'es2022' });
const mock = `
import { DurableObject } from 'cloudflare:workers';
export class Fixture extends DurableObject { constructor(ctx, env) { super(ctx, env);
let sockets = [], calls = 0, hangups = 0, messages = new Map(), allowed = true;
this.handle = async (req) => {
    const u = new URL(req.url), path = u.pathname;
    if (path === '/fixture') {
        if(req.method === 'POST') { const b = await req.json(); if(b.allowed !== undefined) allowed = b.allowed; if(b.event) sockets.at(-1).send(JSON.stringify(b.event)); }
        return Response.json({ calls, hangups, messages: [...messages.values()] });
    }
    if (path === '/auth/v1/user') {
        if (!['Bearer user-a', 'Bearer user-b'].includes(req.headers.get('Authorization'))) return Response.json({message:'Invalid token'}, {status:401});
        return Response.json({ id: req.headers.get('Authorization')?.endsWith('user-b') ? '${B}' : '${A}', aud: 'authenticated' });
    }
    if (path === '/rest/v1/rpc/effective_user_ai_access') return Response.json(allowed);
    if (path === '/rest/v1/coach_conversations') return Response.json(u.searchParams.get('user_id') === 'eq.${A}' ? { id: '${conversationId}' } : null);
    if (path === '/rest/v1/coach_chat_turns' || path === '/rest/v1/ai_coaching_preferences') return Response.json([]);
    if (path === '/rest/v1/coach_voice_messages') {
        if(req.method === 'POST') { const b = await req.json(); if(b.user_id !== '${A}' || b.conversation_id !== '${conversationId}') throw new Error('wrong transcript owner'); messages.set(b.session_id+':'+b.item_id, b); return new Response(null,{status:201}); }
        return Response.json([]);
    }
    if (path === '/v1/realtime/calls') {
        calls++; const data = await req.formData(), config = JSON.parse(data.get('session'));
        if(config.max_output_tokens !== 512 || config.tools.length !== 0) throw new Error('unsafe config');
        return new Response('v=0\\r\\nanswer', { headers: { Location: 'https://api.openai.com/v1/realtime/calls/rtc_'+calls } });
    }
    if (path === '/v1/realtime') { const pair = new WebSocketPair(); pair[1].accept(); sockets.push(pair[1]); return new Response(null,{status:101,webSocket:pair[0]}); }
    if (path.endsWith('/hangup')) { hangups++; return new Response(null,{status:200}); }
    throw new Error('Unexpected external request: '+path);
}; } fetch(req) { return this.handle(req); } }
export default { fetch(req, env) { return env.FIXTURE.getByName('fixture').fetch(req); } };`;
const mf = new Miniflare({ workers: [{ name: 'voice', modules: [{ type: 'ESModule', path: 'voice-test-entry.js', contents: bundle.outputFiles[0].text }],
    routes: ['voice.test/*', 'nvzn-journal.com/*', 'evil.example/*'],
    compatibilityDate: '2026-06-25', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { VOICE_SESSIONS: { className: 'TestVoiceSession', useSQLite: true } }, outboundService: 'mock',
    bindings: { VOICE_ENABLED: 'true', APP_ORIGIN: 'https://nvzn-journal.com', SUPABASE_URL: 'https://supabase.test',
        VOICE_MODEL: 'gpt-realtime-mini', OPENAI_API_KEY: 'test-not-a-key', SB_SECRET_KEY: 'test-not-a-key' } },
    { name: 'mock', modules: true, script: mock, compatibilityDate: '2026-06-25',
        durableObjects: { FIXTURE: { className: 'Fixture', useSQLite: true } } }] });
try {
    const worker = await mf.getWorker('voice'), fixture = await mf.getWorker('mock');
    const request = (path, body = {}, token = 'user-a', origin = 'https://nvzn-journal.com') => worker.fetch('https://voice.test/'+path,
        { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer '+token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = () => ({ sessionId: crypto.randomUUID(), conversationId, voice: 'cedar', sdp: 'v=0\r\noffer',
        context: { capturedAt: '2026-10-08T12:00:00Z', tradeDate: '2026-10-08', accountIds: null, dataReady: false, summary: null } });
    const stats = async () => (await fixture.fetch('https://mock.test/fixture')).json();
    const event = async value => { await fixture.fetch('https://mock.test/fixture', { method:'POST', body:JSON.stringify({event:value}) }); };
    const waitFor = async condition => { for(let i=0; i<50; i++) { if(await condition(await stats())) return; await new Promise(r=>setTimeout(r,20)); } assert.fail('Timed out waiting for mock sideband event'); };
    assert.equal((await request('start', payload(), 'user-a', 'https://evil.example')).status, 403);
    assert.equal((await request('start', payload(), 'invalid-token')).status, 401);
    assert.equal((await request('start', payload(), 'user-b')).status, 404);
    const invalid = await request('start', {}); assert.equal(invalid.status, 400, await invalid.text());
    const one = payload();
    await worker.fetch('https://voice.test/test-legacy-limit'); // Old call-count limits don't lock users out after deployment.
    const first = await request('start', one); assert.equal(first.status, 200, await first.text());
    // An established WebSocket must outlive the provider's 15-second HTTP timeout.
    await new Promise(resolve => setTimeout(resolve, 16000));
    assert.equal((await stats()).hangups, 0, 'A healthy call must survive the HTTP connection timeout');
    assert.equal((await (await request('heartbeat', { sessionId: one.sessionId })).json()).ended, false);
    assert.equal((await request('start', payload())).status, 409);
    assert.equal((await request('end', { sessionId: one.sessionId }, 'user-b')).status, 200);
    assert.equal((await stats()).hangups, 0); // Another user cannot terminate A's call.
    await fixture.fetch('https://mock.test/fixture', { method: 'POST', body: JSON.stringify({ event: {
        type: 'response.output_audio_transcript.done', item_id: 'item_test', transcript: 'Review your sizing.' } }) });
    for (let i=0; i<30 && !(await stats()).messages.length; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal((await stats()).messages[0]?.content, 'Review your sizing.');
    await fixture.fetch('https://mock.test/fixture', { method: 'POST', body: JSON.stringify({ event: { type: 'conversation.item.truncated', item_id: 'item_test' } }) });
    for (let i=0; i<30 && !(await stats()).messages[0]?.interrupted; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal((await stats()).messages[0]?.interrupted, true);
    await worker.fetch('https://voice.test/test-expire');
    assert.equal((await stats()).hangups, 1); // Alarm ends the provider call without browser cooperation.
    assert.equal((await (await worker.fetch('https://voice.test/test-state')).json()).active, undefined);
    for(let i=0;i<2;i++) {
        const p=payload(), itemId='item_end_'+i; assert.equal((await request('start',p)).status,200);
        await event({ type:'response.output_audio_transcript.done', item_id:itemId, transcript:'Review your plan.' });
        await waitFor(s => s.messages.some(m => m.item_id===itemId));
        if(i===1) { await event({ type:'output_audio_buffer.stopped' }); await new Promise(r=>setTimeout(r,30)); }
        await request('end',{sessionId:p.sessionId});
        const saved=(await stats()).messages.find(m=>m.item_id===itemId);
        assert.equal(saved.interrupted, i===0); // End mid-speech omits unplayed words; completed playback stays saved.
    }
    const fourth=payload();
    assert.equal((await request('start', { ...fourth, usage:{tokens:0}, limit:99999999 })).status, 200);
    assert.equal((await stats()).calls, 4); // More than three calls is allowed; starts alone cost no tokens.
    const usage = async () => (await (await worker.fetch('https://voice.test/test-state')).json()).usage;
    const done = { type:'response.done', response:{ id:'resp_metered', status:'cancelled', usage:{total_tokens:48000} } };
    await event(done); await waitFor(async () => (await usage())?.tokens===48000);
    await event(done); // Duplicate delivery must not charge twice.
    await event({type:'conversation.item.input_audio_transcription.completed', item_id:'input_metered',transcript:'Review sizing.',usage:{type:'tokens',total_tokens:2500}});
    await waitFor(s => s.hangups===4);
    await waitFor(async () => !(await (await worker.fetch('https://voice.test/test-state')).json()).active);
    assert.equal((await usage()).tokens,50500);
    const expired=await (await request('heartbeat',{sessionId:fourth.sessionId})).json();
    assert.equal(expired.ended,true); assert.match(expired.message,/Daily voice allowance reached/);
    assert.equal(expired.usage.remainingTokens,0);
    const rejected=await request('start',payload()); assert.equal(rejected.status,429);
    assert.match((await rejected.json()).error,/Text chat is still available/);
    assert.equal((await stats()).calls,4);
    await worker.fetch('https://voice.test/test-rollover');
    const fifth=payload(); assert.equal((await request('start',fifth)).status,200);
    await event({type:'response.created',response:{id:'resp_midnight'}});
    await waitFor(async () => !!(await (await worker.fetch('https://voice.test/test-state')).json()).active?.usage?.['response:resp_midnight']);
    await worker.fetch('https://voice.test/test-rollover');
    await event({type:'response.done',response:{id:'resp_midnight',usage:{total_tokens:2000}}});
    await waitFor(async () => (await (await worker.fetch('https://voice.test/test-state')).json()).active?.usage?.['response:resp_midnight']?.tokens===2000);
    assert.equal((await usage())?.tokens ?? 0,0); // Completion after midnight is attributed to the turn's original day.
    await request('end',{sessionId:fifth.sessionId});
    const sixth=payload(); assert.equal((await request('start',sixth)).status,200);
    await event({type:'response.created',response:{id:'resp_unreported'}});
    await waitFor(async () => !!(await (await worker.fetch('https://voice.test/test-state')).json()).active?.usage?.['response:resp_unreported']);
    await request('end',{sessionId:sixth.sessionId});
    assert.equal((await usage()).estimatedTokens,32768); // Ending before final usage isn't a free quota bypass.
    assert.equal((await usage()).tokens,0);
    for(let i=0;i<4;i++) { const p=payload(); assert.equal((await request('start',p)).status,200); await request('end',{sessionId:p.sessionId}); }
    const throttled=await request('start',payload()); assert.equal(throttled.status,429);
    assert.match((await throttled.json()).error,/Wait a minute/);
    await fixture.fetch('https://mock.test/fixture', { method: 'POST', body: JSON.stringify({ allowed: false }) });
    assert.equal((await request('start', payload(), 'user-b')).status, 403);
    assert.equal((await stats()).calls, 10);
    console.log('PASS: voice Worker lifecycle, token accounting/deduplication, UTC reset, mid-call quota, missing usage, start throttle and entitlement denial');
} finally { await mf.dispose(); }
