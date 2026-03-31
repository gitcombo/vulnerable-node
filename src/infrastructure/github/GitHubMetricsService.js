import config from '../../../config.js';
import logger from '../logging/Logger.js';

class GitHubMetricsService {
  constructor() {
    this.owner = config.github.owner;
    this.repo = config.github.repo;
    this.token = config.github.token;
    this.environment = config.github.environment;
    this.baseUrl = `https://api.github.com/repos/${this.owner}/${this.repo}`;

    // In-memory cache para reducir llamadas redundantes a la GitHub API.
    // _deployments: resultado crudo del endpoint (sin filtrar por days).
    // _statuses: Map<deploymentId, statuses[]> evita re-fetch en N+1.
    // TTL de 5 minutos — suficiente para el dashboard DORA sin datos obsoletos.
    this._cache = {
      deployments: null,
      deploymentsFetchedAt: 0,
      statuses: new Map(),
    };
    this._cacheTTL = 5 * 60 * 1000; // 5 minutos
  }

  /** Invalida el cache completamente (util en tests). */
  clearCache() {
    this._cache.deployments = null;
    this._cache.deploymentsFetchedAt = 0;
    this._cache.statuses.clear();
  }

  _headers() {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'vulnerable-node-dora-metrics'
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async _fetch(endpoint) {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, { headers: this._headers() });

    if (!response.ok) {
      const msg = `GitHub API error: ${response.status} ${response.statusText} for ${endpoint}`;
      logger.error(msg);
      throw new Error(msg);
    }

    return response.json();
  }

  /**
   * Obtiene deployments del periodo con cache TTL.
   * Una sola llamada HTTP se comparte entre todos los metodos DORA.
   */
  async _getDeployments(days = 90) {
    const now = Date.now();
    const cacheStale = (now - this._cache.deploymentsFetchedAt) > this._cacheTTL;

    if (!this._cache.deployments || cacheStale) {
      const raw = await this._fetch(
        `/deployments?environment=${encodeURIComponent(this.environment)}&per_page=100`
      );
      this._cache.deployments = raw;
      this._cache.deploymentsFetchedAt = now;
    }

    const since = new Date();
    since.setDate(since.getDate() - days);
    return this._cache.deployments.filter(d => new Date(d.created_at) >= since);
  }

  /**
   * Obtiene statuses de un deployment con cache por ID.
   * Evita el patron N+1 cuando multiples metodos consultan el mismo deployment.
   */
  async _getDeploymentStatuses(deploymentId) {
    if (this._cache.statuses.has(deploymentId)) {
      return this._cache.statuses.get(deploymentId);
    }
    const statuses = await this._fetch(`/deployments/${deploymentId}/statuses?per_page=10`);
    this._cache.statuses.set(deploymentId, statuses);
    return statuses;
  }

  async _getCommit(sha) {
    return this._fetch(`/commits/${sha}`);
  }

  /**
   * Pre-carga en paralelo los statuses de todos los deployments dados.
   * Usa lotes de `concurrency` para respetar rate limits de GitHub API.
   * Los resultados quedan en this._cache.statuses para uso posterior sin re-fetch.
   */
  async _prefetchStatuses(deployments, concurrency = 10) {
    const ids = deployments.map(d => d.id).filter(id => !this._cache.statuses.has(id));
    for (let i = 0; i < ids.length; i += concurrency) {
      const batch = ids.slice(i, i + concurrency);
      await Promise.all(
        batch.map(id =>
          this._getDeploymentStatuses(id).catch(() => {
            // Error individual no debe interrumpir el lote
          })
        )
      );
    }
  }

  /**
   * Deployment Frequency: How often code is deployed to production
   * Elite: Multiple per day | High: Weekly | Medium: Monthly | Low: > Monthly
   */
  async getDeploymentFrequency(days = 90) {
    const deployments = await this._getDeployments(days);
    const count = deployments.length;
    const frequency = count / days;
    const dailyRate = frequency;

    let rating;
    if (dailyRate >= 1) {
      rating = 'Elite';
    } else if (dailyRate >= 1 / 7) {
      rating = 'High';
    } else if (dailyRate >= 1 / 30) {
      rating = 'Medium';
    } else {
      rating = 'Low';
    }

    return {
      metric: 'Deployment Frequency',
      totalDeployments: count,
      days,
      dailyRate: Math.round(dailyRate * 1000) / 1000,
      weeklyRate: Math.round(dailyRate * 7 * 100) / 100,
      rating,
      description: this._frequencyDescription(rating)
    };
  }

