import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, get, set } from 'firebase/database';
import { readFileSync } from 'node:fs';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'uno-arena-test',
    database: { rules: readFileSync('database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 },
  });
  // Seed a room with two members via the privileged context.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, 'rooms/R1/members/alice'), true);
    await set(ref(db, 'rooms/R1/members/bob'), true);
    await set(ref(db, 'rooms/R1/public'), { turnId: 'alice' });
    await set(ref(db, 'hands/R1/alice'), { cards: [] });
    await set(ref(db, 'hands/R1/bob'), { cards: [] });
  });
});
afterAll(async () => { await env.cleanup(); });

describe('RTDB rules', () => {
  it('a member can read public state', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertSucceeds(get(ref(db, 'rooms/R1/public')));
  });
  it('a non-member cannot read the room', async () => {
    const db = env.authenticatedContext('eve').database();
    await assertFails(get(ref(db, 'rooms/R1/public')));
  });
  it('a player can read their own hand', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertSucceeds(get(ref(db, 'hands/R1/alice')));
  });
  it('a player cannot read another player hand', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertFails(get(ref(db, 'hands/R1/bob')));
  });
  it('a client cannot write public state directly', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertFails(set(ref(db, 'rooms/R1/public/turnId'), 'alice'));
  });
  it('a client cannot write a hand directly', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertFails(set(ref(db, 'hands/R1/alice'), { cards: [{ id: 'x', color: 'red', kind: 'number', value: 1 }] }));
  });
  it('a member can post a chat message authored by themselves', async () => {
    const db = env.authenticatedContext('alice').database();
    await assertSucceeds(set(ref(db, 'rooms/R1/chat/m1'),
      { uid: 'alice', name: 'Alice', kind: 'text', body: 'hi', ts: Date.now() }));
  });
});
