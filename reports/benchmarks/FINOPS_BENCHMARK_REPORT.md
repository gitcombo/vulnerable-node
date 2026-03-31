# Reporte de Benchmark FinOps — Delivery 5

**Proyecto**: vulnerable-node-rehabilitated
**Branch**: feature/finops-optimization
**Fecha**: 2026-03-30
**Autor**: Equipo DevSecOps

---

## 1. Resumen Ejecutivo

Se identificaron y optimizaron dos funciones intensivas en recursos del proyecto:

| # | Funcion | Tipo | Mejora medida |
|---|---------|------|---------------|
| 1 | Regex de validacion de email — `routes/products.js:95` | CPU (catastrophic backtracking) | **99.99%** reduccion de tiempo (2,745ms → 0.15ms) |
| 2 | `GitHubMetricsService.getAllMetrics()` | I/O (N+1 HTTP secuencial) | **92.8%** reduccion de tiempo (2,519ms → 180ms) |

Ambas optimizaciones superan ampliamente el umbral de **>15%** requerido por la rubrica del entregable.

---

## 2. Optimizacion #1: Regex ReDoS en Validacion de Email

### 2.1 Problema Identificado

**Archivo**: `routes/products.js`, lineas 95–98
**Tipo de recurso**: CPU
**Severidad**: Critica

El handler de compra (`POST /products/buy`) contenia la siguiente validacion de email:

```javascript
const re = /^([a-zA-Z0-9])(([\-.]|[_]+)?([a-zA-Z0-9]+))*(@){1}[a-z0-9]+[.]{1}(([a-z]{2,3})|([a-z]{2,3}[.]{1}[a-z]{2,3}))$/;
if (!re.test(cart.mail)) {
    throw new Error("Invalid mail format");
}
```

Los quantifiers anidados `([_]+)?([a-zA-Z0-9]+))*` causan **catastrophic backtracking** (ReDoS). El motor de regex intenta `O(2^n)` caminos posibles con ciertos inputs, congelando el event loop de Node.js.

El proyecto incluia un script de ataque que demuestra el vector: `attacks/evil_regex/attack_1.sh`.

**Impacto en produccion**: Con un input de 33 caracteres `'a'` seguidos de `'!'`, el regex tarda **~2.7 segundos** bloqueando completamente el event loop — durante ese tiempo el servidor no puede procesar ninguna otra solicitud.

### 2.2 Causa Raiz Adicional: Codigo Redundante

El middleware `validatePurchase` (registrado en la linea 71 del mismo archivo) ya ejecuta `PurchaseSchema.parse()` con `z.string().email()` **antes** de que el handler corra. Por lo tanto el regex era completamente redundante — duplicaba una validacion ya resuelta de forma segura.

### 2.3 Solucion Implementada

1. **Eliminar** el regex vulnerable (lineas 95–98)
2. **Simplificar** el handler para usar `req.validatedBody` seteado por el middleware Zod
3. **Agregar** test anti-ReDoS en `tests/unit/validators.test.js`

El handler simplificado:

```javascript
router.all('/products/buy', validatePurchase, function(req, res, next) {
    const params = req.validatedBody;  // validado por Zod antes de llegar aqui
    const cart = {
        mail: params.mail,
        address: params.address,
        ship_date: params.ship_date,
        phone: params.phone,
        product_id: params.product_id,
        product_name: params.product_name,
        username: req.session.user_name,
        price: params.price.slice(0, -1)
    };
    // ...
});
```

### 2.4 Resultados del Benchmark

Script: `benchmarks/redos-email-benchmark.js`

| Entrada | Regex antes (ms) | Zod despues (ms) | Mejora |
|---------|-----------------|-----------------|--------|
| Valido: test@example.com | 0.261 | 1.901 | baseline |
| Valido: user.name@domain.co.uk | 0.153 | 0.189 | baseline |
| Invalido: notanemail | 0.005 | 0.852 | baseline |
| Invalido: @missing.com | 0.002 | 0.055 | baseline |
| ReDoS: "a"x20 + "!" | 0.897 | 0.402 | 2x mas rapido |
| ReDoS: "a"x25 + "!" | 21.563 | 0.093 | 233x mas rapido |
| ReDoS: "a"x28 + "!" | 93.492 | 0.053 | 1,774x mas rapido |
| ReDoS: "a"x30 + "!" | 334.989 | 0.076 | 4,402x mas rapido |
| **ReDoS: "a"x33 + "!"** | **2,745.209** | **0.154** | **17,826x mas rapido** |

**Peor caso**: 2,745ms → 0.154ms = **99.99% de reduccion** (17,826x mas rapido)

> Nota: Para inputs validos y invalidos simples, Zod puede ser ligeramente mas lento
> (overhead de parseo de esquema). La mejora critica es en el peor caso de ataque.

---

## 3. Optimizacion #2: GitHubMetricsService — N+1 a Batch Paralelo

### 3.1 Problema Identificado

**Archivo**: `src/infrastructure/github/GitHubMetricsService.js`
**Tipo de recurso**: I/O (llamadas HTTP externas a GitHub API)
**Severidad**: Alta

El metodo `getAllMetrics()` presentaba tres anti-patrones:

#### Anti-patron 1: 4 fetches identicos de deployments

Cada uno de los 4 metodos DORA llamaba `_getDeployments()` independientemente:

