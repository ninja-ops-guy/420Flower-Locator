import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validCoordinates } from '../.test-build/geo.js';

function mount(props, width = 0) {
  const element = { style: {}, clientWidth: width, clientHeight: width ? 420 : 0 };
  const calls = [];
  const effects = [];
  let resized;
  let revision = 0;
  let refIndex = 0;
  const map = {
    setView: (...args) => { calls.push(['setView', ...args]); return map; },
    getContainer: () => element,
    getPane: () => null,
    remove: () => {}, removeLayer: () => {}, stop: () => {},
    invalidateSize: () => calls.push(['invalidateSize']),
    fitBounds: (...args) => calls.push(['fitBounds', ...args]),
  };
  const layer = { addTo: () => layer, clearLayers: () => {} };
  const marker = { ...layer, on: () => {}, bindTooltip: () => marker };
  const leaflet = {
    Icon: { Default: function () {} }, map: () => map,
    control: { attribution: () => layer, zoom: () => layer },
    layerGroup: () => layer, tileLayer: () => layer, divIcon: () => ({}),
    marker: (point) => { assert.equal(validCoordinates(...point), true); calls.push(['marker', point]); return marker; },
    polyline: (points) => { points.forEach(p => assert.equal(validCoordinates(...p), true)); return layer; },
    latLngBounds: (points) => { points.forEach(p => assert.equal(validCoordinates(...p), true)); return points; },
  };
  const source = fs.readFileSync(new URL('../src/components/MapView.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    ResizeObserver: class { constructor(cb) { resized = cb; } observe() {} disconnect() {} },
    require: (name) => {
      if (name === 'react') return {
        useRef: () => ({ current: refIndex++ === 0 ? element : null }),
        useState: () => [revision, fn => { revision = fn(revision); }],
        useEffect: fn => effects.push(fn),
      };
      if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
      if (name === 'leaflet') return leaflet;
      if (name.endsWith('.css')) return {};
      if (name === '../lib/geo') return { validCoordinates };
      throw new Error(name);
    },
  });
  exports.default({ user: null, nearest: null, all: [], dark: false, tiles: '', darkTiles: '', ...props });
  const cleanups = effects.map(fn => fn());
  return { calls, element, update: effects[2], resized: () => resized(), revision: () => revision, cleanups };
}

test('hidden mobile map defers bounds until it becomes visible', () => {
  const m = mount({ user: { lat: 41.2, lon: -73.1 } });
  assert.equal(m.calls.filter(c => c[0] === 'marker').length, 0);
  m.element.clientWidth = 390; m.element.clientHeight = 420;
  m.resized();
  assert.equal(m.revision(), 1);
  m.update();
  assert.equal(m.calls.filter(c => c[0] === 'marker').length, 1);
  const last = m.calls.at(-1);
  assert.equal(last[0], 'setView');
  assert.equal(last[3].animate, false);
});

test('invalid input never reaches map markers, bounds or connecting line', () => {
  const bad = { id: 'bad', latitude: NaN, longitude: Infinity };
  const m = mount({ user: { lat: NaN, lon: NaN }, nearest: bad, all: [bad] }, 390);
  assert.equal(m.calls.filter(c => c[0] === 'marker').length, 0);
  assert.equal(m.calls.filter(c => c[0] === 'fitBounds').length, 0);
  assert.equal(validCoordinates(...m.calls[0][1]), true);
});

test('valid zero coordinates and multiple markers fit without flight animation', () => {
  const point = { id: 'valid', latitude: 1, longitude: 1 };
  const m = mount({ user: { lat: 0, lon: 0 }, nearest: point, all: [point] }, 390);
  assert.equal(m.calls.filter(c => c[0] === 'marker').length, 2);
  const fit = m.calls.find(c => c[0] === 'fitBounds');
  assert.ok(fit);
  assert.equal(fit[2].animate, false);
});
