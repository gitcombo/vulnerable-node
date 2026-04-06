# ADR-003: Argon2id como Algoritmo de Hashing de Contraseñas

| Campo | Valor |
|---|---|
| **ID** | ADR-003 |
| **Estado** | Aceptado |
| **Fecha** | 2026-03-11 |
| **Proyecto** | vulnerable-node (Rehabilitado) |
| **Contexto Académico** | Postgrado en Ingeniería de Software – Universidad Galileo |
| **Entregable** | Delivery 2 – Rehabilitación Base |
| **Categoría** | Seguridad Criptográfica |

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

El proyecto original almacenaba contraseñas en texto plano en la base de datos PostgreSQL — vulnerabilidad crítica documentada en `docs/fixes/003-password-hashing.md`. La rehabilitación requería adoptar un algoritmo de hashing seguro para contraseñas.

La elección del algoritmo no es trivial: diferentes algoritmos tienen distintas propiedades de resistencia a ataques de fuerza bruta, consumo de recursos, y soporte en el ecosistema Node.js.

**Archivos afectados:**
- `src/infrastructure/security/PasswordHasher.js` — Implementación del hasher
- `model/auth.js` — Verifica contraseña en login
- `model/init_db.js` — Pre-hashea contraseñas en seed de desarrollo

---

## 2. Problema

Se necesitaba un algoritmo que cumpliera:

1. **Resistencia a GPU/ASIC**: Costoso para hardware especializado de cracking
2. **Parámetros configurables**: Memory cost, time cost, paralelismo
3. **Recomendación actual**: Avalado por organismos de seguridad vigentes (NIST, OWASP)
4. **Soporte Node.js**: Bindings nativos estables y mantenidos

---

## 3. Decisión

**Se adopta Argon2id con los siguientes parámetros, encapsulado en la clase `PasswordHasher`:**

```javascript
// src/infrastructure/security/PasswordHasher.js
import argon2 from 'argon2';

const HASH_OPTIONS = {
  type:        argon2.argon2id,  // Variante resistente a side-channel y GPU
  memoryCost:  65536,            // 64 MB de RAM requeridos por operación
  timeCost:    3,                // 3 iteraciones
  parallelism: 4,                // 4 hilos paralelos
};

export class PasswordHasher {
  static async hash(password)         { return argon2.hash(password, HASH_OPTIONS); }
  static async verify(hash, password) { return argon2.verify(hash, password); }
}
```

La variante **argon2id** combina las propiedades de argon2i (resistencia a side-channel) y argon2d (resistencia a GPU), siendo la variante recomendada por el RFC 9106 para la mayoría de casos de uso.

---

## 4. Alternativas Consideradas

### 4.1 bcrypt (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Estándar de facto en Node.js, amplio conocimiento del ecosistema |
| Ventaja | `bcrypt.js` puro JavaScript disponible como fallback |
| Desventaja | Diseñado en 1999 — no fue creado para resistir hardware moderno (GPU/ASIC) |
| Desventaja | Memory cost fijo (~4KB) — hardware especializado puede paralelizar ataques masivamente |
| Desventaja | Límite de 72 bytes en la contraseña — contraseñas más largas se truncan silenciosamente |
| Veredicto | **Descartado** — Argon2 es superior en todas las dimensiones de seguridad |

### 4.2 scrypt (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Incluido en módulo `crypto` nativo de Node.js (sin dependencia externa) |
| Ventaja | Memory-hard por diseño |
| Desventaja | Parámetros difíciles de calibrar correctamente |
| Desventaja | No ganó el Password Hashing Competition — Argon2 fue el vencedor |
| Veredicto | **Descartado** — Argon2id ofrece mejor perfil de seguridad y más claridad en parámetros |

### 4.3 PBKDF2 (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Recomendado por NIST para casos de interoperabilidad federal (FIPS) |
| Ventaja | Nativo en Node.js `crypto` |
| Desventaja | No es memory-hard — GPUs pueden atacarlo eficientemente |
| Desventaja | OWASP lo posiciona por debajo de Argon2 y bcrypt para nuevas implementaciones |
| Veredicto | **Descartado** — solo apropiado para requisitos FIPS específicos no aplica aquí |

