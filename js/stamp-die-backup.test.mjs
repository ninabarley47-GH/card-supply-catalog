import { hydrateStampImages, clearStampImageSources, getStampDetailImageSource } from './stamp-die-images.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatalogBackup, createCatalogBackupSnapshot, createIpadCatalogBackup,
  restoreCatalogBackup, validateBackup, summarizeBackupOverwrites } from './backup.js';
import { normalizeStampDieSet } from './stamp-die-sets.js';
import { BACKUP_SCHEMA_VERSION, CATALOG_SCHEMA_VERSION } from './schema.js';

const embedded = 'data:image/jpeg;base64,YQ==';
const thumbnail = 'data:image/jpeg;base64,Yg==';
const tagCatalog = { schemaVersion: 1,
  categories: [{ id: 'nature', name: 'Nature' }],
  tags: [{ id: 'floral', name: 'Floral', categoryIds: ['nature'] }, { id: 'mask', name: 'Mask', categoryIds: [] }] };
const owners = [{ id: 'owner-1', name: 'Tester' }];
const folder = { imageName: 'Die.jpg', imageLibrary: 'stamp-die-images', imagePath: 'Garden/Die.jpg',
  thumbnailImagePath: 'Garden/Die.thumb.jpg', imageStorageStrategy: 'local-folder' };
function sets() {
  return [[], [{ imageName: 'Stamp.jpg', imageSrc: embedded, thumbnailImageSrc: thumbnail, imageStorageStrategy: 'embedded-indexed-db' }],
    [folder], [{ imageName: 'Stamp.jpg', imageSrc: embedded }, folder,
      { imageName: 'Mask.jpg', imagePath: 'Mask.jpg', imageLibrary: 'stamp-die-images', imageSrc: embedded, thumbnailImageSrc: thumbnail }]]
    .map((imageRefs, index) => ({ id: `set-${index}`, name: `Set ${index}`, ownerId: 'owner-1', releaseYear: 2024,
      favorite: true, tagIds: ['floral', 'mask'], dateCreated: '2026-09-05', imageRefs: structuredClone(imageRefs) }));
}
const paper = { id: 'paper', name: 'Paper', ownerId: 'owner-1', releaseYear: 2024, patternCount: 0, colors: [], tagIds: [], patterns: [] };
const card = { id: 'card', dateCreated: '2026-09-05', size: { width: 4, height: 6 }, tagIds: [], paperPackIds: [], colorIds: [], favorite: false };
const color = { id: 'blue', name: 'Blue', hex: '#123456', rgb: [18, 52, 86], family: 'unknown', colorFamily: 'blue', status: 'unknown', aliases: [], products: {} };
function snapshot(overrides = {}) {
  return createCatalogBackupSnapshot({ paperPacks: [paper], cards: [card], colorsById: { blue: color },
    owners, stampDieSets: sets(), tagCatalog, ...overrides });
}
function restoreServices(overrides = {}) {
  return { loadGlobalTagCatalog: async () => ({ schemaVersion: 1, tags: [], categories: [] }),
    loadSavedCards: async () => [], loadSavedStampDieRecordsForRestore: async () => [],
    preparePaperPack: async (paperPack) => ({ paperPack }),
    dispatchCardsRestored() {}, dispatchStampSetsRestored() {}, ...overrides };
}

