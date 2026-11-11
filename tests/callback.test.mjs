import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCallback, stockholmTime } from '../lib/calendar.mjs';
import { saveRequest } from '../lib/callback-storage.mjs';

const requestId = '01234567-89ab-4cde-8f01-234567890123';

test('Stockholm time handles daylight saving changes and rejects nonexistent times', () => {
  assert.equal(stockholmTime('2026-03-28T12:00').toISOString(), '2026-03-28T11:00:00.000Z');
  assert.equal(stockholmTime('2026-03-30T12:00').toISOString(), '2026-03-30T10:00:00.000Z');
  assert.throws(() => stockholmTime('2026-03-29T02:30'));
  assert.throws(() => stockholmTime('2026-02-31T12:00'));
});

test('fallback selects the first available hour and creates a transparent test event', async () => {
  const originalFetch = globalThis.fetch;
  let event;
  globalThis.fetch = async (url, options) => {
    if (url.includes('freeBusy')) {
      return Response.json({ calendars: { cal: { busy: [
        { start: '2026-11-11T10:00:00Z', end: '2026-11-11T11:00:00Z' }
      ] } } });
    }
    event = JSON.parse(options.body);
    return Response.json({});
  };
  try {
    await saveCallback({ calendarId: 'cal', token: 'test', phone: '0700000000', name: 'Kim', requestId, testTime: '', now: new Date('2026-11-11T09:00:00Z') });
    assert.equal(event.start.dateTime, '2026-11-11T11:00:00.000Z');
    assert.equal(event.transparency, 'transparent');
    assert.match(event.description, /Ingen servicetid är bokad/);
    assert.match(event.description, /Namn: Kim/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('optional name is saved and retries cannot change it', async () => {
  const originalFetch = globalThis.fetch;
  let written;
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === 'PATCH') {
      written = JSON.parse(options.body);
      return Response.json(written);
    }
    return Response.json(written);
  };
  try {
    await saveRequest({ project: 'test', token: 'test', requestId, phone: '0700000000', name: 'Kim', testTime: '' });
    assert.equal(written.fields.name.stringValue, 'Kim');
    globalThis.fetch = async (_url, options = {}) => options.method === 'PATCH'
      ? new Response('', { status: 409 })
      : Response.json(written);
    await saveRequest({ project: 'test', token: 'test', requestId, phone: '0700000000', name: 'Kim', testTime: '' });
    await assert.rejects(saveRequest({ project: 'test', token: 'test', requestId, phone: '0700000000', name: 'Alex', testTime: '' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a repeated request is accepted only when its saved data matches', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => options.method === 'PATCH'
    ? new Response('', { status: 409 })
    : Response.json({ fields: { phone: { stringValue: '0700000000' }, testTime: { stringValue: '' } } });
  try {
    await saveRequest({ project: 'test', token: 'test', requestId, phone: '0700000000', testTime: '' });
    await assert.rejects(saveRequest({ project: 'test', token: 'test', requestId, phone: '0700000001', testTime: '' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a failed write without a verifiable existing document is not confirmed', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 403 });
  try {
    await assert.rejects(saveRequest({ project: 'test', token: 'test', requestId, phone: '0700000000', testTime: '' }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