  /**
   * Lead Time for Changes: Time from commit to production deployment.
   * Usa Promise.all en lotes para obtener commits en paralelo en vez de
   * un for-await secuencial que genera N llamadas HTTP bloqueantes.
   * Elite: < 1 hour | High: < 1 day | Medium: < 1 week | Low: > 1 week
   */
  async getLeadTimeForChanges(days = 90) {
    const deployments = await this._getDeployments(days);
    const sampled = deployments.slice(0, 50);

    // Fetch commits en paralelo (lotes de 10) en vez de secuencial
    const concurrency = 10;
    const leadTimes = [];

    for (let i = 0; i < sampled.length; i += concurrency) {
      const batch = sampled.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async deployment => {
          try {
            const commit = await this._getCommit(deployment.sha);
            const commitDate = new Date(commit.commit.author.date);
            const deployDate = new Date(deployment.created_at);
            const leadTimeHours = (deployDate - commitDate) / (1000 * 60 * 60);
            return leadTimeHours >= 0 ? leadTimeHours : null;
          } catch {
            return null;
          }
        })
      );
      results.forEach(lt => { if (lt !== null) leadTimes.push(lt); });
    }

    const medianHours = this._median(leadTimes);

    let rating;
    if (medianHours < 1) {
      rating = 'Elite';
    } else if (medianHours < 24) {
      rating = 'High';
    } else if (medianHours < 168) {
      rating = 'Medium';
    } else {
      rating = 'Low';
    }

    return {
      metric: 'Lead Time for Changes',
      medianLeadTimeHours: Math.round(medianHours * 100) / 100,
      sampleSize: leadTimes.length,
      days,
      rating,
      description: this._leadTimeDescription(rating)
    };
  }

  /**
   * Change Failure Rate: % of deployments that cause failures.
   * Los statuses ya fueron pre-cargados por getAllMetrics() — sin N+1.
   * Elite: < 5% | High: < 10% | Medium: < 15% | Low: > 15%
   */
  async getChangeFailureRate(days = 90) {
    const deployments = await this._getDeployments(days);
    let failures = 0;
    const total = deployments.length;

    for (const deployment of deployments) {
      try {
        const statuses = await this._getDeploymentStatuses(deployment.id);
        if (statuses.length > 0 && statuses[0].state === 'failure') {
          failures++;
        }
      } catch {
        // Skip if status unavailable
      }
    }

    const rate = total > 0 ? (failures / total) * 100 : 0;

    let rating;
    if (rate < 5) {
      rating = 'Elite';
    } else if (rate < 10) {
      rating = 'High';
    } else if (rate < 15) {
      rating = 'Medium';
    } else {
      rating = 'Low';
    }

    return {
      metric: 'Change Failure Rate',
      failureRate: Math.round(rate * 100) / 100,
      totalDeployments: total,
      failedDeployments: failures,
      days,
      rating,
      description: this._failureRateDescription(rating)
    };
  }

  /**
   * Mean Time to Recovery: How long to restore service after failure.
   * Los statuses ya fueron pre-cargados por getAllMetrics() — sin N+1.
   * Elite: < 1 hour | High: < 1 day | Medium: < 1 week | Low: > 1 week
   */
  async getMTTR(days = 90) {
    const deployments = await this._getDeployments(days);
    const recoveryTimes = [];

    for (let i = 0; i < deployments.length; i++) {
      try {
        const statuses = await this._getDeploymentStatuses(deployments[i].id);
        if (statuses.length === 0) continue;

        const hasFailure = statuses.some(s => s.state === 'failure');
        const hasSuccess = statuses.some(s => s.state === 'success');

        if (hasFailure && hasSuccess) {
          const failureTime = new Date(
            statuses.find(s => s.state === 'failure').created_at
          );
          const recoveryTime = new Date(
            statuses.find(s => s.state === 'success').created_at
          );
          const hours = Math.abs(recoveryTime - failureTime) / (1000 * 60 * 60);
          recoveryTimes.push(hours);
        } else if (hasFailure && !hasSuccess) {
          for (let j = i - 1; j >= 0; j--) {
            try {
              // Los statuses del deployment j ya estan en cache si getAllMetrics
              // llamo _prefetchStatuses antes — cero HTTP adicionales aqui.
              const nextStatuses = await this._getDeploymentStatuses(deployments[j].id);
              if (nextStatuses.length > 0 && nextStatuses[0].state === 'success') {
                const failureTime = new Date(deployments[i].created_at);
                const recoveryTime = new Date(deployments[j].created_at);
                const hours = (recoveryTime - failureTime) / (1000 * 60 * 60);
                if (hours > 0) {
                  recoveryTimes.push(hours);
                }
                break;
              }
            } catch {
              // Skip
            }
          }
        }
      } catch {
        // Skip
      }
    }

    const medianHours = this._median(recoveryTimes);

    let rating;
    if (recoveryTimes.length === 0) {
      rating = 'Elite';
    } else if (medianHours < 1) {
      rating = 'Elite';
    } else if (medianHours < 24) {
      rating = 'High';
    } else if (medianHours < 168) {
      rating = 'Medium';
    } else {
      rating = 'Low';
    }

    return {
      metric: 'Mean Time to Recovery',
      medianRecoveryHours: Math.round(medianHours * 100) / 100,
      incidentCount: recoveryTimes.length,
      days,
      rating,
      description: this._mttrDescription(rating, recoveryTimes.length)
    };
  }

  /**
   * Obtiene las 4 metricas DORA optimizando llamadas a la API:
   * - 1 fetch de deployments compartido (antes: 4 independientes)
   * - Pre-carga paralela de statuses en lotes (antes: N+1 secuencial)
   * - Cache TTL evita re-fetch en llamadas repetidas al dashboard
   */
  async getAllMetrics(days = 90) {
    // 1. Fetch unico de deployments — resultado queda en cache
    const deployments = await this._getDeployments(days);

    // 2. Pre-carga paralela de todos los statuses antes de computar metricas.
    //    getChangeFailureRate y getMTTR los leen del cache sin HTTP adicional.
    await this._prefetchStatuses(deployments);

    // 3. Computo paralelo de las 4 metricas (deployments y statuses ya en cache)
    const [deploymentFrequency, leadTime, changeFailureRate, mttr] = await Promise.all([
      this.getDeploymentFrequency(days),
      this.getLeadTimeForChanges(days),
      this.getChangeFailureRate(days),
      this.getMTTR(days)
    ]);

    return {
      period: { days, from: this._daysAgoISO(days), to: new Date().toISOString() },
      metrics: { deploymentFrequency, leadTime, changeFailureRate, mttr },
      generatedAt: new Date().toISOString()
    };
  }

  // --- Helpers ---

  _median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  _daysAgoISO(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }

  _frequencyDescription(rating) {
    const map = {
      Elite: 'Multiple deploys per day (on-demand)',
      High: 'Between once per day and once per week',
      Medium: 'Between once per week and once per month',
      Low: 'Fewer than once per month'
    };
    return map[rating];
  }

  _leadTimeDescription(rating) {
    const map = {
      Elite: 'Less than one hour from commit to deploy',
      High: 'Between one hour and one day',
      Medium: 'Between one day and one week',
      Low: 'More than one week'
    };
    return map[rating];
  }

  _failureRateDescription(rating) {
    const map = {
      Elite: 'Less than 5% of changes cause failures',
      High: 'Between 5% and 10% failure rate',
      Medium: 'Between 10% and 15% failure rate',
      Low: 'More than 15% of changes cause failures'
    };
    return map[rating];
  }

  _mttrDescription(rating, count) {
    if (count === 0) return 'No incidents recorded in this period';
    const map = {
      Elite: 'Recovery in less than one hour',
      High: 'Recovery in less than one day',
      Medium: 'Recovery in less than one week',
      Low: 'Recovery takes more than one week'
    };
    return map[rating];
  }
}

export default new GitHubMetricsService();
