// REQ-507 L5 (pure): frontend/src/lib/macroData.js, the Market data pages of the value wizard. Source cards (Marketplace first), the query to
// the macro series route, the chart points (history and forecast apart), the citation under the chart and in the story, and the blocked-host line.
import test from 'node:test';
import assert from 'node:assert/strict';

const MD = await import('../src/lib/macroData.js').catch(() => ({}));

const SOURCES = [
  { id: 'imf', name: 'IMF', licence: 'IMF terms', terms: 'Inspire only computes with this data; it is never used to train a model' },
  { id: 'undata', name: 'UN Data', licence: 'UNdata terms' },
  { id: 'worldbank', name: 'World Bank', licence: 'CC BY 4.0' },
  { id: 'eurostat', name: 'Eurostat', licence: 'EU reuse' },
  { id: 'marketplace', name: 'Databricks Marketplace', licence: 'per listing', configured: false },
  { id: 'oecd', name: 'OECD', licence: 'OECD T&C' },
];
const SERIES = { source: 'worldbank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'ARE', unit: '%', fetched_at: '2026-11-23T10:00:00.000Z',
  points: [...[2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y, i) => ({ period: String(y), value: i + 1, forecast: false })),
    { period: '2026', value: 3, forecast: true }, { period: '2027', value: 3.5, forecast: true }],
  citation: { name: 'World Bank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'ARE', url: 'https://api.worldbank.org/v2/x', licence: 'CC BY 4.0', fetched_at: '2026-11-23T10:00:00.000Z' } };

test('L5: the routes, and the source cards in the approved order with Marketplace first', () => {
  assert.equal(MD.SOURCES_ROUTE, '/api/inspire/macro/sources');
  assert.equal(MD.SERIES_ROUTE, '/api/inspire/macro/series');
  assert.deepEqual(MD.orderSources(SOURCES).map((s) => s.id), ['marketplace', 'worldbank', 'imf', 'oecd', 'eurostat', 'undata']);
  assert.equal(SOURCES[0].id, 'imf', 'the input list is not changed');
});

test('L5: the series query carries only the picked source, indicator, country and where to cache it', () => {
  const q = new URLSearchParams(MD.seriesQuery({ source: 'worldbank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'ARE', inspire_database: 'main.inspire', warehouse_id: 'wh1', url: 'https://evil.example.com' }));
  assert.deepEqual([...q.keys()].sort(), ['country', 'indicator', 'inspire_database', 'source', 'warehouse_id']);
  assert.equal(q.get('indicator'), 'NE.CON.PRVT.KD.ZG');
});

test('L5: the citation names source, indicator, country, the years of history, the fetch date and the licence', () => {
  assert.equal(MD.citationLine(SERIES), 'World Bank, NE.CON.PRVT.KD.ZG, ARE, 2016-2025, fetched 23 Nov 2026, CC BY 4.0');
});

test('L5: chart points keep history and forecast apart, oldest first, numbers only', () => {
  const pts = MD.chartPoints(SERIES);
  assert.deepEqual(pts.history.map((p) => p.x), ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025']);
  assert.deepEqual(pts.forecast, [{ x: '2026', y: 3 }, { x: '2027', y: 3.5 }]);
  assert.ok(pts.history.every((p) => typeof p.y === 'number'));
});

test('L5: a blocked host shows the server message as is; a normal series shows no blocked line', () => {
  const msg = 'Your workspace blocks api.worldbank.org; ask an admin to allow it, or use a Marketplace share';
  assert.equal(MD.blockedLine({ blocked: true, host: 'api.worldbank.org', message: msg }), msg);
  assert.equal(MD.blockedLine(SERIES), '');
});