test('standard snapshot includes all normalized Set fields and reference shapes, strips runtime fields, and retains Paper/Card data', () => {
  const records = sets();
  records[1].directoryHandle = { secret: 'never export' }; records[1].draft = 'never export';
  records[1].imageRefs[0].imagePreviewSrc = 'blob:transient';
  records[1].imageRefs[0].fileHandle = { secret: 'never export' };
  const before = structuredClone(records);
  const backup = snapshot({ stampDieSets: records });
  assert.equal(backup.schemaVersion, 4); assert.equal(BACKUP_SCHEMA_VERSION, 4);
  assert.equal(backup.catalogSchemaVersion, CATALOG_SCHEMA_VERSION);
  assert.deepEqual(backup.stampDieSets, records.map((record) => normalizeStampDieSet(record, tagCatalog)));
  assert.deepEqual(records, before);
  assert.doesNotMatch(JSON.stringify(backup), /blob:|never export|directoryHandle|fileHandle/);
  assert.equal(backup.imageStorage.embeddedImages, 3);
  assert.equal(backup.imageStorage.folderImageReferences, 3);
  const baseline = snapshot({ stampDieSets: [] });
  for (const key of ['paperPacks', 'cards', 'colors', 'owners', 'tagCatalog']) assert.deepEqual(backup[key], baseline[key]);
  assert.equal(validateBackup(backup).ok, true);
});

test('standard export loads persisted Sets and all three descriptive settings without reading or mutating files', async () => {
  const setting = { strategy: 'local-folder', selectedAt: '2026-09-05T00:00:00Z', directoryHandle: {
    name: 'Images', queryPermission: () => assert.fail('standard export cannot request permission'),
    getFileHandle: () => assert.fail('standard export cannot access source files'),
    removeEntry: () => assert.fail('no deletion') }, absolutePath: 'C:/private', permission: 'granted' };
  const ids = [];
  const backup = await createCatalogBackup({ paperPacks: [], colorsById: {}, owners,
    services: { loadCatalogSetting: async (id) => { ids.push(id); return setting; },
      loadSavedCards: async () => [], loadSavedStampDieSets: async () => sets(), loadGlobalTagCatalog: async () => tagCatalog } });
  assert.deepEqual(ids, ['imageLibrary', 'cardImageLibrary', 'stampDieImageLibrary']);
  for (const key of ['configuredLibrary', 'configuredCardLibrary', 'configuredStampDieLibrary']) {
    assert.deepEqual(backup.imageStorage[key], { strategy: 'local-folder', folderName: 'Images', selectedAt: setting.selectedAt });
  }
  assert.doesNotMatch(JSON.stringify(backup), /directoryHandle|absolutePath|private|permission/);
  assert.equal(backup.stampDieSets.length, 4);
});

test('mixed catalog round-trips through one restore call with stable IDs and complete images', async () => {
  const backup = JSON.parse(JSON.stringify(snapshot()));
  let state = {}; let commits = 0; let refreshes = 0;
  const summary = await restoreCatalogBackup({ backup, paperPacks: [], colorsById: {}, owners: [], services: restoreServices({
    restoreCatalogRecords: async (records) => { state = structuredClone(records); commits++; },
    dispatchStampSetsRestored: () => { refreshes++; }
  }) });
  assert.deepEqual(summary.errors, []); assert.equal(commits, 1); assert.equal(refreshes, 1);
  assert.equal(summary.setsImported, 4); assert.equal(summary.cardsImported, 1); assert.equal(summary.packsImported, 1);
  assert.deepEqual(state.stampDieSets, backup.stampDieSets);
  assert.deepEqual(state.owners, backup.owners); assert.deepEqual(state.tagCatalog, backup.tagCatalog);
  assert.deepEqual(state.cards, backup.cards);
  assert.match(summary.warnings.join(' '), /Stamp & Die image folders/);
});

