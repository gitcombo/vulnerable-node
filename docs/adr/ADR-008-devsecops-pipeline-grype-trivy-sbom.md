# ADR-008: Pipeline DevSecOps con Grype + Trivy + SBOM CycloneDX

| Campo | Valor |
|---|---|
| **ID** | ADR-008 |
| **Estado** | Aceptado |
| **Fecha** | 2026-03-11 |
| **Proyecto** | vulnerable-node (Rehabilitado) |
| **Contexto Académico** | Postgrado en Ingeniería de Software – Universidad Galileo |
| **Entregable** | Delivery 3 – DevSecOps Hardening |
| **Categoría** | Seguridad de Supply Chain / CI/CD |

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

El proyecto original no tenía CI/CD ni análisis de vulnerabilidades en dependencias. Durante la rehabilitación, se implementó un pipeline de GitHub Actions que incluye no solo tests, sino también análisis de seguridad de la cadena de suministro de software.

La decisión de qué herramientas usar para el escaneo de vulnerabilidades y la generación del SBOM tiene implicaciones directas sobre la cobertura de vulnerabilidades detectadas y la política de bloqueo de builds.

**Archivo afectado:** `.github/workflows/ci-quality.yml`

---

## 2. Problema

Se necesitaba un pipeline que:

1. **Cobertura complementaria**: Distintas bases de datos de CVEs tienen cobertura distinta — un solo scanner puede perder vulnerabilidades
2. **SBOM estándar**: Generar un inventario de dependencias en formato reconocido por NIST/CISA
3. **Política de bloqueo**: Definir qué severidad bloquea el merge (fail-build)
4. **Sin costo adicional**: Herramientas open-source que funcionen en GitHub Actions gratuito

---

## 3. Decisión

**Se implementa un job `sbom-and-scan` en GitHub Actions con tres herramientas combinadas:**

```yaml
# .github/workflows/ci-quality.yml — job: sbom-and-scan

# 1. SBOM con Syft (Anchore) — CycloneDX JSON v1.6
- uses: anchore/sbom-action@v0
  with:
    format: cyclonedx-json
    output-file: sbom.json

# 2. Escaneo con Grype (Anchore) — base de datos OSV/GitHub Advisories
- uses: anchore/scan-action@v3
  with:
    sbom: sbom.json
    fail-build: true
    severity-cutoff: high

# 3. Escaneo con Trivy (Aqua Security) — base de datos NVD/Red Hat
- uses: aquasecurity/trivy-action@master
  with:
    scan-type: fs
    severity: HIGH,CRITICAL
    exit-code: 1
```

El SBOM generado se almacena como `sbom.json` en la raíz del repositorio (163 componentes de producción, formato CycloneDX JSON v1.6).

---

## 4. Alternativas Consideradas

### 4.1 npm audit únicamente (descartado como única herramienta)

| Aspecto | Detalle |
|---|---|
| Ventaja | Nativo en npm, zero-config, cubre advisories del registro npm |
| Desventaja | Solo cubre la base de datos de npm Advisories — diferente cobertura que NVD/OSV |
| Desventaja | No genera SBOM |
| Desventaja | No escanea binarios ni el filesystem más allá de node_modules |
| Veredicto | **Mantenido como complemento** — `npm run audit:check` en el job de tests, pero no como única herramienta |

### 4.2 Snyk (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | SaaS con dashboard, alertas automáticas, PR checks |
| Desventaja | Requiere cuenta y token de Snyk como secret |
| Desventaja | Free tier limitado en repos privados |
| Desventaja | Dependencia de servicio externo para función crítica del pipeline |
| Veredicto | **Descartado** — Grype + Trivy ofrecen cobertura equivalente sin dependencia de SaaS |

### 4.3 OWASP Dependency-Check (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Herramienta OWASP oficial, muy completa |
| Desventaja | Tiempo de ejecución alto (10-15 min por descarga de NVD database) |
| Desventaja | Requiere Java en el runner |
| Desventaja | Demasiado verbose para un proyecto de esta escala |
| Veredicto | **Descartado** — Trivy cubre NVD con mayor velocidad |

### 4.4 Solo Dependabot (descartado)