```javascript
// ANTES: Promise.all lanza 4 llamadas al mismo endpoint simultaneamente
async getAllMetrics(days = 90) {
    const [freq, lead, cfr, mttr] = await Promise.all([
        this.getDeploymentFrequency(days),  // → _getDeployments()
        this.getLeadTimeForChanges(days),   // → _getDeployments()
        this.getChangeFailureRate(days),    // → _getDeployments()
        this.getMTTR(days)                  // → _getDeployments()
    ]);
}
```

#### Anti-patron 2: N+1 secuencial en commits (Lead Time)

```javascript
// ANTES: for-await secuencial — cada commit espera al anterior
for (const deployment of sampled) {
    const commit = await this._getCommit(deployment.sha);  // bloquea
}
```

Con 50 deployments a ~10ms/llamada = **500ms bloqueantes en serie**.

#### Anti-patron 3: N+1 secuencial doble en statuses (CFR + MTTR)

`getChangeFailureRate()` y `getMTTR()` hacian **cada uno** N fetches secuenciales de statuses para los mismos N deployments — sin compartir resultados.

**Total con 50 deployments**: ~154 llamadas HTTP, ~2,500ms de tiempo serial.

### 3.2 Solucion Implementada

Tres cambios en `GitHubMetricsService.js`:

#### Cambio 1: Cache en memoria con TTL

```javascript
constructor() {
    // ...
    this._cache = {
        deployments: null,
        deploymentsFetchedAt: 0,
        statuses: new Map(),
    };
    this._cacheTTL = 5 * 60 * 1000; // 5 minutos
}
```

#### Cambio 2: Pre-carga paralela de statuses

```javascript
async _prefetchStatuses(deployments, concurrency = 10) {
    const ids = deployments.map(d => d.id).filter(id => !this._cache.statuses.has(id));
    for (let i = 0; i < ids.length; i += concurrency) {
        const batch = ids.slice(i, i + concurrency);
        await Promise.all(batch.map(id => this._getDeploymentStatuses(id).catch(() => {})));
    }
}
```

#### Cambio 3: getAllMetrics con fetch unico compartido

```javascript
async getAllMetrics(days = 90) {
    // 1. Un solo fetch de deployments (queda en cache)
    const deployments = await this._getDeployments(days);

    // 2. Pre-carga paralela de statuses (lotes de 10)
    await this._prefetchStatuses(deployments);

    // 3. Computo paralelo — deployments y statuses ya en cache
    const [freq, lead, cfr, mttr] = await Promise.all([...]);
}
```

### 3.3 Resultados del Benchmark

Script: `benchmarks/github-metrics-benchmark.js`
Configuracion: 50 deployments, latencia simulada 10ms/llamada

| Metrica | Antes (original) | Despues (optimizado) | Mejora |
|---------|-----------------|---------------------|--------|
| Tiempo total (mediana) | 2,519ms | 180ms | **92.8% mas rapido** |
| Llamadas HTTP totales | 154 | 101 | 34% menos |
| Deployment fetches | 4 | 1 | 75% menos |
| Status fetches secuenciales | 100 | 0 | 100% eliminados |
| Status fetches paralelos | 0 | 50 | (nuevo patron) |
| 2da llamada (cache hit) | 2,519ms | 50ms | **98.0% mas rapido** |

**Mejora de velocidad**: **14x mas rapido** (92.8% de reduccion)

**Con cache** (2da llamada al dashboard en los 5 minutos de TTL): **50x mas rapido** (98%)

---

## 4. Analisis de Impacto FinOps

### 4.1 Reduccion de costos en GitHub API

GitHub API tiene un rate limit de **5,000 requests/hora** para tokens autenticados. Cada llamada a `/api/dora/metrics` consume:

| Escenario | Requests consumidos |
|-----------|---------------------|
| Antes (1 llamada) | 154 requests |
| Despues (1a llamada) | 101 requests |
| Despues (2a+ llamada, cache) | ~50 requests (solo commits) |

Con el cache de 5 minutos, un dashboard que recarga cada 5 minutos pasa de **1,848 requests/hora** a **~600 requests/hora** — **67% menos consumo de rate limit**.

### 4.2 Mejora de experiencia de usuario

El endpoint `/api/dora/metrics` pasa de ~2.5 segundos a ~180ms en primera carga, y ~50ms en cargas subsiguientes. Esto es critico para un dashboard de metricas en tiempo real.

### 4.3 Reduccion de riesgo operacional

El ReDoS eliminado prevenia ataques de denegacion de servicio de bajo costo: un atacante podia congelar el servidor con un solo request malicioso de 33 bytes.

---

## 5. Verificacion

Todos los tests pasan despues de ambas optimizaciones:

```
Test Suites: 3 passed, 3 total
Tests:       35 passed, 35 total
```

Tests nuevos agregados:
- `validators.test.js`: "should handle ReDoS attack payload without hanging" — verifica que el input malicioso se procesa en < 50ms
- `githubMetricsService.test.js`: "should use cache on second call" — verifica que la 2da llamada no genera fetches redundantes

---

## 6. Conclusion

Ambas optimizaciones demuestran mejoras cuantificables y superan el umbral del 15%:

| Optimizacion | Mejora | Cumple >15% |
|-------------|--------|-------------|
| ReDoS regex → Zod | 99.99% | ✅ |
| N+1 secuencial → Batch + Cache | 92.8% | ✅ |

El refactoring es limpio, no rompe funcionalidad existente, y alinea el codigo con las practicas ya establecidas en el proyecto (Zod para validacion, arquitectura hexagonal para servicios de infraestructura).