for (const [label, change] of [
  ['section', (b) => { b.stampDieSets = {}; }],
  ['null record', (b) => { b.stampDieSets[0] = null; }],
  ['id', (b) => { b.stampDieSets[0].id = ''; }],
  ['duplicate id', (b) => { b.stampDieSets[1].id = b.stampDieSets[0].id; }],
  ['name', (b) => { b.stampDieSets[0].name = ' '; }],
  ['releaseYear', (b) => { b.stampDieSets[0].releaseYear = '2024'; }],
  ['owner type', (b) => { b.stampDieSets[0].ownerId = 1; }],
  ['unknown owner', (b) => { b.stampDieSets[0].ownerId = 'absent'; }],
  ['missing owner registry', (b) => { delete b.owners; }],
  ['favorite', (b) => { b.stampDieSets[0].favorite = 'true'; }],
  ['creation date', (b) => { b.stampDieSets[0].dateCreated = '2026-02-30'; }],
  ['tag shape', (b) => { b.stampDieSets[0].tagIds = 'floral'; }],
  ['unknown tag', (b) => { b.stampDieSets[0].tagIds = ['absent']; }],
  ['category assignment', (b) => { b.stampDieSets[0].tagIds = ['nature']; }],
  ['invalid category', (b) => { b.tagCatalog.tags[0].categoryIds = ['absent']; }],
  ['image array', (b) => { b.stampDieSets[0].imageRefs = null; }],
  ['absolute image path', (b) => { b.stampDieSets[2].imageRefs[0].imagePath = 'C:/Images/a.jpg'; }],
  ['traversal', (b) => { b.stampDieSets[2].imageRefs[0].imagePath = '../a.jpg'; }],
  ['blob image', (b) => { b.stampDieSets[1].imageRefs[0].imageSrc = 'blob:temporary'; }],
  ['invalid thumbnail', (b) => { b.stampDieSets[1].imageRefs[0].thumbnailImageSrc = 'not an image'; }],
  ['invalid strategy', (b) => { b.stampDieSets[2].imageRefs[0].imageStorageStrategy = 'unknown'; }]
]) {
  test(`malformed Stamp ${label} aborts before storage access or any catalog change`, async () => {
    const backup = snapshot(); change(backup);
    const paperPacks = [{ sentinel: 'paper' }], colorsById = { sentinel: 'color' }, localOwners = [{ sentinel: 'owner' }];
    const before = structuredClone({ paperPacks, colorsById, localOwners });
    const summary = await restoreCatalogBackup({ backup, paperPacks, colorsById, owners: localOwners,
      services: { loadGlobalTagCatalog: () => assert.fail('validation must precede reads'),
        restoreCatalogRecords: () => assert.fail('invalid backup cannot write') } });
    assert.ok(summary.errors.length); assert.equal(summary.setsImported, 0);
    assert.deepEqual({ paperPacks, colorsById, localOwners }, before);
  });
}

for (const version of [2, 3, 4]) {
  test(`version ${version} backup without Sets/config imports without creating or clearing Sets`, async () => {
    const backup = snapshot({ stampDieSets: [] }); backup.schemaVersion = version;
    delete backup.stampDieSets; delete backup.imageStorage.configuredStampDieLibrary;
    if (version === 2) {
      delete backup.tagCatalog; backup.paperPacks.forEach((r) => { delete r.tagIds; r.keywords = []; });
      backup.cards.forEach((r) => { delete r.tagIds; r.tags = []; });
    }
    let restored;
    const summary = await restoreCatalogBackup({ backup, paperPacks: [], colorsById: {}, services: restoreServices({
      loadSavedStampDieRecordsForRestore: () => assert.fail('no Stamp import needs no Stamp planning'),
      restoreCatalogRecords: async (records) => { restored = records; }
    }) });
    assert.deepEqual(summary.errors, []); assert.equal(summary.setsImported, 0); assert.deepEqual(restored.stampDieSets, []);
  });
}

test('legacy Sets may omit owner/release year; normalization matches the live app', async () => {
  const backup = snapshot(); delete backup.stampDieSets[0].ownerId; delete backup.stampDieSets[0].releaseYear;
  backup.stampDieSets[0].name = '  Trim me  ';
  assert.equal(validateBackup(backup).ok, true);
  let restored;
  await restoreCatalogBackup({ backup, paperPacks: [], colorsById: {}, services: restoreServices({ restoreCatalogRecords: async (r) => { restored = r; } }) });
  assert.equal(restored.stampDieSets[0].name, 'Trim me'); assert.equal('releaseYear' in restored.stampDieSets[0], false);
});

