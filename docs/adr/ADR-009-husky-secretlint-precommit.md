# ADR-009: Husky + Secretlint como Protección de Secretos en Origen

| Campo | Valor |
|---|---|
| **ID** | ADR-009 |
| **Estado** | Aceptado |
| **Fecha** | 2026-03-11 |
| **Proyecto** | vulnerable-node (Rehabilitado) |
| **Contexto Académico** | Postgrado en Ingeniería de Software – Universidad Galileo |
| **Entregable** | Delivery 3 – DevSecOps Hardening |
| **Categoría** | Seguridad de Supply Chain / Developer Experience |

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

Los secretos (tokens de API, credenciales, claves privadas) son uno de los vectores más comunes de compromiso en proyectos de software. Una vez que un secreto llega al repositorio Git remoto, incluso si se elimina en un commit posterior, permanece accesible en el historial y puede ser indexado por herramientas de búsqueda de secretos.

El proyecto requería un mecanismo que previniera la exposición de secretos **antes** de que llegaran al repositorio remoto.

**Archivos afectados:**
- `.husky/pre-commit` — Hook que ejecuta el escaneo
- `.secretlintrc.json` — Configuración de reglas de detección
- `.secretlintignore` — Archivos excluidos del escaneo
- `package.json:14` — Script `"prepare": "husky"` para instalación automática

---

## 2. Problema

Se necesitaba una estrategia que:

1. **Prevención en origen**: Bloquear el commit antes de que el secreto llegue al repositorio
2. **Feedback inmediato**: El desarrollador recibe el error en el momento del commit
3. **Detección amplia**: Cubrir múltiples tipos de secretos (AWS, GitHub, Google, Slack, etc.)
4. **Instalación automática**: El hook debe instalarse automáticamente al hacer `npm install`

---

## 3. Decisión

**Se adopta Husky v9 para gestión de git hooks combinado con Secretlint para detección de secretos, configurado como pre-commit hook.**

```bash
# .husky/pre-commit
echo "Scanning staged files for secrets..."

STAGED=$(git diff --cached --name-only --diff-filter=d)

if [ -z "$STAGED" ]; then
  echo "No staged files to check."
  exit 0
fi

echo "$STAGED" | xargs npx secretlint --no-color

EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "ERROR: Potential secrets detected in staged files."
  echo "   Remove secrets before committing."
  echo "   Use 'git commit --no-verify' to bypass (not recommended)."
  echo ""
  exit 1
fi

echo "No secrets detected. Proceeding with commit."
```

```json
// .secretlintrc.json
{
  "rules": [
    { "id": "@secretlint/secretlint-rule-preset-recommend" }
  ]
}
```

La instalación es automática: `"prepare": "husky"` en `package.json` ejecuta Husky al hacer `npm install`.

---

## 4. Alternativas Consideradas

### 4.1 GitHub Secret Scanning nativo (descartado como única capa)

| Aspecto | Detalle |
|---|---|
| Ventaja | Zero-config en repositorios GitHub, detección automática en push |
| Desventaja | **Post-commit detection**: el secreto ya llegó al repositorio remoto |
| Desventaja | GitHub puede invalidar el token automáticamente (solo para algunos providers) pero el secreto sigue en el historial |
| Desventaja | No hay forma de recuperarse de un secreto en historial público |
| Veredicto | **Mantenido como segunda capa**, no como única defensa — la protección debe ocurrir antes del push |

### 4.2 Pre-push hook en lugar de pre-commit (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Menos interrupciones durante desarrollo (solo al hacer push) |
| Desventaja | El secreto ya está en el historial local — requiere rebase para eliminar |
| Desventaja | Eliminar un secreto del historial Git es destructivo y disruptivo |
| Veredicto | **Descartado** — el pre-commit bloquea antes de que el secreto entre al historial |

### 4.3 git-secrets (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Herramienta de AWS, diseñada específicamente para prevenir secretos |
| Desventaja | Configuración manual de patrones — sin preset completo out-of-the-box |
| Desventaja | Menos mantenido que Secretlint (actualizaciones menos frecuentes) |
| Veredicto | **Descartado** — Secretlint tiene preset recomendado más amplio y mejor integración con npm |

