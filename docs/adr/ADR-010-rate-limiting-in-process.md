# ADR-010: Rate Limiting In-Process con express-rate-limit

| Campo | Valor |
|---|---|
| **ID** | ADR-010 |
| **Estado** | Aceptado (con limitaciones conocidas) |
| **Fecha** | 2026-03-11 |
| **Proyecto** | vulnerable-node (Rehabilitado) |
| **Contexto Académico** | Postgrado en Ingeniería de Software – Universidad Galileo |
| **Entregable** | Delivery 2 – Rehabilitación Base |
| **Categoría** | Resiliencia / Seguridad Operacional |

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

El proyecto original no tenía ningún mecanismo de control de tasa. Un atacante podía realizar intentos de fuerza bruta contra el endpoint `/login/auth` o saturar la API con requests ilimitados, pudiendo causar degradación de servicio o compromiso de cuentas.

Durante la rehabilitación, se requería implementar rate limiting como control preventivo.

**Archivos afectados:**
- `src/interface/http/middleware/rateLimiter.js` — Configuración de los limitadores
- `app.js:94-95` — Aplicación de los limitadores en las rutas

---

## 2. Problema

Se necesitaba un mecanismo que:

1. **Protección de brute-force**: Limitar intentos de login por IP
2. **Protección de DoS básico**: Limitar el volumen general de requests a la API
3. **Headers estándar**: Informar al cliente cuántos requests le quedan (RFC 6585)
4. **Sin infraestructura adicional**: Funcionar sin Redis u otro servicio externo para la escala del proyecto

---

## 3. Decisión

**Se adopta `express-rate-limit` v7 con dos configuraciones diferenciadas.**

```javascript
// src/interface/http/middleware/rateLimiter.js
import rateLimit from 'express-rate-limit';

// Limitador estricto para login — prevención de brute-force
export const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,  // Ventana de 15 minutos
  max:              5,               // 5 intentos por IP por ventana
  standardHeaders:  true,            // RateLimit-* headers (RFC 6585)
  legacyHeaders:    false,
  message:          { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// Limitador general para toda la API
export const apiLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,  // Ventana de 15 minutos
  max:              100,             // 100 requests por IP por ventana
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests. Try again later.' },
});
```

```javascript
// app.js:94-95 — Aplicación
app.use('/login/auth', loginLimiter);  // Solo en autenticación
app.use('/api',        apiLimiter);    // En toda la API
```

---

## 4. Alternativas Consideradas

### 4.1 WAF (Web Application Firewall) — nginx/Cloudflare (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Rate limiting fuera del proceso Node.js — no consume recursos de la app |
| Ventaja | Protección antes de que el request llegue a la aplicación |
| Desventaja | Requiere infraestructura adicional (nginx como reverse proxy o cuenta Cloudflare) |
| Desventaja | Fuera del alcance del proyecto académico con Docker Compose |
| Veredicto | **Descartado** — introduce infraestructura que no existe en el stack actual |

### 4.2 Redis-backed rate limiting (descartado)

| Aspecto | Detalle |
|---|---|
| Descripción | `express-rate-limit` + `rate-limit-redis` store |
| Ventaja | Estado compartido entre múltiples instancias (horizontal scaling) |
| Desventaja | Requiere Redis como dependencia de infraestructura |
| Desventaja | El proyecto actualmente es de instancia única |
| Veredicto | **Descartado para esta etapa** — la limitación está documentada en consecuencias y aplica si el proyecto escala horizontalmente |

### 4.3 Sin rate limiting (descartado)

| Aspecto | Detalle |
|---|---|
| Riesgo | Brute-force sobre `/login/auth` — puede comprometer cuentas en minutos |
| Riesgo | DoS simple con requests ilimitados |
| Veredicto | **Descartado** — es una vulnerabilidad de OWASP Top 10 (A07:2021 Identification and Authentication Failures) |

---

## 5. Justificación con Evidencia

### 5.1 Configuración basada en OWASP

OWASP recomienda para prevención de brute-force en login:
- Bloqueo temporal tras N intentos fallidos
- Ventana de tiempo razonable (15 min es el estándar común)
- Feedback al usuario sobre cuándo puede reintentar

La configuración de 5 intentos/15 minutos permite a un usuario legítimo 480 intentos de login al día (32 ventanas × 15 min = 480 min × 5 = 480 intentos/día) mientras hace impráctica la fuerza bruta automatizada.

### 5.2 Headers RFC 6585

`standardHeaders: true` agrega headers informativos a la respuesta:

```
RateLimit-Limit: 100
RateLimit-Remaining: 87
RateLimit-Reset: 1712001600
```

Esto permite a clientes legítimos adaptar su comportamiento sin necesidad de reintentar en loop.

### 5.3 Separación de políticas por endpoint

El endpoint `/login/auth` recibe un límite mucho más estricto (5 req/15min) que la API general (100 req/15min). Esta diferenciación reconoce que el riesgo de brute-force en autenticación es categorialmente diferente al de la API de productos.

---

## 6. Consecuencias

### Positivas
- Brute-force contra login limitado a 5 intentos por IP cada 15 minutos
- API general limitada a 100 requests por IP cada 15 minutos
- Headers estándar informan al cliente sobre el límite restante
- Zero dependencies adicionales de infraestructura

### Negativas y limitaciones conocidas

**Limitación 1: No distribuido**
El rate limit vive en memoria del proceso Node.js. Si se despliegan múltiples instancias, cada instancia mantiene su propio contador. Un atacante puede bypassear el límite rotando entre instancias. Para multi-instancia se requeriría `rate-limit-redis`.

**Limitación 2: Vulnerable a IP spoofing con proxies**
El `keyGenerator` usa `req.ip`. Si la aplicación está detrás de un proxy (nginx, load balancer), `req.ip` puede ser la IP del proxy, no la del cliente real. Requiere configurar `app.set('trust proxy', 1)` y que el proxy reenvíe `X-Forwarded-For`.

**Limitación 3: Reset en restart**
Los contadores se pierden cuando la aplicación reinicia. Un atacante puede hacer 5 intentos de login, esperar el reinicio (o forzarlo via DoS), y reintentar.

Estas limitaciones son aceptables para el scope del proyecto académico de instancia única.

---

## 7. Trade-offs

| Dimensión | In-process (elegido) | Redis-backed (descartado) |
|---|---|---|
| Infraestructura requerida | Ninguna | Redis |
| Efectividad en instancia única | 100% | 100% |
| Efectividad en multi-instancia | Limitada | Completa |
| Persistencia en restart | No | Sí |
| Complejidad de setup | Baja | Media |
| Adecuación al proyecto | Alta | Over-engineering actual |

---

## 8. Referencias

- express-rate-limit: https://github.com/express-rate-limit/express-rate-limit
- RFC 6585 — Additional HTTP Status Codes: https://www.rfc-editor.org/rfc/rfc6585
- OWASP A07:2021 — Identification and Authentication Failures: https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/
- `src/interface/http/middleware/rateLimiter.js` — Configuración
- `app.js:94-95` — Aplicación de los limitadores