test('Set tag IDs follow canonical reconciliation while existing local IDs and owner IDs remain valid', async () => {
  const localCatalog = { schemaVersion: 1, categories: [{ id: 'local-nature', name: 'Nature' }],
    tags: [{ id: 'local-floral', name: 'Floral', categoryIds: ['local-nature'] }] };
  const localOwners = [{ id: 'same-name-local-id', name: 'Tester' }];
  let restored;
  const summary = await restoreCatalogBackup({ backup: snapshot(), paperPacks: [], colorsById: {}, owners: localOwners,
    services: restoreServices({ loadGlobalTagCatalog: async () => localCatalog, restoreCatalogRecords: async (r) => { restored = r; } }) });
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(restored.stampDieSets[0].tagIds, ['local-floral', 'mask']);
  assert.equal(restored.stampDieSets[0].ownerId, 'owner-1');
  assert.ok(restored.owners.some((o) => o.id === 'same-name-local-id'));
  assert.ok(restored.owners.some((o) => o.id === 'owner-1'));
});

for (const overwriteExisting of [false, true]) {
  test(`Set import obeys existing skip/replace behavior (overwrite=${overwriteExisting})`, async () => {
    let restored;
    const summary = await restoreCatalogBackup({ backup: snapshot(), paperPacks: [], colorsById: {}, overwriteExisting,
      services: restoreServices({ loadSavedStampDieRecordsForRestore: async () => [{ id: 'set-0', name: 'Local' }],
        restoreCatalogRecords: async (r) => { restored = r; } }) });
    assert.deepEqual(summary.errors, []); assert.equal(summary.setsSkipped, overwriteExisting ? 0 : 1);
    assert.equal(restored.stampDieSets.length, overwriteExisting ? 4 : 3);
  });
}

test('Set-only overwrite requires the existing replacement confirmation', async () => {
  const result = await summarizeBackupOverwrites(snapshot(), [], {}, restoreServices({
    loadSavedStampDieRecordsForRestore: async () => [{ id: 'set-0' }]
  }));
  assert.equal(result.requiresConfirmation, true); assert.match(result.message, /1 Stamp & Die Set/);
});

test('failed atomic commit leaves runtime collections unchanged and emits no restore event', async () => {
  const paperPacks = [], colorsById = {}, localOwners = [];
  const summary = await restoreCatalogBackup({ backup: snapshot(), paperPacks, colorsById, owners: localOwners,
    services: restoreServices({ restoreCatalogRecords: async () => { throw new Error('Simulated transaction abort'); },
      dispatchStampSetsRestored: () => assert.fail('failed restore cannot refresh Sets') }) });
  assert.ok(summary.errors.length); assert.equal(summary.setsImported, 0);
  assert.deepEqual(paperPacks, []); assert.deepEqual(colorsById, {}); assert.deepEqual(localOwners, []);
});

test('compact export compresses accessible Set images with the shared policy and produces valid embedded references', async () => {
  let compressed = 0;
  const backup = await createIpadCatalogBackup({ paperPacks: [], colorsById: {}, owners, services: {
    loadSavedCards: async () => [], loadSavedStampDieSets: async () => sets(), loadGlobalTagCatalog: async () => tagCatalog,
    hydrateCardImageSources: async () => {}, hydrateStampImages: async (records) => {
      for (const record of records) for (const ref of record.imageRefs) if (ref.imagePath) ref.imagePreviewSrc = 'blob:read-only';
    }, compressImageSource: async () => { compressed++; return thumbnail; }
  } });
  assert.equal(compressed, 5); assert.equal(backup.imageStorage.compressedImages, 5);
  assert.equal(validateBackup(backup).ok, true);
  for (const ref of backup.stampDieSets.flatMap((r) => r.imageRefs)) {
    assert.equal(ref.imageSrc, thumbnail); assert.equal(ref.imageStorageStrategy, 'embedded-indexed-db');
    assert.equal(ref.imagePath, undefined); assert.equal(ref.thumbnailImageSrc, undefined);
  }
  assert.equal('configuredStampDieLibrary' in backup.imageStorage, false, 'compact excludes descriptive folders for all products');
  let restored;
  const summary = await restoreCatalogBackup({ backup, paperPacks: [], colorsById: {}, services: restoreServices({ restoreCatalogRecords: async (r) => { restored = r; } }) });
  assert.deepEqual(summary.errors, []); assert.deepEqual(restored.stampDieSets, backup.stampDieSets);
});

