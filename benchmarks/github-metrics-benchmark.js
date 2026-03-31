/**
 * Benchmark: GitHubMetricsService — N+1 secuencial vs Batch paralelo + Cache
 *
 * Simula llamadas a getAllMetrics() con fetch mockeado (latencia realista)
 * para comparar el patron original (N+1 secuencial) con la version optimizada.
 *
 * Uso: node benchmarks/github-metrics-benchmark.js
 */

import { performance } from 'node:perf_hooks';

// ── Configuracion del benchmark ──────────────────────────────────────────────
const DEPLOYMENT_COUNT = 50;   // deployments en el periodo
const API_LATENCY_MS   = 10;   // latencia simulada por llamada HTTP (ms)
const RUNS             = 3;    // repeticiones para obtener mediana

// ── Generacion de datos mock ─────────────────────────────────────────────────
function generateDeployments(count) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    return {
      id: i + 1,
      sha: `sha${String(i).padStart(3, '0')}`,
      created_at: d.toISOString(),
      environment: 'production'
    };
  });
}

function generateCommit(sha, deployedAt) {
  const commitDate = new Date(new Date(deployedAt).getTime() - 30 * 60 * 1000); // 30 min antes
  return { sha, commit: { author: { date: commitDate.toISOString() } } };
}

function generateStatuses(deploymentId) {
  return [{ state: 'success', created_at: new Date().toISOString() }];
}

// Simula latencia de red
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Patron ANTES: N+1 secuencial (codigo original) ──────────────────────────
async function simulateOriginal(deployments) {
  let fetchCount = 0;

  async function mockFetch(type) {
    fetchCount++;
    await sleep(API_LATENCY_MS);
    return type;
  }

  // getDeploymentFrequency: 1 deployment fetch
  await mockFetch('deployments');

  // getLeadTimeForChanges: 1 deployment fetch + 50 commit fetches secuenciales
  await mockFetch('deployments');
  for (const dep of deployments.slice(0, 50)) {
    await mockFetch(`commit:${dep.sha}`);  // await secuencial — bloquea
  }

  // getChangeFailureRate: 1 deployment fetch + N status fetches secuenciales
  await mockFetch('deployments');
  for (const dep of deployments) {
    await mockFetch(`status:${dep.id}`);  // await secuencial — bloquea
  }

  // getMTTR: 1 deployment fetch + N status fetches secuenciales
  await mockFetch('deployments');
  for (const dep of deployments) {
    await mockFetch(`status:${dep.id}`);  // await secuencial — bloquea
  }

  return fetchCount;
}

// ── Patron DESPUES: Batch paralelo + Cache (codigo optimizado) ───────────────
async function simulateOptimized(deployments) {
  let fetchCount = 0;
  const statusCache = new Map();

  async function mockFetch(type) {
    fetchCount++;
    await sleep(API_LATENCY_MS);
    return type;
  }

  async function getCachedStatus(id) {
    if (statusCache.has(id)) return statusCache.get(id);
    const result = await mockFetch(`status:${id}`);
    statusCache.set(id, result);
    return result;
  }

  // 1. UN SOLO fetch de deployments compartido entre las 4 metricas
  await mockFetch('deployments');

  // 2. _prefetchStatuses: todos los statuses en paralelo (lotes de 10)
  const concurrency = 10;
  for (let i = 0; i < deployments.length; i += concurrency) {
    const batch = deployments.slice(i, i + concurrency);
    await Promise.all(batch.map(dep => getCachedStatus(dep.id)));
  }

  // 3. Compute paralelo de las 4 metricas

  // getDeploymentFrequency: usa deployments del cache — 0 fetches adicionales

  // getLeadTimeForChanges: commits en paralelo (lotes de 10)
  const commitsToFetch = deployments.slice(0, 50);
  for (let i = 0; i < commitsToFetch.length; i += concurrency) {
    const batch = commitsToFetch.slice(i, i + concurrency);
    await Promise.all(batch.map(dep => mockFetch(`commit:${dep.sha}`)));
  }

  // getChangeFailureRate: statuses ya en cache — 0 fetches adicionales
  for (const dep of deployments) {
    await getCachedStatus(dep.id);  // cache hit
  }

  // getMTTR: statuses ya en cache — 0 fetches adicionales
  for (const dep of deployments) {
    await getCachedStatus(dep.id);  // cache hit
  }

  return fetchCount;
}