| Aspecto | Detalle |
|---|---|
| Ventaja | Nativo en GitHub, crea PRs automáticos de actualización |
| Desventaja | Solo crea PRs — no bloquea builds con vulnerabilidades conocidas |
| Desventaja | No genera SBOM |
| Desventaja | Sin cobertura de vulnerabilidades en el filesystem |
| Veredicto | **Descartado como única herramienta** — puede coexistir pero no reemplaza el escaneo activo |

---

## 5. Justificación con Evidencia

### 5.1 Cobertura complementaria de Grype y Trivy

Los dos scanners usan bases de datos distintas:

| Scanner | Base de datos principal | Cobertura adicional |
|---|---|---|
| Grype (Anchore) | GitHub Advisory Database (GHSA) + OSV | npm, Go, Python, Java, Ruby |
| Trivy (Aqua) | NVD (NIST) + Red Hat + Ubuntu | + contenedores, IaC, secrets |

En los escaneos del proyecto, Grype detectó vulnerabilidades en `cookie` y `minimatch` que npm audit también detectó pero con diferentes IDs de advisory (GHSA vs. NPM). Tener ambos garantiza que no hay CVEs perdidos por diferencias entre bases de datos.

### 5.2 SBOM en CycloneDX como estándar NIST/CISA

El formato CycloneDX JSON v1.6 es el estándar recomendado por:
- **NTIA (National Telecommunications and Information Administration)** — minimum elements for SBOM
- **CISA (Cybersecurity and Infrastructure Security Agency)** — SBOM guidance 2023
- **Executive Order 14028** (EE.UU.) — software supply chain security

El `sbom.json` del proyecto cataloga 163 componentes con nombre, versión, PURL (Package URL), y licencia — suficiente para impact assessment inmediato ante un nuevo CVE.

### 5.3 Política `fail-build: true`

La decisión de bloquear builds con vulnerabilidades HIGH o CRITICAL garantiza que ningún código vulnerable llega a producción. Esta es una política de "secure by default" que requiere acción explícita para resolver o aceptar el riesgo.

---

## 6. Consecuencias

### Positivas
- 0 vulnerabilidades en npm, Grype, y Trivy al cierre de Delivery 3
- SBOM de 163 componentes disponible como artefacto del repositorio
- Builds bloqueados ante vulnerabilidades HIGH/CRITICAL — sin bypasses silenciosos
- Cobertura de dos bases de datos de CVEs (GHSA + NVD)

### Negativas
- El job `sbom-and-scan` añade ~3-5 minutos al pipeline
- `fail-build: true` puede bloquear el pipeline ante vulnerabilidades en dependencias transitivas que no son explotables en el contexto del proyecto — requiere triaging manual
- Un finding persistente: Grype detecta `actions/download-artifact@v4` como vulnerable (GHSA-cxww-7g56-2vh6) — es una acción de CI, no una dependencia de la aplicación, y no tiene path de fix disponible en el pin actual

---

## 7. Trade-offs

| Dimensión | Grype + Trivy + Syft | Snyk (alternativa) |
|---|---|---|
| Costo | Gratuito (open-source) | Free tier limitado |
| Dependencia externa | Ninguna (GitHub Actions nativo) | API de Snyk (SaaS) |
| Cobertura | Doble (GHSA + NVD) | Alta (base de datos propia) |
| SBOM | Sí (CycloneDX via Syft) | Sí (formato propio) |
| Tiempo de ejecución | ~3-5 min | ~2-3 min |
| Dashboard visual | No | Sí (web UI) |
| Alertas automáticas | No (solo en PR) | Sí (email, Slack) |

---

## 8. Referencias

- Grype (Anchore): https://github.com/anchore/grype
- Trivy (Aqua Security): https://github.com/aquasecurity/trivy
- Syft (Anchore): https://github.com/anchore/syft
- CycloneDX specification: https://cyclonedx.org/specification/overview/
- CISA SBOM guidance: https://www.cisa.gov/sbom
- `.github/workflows/ci-quality.yml` — Definición del pipeline
- `sbom.json` — SBOM generado (163 componentes)
- `reports/vulnerability/VULNERABILITY_REPORT.md` — Evidencia de remediación
