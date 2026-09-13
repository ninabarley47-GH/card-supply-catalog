import test from 'node:test';
import assert from 'node:assert/strict';
import { runCoverSheetAction } from './library.js';
import { createCoverSheetForPack, saveCoverSheet, createCoverSheetFileName } from './cover-sheet.js';

test('cover sheet shows progress immediately, prevents duplicate clicks and reports its saved destination', async () => {
  const button = { disabled: false }, status = {};
  let finish, calls = 0;
  const create = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const pending = runCoverSheetAction(button, status, {}, {}, create);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Creating Cover Sheet...');
  assert.equal(status.hidden, false);
  await runCoverSheetAction(button, status, {}, {}, create);
  assert.equal(calls, 1);
  finish({ savedToFolder: true, folderName: 'Exports', fileName: 'Paper.png' });
  await pending;
  assert.equal(status.textContent, 'Cover sheet saved to Exports: Paper.png');
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Create Cover Sheet');
});

for (const [result, expected] of [
  [undefined, 'Cover sheet creation cancelled.'],
  [{ savedWithPicker: true, fileName: 'paper.png' }, 'Cover sheet saved: paper.png'],
  [{ savedToFolder: false, fileName: 'paper.png' }, 'Cover sheet sent to browser downloads: paper.png']
]) test(expected, async () => {
  const button = {}, status = {};
  await runCoverSheetAction(button, status, {}, {}, async () => result);
  assert.equal(status.textContent, expected);
  assert.equal(button.disabled, false);
});

test('generation errors are visible and the action can be retried', async t => {
  t.mock.method(console, 'error', () => {});
  const button = {}, status = {};
  await runCoverSheetAction(button, status, { patterns: [] }, {});
  assert.match(status.textContent, /does not have any pattern images/);
  assert.equal(button.disabled, false);
});

test('Save As reports success only after the PNG is written and closed', async () => {
  const operations = [];
  const blob = new Blob(['png']);
  const result = await saveCoverSheet(blob, { name: 'Paper' }, { fileHandle: {
    createWritable: async () => ({
      write: async value => { assert.equal(value, blob); operations.push('write'); },
      close: async () => operations.push('close')
    })
  } });
  assert.deepEqual(operations, ['write', 'close']);
  assert.deepEqual(result, { savedToFolder: false, savedWithPicker: true, fileName: 'Paper.png' });
});

test('full cover sheet generation returns delivery metadata and writes a PNG with print resolution', async t => {
  const originals = new Map(['window', 'document', 'Image', 'showSaveFilePicker'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  let written;
  globalThis.showSaveFilePicker = async () => ({
    createWritable: async () => ({ write: async blob => { written = blob; }, close: async () => {} })
  });
  globalThis.window = globalThis;
  const drawing = new Proxy({ measureText: () => ({ width: 10 }) }, {
    get: (target, key) => key in target ? target[key] : () => {}
  });
  const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });
  globalThis.document = { createElement: tag => {
    assert.equal(tag, 'canvas');
    return { getContext: () => drawing, toBlob: callback => callback(png) };
  } };
  globalThis.Image = class {
    naturalWidth = 100; naturalHeight = 100;
    set src(value) { queueMicrotask(() => this.onload()); }
  };
  const result = await createCoverSheetForPack({ name: 'Paper', patterns: [{ imageSrc: 'data:image/png;base64,test' }], colors: [] }, {});
  assert.equal(result.savedWithPicker, true);
  assert.equal(result.fileName, 'Paper.png');
  assert.equal(written.type, 'image/png');
  const bytes = Buffer.from(await written.arrayBuffer());
  assert.equal(bytes.subarray(37, 41).toString(), 'pHYs');
  assert.equal(bytes.readUInt32BE(41), 11811);
});

test('cover sheets use display names and replace only the matching file on repeated saves', async () => {
  const files = new Map([['Glow of Harvest.png', 'old'], ['Other.png', 'keep']]);
  const directoryHandle = {
    name: 'All Cover Sheets',
    getFileHandle: async (name, options) => {
      assert.equal(name, 'Glow of Harvest.png');
      assert.deepEqual(options, { create: true });
      return { createWritable: async () => ({
        write: async blob => { files.set(name, await blob.text()); },
        close: async () => {}
      }) };
    }
  };
  for (const content of ['first', 'second']) {
    const result = await saveCoverSheet(new Blob([content]), { name: 'Glow of Harvest' }, { directoryHandle }, {
      download: () => assert.fail('should save to chosen folder'),
      loadCatalogSetting: () => assert.fail('must not look up owner or backup settings')
    });
    assert.equal(result.fileName, 'Glow of Harvest.png');
    assert.equal(result.folderName, 'All Cover Sheets');
    assert.equal(files.get('Glow of Harvest.png'), content);
  }
  assert.equal(files.get('Other.png'), 'keep');
  assert.equal(files.size, 2);
});

test('cover sheet names preserve spaces, case and Unicode while removing invalid filename characters', () => {
  assert.equal(createCoverSheetFileName('Glow of Harvest'), 'Glow of Harvest.png');
  assert.equal(createCoverSheetFileName('Foil & Flowers'), 'Foil & Flowers.png');
  assert.equal(createCoverSheetFileName('Caf\u00e9 Paper'), 'Caf\u00e9 Paper.png');
  assert.equal(createCoverSheetFileName('Paper / Gold: 12'), 'Paper - Gold- 12.png');
  assert.equal(createCoverSheetFileName('CON'), '_CON.png');
  assert.equal(createCoverSheetFileName(''), 'Untitled Paper Pack.png');
});

for (const failure of ['lookup', 'open', 'write', 'close']) {
  test('cover sheet ' + failure + ' failure downloads the same image with its display name', async () => {
    const blob = new Blob(['complete image']);
    let downloaded;
    const fail = point => { if (point === failure) throw new Error(point); };
    const result = await saveCoverSheet(blob, { name: 'Glow of Harvest' }, {
      directoryHandle: { getFileHandle: async () => {
        fail('lookup');
        return { createWritable: async () => {
          fail('open');
          return { write: async () => fail('write'), close: async () => fail('close') };
        } };
      } }
    }, { download: (value, name) => { assert.equal(value, blob); downloaded = name; } });
    assert.equal(downloaded, 'Glow of Harvest.png');
    assert.equal(result.savedToFolder, false);
  });
}
