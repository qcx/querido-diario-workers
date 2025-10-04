/**
 * Health checker for platform monitoring
 */

import { SpiderType } from '../../types';
import { PlatformHealthCheck } from '../types';

/**
 * Platform base URLs for health checking
 */
const PLATFORM_BASE_URLS: Partial<Record<SpiderType, string>> = {
  doem: 'https://www.doem.org.br',
  instar: 'https://www.instar.com.br',
  dosp: 'https://www.imprensaoficialmunicipal.com.br',
  diof: 'https://diof.com.br',
  adiarios_v1: 'https://www.adiarios.com.br',
  adiarios_v2: 'https://www.adiarios.com.br',
  sigpub: 'https://sigpub.com.br',
  barco_digital: 'https://barcodigital.com.br',
  siganet: 'https://siganet.com.br',
  diario_oficial_br: 'https://diariooficial.com.br',
  modernizacao: 'https://modernizacao.com.br',
  aplus: 'https://aplus.com.br',
  dioenet: 'https://dioenet.com.br',
  administracao_publica: 'https://administracaopublica.com.br',
  ptio: 'https://ptio.com.br',
  municipio_online: 'https://municipioonline.com.br',
  atende_v2: 'https://atende.net',
};

/**
 * Health checker for platforms
 */
export class HealthChecker {
  /**
   * Checks the health of a specific platform
   */
  async checkPlatform(platform: SpiderType): Promise<PlatformHealthCheck> {
    const url = PLATFORM_BASE_URLS[platform];

    if (!url) {
      return {
        platform,
        url: 'unknown',
        isAccessible: false,
        error: 'Platform URL not configured',
        checkedAt: new Date().toISOString(),
      };
    }

    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      const responseTime = Date.now() - startTime;

      return {
        platform,
        url,
        isAccessible: response.ok,
        statusCode: response.status,
        responseTime,
        error: response.ok ? undefined : `HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;

      return {
        platform,
        url,
        isAccessible: false,
        responseTime,
        error: error.message || 'Unknown error',
        checkedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Checks the health of all platforms
   */
  async checkAllPlatforms(): Promise<PlatformHealthCheck[]> {
    const platforms = Object.keys(PLATFORM_BASE_URLS) as SpiderType[];
    const checks = await Promise.all(
      platforms.map((platform) => this.checkPlatform(platform))
    );

    return checks;
  }

  /**
   * Checks if a specific URL is accessible
   */
  async checkUrl(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Checks multiple URLs in parallel
   */
  async checkUrls(urls: string[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    const checks = await Promise.allSettled(
      urls.map(async (url) => {
        const isAccessible = await this.checkUrl(url);
        return { url, isAccessible };
      })
    );

    for (const check of checks) {
      if (check.status === 'fulfilled') {
        results.set(check.value.url, check.value.isAccessible);
      } else {
        results.set('unknown', false);
      }
    }

    return results;
  }
}
