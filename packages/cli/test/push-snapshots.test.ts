import { describe, expect, it } from 'vitest';

import {
  createMemorySnapshotStore,
  pushSnapshotsToWeb,
  uploadFilesFromSnapshotStore,
} from '@redis-detective/cli';

import { snapshotFixture } from './helpers/snapshot-builder.js';

describe('pushSnapshotsToWeb', () => {
  it('POSTs snapshot files with a Bearer token and treats 202 as success', async () => {
    const store = createMemorySnapshotStore([
      snapshotFixture({ snapshotId: 'a', capturedAt: '2026-09-20T00:00:00.000Z' }),
    ]);
    const files = await uploadFilesFromSnapshotStore(store);
    const calls: { url: string; authorization: string | null; names: string[] }[] = [];

    const result = await pushSnapshotsToWeb(
      {
        webUrl: 'https://app.example.com/',
        instanceId: 'inst-1',
        token: 'rdp_secret',
      },
      files,
      async (url, init) => {
        const body = init?.body;
        if (!(body instanceof FormData)) {
          throw new Error('expected FormData');
        }
        calls.push({
          url,
          authorization: new Headers(init?.headers).get('authorization'),
          names: body.getAll('snapshots').map((item) => (item instanceof File ? item.name : '')),
        });
        return new Response('{"ok":true}\n', { status: 202 });
      },
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        url: 'https://app.example.com/api/instances/inst-1/snapshots',
        authorization: 'Bearer rdp_secret',
        names: [files[0]?.name],
      },
    ]);
  });

  it('surfaces a 409 busy response without inventing a network failure', async () => {
    const result = await pushSnapshotsToWeb(
      { webUrl: 'https://app.example.com', instanceId: 'inst-1', token: 'rdp_secret' },
      [{ name: 'a.snapshot.json', contents: '{}' }],
      async () => new Response('A run is already in progress for this instance.\n', { status: 409 }),
    );

    expect(result).toEqual({
      ok: false,
      status: 409,
      message: 'A run is already in progress for this instance.',
    });
  });
});