### 4.4 detect-secrets (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Herramienta de Yelp, ampliamente usada en entornos enterprise |
| Desventaja | Requiere Python — dependencia fuera del stack Node.js del proyecto |
| Desventaja | Configuración más compleja para proyectos Node.js |
| Veredicto | **Descartado** — mantener el stack en JavaScript/Node.js reduce fricción |

---

## 5. Justificación con Evidencia

### 5.1 Demostración del hook en acción

El hook fue probado con un token de GitHub PAT en un archivo staged:

```bash
$ echo 'const token = "ghp_<REDACTED_FOR_DOCS>xxxxxxxxxxxxxxxxxxxxxxxxxxxxx";' > test-secret.js
$ git add test-secret.js
$ git commit -m "test: should be blocked"

Scanning staged files for secrets...
test-secret.js
  1:15  error  [GITHUB_TOKEN] found GitHub Token(*****): ****  @secretlint/secretlint-rule-github

husky - pre-commit script failed (code 123)
# → Commit BLOQUEADO
```

El commit fue rechazado. El secreto nunca llegó al historial de Git.

### 5.2 Cobertura del preset recomendado

`@secretlint/secretlint-rule-preset-recommend` detecta:

| Tipo de secreto | Ejemplos |
|---|---|
| AWS | Access Key IDs (`AKIA...`), Secret Access Keys |
| GitHub | Personal Access Tokens (`ghp_...`), App tokens |
| Google | API Keys, Service Account JSON |
| Slack | Bot tokens, Webhook URLs |
| Generic | Private keys (`-----BEGIN PRIVATE KEY-----`) |
| SendGrid, Twilio, Shopify | Tokens específicos de cada plataforma |

### 5.3 Instalación automática con prepare

```json
// package.json
"scripts": {
  "prepare": "husky"
}
```

`npm install` ejecuta `prepare` automáticamente, lo que instala los hooks de Husky. Cualquier desarrollador que clone el repositorio y ejecute `npm install` tiene los hooks activos sin pasos adicionales.

---

## 6. Consecuencias

### Positivas
- Secretos bloqueados en origen — antes de entrar al historial de Git
- Instalación automática con `npm install` — zero-config para desarrolladores nuevos
- Cobertura de 15+ tipos de secretos con el preset recomendado
- Feedback inmediato en el terminal con el tipo exacto de secreto detectado

### Negativas
- El hook puede bypassearse con `git commit --no-verify` — protección no absoluta
- Falsos positivos posibles: contraseñas en archivos de test o fixtures pueden activar el detector (se manejan con `.secretlintignore`)
- Requiere que el equipo tenga Node.js instalado para que funcione `npx secretlint` — no aplica a contributors que usen Git sin npm

### Defensa en profundidad
El hook es la primera capa. La segunda es GitHub Secret Scanning (post-push). El pipeline CI (`npm run scan:secrets` en `.github/workflows/ci-quality.yml`) es la tercera. Un secreto debe evadir las tres capas para comprometer el repositorio.

---

## 7. Trade-offs

| Dimensión | pre-commit (elegido) | pre-push (descartado) |
|---|---|---|
| Momento de detección | Antes de entrar al historial local | Después de entrar al historial local |
| Facilidad de remediación | Simple (deshacer el add) | Compleja (requiere rebase) |
| Interrupciones al dev | Más frecuentes (cada commit) | Menos frecuentes (cada push) |
| Riesgo si secreto ya committeado | Ninguno (bloqueado antes) | Secreto en historial local |

---

## 8. Referencias

- Husky documentation: https://typicode.github.io/husky/
- Secretlint: https://github.com/secretlint/secretlint
- GitHub Secret Scanning: https://docs.github.com/en/code-security/secret-scanning
- `.husky/pre-commit` — Hook implementado
- `.secretlintrc.json` — Configuración de reglas
- `reports/vulnerability/VULNERABILITY_REPORT.md:§Pre-Commit Secret Protection` — Demostración documentada
