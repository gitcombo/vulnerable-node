# ADR-007: DORA Metrics via GitHub Deployments API con Cache TTL

| Campo | Valor |
|---|---|
| **ID** | ADR-007 |
| **Estado** | Aceptado |
| **Fecha** | 2026-03-30 |
| **Proyecto** | vulnerable-node (Rehabilitado) |
| **Contexto Académico** | Postgrado en Ingeniería de Software – Universidad Galileo |
| **Entregable** | Delivery 4 – Architecture Strategy & DevEx / Delivery 5 – FinOps |
| **Categoría** | Observabilidad DevOps |

---

## Tabla de Contenidos

1. [Contexto](#1-contexto)
2. [Problema](#2-problema)
3. [Decisión](#3-decisión)
4. [Alternativas Consideradas](#4-alternativas-consideradas)
5. [Justificación con Evidencia](#5-justificación-con-evidencia)
6. [Consecuencias](#6-consecuencias)
7. [Trade-offs](#7-trade-offs)
8. [Referencias](#8-referencias)

---

## 1. Contexto

El proyecto implementa las cuatro métricas DORA (DevOps Research and Assessment) como indicadores de madurez del pipeline de entrega:

- **Deployment Frequency**: Con qué frecuencia se despliega a producción
- **Lead Time for Changes**: Tiempo desde commit hasta producción
- **Change Failure Rate**: % de deployments que causan incidentes
- **Mean Time to Recovery (MTTR)**: Tiempo promedio de recuperación

Estas métricas se exponen via `GET /api/dora/metrics`, alimentando un dashboard de Grafana configurado en `grafana/`.

---

## 2. Problema

Se debía decidir:

1. **Fuente de datos**: ¿Dónde viven los datos de deployment? ¿En la aplicación o en el repositorio?
2. **Estrategia de fetch**: Las 4 métricas DORA compartían datos subyacentes (deployments, statuses) — el patrón naive generaba N+1 queries HTTP
3. **Rate limits**: GitHub API permite 5,000 requests/hora por token autenticado — sin optimización, un dashboard activo puede agotarlos en minutos
4. **Latencia**: El endpoint agregaba 4 llamadas paralelas al mismo endpoint de deployments y hasta 150 llamadas HTTP secuenciales a statuses

---

## 3. Decisión

**Se implementa `GitHubMetricsService` usando GitHub Deployments API como fuente de verdad, con las siguientes optimizaciones:**

1. **Cache en memoria con TTL de 5 minutos** para deployments y statuses
2. **Pre-fetch paralelo de statuses** en lotes de 10 (concurrency: 10)
3. **Fetch único de deployments** compartido entre las 4 métricas DORA
4. **`getAllMetrics()` como coordinador** que orquesta el ciclo completo

```javascript
// src/infrastructure/github/GitHubMetricsService.js

async getAllMetrics(days = 90) {
  // 1. Un único fetch (con cache TTL 5 min)
  const deployments = await this._getDeployments(days);

  // 2. Pre-carga paralela de statuses en lotes de 10
  await this._prefetchStatuses(deployments);

  // 3. Las 4 métricas computan desde cache — sin llamadas adicionales
  const [freq, lead, cfr, mttr] = await Promise.all([
    this.getDeploymentFrequency(days),
    this.getLeadTimeForChanges(days),
    this.getChangeFailureRate(days),
    this.getMTTR(days),
  ]);
  return { deploymentFrequency: freq, leadTime: lead,
           changeFailureRate: cfr, mttr };
}
```

---

## 4. Alternativas Consideradas

### 4.1 Instrumentación directa en la aplicación (descartado)

| Aspecto | Detalle |
|---|---|
| Descripción | Emitir eventos desde el código de la aplicación en cada deploy/incidente |
| Ventaja | Datos más precisos, sin dependencia de GitHub API |
| Desventaja | Requiere cambios en el pipeline de deployment para registrar eventos |
| Desventaja | Requiere persistencia (tabla en PostgreSQL o sistema de eventos) |
| Desventaja | Overhead de desarrollo significativo para un proyecto académico |
| Veredicto | **Descartado** — GitHub Deployments ya registra los eventos relevantes automáticamente |

### 4.2 Solución SaaS (Datadog, LinearB, Sleuth) (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | DORA metrics out-of-the-box, dashboards pre-construidos |
| Desventaja | Costo mensual por seat |
| Desventaja | Dependencia de terceros para métricas core del equipo |
| Desventaja | Fuera del alcance de un proyecto académico con stack propio |
| Veredicto | **Descartado** — el proyecto requiere implementación propia como evidencia de aprendizaje |

### 4.3 GitHub Actions + artefactos sin API (descartado)

| Aspecto | Detalle |
|---|---|
| Descripción | Calcular métricas en el CI y guardar resultados en artefactos |
| Ventaja | Sin dependencia de API en runtime |
| Desventaja | Métricas disponibles solo después de cada pipeline, no en tiempo real |
| Desventaja | Requiere lógica adicional para consultar artefactos históricos |
| Veredicto | **Descartado** — endpoint REST en tiempo real es más útil para un dashboard |

---

## 5. Justificación con Evidencia

### 5.1 GitHub Deployments como fuente de verdad

GitHub Deployments API registra automáticamente:
- Cada deployment (timestamp, SHA, environment)
- El status de cada deployment (`success`, `failure`, `in_progress`)

Estos datos son suficientes para calcular las 4 métricas DORA sin instrumentación adicional.

### 5.2 Impacto cuantificado de la optimización N+1

Sin la optimización (estado anterior):

| Operación | Llamadas HTTP | Tiempo |
|---|---|---|
| 4× `_getDeployments()` | 4 | paralelas |
| 50× `_getCommit()` | 50 | **secuencial** |
| 50× `_getStatuses()` (CFR) | 50 | **secuencial** |
| 50× `_getStatuses()` (MTTR) | 50 | **secuencial** |
| **Total** | **154** | **~2,519ms** |

Con la optimización:

| Operación | Llamadas HTTP | Tiempo |
|---|---|---|
| 1× `_getDeployments()` | 1 | — |
| 50× `_prefetchStatuses()` | 50 | **paralelo (lotes 10)** |
| 50× `_getCommit()` | 50 | **paralelo** |
| **Total** | **101** | **~180ms** |

**Mejora: 92.8% de reducción en latencia. Evidencia en `reports/benchmarks/FINOPS_BENCHMARK_REPORT.md`.**

### 5.3 Impacto en rate limit de GitHub API

| Escenario | Requests/llamada | Llamadas/hora posibles |
|---|---|---|
| Sin optimización | 154 | 32 llamadas/hora |
| Con optimización (sin cache) | 101 | 49 llamadas/hora |
| Con cache 5min (hits) | ~50 | 100 llamadas/hora |

El cache de 5 minutos triplica la capacidad de serving con el mismo token de API.

---

## 6. Consecuencias

### Positivas
- Endpoint `/api/dora/metrics` responde en ~180ms (primera carga) y ~50ms (con cache)
- Rate limit de GitHub API preservado: 3× más capacidad con cache activado
- Sin dependencias externas adicionales (usa `fetch` nativo de Node.js 22)

### Negativas
- **Datos con latencia de 5 minutos**: El cache TTL introduce un delay entre un deployment real y su aparición en el dashboard. Para ventanas de 90 días, esto es irrelevante operacionalmente.
- **Cache in-process (no distribuido)**: El cache vive en memoria del proceso. Si hay múltiples instancias (horizontal scaling), cada instancia mantiene su propio cache. Para este proyecto de instancia única, no es un problema.
- **Dependencia de GitHub API**: Si el token expira o GitHub tiene un outage, el endpoint falla. No hay fallback con datos cached persistentes.

---

## 7. Trade-offs

| Dimensión | GitHub API (elegido) | Instrumentación directa (descartado) |
|---|---|---|
| Precisión de datos | Media (depende de GitHub Deployments) | Alta (eventos propios) |
| Esfuerzo de implementación | Bajo | Alto |
| Dependencia externa | Sí (GitHub) | No |
| Rate limits | 5,000 req/hora (manejable con cache) | Sin límite |
| Latencia de datos | ~5 min (con cache) | Tiempo real |
| Adecuado para proyecto académico | Sí | No (over-engineering) |

---

## 8. Referencias

- DORA State of DevOps Report: https://dora.dev/
- GitHub Deployments API: https://docs.github.com/en/rest/deployments/deployments
- `src/infrastructure/github/GitHubMetricsService.js` — Implementación completa
- `reports/benchmarks/FINOPS_BENCHMARK_REPORT.md` — Evidencia de optimización N+1
- `grafana/` — Dashboard de visualización de métricas DORA
