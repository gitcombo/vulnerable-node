# Vulnerable Node — Rehabilitated

[![CI Quality Pipeline](https://github.com/gitcombo/vulnerable-node/actions/workflows/ci-quality.yml/badge.svg)](https://github.com/gitcombo/vulnerable-node/actions/workflows/ci-quality.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=gitcombo_vulnerable-node&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=gitcombo_vulnerable-node)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=gitcombo_vulnerable-node&metric=coverage)](https://sonarcloud.io/summary/new_code?id=gitcombo_vulnerable-node)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-22%20LTS-green)
![Express](https://img.shields.io/badge/Express-4.21-lightgrey)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)

Aplicacion e-commerce Node.js originalmente vulnerable, rehabilitada a estado seguro y listo para produccion. Desarrollada como proyecto de curso de Ingenieria de Software con enfasis en DevSecOps, FinOps y arquitectura limpia.

---

## Prerequisitos

- [Node.js 22 LTS](https://nodejs.org/) y npm 10+
- [Docker](https://www.docker.com/) y Docker Compose (recomendado)
- PostgreSQL 16 (si se ejecuta sin Docker)

---

## Inicio Rapido

### Con Docker (recomendado)

```bash
docker-compose up --build
```

La aplicacion estara disponible en <http://localhost:3000>

### Manual

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tu DATABASE_URL

# 3. Iniciar la aplicacion
npm start
```

<details>
<summary>Credenciales de desarrollo</summary>

| Usuario | Contrasena |
|---------|-----------|
| `admin` | `admin` |
| `roberto` | `asdfpiuw981` |

> Estas credenciales son solo para el entorno de desarrollo local.
</details>

---

## Tech Stack

| Capa | Tecnologia |
|------|------------|
| Runtime | Node.js 22 LTS + ESM modules |
| Framework | Express 4.21 |
| Base de datos | PostgreSQL 16 |
| Template engine | EJS 3.x + ejs-mate |
| Seguridad | Helmet, Argon2id, CSRF, Zod |
| Logging | Winston (structured JSON) |
| Testing | Jest 29 + Supertest |
| CI/CD | GitHub Actions + SonarCloud |

---

## Caracteristicas de Seguridad

- Consultas SQL parametrizadas (prevencion de SQL injection)
- Hashing de contrasenas con Argon2id (memory: 64MB, iterations: 3)
- Cabeceras de seguridad HTTP con Helmet
- Proteccion CSRF con patron Synchronizer Token
- Validacion de entrada con esquemas Zod
- Gestion de sesiones segura (httpOnly, sameSite strict, 24h TTL)
- Rate limiting (login: 5 req/15min, API: 100 req/15min)
- Prevencion de XSS (output escapado en EJS)
- Prevencion de Open Redirect

---

## Testing

```bash
npm test                  # Todos los tests
npm run test:unit         # Tests unitarios + cobertura
npm run test:e2e          # Tests end-to-end (requiere PostgreSQL)
npm run audit:check       # Auditoria de dependencias (solo produccion)
npm run scan:secrets      # Deteccion de secretos con Secretlint
```

---

## Endpoints

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/login` | No | Pagina de login |
| POST | `/login/auth` | No | Autenticacion |
| GET | `/logout` | No | Cerrar sesion |
| GET | `/health` | No | Health check |
| GET | `/` | Si | Listado de productos |
| GET | `/products/detail?id=N` | Si | Detalle de producto |
| GET | `/products/search?q=term` | Si | Busqueda de productos |
| POST | `/products/buy` | Si | Comprar producto |
| GET | `/products/purchased` | Si | Historial de compras |
| GET | `/api/dora/metrics` | No | Metricas DORA |

---

## Estructura del Proyecto

```
vulnerable-node/
├── app.js                      # Express app (middleware, rutas, seguridad)
├── bin/www                     # Entry point HTTP
├── config.js                   # Configuracion por entorno
├── model/                      # Capa de datos legacy
│   ├── auth.js
│   ├── init_db.js
│   └── products.js
├── routes/                     # Rutas Express legacy
│   ├── login.js
│   ├── login_check.js
│   └── products.js
├── src/                        # Arquitectura hexagonal (Clean Architecture)
│   ├── domain/                 # Entidades y validadores
│   ├── infrastructure/         # GitHub API, logging, seguridad
│   └── interface/http/         # Middleware, validators, rutas de salud
├── views/                      # Templates EJS
├── public/                     # Assets estaticos
├── tests/
│   ├── unit/                   # Tests unitarios (Jest)
│   └── e2e/                    # Tests end-to-end (Supertest)
├── benchmarks/                 # Scripts de benchmark FinOps
├── reports/
│   ├── benchmarks/             # Reportes de optimizacion de rendimiento
│   └── vulnerability/          # Evidencia de escaneos de seguridad
├── docs/
│   ├── adr/                    # Architecture Decision Records
│   └── fixes/                  # Documentacion de correcciones
├── design/                     # Planes de arquitectura y refactorizacion
├── grafana/                    # Dashboard DORA Metrics
├── .github/workflows/          # CI/CD pipelines
├── docker-compose.yml
└── Dockerfile
```

---

## Documentacion

| Documento | Descripcion |
|-----------|-------------|
| [ADR-001: Clean Architecture](docs/adr/ADR-001-consolidacion-clean-architecture.md) | Propuesta de consolidacion a arquitectura hexagonal completa |
| [Plan de Rehabilitacion](design/REHABILITATION_PLAN.md) | Estrategia original de migracion de vulnerable a seguro |
| [Roadmap de Refactorizacion](design/REFACTORING_ROADMAP.md) | Plan incremental con ROI calculado por item |
| [Reporte de Vulnerabilidades](reports/vulnerability/VULNERABILITY_REPORT.md) | Evidencia before/after de escaneos Grype y npm audit |
| [Reporte FinOps / Benchmark](reports/benchmarks/FINOPS_BENCHMARK_REPORT.md) | Resultados de optimizacion de rendimiento (Delivery 5) |
| [Log de Implementacion](docs/fixes/IMPLEMENTATION_LOG.md) | Registro completo de los 14 fixes de seguridad aplicados |

---

## Historial de Entregas

| Entrega | Enfoque | Logros principales |
|---------|---------|-------------------|
| Delivery 1 | Discovery & Reverse Engineering | Inventario de vulnerabilidades, arranque del sistema |
| Delivery 2 | Security Hardening | 10 clases de vulnerabilidades corregidas (SQLi, XSS, CSRF, Argon2, Helmet, Zod) |
| Delivery 3 | CI/CD & Testing | GitHub Actions, Jest unit/e2e, SonarCloud, Docker multi-stage |
| Delivery 4 | Architecture Strategy | ADR-001 Clean Architecture, DevSecOps pipeline (Grype, Trivy, Syft SBOM) |
| Delivery 5 | FinOps Optimization | ReDoS eliminado (-99.99% CPU), N+1 resuelto (-92.8% I/O), README handover-ready |

---

## Vulnerabilidades Corregidas

El proyecto fue rehabilitado desde [vulnerable-node](https://github.com/cr0hn/vulnerable-node) de `cr0hn`.

- 6 puntos de SQL injection (consultas parametrizadas)
- Contrasenas en texto plano (hashing Argon2id)
- XSS en todos los templates (output escapado)
- CSRF en todos los formularios (token de sincronizacion)
- Session insegura (configuracion endurecida)
- Open redirect (sanitizacion de URL)
- Cabeceras de seguridad faltantes (Helmet)
- Dependencias desactualizadas (actualizadas + overrides)
- Validacion de entrada faltante (esquemas Zod)
- Rate limiting faltante (express-rate-limit)
- Regex ReDoS en validacion de email (reemplazado por Zod)

---

## Acerca del Proyecto

Elegimos _vulnerable-node_ porque, como equipo con experiencia en Infraestructura, Cloud y DevOps, nos motivan los sistemas con retos tecnicos desde el inicio. Al detectar que el proyecto tenia problemas para arrancar, lo vimos como la oportunidad perfecta para aplicar nuestra experiencia estabilizando entornos. Nuestro objetivo fue transformar este sistema inestable en una API solida, segura y eficiente, aplicando practicas modernas de automatizacion, seguridad y optimizacion.

---

## Licencia

Este proyecto esta licenciado bajo la [BSD 3-Clause License](LICENSE).
Proyecto original: [cr0hn/vulnerable-node](https://github.com/cr0hn/vulnerable-node)
