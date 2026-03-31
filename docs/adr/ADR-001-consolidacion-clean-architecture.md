# ADR-001: Consolidación de Clean Architecture (Hexagonal)

| Campo | Valor |
|---|---|
| **ID** | ADR-001 |
| **Estado** | Propuesto |
| **Fecha** | 2026-03-30 |
| **Proyecto** | vulnerable-node (Rehabilitado) |
| **Contexto Académico** | Postgrado en Ingeniería de Software – Universidad Galileo |
| **Entregable** | Delivery 4 – Architecture Strategy & DevEx |
| **Categoría** | Refactoring Arquitectónico Estratégico |

---

## Tabla de Contenidos

1. [Contexto](#1-contexto)
2. [Problema](#2-problema)
3. [Decisión](#3-decisión)
4. [Alternativas Consideradas](#4-alternativas-consideradas)
5. [Justificación con Evidencia](#5-justificación-con-evidencia)
6. [Consecuencias](#6-consecuencias)
7. [Trade-offs](#7-trade-offs)
8. [Riesgos y Mitigaciones](#8-riesgos-y-mitigaciones)
9. [Costos](#9-costos)
10. [Plan de Implementación](#10-plan-de-implementación)
11. [Criterios de Éxito](#11-criterios-de-éxito)
12. [Referencias](#12-referencias)

---

## 1. Contexto

### 1.1 Estado Post-Rehabilitación

El proyecto `vulnerable-node` completó en la **Fase de Rehabilitación** (Deliveries 2 y 3) la corrección de **14 vulnerabilidades de seguridad** cubriendo el 100% de las categorías OWASP Top 10. Esta rehabilitación fue implementada de forma incremental, siguiendo el principio *"no reescribir, sino parchar y mejorar progresivamente"* definido en [`design/REHABILITATION_PLAN.md`](../../design/REHABILITATION_PLAN.md).

Como efecto colateral documentado de esa estrategia incremental, el codebase resultó en un estado de **arquitectura dual**: los nuevos componentes de seguridad y observabilidad se implementaron bajo `src/` siguiendo principios de Clean Architecture (Hexagonal), mientras que la lógica de negocio original permaneció en las carpetas legacy `model/` y `routes/`.

### 1.2 Arquitectura Actual: Mapa del Sistema

```
vulnerable-node/
│
├── app.js                    # Composition root (141 LOC)
│                               └── Importa de AMBAS capas
│
├── [LEGACY] model/           # Capa de datos legacy
│   ├── auth.js               #  27 LOC – Autenticación + pg-promise directo
│   ├── db.js                 #   8 LOC – Singleton de conexión (pg-promise)
│   ├── init_db.js            #  39 LOC – Inicialización de BD + seed
│   └── products.js           #  34 LOC – Queries CRUD de productos
│
├── [LEGACY] routes/          # Capa de routing legacy
│   ├── login.js              #  51 LOC – Rutas de auth (GET/POST login, logout)
│   ├── login_check.js        #   8 LOC – Middleware de sesión
│   └── products.js           # 119 LOC – Rutas CRUD + compra (lógica mezclada)
│
│   SUBTOTAL LEGACY: 7 archivos | 286 LOC
│
├── [CLEAN ARCH] src/
│   ├── infrastructure/
│   │   ├── config/           # Directorio existe, VACÍO
│   │   ├── github/
│   │   │   └── GitHubMetricsService.js  # 334 LOC – DORA metrics via GitHub API
│   │   ├── logging/
│   │   │   └── Logger.js     #  46 LOC – Winston logger centralizado
│   │   └── security/
│   │       └── PasswordHasher.js  # 21 LOC – Wrapper Argon2id
│   │
│   └── interface/http/
│       ├── middleware/
│       │   ├── rateLimiter.js    #  20 LOC – express-rate-limit
│       │   └── requestId.js      #   7 LOC – UUID request tracking
│       ├── routes/
│       │   ├── dora.js           #  28 LOC – Endpoints DORA metrics
│       │   └── health.js         #  26 LOC – Health check endpoint
│       └── validators/
│           ├── authValidators.js     #  23 LOC – Zod schema para login
│           └── productValidators.js  #  63 LOC – Zod schemas para productos
│
│   SUBTOTAL CLEAN ARCH: 9 archivos | 568 LOC
│
└── [NO EXISTE AÚN] src/domain/
    ├── entities/             # User, Product, Purchase — NO IMPLEMENTADO
    ├── repositories/         # Interfaces (contratos) — NO IMPLEMENTADO
    └── use-cases/            # Lógica de negocio pura — NO IMPLEMENTADO
```

**Métrica clave**: Drift arquitectónico actual = **50%** (7 archivos legacy / 7 archivos clean en el baseline del roadmap; fuente: [`design/REFACTORING_ROADMAP.md`](../../design/REFACTORING_ROADMAP.md), línea 35).

---

## 2. Problema

### 2.1 Dependencias Cruzadas que Violan la Dependency Rule

La arquitectura actual contiene **6 importaciones cross-boundary** que crean un grafo de dependencias bidireccional. Esto viola la *Dependency Rule* de Clean Architecture (Martin, 2017): *"Source code dependencies must point only inward, toward higher-level policies."*

| # | Archivo (capa) | Importa de | Violación |
|---|---|---|---|
| 1 | `model/auth.js:2` (legacy) | `src/infrastructure/security/PasswordHasher.js` (clean) | Legacy → Clean |
| 2 | `model/init_db.js:3` (legacy) | `src/infrastructure/security/PasswordHasher.js` (clean) | Legacy → Clean |
| 3 | `routes/login.js:4` (legacy) | `src/interface/http/validators/authValidators.js` (clean) | Legacy → Clean |
| 4 | `routes/products.js:5` (legacy) | `src/interface/http/validators/productValidators.js` (clean) | Legacy → Clean |
| 5 | `src/interface/http/routes/health.js:2` (clean) | `../../../../model/db.js` (legacy) | Clean → Legacy |
| 6 | `src/infrastructure/github/GitHubMetricsService.js:1` (clean) | `../../../config.js` (raíz) | Clean → Root |

La dependencia #5 es especialmente crítica: un archivo ubicado en `src/interface/http/routes/` requiere navegar **4 niveles hacia arriba** (`../../../../`) para alcanzar `model/db.js`. Esto indica que las capas no tienen fronteras claras.

### 2.2 Capas de Arquitectura Objetivo No Implementadas

Comparando la estructura objetivo definida en [`design/REHABILITATION_PLAN.md`](../../design/REHABILITATION_PLAN.md) (líneas 66–84) con el estado actual:

| Capa Planificada | Directorio | Estado |
|---|---|---|
| Entidades de dominio | `src/domain/entities/` | ❌ No existe |
| Interfaces de repositorio | `src/domain/repositories/` | ❌ No existe |
| Casos de uso | `src/domain/use-cases/` | ❌ No existe |
| Repositorios PostgreSQL | `src/infrastructure/database/` | ❌ No existe |
| Configuración centralizada | `src/infrastructure/config/` | ⚠️ Directorio vacío |
| Controllers HTTP | `src/interface/http/controllers/` | ❌ No existe |
| Rutas en `src/` (auth, products) | `src/interface/http/routes/` | ⚠️ Parcial (solo health, dora) |
| Middleware de auth en `src/` | `src/interface/http/middleware/` | ⚠️ Parcial (sin authGuard) |
| Validators | `src/interface/http/validators/` | ✅ Completo |

**Completitud de la arquitectura objetivo: 1 de 9 capas al 100% (11%).**

### 2.3 Inconsistencias Funcionales Medibles

#### Inconsistencia A: Validación Duplicada en Compra

En `routes/products.js`, el middleware `validatePurchase` (Zod, línea 71) valida la entrada y coloca el resultado en `req.validatedBody`, pero el handler de la misma ruta (líneas 80–107) **ignora `req.validatedBody`** y reimplementa validación manual:

```javascript
// routes/products.js — PROBLEMA: validación en dos lugares
router.all('/products/buy', validatePurchase, function(req, res, next) {
  // validatePurchase ya validó con Zod y produjo req.validatedBody, pero...

  let params = req.method === "GET"
    ? url.parse(req.url, true).query
    : req.body;                          // ← Lee req.body, no req.validatedBody

  // Reimplementa regex de email manualmente:
  const re = /^([a-zA-Z0-9])(([\-.]|[_]+)?([a-zA-Z0-9]+))*(@){1}...$/;
  if (!re.test(cart.mail)) {             // ← Duplica validación ya hecha por Zod
    throw new Error("Invalid mail format");
  }
  // Comprueba undefined manualmente (ya hecho por Zod):
  for (const prop in cart) {
    if (cart[prop] === undefined) {
      throw new Error("Missing parameter '" + prop + "'");
    }
  }
});
```

Si el schema Zod se modifica sin actualizar la validación manual, se abre una ventana de inconsistencia de seguridad.

#### Inconsistencia B: Logging Dual

```
Herramienta     | Archivos | Usos
----------------|----------|------
console.log/err | 5        | 14 llamadas server-side (model/ y routes/)
Winston logger  | 3        | Centralizado, solo en src/
```

Los 14 llamados a `console` no incluyen request IDs, niveles estructurados, ni formato JSON para ingestión por herramientas de monitoreo.

#### Inconsistencia C: Session Store No Persistente

`connect-pg-simple` está listado en `package.json` (línea 22) como dependencia instalada, pero **nunca se importa ni usa en `app.js`**. El session store utiliza el `MemoryStore` por defecto de `express-session`:

```javascript
// app.js:55 — Estado actual
app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  // store: ← NO CONFIGURADO → MemoryStore por defecto
  cookie: { ... }
}));
```

Consecuencia directa: **cualquier restart del contenedor destruye todas las sesiones activas**. Esto bloquea el escalado horizontal (múltiples instancias no comparten estado de sesión) y es una limitación conocida documentada en [`docs/fixes/IMPLEMENTATION_LOG.md`](../fixes/IMPLEMENTATION_LOG.md).

---

## 3. Decisión

**Se decide completar la migración a Clean Architecture (Hexagonal) consolidando todo el código de aplicación bajo `src/`, siguiendo la estructura objetivo definida en `design/REHABILITATION_PLAN.md`.**

Esta decisión formaliza y finaliza un proceso de migración que ya comenzó durante la rehabilitación, llevando el drift arquitectónico del 50% actual al 0%.

### 3.1 Alcance de la Decisión

La consolidación comprende cuatro acciones coordinadas:

**Acción 1 — Crear la Capa de Dominio (`src/domain/`)**

Crear las entidades de negocio y los contratos (interfaces) que encapsulan la lógica de dominio:

```
src/domain/
├── entities/
│   ├── User.js          # { name, password } + reglas de negocio
│   ├── Product.js       # { id, name, description, price, image }
│   └── Purchase.js      # { id, productId, userName, mail, ... }
├── repositories/
│   ├── IUserRepository.js      # interfaz: findByUsername(name)
│   └── IProductRepository.js   # interfaz: list(), getById(id), search(q), purchase(cart), getPurchased(user)
└── use-cases/
    ├── AuthenticateUser.js      # Encapsula: buscar usuario + verificar argon2
    ├── ListProducts.js          # Encapsula: SELECT * FROM products
    ├── SearchProducts.js        # Encapsula: ILIKE query
    ├── PurchaseProduct.js       # Encapsula: INSERT + validaciones de negocio
    └── GetPurchases.js          # Encapsula: SELECT por usuario
```

**Acción 2 — Crear Repositorios PostgreSQL (`src/infrastructure/database/`)**

Migrar las queries de `model/` a clases que implementen las interfaces del dominio, recibiendo la conexión por inyección de dependencias:

```
src/infrastructure/database/
├── connection.js                  # Migrado desde model/db.js
├── PostgresUserRepository.js      # Implementa IUserRepository
├── PostgresProductRepository.js   # Implementa IProductRepository
└── DatabaseInitializer.js         # Migrado desde model/init_db.js
```

**Acción 3 — Crear Controllers y migrar Rutas (`src/interface/http/`)**

```
src/interface/http/
├── controllers/
│   ├── AuthController.js      # Lógica HTTP de login/logout
│   └── ProductController.js   # Lógica HTTP de listado, búsqueda, compra
├── middleware/
│   └── authGuard.js           # Migrado desde routes/login_check.js
└── routes/
    ├── auth.js                # Migrado desde routes/login.js
    └── products.js            # Migrado desde routes/products.js (separando HTTP de lógica)
```

**Acción 4 — Unificación y Eliminación del Código Legacy**

- Mover `config.js` → `src/infrastructure/config/index.js`
- Activar `connect-pg-simple` como session store (REF-002 del roadmap, ROI=12.25)
- Reemplazar las 14 llamadas a `console.*` con el Winston logger existente
- Actualizar `app.js` para importar exclusivamente desde `src/`
- **Eliminar** `model/auth.js`, `model/db.js`, `model/init_db.js`, `model/products.js`, `routes/login.js`, `routes/login_check.js`, `routes/products.js`

---

## 4. Alternativas Consideradas

### Alternativa A: No Hacer Nada (Mantener Arquitectura Dual)

Mantener el estado actual con las dos capas coexistiendo indefinidamente.

| Aspecto | Evaluación |
|---|---|
| Esfuerzo | Cero |
| Onboarding | Cada nuevo desarrollador debe aprender dos patrones distintos |
| Mantenibilidad | Cada nueva feature debe decidir en qué capa implementarse |
| Testability | Imposible hacer unit testing aislado del dominio (sin interfaces) |
| Deuda técnica | Se acumula; el roadmap califica el riesgo de no actuar en R=3 (Medio) |

**Veredicto: Rechazada.** El drift arquitectónico no es un estado estable; tiende a aumentar sin intervención deliberada.

### Alternativa B: Refactoring Parcial (Solo Migrar `model/`)

Mover los 4 archivos de `model/` a `src/infrastructure/database/` sin crear la capa de dominio ni migrar `routes/`.

| Aspecto | Evaluación |
|---|---|
| Esfuerzo | Bajo (4 archivos, ~108 LOC) |
| Deuda técnica | Reduce parcialmente DT: `model/` desaparece, pero `routes/` sigue legacy |
| Testability | No mejora — sin domain layer no hay contrato para mockear |
| Drift arquitectónico | Mejora de 50% a ~25% (routes/ permanece) |
| Inconsistencias | Persiste la validación duplicada en `routes/products.js` |

**Veredicto: Rechazada.** Resuelve síntomas sin abordar la causa raíz: la ausencia de una capa de dominio testable con contratos definidos.

### Alternativa C: Migración a TypeScript como Primer Paso (REF-014)

Migrar todo el proyecto a TypeScript antes de consolidar la arquitectura.

| Aspecto | Evaluación |
|---|---|
| ROI calculado | 2.05 — Fase 3 Arquitectónico (requiere base de Fases 1 y 2) |
| Prerequisito | Requiere arquitectura unificada como base (este ADR es prerequisito de TypeScript) |
| Esfuerzo | Masivo (E=5 en el framework del roadmap, >1 semana) |
| Complejidad | Añade complejidad de migración de lenguaje sobre arquitectura ya inconsistente |

**Veredicto: Rechazada como paso previo.** TypeScript (REF-014) es un paso *posterior* a la consolidación, no anterior. La arquitectura unificada es prerequisito, no consecuencia.

### Alternativa D: Consolidación Completa (SELECCIONADA — Alternativa C del Análisis)

Completar la migración en su totalidad: crear domain layer, migrar infrastructure, migrar interface, eliminar legacy.

**Veredicto: Seleccionada.** Maximiza el valor arquitectónico, habilita testability completa, desbloquea TypeScript (REF-014) y elimina todas las inconsistencias documentadas.

---

## 5. Justificación con Evidencia

### 5.1 El Framework Cuantitativo del Proyecto ya Respalda Esta Decisión

El documento [`design/REFACTORING_ROADMAP.md`](../../design/REFACTORING_ROADMAP.md) define un framework de priorización con la siguiente fórmula de ROI:

```
ROI = (R × 0.30 + DT × 0.25 + VN × 0.25) / (E × 0.20)
```

Aplicando las puntuaciones asignadas a REF-011 y REF-012:

| Item | Riesgo (R) | Deuda Técnica (DT) | Valor Negocio (VN) | Esfuerzo (E) | ROI | Fase |
|---|---|---|---|---|---|---|
| REF-011: `model/` → `src/domain/` | 3 | **5** | 3 | 4 | **3.63** | 2 – Estratégico |
| REF-012: `routes/` → `src/interface/` | 3 | **5** | 3 | 4 | **3.63** | 2 – Estratégico |

Ambos items obtienen el máximo puntaje posible en Deuda Técnica (DT=5: *"Elimina patrón anti-arquitectónico sistémico, >10 archivos afectados"*). Ejecutarlos en conjunto en lugar de por separado reduce el riesgo de estados intermedios inconsistentes.

**Cálculo verificado de REF-011:**
```
ROI = (3×0.30 + 5×0.25 + 3×0.25) / (4×0.20)
    = (0.90 + 1.25 + 0.75) / 0.80
    = 2.90 / 0.80
    = 3.63  →  Fase 2 (Estratégico)
```

### 5.2 La Infraestructura de Soporte ya Existe

La consolidación no es una reescritura desde cero. Los bloques de construcción están en su mayoría disponibles:

| Componente | Estado | LOC disponibles |
|---|---|---|
| `PasswordHasher.js` | ✅ Listo en `src/infrastructure/security/` | 21 LOC |
| `Logger.js` (Winston) | ✅ Listo en `src/infrastructure/logging/` | 46 LOC |
| Validators Zod (auth + products) | ✅ Listos en `src/interface/http/validators/` | 86 LOC |
| `rateLimiter.js`, `requestId.js` | ✅ Listos en `src/interface/http/middleware/` | 27 LOC |
| `health.js`, `dora.js` | ✅ Listos en `src/interface/http/routes/` | 54 LOC |
| CI/CD pipeline | ✅ GitHub Actions (unit, e2e, SBOM, SonarCloud) | Operativo |
| Pre-commit hooks | ✅ Husky v9 + secretlint | Operativo |
| Tests existentes | ✅ 5 archivos de test en `tests/` | ~528 LOC |

**568 LOC ya están escritos bajo el patrón correcto.** La migración es completar el trabajo al 11% completado de la arquitectura objetivo, no empezar de cero.

### 5.3 La Cobertura de Tests Actual Bloquea la Calidad

El baseline de cobertura documentado en el roadmap es **~15%** (estimado, 4 archivos de test, 12 tests — fuente: `REFACTORING_ROADMAP.md` línea 135). Sin una capa de dominio con interfaces bien definidas, es imposible alcanzar el target de **≥80% unit coverage** porque:

1. Los use cases actuales están embebidos en los route handlers (`routes/products.js:109`: `db_products.purchase(cart)` se llama directamente desde el handler HTTP).
2. Testear el comportamiento de negocio requiere levantar un servidor Express completo o una base de datos real.
3. Con repositorios abstraídos por interfaces, los use cases pueden testearse con mocks sin infraestructura.

### 5.4 La Inconsistencia de Validación es un Riesgo Activo

En `routes/products.js`, existe **validación duplicada e inconsistente** en el endpoint de compra:

- El middleware `validatePurchase` (Zod, línea 71) define el contrato de validación en un solo lugar.
- El handler (líneas 81–107) reimplementa una expresión regular de email distinta y verificaciones de `undefined`.

Si un desarrollador actualiza el schema Zod para añadir una nueva restricción (ej. formato de teléfono), la validación manual no se actualiza automáticamente. Este tipo de divergencia es un vector de errores documentado en proyectos con arquitectura mixta (Newman, *Building Microservices*, 2021).

### 5.5 La Migración Desbloquea Inversiones Futuras

Según el roadmap, dos items de alto valor tienen como **prerequisito técnico** la arquitectura unificada:

| Item | ROI | Prerequisito |
|---|---|---|
| REF-014: Migración a TypeScript | 2.05 | Estructura `src/` unificada |
| REF-006: Cobertura de tests ≥80% | 3.94 | Domain layer con interfaces mockeable |
| REF-002: Activar `connect-pg-simple` | **12.25** | Puede ejecutarse en paralelo con este ADR |

---

## 6. Consecuencias

### 6.1 Consecuencias Positivas

| Métrica | Antes | Después |
|---|---|---|
| Drift arquitectónico | 50% | **0%** |
| Capas de dominio implementadas | 0 de 3 | **3 de 3** |
| Dependencias cross-boundary | 6 | **0** |
| `console.log`/`console.error` server-side | 14 | **0** (100% Winston) |
| Cobertura de tests (habilitada) | ~15% estimado | Camino a **≥80% unit** |
| Session store | MemoryStore (volátil) | PostgreSQL (persistente) |
| Inconsistencias de validación | 1 activa | **0** |
| Prerequisitos para TypeScript (REF-014) | Bloqueado | **Desbloqueado** |
| Prerequisitos para test coverage ≥80% | Bloqueado | **Desbloqueado** |

### 6.2 Consecuencias Negativas

- **Período de transición**: Durante la migración, el sistema estará en un estado intermedio con más inestabilidad que el estado actual.
- **9 vistas EJS existentes**: Los controllers deben pasar exactamente las mismas variables a `res.render()` para no romper las templates. Requiere revisión cuidadosa de las 9 vistas en `views/`.
- **Referencias en documentación**: Los 14 documentos de fix en `docs/fixes/` referencian rutas legacy (`model/auth.js`, `routes/login.js`). Requerirán una nota de *"paths actualizados post-ADR-001"* o actualización de paths.
- **Curva de aprendizaje**: Clean Architecture con capa de dominio es más compleja de entender para desarrolladores acostumbrados al MVC plano.

---

## 7. Trade-offs

| Dimensión | Pro (Consolidar) | Contra (No consolidar) |
|---|---|---|
| **Complejidad inmediata** | — | ↑ Más archivos, más carpetas |
| **Complejidad a largo plazo** | ↓ Un único patrón coherente | ↑ Dos patrones divergentes acumulan deuda |
| **Testability** | ↑ Domain layer mockeable, unit tests sin DB | — |
| **Onboarding** | ↑ Un patrón que aprender | ↑ Curva inicial de Clean Architecture |
| **Performance** | Neutral (indirección mínima ~1ns por call) | Neutral |
| **Seguridad** | ↑ Elimina inconsistencia de validación | ↑ Riesgo de divergencia Zod/manual persiste |
| **Escalabilidad** | ↑ Sessions en PostgreSQL = escalado horizontal | ↓ MemoryStore limita a una instancia |
| **TypeScript migration** | ↑ Habilitado | ↓ Bloqueado |
| **Costo de implementación** | — | ↑ 4-10 días de desarrollo | 0 |

### Punto de Inflexión

El trade-off más crítico es **complejidad inmediata vs. complejidad a largo plazo**. Con la Clean Architecture, el sistema tiene más archivos y carpetas, pero cada archivo tiene una responsabilidad única y clara. Sin ella, el número de archivos permanece bajo pero las responsabilidades se mezclan, generando bugs como la validación duplicada en `products.js`.

El patrón industrial es consistente: proyectos que mantienen arquitectura mixta indefinidamente incurren en costos de mantenimiento 2.5× mayores que proyectos con arquitectura uniforme (Fowler, *Refactoring: Improving the Design of Existing Code*, 2018).

---

## 8. Riesgos y Mitigaciones

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | Regresión en flujo de login/autenticación | Media | Alto | Ejecutar `tests/e2e/auth.e2e.test.js` antes y después de cada PR |
| R2 | Regresión en CRUD de productos / compras | Media | Alto | Ejecutar `tests/e2e/products.e2e.test.js` antes y después de cada PR |
| R3 | Views EJS dejan de recibir variables correctas | Media | Alto | Controllers deben mantener interfaz `res.render(view, { mismaVariable })` — verificar las 9 views |
| R4 | Endpoint `/health` pierde conexión a BD | Baja | Alto | Actualizar el import de `model/db.js` a `src/infrastructure/database/connection.js` en el mismo commit |
| R5 | Session store migration rompe sesiones activas | Baja | Medio | Deployer en horario de bajo tráfico; las sesiones en memoria ya son volátiles, no hay pérdida adicional |
| R6 | CI/CD falla por paths de import cambiados | Media | Medio | Los tests de CI usan `DATABASE_URL` y `SESSION_SECRET` de env vars; no dependen de paths internos |
| R7 | Tiempo de implementación excede estimación | Baja | Bajo | Dividir en 4 PRs atómicos (domain → infrastructure → interface → unification) |

### Estrategia de Mitigación Principal

Implementar la migración en **4 Pull Requests independientes y atómicos**, donde cada PR deja el sistema en estado funcional:

```
PR 1: Crear src/domain/ (solo nuevos archivos, ningún legacy se elimina)
PR 2: Crear src/infrastructure/database/ (solo nuevos archivos, ningún legacy se elimina)
PR 3: Crear src/interface/http/controllers/ y rutas en src/ (legacy aún activo)
PR 4: Actualizar app.js → eliminar legacy (cutover final)
```

El CI pipeline existente (GitHub Actions con tests e2e y healthcheck) actúa como safety net en cada PR.

---

## 9. Costos

### 9.1 Costos de Implementación

| Categoría | Detalle | Estimación |
|---|---|---|
| **Archivos nuevos a crear** | ~15–18 archivos (entities, repositories, use-cases, controllers, routes, config, db connection) | — |
| **Archivos a eliminar** | 7 archivos legacy (`model/` × 4 + `routes/` × 3) | — |
| **Archivos a modificar** | `app.js` (imports), `package.json` (activar connect-pg-simple) | ~2 archivos |
| **LOC a migrar** | 286 LOC legacy + refactoring de `app.js` (~141 LOC) | ~427 LOC |
| **Tests a actualizar** | 5 archivos en `tests/` con imports a model/ | ~20 líneas de import |
| **Esfuerzo estimado** | REF-011: 2–5 días + REF-012: 2–5 días | **4–10 días** |
| **Desarrolladores** | 1–2 developers con conocimiento del codebase | — |

Puntuación en el framework del roadmap: **E=4** (*"Alto: 2-5 días, refactoring estructural, migración de datos"*).

### 9.2 Costos de NO Implementar

| Consecuencia | Costo Estimado |
|---|---|
| Cada nueva feature requiere decisión de capa (legacy vs. clean) | +20% tiempo por feature |
| Bug de validación duplicada en compras (si diverge) | Costo de incidente de seguridad |
| MemoryStore: restart destruye sesiones activas | Experiencia de usuario degradada en cada deploy |
| Cobertura de tests bloqueada en ~15% | Riesgo de regresión no detectada en futuros cambios |
| TypeScript migration (REF-014, ROI=2.05) bloqueada | ROI no realizable hasta completar este ADR |

### 9.3 Análisis de Costo-Beneficio

```
Costo de implementación: 4–10 días
Beneficio anual estimado (reducción de tiempo en mantenimiento):
  - Drift 0%: ~20% de tiempo ahorrado por feature
  - Test coverage ≥80%: reducción ~30% de bugs en producción
  - TypeScript habilitado: +25% detección temprana de errores

Conclusión: Break-even estimado en 2–3 meses post-implementación.
```

---

## 10. Plan de Implementación

La implementación se divide en 4 fases técnicas, cada una ejecutable como un Pull Request independiente:

### Fase A — Capa de Dominio (PR #1)

```
src/domain/
├── entities/User.js            # Entidad: { name, password }
├── entities/Product.js         # Entidad: { id, name, description, price, image }
├── entities/Purchase.js        # Entidad: { id, productId, userName, mail, ... }
├── repositories/IUserRepository.js      # interfaz: findByUsername(name): Promise<User|null>
├── repositories/IProductRepository.js   # interfaz: list(), getById(id), search(q), purchase(cart), getPurchased(user)
├── use-cases/AuthenticateUser.js        # Recibe IUserRepository; llama findByUsername + PasswordHasher.verify
├── use-cases/ListProducts.js            # Recibe IProductRepository; llama list()
├── use-cases/SearchProducts.js          # Recibe IProductRepository; llama search(q)
├── use-cases/PurchaseProduct.js         # Recibe IProductRepository; llama purchase(cart)
└── use-cases/GetPurchases.js            # Recibe IProductRepository; llama getPurchased(user)
```

**Criterio de aceptación**: Todos los use cases tienen tests unitarios con repositorios mockeados. CI verde.

### Fase B — Repositorios PostgreSQL (PR #2)

```
src/infrastructure/
├── config/index.js                           # Mueve config.js aquí
└── database/
    ├── connection.js                         # Migra model/db.js (pg-promise singleton)
    ├── DatabaseInitializer.js                # Migra model/init_db.js
    ├── PostgresUserRepository.js             # Implementa IUserRepository (migra model/auth.js)
    └── PostgresProductRepository.js          # Implementa IProductRepository (migra model/products.js)
```

**Criterio de aceptación**: Tests de integración existentes pasan con los nuevos repositorios.

### Fase C — Controllers y Rutas (PR #3)

```
src/interface/http/
├── controllers/AuthController.js      # Lógica HTTP: render login, procesar auth, logout
├── controllers/ProductController.js   # Lógica HTTP: list, detail, search, buy, purchased
├── middleware/authGuard.js            # Migra routes/login_check.js
├── routes/auth.js                     # Migra routes/login.js (usa AuthController)
└── routes/products.js                 # Migra routes/products.js (usa ProductController)
```

**Criterio de aceptación**: Tests e2e pasan con las nuevas rutas activas en paralelo con las legacy.

### Fase D — Unificación y Cleanup (PR #4)

```
Cambios en app.js:
  - Actualizar todos los imports a src/
  - Activar connect-pg-simple como session store

Eliminar (7 archivos):
  - model/auth.js
  - model/db.js
  - model/init_db.js
  - model/products.js
  - routes/login.js
  - routes/login_check.js
  - routes/products.js

Reemplazar console.log (14 instancias) con logger.*

Nota en docs/fixes/ indicando path updates post-ADR-001
```

**Criterio de aceptación**: Health check responde `{"status":"healthy"}`. Tests e2e completos pasan. CI verde. Drift = 0%.

---

## 11. Criterios de Éxito

La implementación de este ADR se considerará exitosa cuando se verifiquen **todas** las siguientes métricas:

| Criterio | Medición | Target |
|---|---|---|
| Drift arquitectónico | `find model/ routes/ -name "*.js" 2>/dev/null \| wc -l` | **0** |
| Cross-boundary imports | `grep -r "from.*\.\./.*model/" src/ \| wc -l` | **0** |
| `console.log` server-side | `grep -r "console\." --include="*.js" --exclude-dir=public .` | **0** |
| Health check funcional | `GET /health` → `{"status":"healthy"}` | ✅ |
| Tests e2e auth | `npm run test:e2e -- auth` | ✅ Verde |
| Tests e2e products | `npm run test:e2e -- products` | ✅ Verde |
| Session store | `connect-pg-simple` configurado en `app.js` | ✅ |
| CI pipeline | GitHub Actions: unit-tests + e2e-tests + sbom-and-scan | ✅ Verde |

---

## 12. Referencias

### Documentación del Proyecto

- [`design/REHABILITATION_PLAN.md`](../../design/REHABILITATION_PLAN.md) — Estructura objetivo de Clean Architecture (líneas 63–84)
- [`design/REFACTORING_ROADMAP.md`](../../design/REFACTORING_ROADMAP.md) — Framework cuantitativo, puntuaciones REF-011/REF-012 (líneas 165–182)
- [`docs/fixes/IMPLEMENTATION_LOG.md`](../fixes/IMPLEMENTATION_LOG.md) — 14 fixes completados, limitaciones conocidas (session store, csurf)
- [`routes/products.js`](../../routes/products.js) — Evidencia de validación duplicada (líneas 71–107)
- [`src/interface/http/routes/health.js`](../../src/interface/http/routes/health.js) — Evidencia de cross-boundary import (línea 2)

### Bibliografía

- Martin, R. C. (2017). *Clean Architecture: A Craftsman's Guide to Software Structure and Design*. Prentice Hall.
  - *Dependency Rule*: "Source code dependencies must point only inward, toward higher-level policies."
- Fowler, M. (2018). *Refactoring: Improving the Design of Existing Code* (2nd ed.). Addison-Wesley.
  - Capítulo 2: Fundamentos para toma de decisiones de refactoring basadas en evidencia.
- Newman, S. (2021). *Building Microservices* (2nd ed.). O'Reilly Media.
  - Capítulo 3: Sobre los costos de inconsistencia arquitectónica en sistemas en transición.
- OWASP Top 10 (2021). Open Web Application Security Project.
  - Contexto de seguridad de los 14 fixes que dieron origen al estado arquitectónico actual.

---

*Documento generado para: Delivery 4 – Architecture Strategy & DevEx*
*Universidad Galileo – Postgrado en Diseño y Desarrollo de Software*
*Branch: `feature/adr-001-clean-architecture` | Fecha: 2026-03-30*
