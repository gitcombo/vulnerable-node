# ADR-002: Query Builder con pg-promise en lugar de ORM completo

| Campo | Valor |
|---|---|
| **ID** | ADR-002 |
| **Estado** | Aceptado |
| **Fecha** | 2026-03-11 |
| **Proyecto** | vulnerable-node (Rehabilitado) |
| **Contexto Académico** | Postgrado en Ingeniería de Software – Universidad Galileo |
| **Entregable** | Delivery 2 – Rehabilitación Base |
| **Categoría** | Arquitectura de Datos |

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

El proyecto `vulnerable-node` es una aplicación e-commerce Node.js con PostgreSQL 16 como base de datos. Durante la rehabilitación de seguridad (Delivery 2), la capa de datos debía migrarse de queries SQL concatenadas (SQL Injection activo) a una estrategia segura de acceso a datos.

El codebase original usaba strings concatenados directamente en queries, lo que generó la vulnerabilidad crítica de SQL Injection documentada en `docs/fixes/`. La decisión de qué herramienta adoptar para la capa de datos tenía implicaciones directas sobre la seguridad y la arquitectura futura.

**Archivos afectados:**
- `model/db.js` — Singleton de conexión
- `model/auth.js` — Queries de autenticación
- `model/products.js` — Queries CRUD de productos
- `model/init_db.js` — Inicialización y seed

---

## 2. Problema

La elección de la capa de acceso a datos debía satisfacer simultáneamente:

1. **Seguridad**: Prevenir SQL Injection mediante queries parametrizadas
2. **Continuidad**: Preservar la lógica SQL existente sin reescritura completa
3. **Control**: Mantener visibilidad sobre las queries ejecutadas
4. **Escala del proyecto**: Apropiado para una aplicación educativa de tamaño pequeño-mediano

---

## 3. Decisión

**Se adopta `pg-promise` v11 como query builder sobre PostgreSQL 16, usando el patrón de conexión singleton.**

```javascript
// model/db.js — Singleton de conexión
import pgPromise from 'pg-promise';
const pgp = pgPromise();
const db = pgp(process.env.DATABASE_URL);
export default db;

// Uso con parámetros seguros — model/auth.js:8
const user = await db.oneOrNone(
  'SELECT * FROM users WHERE username=$1', [username]
);
```

Las queries de la aplicación usan la sintaxis `$1`, `$2`... de pg-promise, que genera prepared statements parametrizados internamente, eliminando la posibilidad de SQL Injection.

---

## 4. Alternativas Consideradas

### 4.1 Prisma ORM (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Type-safety completo, migraciones declarativas, Prisma Client auto-generado |
| Desventaja | Requiere reescritura completa del schema y todos los queries |
| Desventaja | Overhead de generación de tipos en proyecto sin TypeScript |
| Desventaja | Abstracción opaca dificulta auditoría de queries SQL para seguridad |
| Veredicto | **Descartado** — costo de migración excede beneficio en proyecto de rehabilitación incremental |

### 4.2 Sequelize ORM (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | ORM maduro con amplio ecosistema |
| Desventaja | API verbosa y confusa (mixtura de callbacks, promises y async/await) |
| Desventaja | Queries generadas difíciles de auditar |
| Desventaja | Requiere reescritura completa de la capa model/ |
| Veredicto | **Descartado** — complejidad sin beneficio claro sobre pg-promise |

### 4.3 node-postgres (pg) raw (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Dependencia mínima, máximo control |
| Desventaja | Sin utilidades de formato, connection pooling manual, verbosidad alta |
| Desventaja | Manejo de conexiones más propenso a errores |
| Veredicto | **Descartado** — pg-promise agrega utilidades sin overhead significativo |

### 4.4 Knex.js (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Query builder fluido, agnóstico de base de datos |
| Desventaja | Agnóstico de BD es irrelevante (el proyecto usa exclusivamente PostgreSQL) |
| Desventaja | Abstracción adicional sin beneficio concreto |
| Veredicto | **Descartado** — la portabilidad de BD no es un requisito del proyecto |

---

## 5. Justificación con Evidencia

### 5.1 Prevención de SQL Injection

Antes de la rehabilitación, `model/products.js` contenía:
```javascript
// ANTES — SQL Injection activo (fix documentado en docs/fixes/)
const query = "SELECT * FROM products WHERE id=" + req.query.id;
```

Con pg-promise, toda query usa parámetros posicionales:
```javascript
// DESPUÉS — Parametrizado y seguro
db.oneOrNone('SELECT * FROM products WHERE id=$1', [id])
```

pg-promise envía los parámetros por separado al driver de PostgreSQL; el valor nunca se interpola en el string SQL.

### 5.2 Compatibilidad con SQL existente

pg-promise preserva el SQL nativo, lo que permite mantener las queries originales (corregidas) sin reescritura completa. Esto alineó con el principio de rehabilitación incremental definido en `design/REHABILITATION_PLAN.md`.

### 5.3 Footprint mínimo

pg-promise no genera código, no requiere archivos de schema adicionales, y no impone convenciones de nombre. Es adecuado para un proyecto de 7 archivos en `model/`.

---

## 6. Consecuencias

### Positivas
- SQL Injection eliminado en todas las queries (`$1`, `$2`... en 100% de los accesos a datos)
- Queries auditables directamente en código — no hay abstracción que oculte el SQL real
- Sin overhead de generación de tipos ni archivos de schema adicionales

### Negativas
- Sin type-safety en queries (los resultados son `any` desde TypeScript)
- Sin migraciones declarativas — cambios de schema se gestionan manualmente en `model/init_db.js`
- La capa `model/` permanece como legacy en la arquitectura dual (ver ADR-001)

### Impacto en ADR-001
La adopción de pg-promise en `model/` es una de las razones por las que el ADR-001 propone migrar a `src/infrastructure/database/` con repositorios que abstraigan el acceso a pg-promise detrás de interfaces definidas.

---

## 7. Trade-offs

| Dimensión | pg-promise | Prisma (alternativa rechazada) |
|---|---|---|
| Control sobre SQL | Total | Limitado (Prisma genera SQL) |
| Type-safety | Ninguno | Completo |
| Velocidad de migración | Alta (queries existentes reutilizables) | Baja (reescritura completa) |
| Curva de aprendizaje | Baja | Media-Alta |
| Migraciones | Manual | Declarativo con `prisma migrate` |
| Adecuación al proyecto | Alta | Sobredimensionado para proyecto educativo |

---

## 8. Referencias

- pg-promise documentation: https://vitaly-t.github.io/pg-promise/
- OWASP SQL Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- `docs/fixes/` — Documentación de la corrección de SQL Injection
- `design/REHABILITATION_PLAN.md` — Principio de rehabilitación incremental
