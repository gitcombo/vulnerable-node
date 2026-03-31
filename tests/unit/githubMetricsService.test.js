import { jest } from '@jest/globals';

// Mock config before importing the service
jest.unstable_mockModule('../../config.js', () => ({
  default: {
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
      environment: 'production'
    }
  }
}));

jest.unstable_mockModule('../../src/infrastructure/logging/Logger.js', () => ({
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const { default: GitHubMetricsService } = await import(
  '../../src/infrastructure/github/GitHubMetricsService.js'
);

describe('GitHubMetricsService', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    GitHubMetricsService.clearCache();
  });

  describe('_median', () => {
    it('should return 0 for empty array', () => {
      expect(GitHubMetricsService._median([])).toBe(0);
    });

    it('should return the single element for array of length 1', () => {
      expect(GitHubMetricsService._median([5])).toBe(5);
    });

    it('should return the middle element for odd-length array', () => {
      expect(GitHubMetricsService._median([1, 3, 5])).toBe(3);
    });

    it('should return average of two middle elements for even-length array', () => {
      expect(GitHubMetricsService._median([1, 2, 3, 4])).toBe(2.5);
    });

    it('should handle unsorted arrays', () => {
      expect(GitHubMetricsService._median([5, 1, 3])).toBe(3);
    });
  });

  describe('Deployment Frequency ratings', () => {
    function mockDeployments(count, days) {
      const deployments = [];
      const now = new Date();
      for (let i = 0; i < count; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - Math.floor(i * (days / count)));
        deployments.push({
          id: i + 1,
          sha: `abc${i}`,
          created_at: date.toISOString(),
          environment: 'production'
        });
      }
      return deployments;
    }

    it('should rate Elite for >= 1 deploy per day', async () => {
      const deployments = mockDeployments(100, 90);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deployments
      });

      const result = await GitHubMetricsService.getDeploymentFrequency(90);
      expect(result.rating).toBe('Elite');
      expect(result.totalDeployments).toBe(100);
    });

    it('should rate High for >= 1 per week but < 1 per day', async () => {
      const deployments = mockDeployments(20, 90);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deployments
      });

      const result = await GitHubMetricsService.getDeploymentFrequency(90);
      expect(result.rating).toBe('High');
    });

    it('should rate Medium for >= 1 per month but < 1 per week', async () => {
      const deployments = mockDeployments(3, 90);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deployments
      });

      const result = await GitHubMetricsService.getDeploymentFrequency(90);
      expect(result.rating).toBe('Medium');
    });

    it('should rate Low for < 1 per month', async () => {
      const deployments = mockDeployments(1, 90);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deployments
      });

      const result = await GitHubMetricsService.getDeploymentFrequency(90);
      expect(result.rating).toBe('Low');
    });
  });

  describe('Lead Time ratings', () => {
    it('should rate Elite for < 1 hour lead time', async () => {
      const now = new Date();
      const commitDate = new Date(now);
      commitDate.setMinutes(commitDate.getMinutes() - 30);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          id: 1,
          sha: 'abc123',
          created_at: now.toISOString(),
          environment: 'production'
        }]
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sha: 'abc123',
          commit: { author: { date: commitDate.toISOString() } }
        })
      });

      const result = await GitHubMetricsService.getLeadTimeForChanges(90);
      expect(result.rating).toBe('Elite');
      expect(result.medianLeadTimeHours).toBeLessThan(1);
    });

    it('should rate Low for > 1 week lead time', async () => {
      const now = new Date();
      const commitDate = new Date(now);
      commitDate.setDate(commitDate.getDate() - 10);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          id: 1,
          sha: 'abc123',
          created_at: now.toISOString(),
          environment: 'production'
        }]
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sha: 'abc123',
          commit: { author: { date: commitDate.toISOString() } }
        })
      });

      const result = await GitHubMetricsService.getLeadTimeForChanges(90);
      expect(result.rating).toBe('Low');
    });
  });

  describe('Change Failure Rate ratings', () => {
    it('should rate Elite for 0% failure rate', async () => {
      const now = new Date();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          id: 1, sha: 'abc', created_at: now.toISOString()
        }]
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ state: 'success', created_at: now.toISOString() }]
      });

      const result = await GitHubMetricsService.getChangeFailureRate(90);
      expect(result.rating).toBe('Elite');
      expect(result.failureRate).toBe(0);
    });

    it('should rate Low for > 15% failure rate', async () => {
      const now = new Date();
      const deployments = [];
      for (let i = 0; i < 5; i++) {
        deployments.push({
          id: i + 1, sha: `abc${i}`, created_at: now.toISOString()
        });
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deployments
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ state: 'success', created_at: now.toISOString() }]
      });
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [{ state: 'failure', created_at: now.toISOString() }]
        });
      }

      const result = await GitHubMetricsService.getChangeFailureRate(90);
      expect(result.rating).toBe('Low');
      expect(result.failureRate).toBe(80);
    });
  });

  describe('MTTR ratings', () => {
    it('should rate Elite when no incidents recorded', async () => {
      const now = new Date();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          id: 1, sha: 'abc', created_at: now.toISOString()
        }]
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ state: 'success', created_at: now.toISOString() }]
      });

      const result = await GitHubMetricsService.getMTTR(90);
      expect(result.rating).toBe('Elite');
      expect(result.incidentCount).toBe(0);
    });
  });

  describe('getAllMetrics', () => {
    it('should return all 4 metrics with period info', async () => {
      const now = new Date();
      const deployments = [{
        id: 1, sha: 'abc123', created_at: now.toISOString()
      }];

      // 1 deployment fetch compartido (antes eran 4 independientes)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deployments
      });

      // _prefetchStatuses: 1 status fetch para el unico deployment
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ state: 'success', created_at: now.toISOString() }]
      });

      // Lead time - commit fetch (batch paralelo, 1 deployment)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sha: 'abc123',
          commit: { author: { date: now.toISOString() } }
        })
      });

      // Change failure rate y MTTR leen statuses del cache — sin fetch adicional

      const result = await GitHubMetricsService.getAllMetrics(90);

      expect(result.period).toBeDefined();
      expect(result.period.days).toBe(90);
      expect(result.metrics.deploymentFrequency).toBeDefined();
      expect(result.metrics.leadTime).toBeDefined();
      expect(result.metrics.changeFailureRate).toBeDefined();
      expect(result.metrics.mttr).toBeDefined();
      expect(result.generatedAt).toBeDefined();
    });

    it('should use cache on second call (no additional fetch)', async () => {
      const now = new Date();
      const deployments = [{ id: 1, sha: 'abc', created_at: now.toISOString() }];

      // Primera llamada: 1 deployment + 1 status + 1 commit
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => deployments })
        .mockResolvedValueOnce({ ok: true, json: async () => [{ state: 'success', created_at: now.toISOString() }] })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'abc', commit: { author: { date: now.toISOString() } } }) });

      await GitHubMetricsService.getAllMetrics(90);
      const callsAfterFirst = mockFetch.mock.calls.length;

      // Segunda llamada: deployments y statuses vienen del cache
      // Solo se espera el commit fetch (lead time, no cacheable)
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'abc', commit: { author: { date: now.toISOString() } } }) });

      await GitHubMetricsService.getAllMetrics(90);
      const newCalls = mockFetch.mock.calls.length - callsAfterFirst;

      // Solo 1 nuevo fetch (commit), no re-fetch de deployments ni statuses
      expect(newCalls).toBe(1);
    });
  });

  describe('API error handling', () => {
    it('should throw on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      await expect(GitHubMetricsService.getDeploymentFrequency(90))
        .rejects
        .toThrow('GitHub API error: 403 Forbidden');
    });
  });
});