---

## 5. Justificación con Evidencia

### 5.1 Password Hashing Competition (PHC) 2015

Argon2 fue el ganador del concurso internacional PHC, proceso de selección de 3 años que evaluó resistencia a ataques, eficiencia en hardware legítimo, y flexibilidad de parámetros. Es el sucesor natural de bcrypt y scrypt.

### 5.2 Recomendaciones vigentes

| Organismo | Recomendación |
|---|---|
| OWASP Password Storage Cheat Sheet | Argon2id como primera opción |
| RFC 9106 (2021) | Define Argon2id como variante recomendada para uso general |
| NIST SP 800-63B | Permite Argon2 para autenticación |

### 5.3 Parámetros elegidos y su justificación

```
memoryCost: 65536  (64 MB)
  → Cada verificación requiere 64 MB de RAM
  → Atacante con 1 GPU (8 GB VRAM) solo puede ejecutar ~128 hashes en paralelo
  → vs. bcrypt: atacante puede ejecutar miles en paralelo

timeCost: 3
  → 3 iteraciones sobre la memoria
  → ~250ms en hardware de desarrollo típico — aceptable para login

parallelism: 4
  → Usa 4 hilos — aprovecha CPUs multi-core del servidor
  → No beneficia al atacante que ya está saturado por memoryCost
```

### 5.4 Encapsulamiento en PasswordHasher

La clase `PasswordHasher` encapsula el algoritmo y sus parámetros. Si en el futuro se decide cambiar parámetros (más iteraciones) o migrar de algoritmo, el cambio ocurre en un único archivo sin afectar a los consumidores (`model/auth.js`, `model/init_db.js`).

---

## 6. Consecuencias

### Positivas
- Contraseñas almacenadas con el estado del arte en hashing (2026)
- Resistencia a ataques GPU: 64 MB/hash imposibilita paralelismo masivo
- Sin límite de longitud de contraseña (a diferencia de bcrypt con 72 bytes)
- Parámetros actualizables sin cambiar la API de `PasswordHasher`

### Negativas
- **Consumo de memoria**: Cada verificación de login consume 64 MB de RAM durante ~250ms
- **Implicación en contenedores**: El contenedor Docker del proyecto debe tener al menos 256 MB disponibles para manejar concurrencia mínima de 4 logins simultáneos
- **Dependencia nativa**: `argon2` requiere compilación de bindings C++ — puede fallar en entornos sin herramientas de build

### Mitigación del impacto en memoria
Los 64 MB son transitorios (duración del hash/verify). Para una aplicación e-commerce de escala pequeña, los picos de login simultáneo son manejables. Para escala enterprise con miles de logins/segundo, se requeriría revisitar `memoryCost`.

---

## 7. Trade-offs

| Dimensión | Argon2id | bcrypt (alternativa rechazada) |
|---|---|---|
| Resistencia a GPU | Alta (memory-hard) | Media (limitada por diseño de 1999) |
| Compatibilidad ecosistema | Media | Muy alta |
| Consumo de RAM por hash | 64 MB (configurable) | ~4 KB (fijo) |
| Velocidad de verificación | ~250ms | ~100ms |
| Límite de contraseña | Sin límite | 72 bytes |
| Recomendación OWASP 2024 | Primera opción | Segunda opción |
| Dependencia nativa | Sí (bindings C++) | Sí (o bcryptjs puro JS) |

La latencia adicional de ~150ms respecto a bcrypt es aceptable: el login no es una operación de alta frecuencia, y el overhead es precisamente lo que dificulta los ataques de fuerza bruta.

---

## 8. Referencias

- RFC 9106 — Argon2 Memory-Hard Function: https://www.rfc-editor.org/rfc/rfc9106
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Password Hashing Competition (PHC): https://www.password-hashing.net/
- `src/infrastructure/security/PasswordHasher.js` — Implementación
- `docs/fixes/003-password-hashing.md` — Corrección documentada