test('compact export preserves inaccessible paths and existing embedded originals/thumbnails if compression fails', async () => {
  const backup = await createIpadCatalogBackup({ paperPacks: [], colorsById: {}, owners, services: {
    loadSavedCards: async () => [], loadSavedStampDieSets: async () => sets(), loadGlobalTagCatalog: async () => tagCatalog,
    hydrateCardImageSources: async () => {}, hydrateStampImages: async () => {},
    compressImageSource: async () => { throw new Error('Decode unavailable'); }
  } });
  assert.deepEqual(backup.stampDieSets, sets().map((r) => normalizeStampDieSet(r, tagCatalog)));
  assert.equal(backup.imageStorage.missingImages, 3); assert.equal(validateBackup(backup).ok, true);
});

test('future versions fail safely and export refuses unknown Set owners', () => {
  const backup = snapshot(); backup.schemaVersion = BACKUP_SCHEMA_VERSION + 1;
  assert.equal(validateBackup(backup).ok, false);
  assert.throws(() => snapshot({ owners: [] }), /unknown owner/);
});

test('Stamp backup integration never calls filesystem mutation or image-save helpers', async () => {
  const source = await readFile(new URL('./backup.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /removeEntry|prepareStampImagesForSave|chooseStampImageDirectory/);
  const restore = source.slice(source.indexOf('export async function restoreCatalogBackup'), source.indexOf('function getImportedPaperPacksForVerification'));
  assert.doesNotMatch(restore, /createWritable|getDirectoryHandle|saveCatalogSetting|createDirectory|writeFile/);
});

test('restored folder references resolve after reconnect using reads only and preserve persisted metadata', async () => {
  let restored;
  await restoreCatalogBackup({ backup: snapshot(), paperPacks: [], colorsById: {}, services: restoreServices({
    restoreCatalogRecords: async (r) => { restored = r.stampDieSets; }
  }) });
  const before = structuredClone(restored);
  const root = {
    getDirectoryHandle: async (_name, options) => { assert.equal(options, undefined); return root; },
    getFileHandle: async (_name, options) => {
      assert.equal(options, undefined);
      return { getFile: async () => new Blob(['image'], { type: 'image/jpeg' }), createWritable: () => assert.fail('no writes') };
    }, removeEntry: () => assert.fail('no deletions')
  };
  await hydrateStampImages(restored, { loadDirectory: async () => root });
  assert.match(getStampDetailImageSource(restored[2].imageRefs[0]), /^blob:/);
  assert.equal(getStampDetailImageSource(restored[1].imageRefs[0]), embedded);
  clearStampImageSources(restored);
  assert.deepEqual(restored, before);
});

test('standard round-trip retains legacy Paper/Card and unknown image-library identities', async () => {
  const refs = [{ imagePath: 'legacy.jpg' }, { imagePath: 'card.jpg', imageLibrary: 'card-images' },
    { imagePath: 'other.jpg', imageLibrary: 'unknown-library' }];
  const records = [{ ...sets()[0], imageRefs: refs }];
  let restored;
  const summary = await restoreCatalogBackup({ backup: snapshot({ stampDieSets: records }), paperPacks: [], colorsById: {},
    services: restoreServices({ restoreCatalogRecords: async (r) => { restored = r; } }) });
  assert.deepEqual(summary.errors, []); assert.deepEqual(restored.stampDieSets[0].imageRefs, refs);
});
