# ADR-004: Zod como Framework de Validación de Entrada

| Campo | Valor |
|---|---|
| **ID** | ADR-004 |
| **Estado** | Aceptado |
| **Fecha** | 2026-03-11 |
| **Proyecto** | vulnerable-node (Rehabilitado) |
| **Contexto Académico** | Postgrado en Ingeniería de Software – Universidad Galileo |
| **Entregable** | Delivery 2 – Rehabilitación Base |
| **Categoría** | Validación y Seguridad de Entrada |

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

El proyecto original no tenía validación de entrada en ningún endpoint. Cualquier valor podía llegar al controlador y de ahí directamente a la base de datos o a la lógica de negocio. Esto habilitaba SQL Injection, XSS, y otros ataques basados en entrada maliciosa.

Durante la rehabilitación, se necesitaba adoptar una estrategia de validación que cubriera todos los endpoints existentes y definiera el patrón para endpoints futuros.

**Schemas implementados:**
- `LoginSchema` — `src/interface/http/validators/authValidators.js`
- `ProductIdSchema` — validación de `id` numérico
- `SearchQuerySchema` — validación de parámetro `q` con longitud máxima
- `PurchaseSchema` — validación completa de 6 campos del carrito

---

## 2. Problema

Se necesitaba una solución de validación que:

1. **Declarativa**: Schemas legibles que documenten la forma esperada de los datos
2. **Integrable con Express**: Convertible en middleware sin boilerplate excesivo
3. **Manejo de errores claro**: Mensajes de error estructurados (no strings genéricos)
4. **Sin dependencia de TypeScript**: El proyecto usa JavaScript (ESM), no TypeScript
5. **Seguridad**: Validación estricta que rechace datos inesperados

---

## 3. Decisión

**Se adopta Zod v3 para validación de entrada, usando el patrón de middleware que parsea y coloca el resultado en `req.validatedBody`.**

```javascript
// src/interface/http/validators/productValidators.js
import { z } from 'zod';

const PurchaseSchema = z.object({
  mail:         z.string().email(),
  address:      z.string().min(1).max(200),
  ship_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phone:        z.string().regex(/^\+?[\d\s\-]{7,15}$/),
  product_id:   z.coerce.number().int().positive(),
  product_name: z.string().min(1).max(100),
  price:        z.string().regex(/^\d+(\.\d{1,2})?Q$/),
});

export function validatePurchase(req, res, next) {
  const result = PurchaseSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }
  req.validatedBody = result.data;
  next();
}
```

Los handlers posteriores usan `req.validatedBody` en lugar de `req.body`, garantizando que los datos ya pasaron por el schema.

---

## 4. Alternativas Consideradas

### 4.1 express-validator (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Diseñado específicamente para Express, ampliamente adoptado |
| Desventaja | API imperativa — las reglas se encadenan en el route handler, no en un schema separado |
| Desventaja | Validación y sanitización mezcladas; dificulta reutilización de schemas en tests |
| Desventaja | Sin type inference (incluso con TypeScript) |
| Ejemplo | `body('email').isEmail().normalizeEmail()` — no hay un objeto schema central |
| Veredicto | **Descartado** — Zod provee schemas declarativos reutilizables y más legibles |

### 4.2 joi (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Maduro, API fluida, muy adoptado |
| Desventaja | Diseño de 2013 — sin type inference nativa |
| Desventaja | Bundle size mayor que Zod |
| Desventaja | Manejo de errores verbose y difícil de estructurar para JSON APIs |
| Veredicto | **Descartado** — Zod es más moderno y tiene mejor soporte para casos edge |

### 4.3 class-validator con class-transformer (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Decoradores expresivos, integración nativa con TypeScript |
| Desventaja | Requiere decoradores — no disponibles en JavaScript estándar sin Babel |
| Desventaja | El proyecto no usa TypeScript |
| Veredicto | **Descartado** — incompatible con el stack JavaScript ESM del proyecto |

### 4.4 Validación manual (descartado)

| Aspecto | Detalle |
|---|---|
| Existía | El proyecto original usaba `if (campo === undefined)` y regex manuales |
| Desventaja | Inconsistente, propenso a omisiones, sin estructura |
| Desventaja | El regex de email causó una vulnerabilidad ReDoS (documentada en `reports/benchmarks/`) |
| Veredicto | **Descartado** — la vulnerabilidad ReDoS es evidencia directa del riesgo |

---

## 5. Justificación con Evidencia

### 5.1 Eliminación del ReDoS

La validación manual con regex causó una vulnerabilidad ReDoS en `routes/products.js:95`:

```javascript
// ANTES — Regex con catastrophic backtracking (CWE-400)
const re = /^([a-zA-Z0-9])(([\-.]|[_]+)?([a-zA-Z0-9]+))*(@){1}[a-z0-9]+.../;
re.test('a'.repeat(33) + '!')  // → bloquea el event loop 2,745ms
```

Zod usa internamente una validación de email probada que no tiene este problema:

```javascript
// DESPUÉS — z.string().email() → 0.154ms con el mismo input de ataque
// Mejora: 17,826× más rápido en el peor caso
```

Evidencia cuantificada en `reports/benchmarks/FINOPS_BENCHMARK_REPORT.md`.

### 5.2 Patrón de middleware limpio

Zod permite separar la definición del schema de su aplicación como middleware:

```javascript
// Schema definido una vez, reutilizable en tests y en middleware
export { PurchaseSchema };     // reutilizable en unit tests
export { validatePurchase };   // middleware de Express
```

### 5.3 Errores estructurados

`safeParse` retorna errores con estructura JSON navegable, ideal para APIs:

```json
{
  "fieldErrors": {
    "mail": ["Invalid email"],
    "price": ["Invalid input"]
  }
}
```

---

## 6. Consecuencias

### Positivas
- Schemas centralizados en `src/interface/http/validators/` — fuente única de verdad sobre la forma de los datos
- ReDoS eliminado: validación de email por Zod es safe por diseño
- Handlers reciben datos ya validados y tipados via `req.validatedBody`
- Tests unitarios de schemas posibles sin levantar Express (`validators.test.js`)

### Negativas
- Overhead de parseo: Zod es más lento que un `if` manual para inputs válidos simples (~1-2ms por request)
- Los handlers deben usar `req.validatedBody` conscientemente — si un handler usa `req.body` directamente, la validación no aplica (inconsistencia visible en el estado actual antes de completar ADR-001)
- `z.coerce` puede sorprender a desarrolladores nuevos: convierte tipos implícitamente

### Deuda técnica identificada
`routes/products.js` (estado anterior al fix de FinOps) usaba `req.body` en lugar de `req.validatedBody` en el handler de compra, creando una ventana de inconsistencia. Este patrón debe evitarse en todos los handlers futuros.

---

## 7. Trade-offs

| Dimensión | Zod | express-validator (alternativa rechazada) |
|---|---|---|
| Estilo de API | Declarativo (schema-first) | Imperativo (reglas en route) |
| Reutilización del schema | Alta (exportar schema + middleware) | Baja (reglas acopladas al route) |
| Type inference (TypeScript) | Completa | Limitada |
| Uso en JavaScript puro | Compatible | Compatible |
| Tamaño del bundle | ~13 KB | ~8 KB |
| Facilidad para unit tests | Alta | Media |

---

## 8. Referencias

- Zod documentation: https://zod.dev/
- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- `src/interface/http/validators/` — Schemas implementados
- `tests/unit/validators.test.js` — Tests de schemas incluyendo ReDoS
- `reports/benchmarks/FINOPS_BENCHMARK_REPORT.md` — Evidencia del impacto de ReDoS
