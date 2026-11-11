import test from 'node:test';
import assert from 'node:assert/strict';
import { message, messageError, formatMessage } from '../web/core/messages.mjs';
import { importCdat } from '../web/core/cdat.mjs';
import { makeZip, demoEntries } from './fixtures.mjs';

test('English defaults, explicit German and nested diagnostic descriptors do not mutate data', () => {
  const error = messageError('cdat.multipleSources', { label: message('coverage.drivers') });
  const before = JSON.stringify(error.messageDescriptor);
  assert.equal(error.code, 'cdat.multipleSources');
  assert.match(error.message, /^Multiple sources for Reported device drivers/);
  assert.match(formatMessage(error, 'de'), /^Mehrere Quellen für Gemeldete Gerätetreiber/);
  assert.equal(formatMessage(error, 'fr'), error.message);
  assert.equal(JSON.stringify(error.messageDescriptor), before);
  assert.equal(formatMessage('Raw source: Geräteübersicht', 'en'), 'Raw source: Geräteübersicht');
  assert.equal(formatMessage(new Error('External detail')), 'External detail');
});

test('loaded capture coverage and collection notices can change language while evidence remains identical', async () => {
  const snapshot = await importCdat(new File([makeZip(demoEntries())], 'demo.zip'));
  const evidence = JSON.stringify({ device: snapshot.device, texts: snapshot.texts, sources: snapshot.sources, drivers: snapshot.drivers });
  const overview = snapshot.coverage.find(item => item.labelDescriptor.key === 'coverage.quick');
  assert.equal(overview.label, 'Device overview');
  assert.equal(formatMessage(overview.labelDescriptor, 'de'), 'Geräteübersicht');
  assert.match(formatMessage(overview.detailDescriptor, 'de'), /fehlgeschlagene Abfrage/);
  const warning = snapshot.warnings.find(item => item.kind === 'collection');
  assert.match(warning.message, /^Failed CDAT query:/);
  assert.match(formatMessage(warning.messageDescriptor, 'de'), /^Fehlgeschlagene CDAT-Abfrage:/);
  assert.equal(formatMessage(warning.messageDescriptor), warning.message);
  assert.equal(JSON.stringify({ device: snapshot.device, texts: snapshot.texts, sources: snapshot.sources, drivers: snapshot.drivers }), evidence);
});

test('failed source reads retain nested localized causes and source references', async () => {
  const entries = demoEntries().map(([path, value]) => [path, path.endsWith('/Drivers.log') ? '' : value]);
  const snapshot = await importCdat(new Blob([makeZip(entries)]));
  const warning = snapshot.warnings.find(item => item.kind === 'import');
  assert.equal(warning.message, 'Reported device drivers: The source file is empty.');
  assert.equal(formatMessage(warning.messageDescriptor, 'de'), 'Gemeldete Gerätetreiber: Quelldatei ist leer.');
  assert.ok(warning.source.endsWith('/Drivers.log'));
  const driverCoverage = snapshot.coverage.find(item => item.labelDescriptor.key === 'coverage.drivers');
  assert.equal(driverCoverage.status, 'failed');
  assert.equal(formatMessage(driverCoverage.detailDescriptor, 'de'), 'Quelldatei ist leer.');
});

test('row counts follow UI locale without changing descriptor values', () => {
  const descriptor = message('coverage.driverRows', { read: 1234, skipped: 6 });
  assert.equal(formatMessage(descriptor), '1,234 rows recognized; 6 could not be read reliably.');
  assert.equal(formatMessage(descriptor, 'de'), '1.234 Zeilen erkannt; 6 nicht eindeutig lesbar.');
  assert.deepEqual(descriptor.params, { read: 1234, skipped: 6 });
});
