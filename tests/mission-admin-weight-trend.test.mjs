import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = readFileSync(join(root, 'src/routes/admin/+page.svelte'), 'utf8');
const trend = readFileSync(join(root, 'src/lib/components/MetricTrend.svelte'), 'utf8');
const motion = readFileSync(join(root, 'src/routes/layout.css'), 'utf8');

test('CRM weight chart delegates curve, gradient, dots, and interactions to MetricTrend', () => {
	assert.match(admin, /import MetricTrend from '\.\.\/\.\.\/lib\/components\/MetricTrend\.svelte'/);
	assert.match(admin, /<MetricTrend[\s\S]*?points=\{weightPoints\.points\}[\s\S]*?interactive=\{true\}[\s\S]*?showGridLabels=\{true\}[\s\S]*?showDateLabels=\{true\}/);
	assert.match(trend, /<linearGradient id=\{gradId\}/);
	assert.match(trend, /class="draw" pathLength="1"/);
	assert.match(trend, /class="area" d=\{dotsPath\}/);
	assert.match(trend, /onmousemove=\{handleMove\}/);
});

test('CRM chart passes the complete chronological source series without downsampling', () => {
	assert.match(admin, /const pts = \[\.\.\.view\.weightTrend\]\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)\) as \{ date: string; weightKg: number \}\[\]/);
	assert.match(admin, /points: pts\.map\(\(p\) => \(\{ date: p\.date, value: p\.weightKg \}\)\)/);
	assert.match(admin, /ResizeObserver/);
	assert.match(trend, /const dateLabelIndices = \$derived\.by\(\(\) =>/);
	assert.match(trend, /xyPts\[i\]\.x - xyPts\[indices\[indices\.length - 1\]\]\.x >= minGap/);
});

test('trend stroke animation is disabled for reduced motion', () => {
	assert.match(motion, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: 0\.01ms !important/);
});