// ── Medicion ─────────────────────────────────────────────────────────────────
async function measure(fn, deployments) {
  const times = [];
  let fetchCount = 0;
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    fetchCount = await fn(deployments);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    medianMs: times[Math.floor(times.length / 2)],
    minMs:    times[0],
    maxMs:    times[times.length - 1],
    fetchCount
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const deployments = generateDeployments(DEPLOYMENT_COUNT);

console.log('\n# Benchmark: GitHubMetricsService — N+1 Secuencial vs Batch Paralelo + Cache\n');
console.log(`Configuracion:`);
console.log(`  - Deployments: ${DEPLOYMENT_COUNT}`);
console.log(`  - Latencia simulada por llamada HTTP: ${API_LATENCY_MS}ms`);
console.log(`  - Repeticiones (mediana): ${RUNS}\n`);

console.log('Ejecutando patron ORIGINAL (N+1 secuencial)...');
const before = await measure(simulateOriginal, deployments);

console.log('Ejecutando patron OPTIMIZADO (batch paralelo + cache)...\n');
const after = await measure(simulateOptimized, deployments);

// ── Calculo de mejoras ───────────────────────────────────────────────────────
const improvement   = ((before.medianMs - after.medianMs) / before.medianMs) * 100;
const speedupFactor = before.medianMs / after.medianMs;

// Fetches 2da llamada (cache hit): solo commits se re-fetch
const secondCallFetches = DEPLOYMENT_COUNT; // solo commits en paralelo
const secondCallTime    = Math.ceil(DEPLOYMENT_COUNT / 10) * API_LATENCY_MS;
const cacheImprovementPct = ((before.medianMs - secondCallTime) / before.medianMs) * 100;

// ── Tabla de resultados ──────────────────────────────────────────────────────
console.log('## Resultados\n');
console.log('| Metrica                         | Antes (original) | Despues (optimizado) | Mejora     |');
console.log('|---------------------------------|------------------|----------------------|------------|');
console.log(`| Tiempo total (mediana)          | ${before.medianMs.toFixed(0).padStart(9)}ms      | ${after.medianMs.toFixed(0).padStart(11)}ms          | ${improvement.toFixed(1)}% mas rapido |`);
console.log(`| Llamadas HTTP totales           | ${String(before.fetchCount).padStart(9)}       | ${String(after.fetchCount).padStart(11)}             | ${((before.fetchCount - after.fetchCount) / before.fetchCount * 100).toFixed(0)}% menos    |`);
console.log(`| Deployment fetches              | ${String(4).padStart(9)}       | ${String(1).padStart(11)}             | 75% menos  |`);
console.log(`| Status fetches secuenciales     | ${String(DEPLOYMENT_COUNT * 2).padStart(9)}       | ${String(0).padStart(11)}             | 100% menos |`);
console.log(`| Status fetches paralelos        | ${String(0).padStart(9)}       | ${String(DEPLOYMENT_COUNT).padStart(11)}             | (nuevo)    |`);
console.log(`| 2da llamada (cache hit)         | ${before.medianMs.toFixed(0).padStart(9)}ms      | ${String(secondCallTime).padStart(11)}ms          | ${cacheImprovementPct.toFixed(1)}% mas rapido |`);
console.log();

console.log('## Resumen');
console.log(`- Mejora de velocidad: ${speedupFactor.toFixed(1)}x mas rapido (${improvement.toFixed(1)}%)`);
console.log(`- Con ${DEPLOYMENT_COUNT} deployments a ${API_LATENCY_MS}ms/llamada:`);
console.log(`  ANTES:  ~${before.medianMs.toFixed(0)}ms (${before.fetchCount} llamadas secuenciales)`);
console.log(`  DESPUES: ~${after.medianMs.toFixed(0)}ms (${after.fetchCount} llamadas, paralelas en lotes)`);
console.log(`  CACHE:   ~${secondCallTime}ms (2da llamada, solo commits se re-fetch)`);
console.log();
console.log('Patron original: O(N) llamadas secuenciales bloqueantes');
console.log('Patron optimizado: O(N/10) lotes paralelos + cache de deployments y statuses');
