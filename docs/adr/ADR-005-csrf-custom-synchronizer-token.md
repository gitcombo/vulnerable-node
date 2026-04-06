# ADR-005: Protección CSRF con Synchronizer Token Personalizado (sin csurf)

| Campo | Valor |
|---|---|
| **ID** | ADR-005 |
| **Estado** | Aceptado |
| **Fecha** | 2026-03-11 |
| **Proyecto** | vulnerable-node (Rehabilitado) |
| **Contexto Académico** | Postgrado en Ingeniería de Software – Universidad Galileo |
| **Entregable** | Delivery 3 – DevSecOps Hardening |
| **Categoría** | Seguridad — Protección de Sesión |

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

El proyecto original no tenía protección CSRF. Un atacante podía construir una página maliciosa que enviara requests POST a la aplicación usando las cookies de sesión de un usuario autenticado, ejecutando acciones en su nombre (compras, cambios de cuenta).

Durante la rehabilitación de seguridad (Delivery 3), se requería implementar protección CSRF para todos los formularios POST. El paquete `csurf` era la solución estándar histórica en el ecosistema Express, pero fue deprecado.

**Archivos afectados:**
- `app.js:69-113` — Middleware CSRF y error handler
- `views/` — Templates EJS que incluyen `csrfToken`

---

## 2. Problema

La protección CSRF requería:

1. **Efectividad**: Verificar que cada POST proviene de un formulario generado por la propia aplicación
2. **Compatibilidad**: Sin dependencias deprecated o sin mantenimiento
3. **Mantenibilidad**: Interface simple, compatible con los templates EJS existentes
4. **Zero-dependency**: No introducir nuevas dependencias de terceros para funcionalidad crítica de seguridad

---

## 3. Decisión

**Se implementa el patrón Synchronizer Token usando `crypto.randomBytes(32)` del módulo nativo de Node.js, sin dependencias externas.**

```javascript
// app.js — Generación y validación del token CSRF

// Generación: se crea un token por sesión y se expone a templates
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
});

// Validación: en cada POST se verifica que el token del body coincide con el de sesión
app.use((req, res, next) => {
  const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
  if (SAFE_METHODS.includes(req.method)) return next();

  // Permitir rutas sin sesión activa
  if (!req.session?.user_name) return next();

  const bodyToken = req.body._csrf || req.headers['x-csrf-token'];
  if (!bodyToken || bodyToken !== req.session.csrfToken) {
    const err = new Error('EBADCSRFTOKEN');
    err.code  = 'EBADCSRFTOKEN';
    err.status = 403;
    return next(err);
  }
  next();
});

// Error handler específico para CSRF
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { message: 'Invalid CSRF token' });
  }
  next(err);
});
```

Los templates EJS incluyen el token como campo oculto:
```html
<input type="hidden" name="_csrf" value="<%= csrfToken %>">
```

---

## 4. Alternativas Consideradas

### 4.1 csurf@1.11.0 (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Solución establecida, ampliamente documentada |
| Desventaja | **Deprecated** — sin mantenimiento desde 2021, sin parches de seguridad futuros |
| Desventaja | Dependencia `cookie@0.4.0` tiene GHSA-pxg6-pf52-xh8x (Header Injection) |
| Desventaja | Documentación oficial de Express recomienda NO usarlo |
| Veredicto | **Descartado** — package deprecated es riesgo de supply chain (ADR-002 relacionado) |

### 4.2 Double-Submit Cookie Pattern (descartado)

| Aspecto | Detalle |
|---|---|
| Descripción | El token CSRF se envía tanto como cookie como en el body |
| Ventaja | No requiere estado en servidor |
| Desventaja | Vulnerable si el atacante puede escribir cookies en el dominio (subdomain takeover) |
| Desventaja | Más complejo de implementar correctamente |
| Veredicto | **Descartado** — Synchronizer Token es más simple y más seguro para este caso |

### 4.3 SameSite=Strict únicamente (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Zero-code — solo configuración de cookies |
| Desventaja | `SameSite=Strict` ya está configurado en el proyecto **pero no es suficiente solo** |
| Desventaja | Navegadores legacy y algunas configuraciones de proxy no respetan SameSite |
| Desventaja | OWASP recomienda defensa en profundidad: SameSite + CSRF token |
| Veredicto | **Descartado como único mecanismo** — usado como capa complementaria junto al token |

---

## 5. Justificación con Evidencia

### 5.1 Compatibilidad de interfaz con csurf

La implementación personalizada mantiene **exactamente la misma interfaz pública** que `csurf`:

| Elemento | csurf | Implementación custom |
|---|---|---|
| Token en templates | `res.locals.csrfToken` | `res.locals.csrfToken` ✓ |
| Campo de formulario | `_csrf` | `_csrf` ✓ |
| Header alternativo | `x-csrf-token` | `x-csrf-token` ✓ |
| Código de error | `EBADCSRFTOKEN` | `EBADCSRFTOKEN` ✓ |

Esto significa que **ningún template EJS requirió cambios** durante la migración.

### 5.2 Criptografía correcta

`crypto.randomBytes(32)` produce 256 bits de entropía criptográficamente seguros, convertidos a 64 caracteres hexadecimales. Esto es equivalente o superior a lo que generaba `csurf` internamente.

### 5.3 Zero new dependencies

La implementación usa únicamente `crypto` (módulo nativo de Node.js). No se introdujo ninguna nueva dependencia, lo que:
- Reduce la superficie de ataque de supply chain
- Elimina el riesgo de futuras deprecaciones
- No agrega peso al `node_modules`

---

## 6. Consecuencias

### Positivas
- CSRF eliminado de la lista de vulnerabilidades sin dependencias externas
- Interface idéntica a `csurf` — sin cambios en templates
- Totalmente mantenible: 44 líneas de código en `app.js`, sin abstracción oculta
- Defensa en profundidad: token + `SameSite=Strict` en cookies

### Negativas
- La lógica de seguridad crítica reside en `app.js` en lugar de en un módulo dedicado (`src/infrastructure/security/`)
- Si la sesión no existe (usuario no autenticado), la validación se omite — esto es correcto por diseño pero debe documentarse para evitar malentendidos

### Deuda técnica
Cuando se complete ADR-001 (Clean Architecture), el middleware CSRF debería moverse a `src/interface/http/middleware/csrf.js` para consistencia con el resto de la capa de seguridad.

---

## 7. Trade-offs

| Dimensión | Custom (elegido) | csurf (descartado) |
|---|---|---|
| Mantenimiento | Propio (44 líneas auditables) | Sin mantenimiento desde 2021 |
| Dependencias | 0 nuevas | 1 deprecated con CVE |
| Compatibilidad con csurf | 100% (misma interfaz) | N/A |
| Riesgo supply chain | Mínimo | Alto (paquete deprecado) |
| Complejidad | Baja (patrón bien documentado) | Baja (pero caja negra) |
| Auditabilidad | Total | Parcial |

---

## 8. Referencias

- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Node.js crypto.randomBytes: https://nodejs.org/api/crypto.html#cryptorandombytessize-callback
- csurf deprecation notice: https://github.com/expressjs/csurf#readme
- `app.js:69-113` — Implementación del middleware CSRF
- `docs/fixes/006-csrf-protection.md` — Corrección documentada
