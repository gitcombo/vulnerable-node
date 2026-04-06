# ADR-006: Winston como Estrategia de Logging Centralizado

| Campo | Valor |
|---|---|
| **ID** | ADR-006 |
| **Estado** | Aceptado (implementación parcial) |
| **Fecha** | 2026-03-11 |
| **Proyecto** | vulnerable-node (Rehabilitado) |
| **Contexto Académico** | Postgrado en Ingeniería de Software – Universidad Galileo |
| **Entregable** | Delivery 3 – DevSecOps Hardening |
| **Categoría** | Observabilidad |

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

El proyecto original usaba `console.log` y `console.error` en toda la aplicación. Este enfoque produce logs no estructurados, sin niveles de severidad, sin contexto de request, y sin posibilidad de ingestión por herramientas de monitoreo.

Durante la rehabilitación, se adoptó Winston como logger centralizado. Sin embargo, la migración es **parcial**: la capa `src/` usa Winston, mientras que la capa legacy `model/` y `routes/` mantiene 14 llamadas a `console`.

**Estado actual:**

| Capa | Herramienta | Llamadas |
|---|---|---|
| `src/interface/http/routes/dora.js` | Winston | 2 |
| `src/infrastructure/github/GitHubMetricsService.js` | Winston | ~5 |
| `model/` (legacy) | console | 8 |
| `routes/` (legacy) | console | 6 |
| `app.js` | console (startup) | 3 |

---

## 2. Problema

Se necesitaba un sistema de logging que:

1. **Niveles de severidad**: `error`, `warn`, `info`, `debug` — no solo stdout/stderr
2. **Formato estructurado**: JSON para ingestión por herramientas (ELK, Datadog, CloudWatch)
3. **Múltiples transports**: Consola coloreada en desarrollo, archivos en producción
4. **Request correlation**: Soporte para incluir `requestId` en cada log (ver `requestId.js`)
5. **Configurable por entorno**: `LOG_LEVEL` como variable de entorno

---

## 3. Decisión

**Se adopta Winston v3 como logger centralizado, configurado en `src/infrastructure/logging/Logger.js`.**

```javascript
// src/infrastructure/logging/Logger.js
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log',    level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

export default logger;
```

La configuración produce JSON en archivos (para ingestión) y formato legible en consola (para desarrollo).

---

## 4. Alternativas Consideradas

### 4.1 Morgan únicamente (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Diseñado para Express, logging de HTTP requests automático |
| Desventaja | **Solo loguea HTTP requests** — no es un logger de aplicación general |
| Desventaja | No tiene niveles de severidad arbitrarios |
| Desventaja | No se puede usar para loguear errores de negocio, eventos de seguridad, etc. |
| Veredicto | **Descartado como solución única** — Morgan puede coexistir como middleware HTTP, pero no reemplaza un logger de aplicación |

### 4.2 pino (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Extremadamente rápido (hasta 5× más que Winston en benchmarks) |
| Ventaja | JSON por defecto, adecuado para producción |
| Desventaja | API menos familiar que Winston para el equipo |
| Desventaja | Formateo de consola requiere `pino-pretty` como dependencia adicional |
| Veredicto | **Descartado** — la diferencia de performance no es relevante a esta escala; Winston es más conocido en el ecosistema educativo |

### 4.3 Bunyan (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Logger estructurado JSON maduro |
| Desventaja | Mantenimiento reducido — última release relevante fue en 2017 |
| Desventaja | Menos adoptado que Winston en proyectos modernos |
| Veredicto | **Descartado** — riesgo de mantenimiento similar al de csurf (ver ADR-005) |

### 4.4 console (descartado)

| Aspecto | Detalle |
|---|---|
| Existía | Es el estado actual en la capa legacy |
| Desventaja | Sin niveles de severidad configurables |
| Desventaja | Sin formato JSON — imposible ingerir en herramientas de monitoreo |
| Desventaja | Sin request correlation (no incluye requestId) |
| Desventaja | Sin transports — no hay forma de redirigir a archivos sin pipes de SO |
| Veredicto | **Descartado** — inadecuado para producción |

---

## 5. Justificación con Evidencia

### 5.1 Structured logging y observabilidad

Un log de Winston en producción (JSON):
```json
{
  "level": "error",
  "message": "GitHub API request failed",
  "timestamp": "2026-03-30T14:23:11.432Z",
  "requestId": "a3b2c1d0",
  "statusCode": 429,
  "retryAfter": 60,
  "stack": "Error: HTTP 429..."
}
```

Comparado con un log de console:
```
GitHub API request failed
```

El log estructurado es directamente ingestible por Datadog, ELK, CloudWatch Logs Insights, o cualquier herramienta de observabilidad moderna.

### 5.2 Nivel configurable por entorno

```javascript
// config.js
LOG_LEVEL: process.env.LOG_LEVEL || 'info'
```

En producción: `LOG_LEVEL=warn` — solo errores y advertencias.
En desarrollo: `LOG_LEVEL=debug` — logs detallados de diagnóstico.

### 5.3 Integración con requestId

El middleware `requestId.js` genera un UUID por request que puede incluirse en cada log, permitiendo trazar todos los eventos asociados a una solicitud específica.

---

## 6. Consecuencias

### Positivas
- Logs estructurados JSON en `logs/error.log` y `logs/combined.log`
- Nivel configurable sin cambios de código
- Formato legible en consola durante desarrollo

### Negativas — Deuda técnica activa

La implementación es **parcial**. Las 14 llamadas a `console` en `model/` y `routes/` no usan Winston:
- Los logs de autenticación y queries no tienen requestId ni timestamp estructurado
- Los errores de base de datos se loguean a stderr sin nivel explícito

Esta inconsistencia se resolverá como parte de la migración a Clean Architecture (ADR-001): cuando `model/` y `routes/` se muevan a `src/`, usarán el logger centralizado.

---

## 7. Trade-offs

| Dimensión | Winston | pino (alternativa rechazada) |
|---|---|---|
| Performance | Media | Muy alta |
| Familiaridad en ecosistema | Alta | Media |
| JSON por defecto | No (requiere formato) | Sí |
| Consola legible sin extra dep | Sí | No (requiere pino-pretty) |
| Nivel de abstracción | Alto (múltiples transports) | Medio |
| Adecuación al proyecto | Alta | Alta (pero innecesaria para esta escala) |

---

## 8. Referencias

- Winston documentation: https://github.com/winstonjs/winston
- 12-Factor App — Logs: https://12factor.net/logs
- `src/infrastructure/logging/Logger.js` — Configuración del logger
- `src/interface/http/middleware/requestId.js` — Correlación de requests
- `config.js:14` — Variable `LOG_LEVEL`
