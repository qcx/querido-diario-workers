/**
 * Content validator - validates gazette content and metadata
 */

import { Gazette, SpiderConfig } from '../../types';
import { ValidationDetail } from '../types';

export interface ContentValidationResult {
  passed: boolean;
  details: ValidationDetail[];
}

/**
 * Validates the content of gazette data
 */
export class ContentValidator {
  /**
   * Validates gazette content
   */
  async validate(
    gazettes: Gazette[],
    config: SpiderConfig
  ): Promise<ContentValidationResult> {
    const details: ValidationDetail[] = [];

    // If no gazettes, skip content validation
    if (gazettes.length === 0) {
      details.push({
        name: 'content_validation',
        passed: true,
        message: 'No gazettes to validate',
      });

      return { passed: true, details };
    }

    // Validate metadata consistency
    const metadataValidation = this.validateMetadata(gazettes, config);
    details.push(...metadataValidation);

    // Validate PDF URLs accessibility (sample check)
    const pdfValidation = await this.validatePdfUrls(gazettes);
    details.push(...pdfValidation);

    // Validate date consistency
    const dateValidation = this.validateDates(gazettes);
    details.push(...dateValidation);

    const allPassed = details.every((d) => d.passed);

    return { passed: allPassed, details };
  }

  /**
   * Validates metadata consistency
   */
  private validateMetadata(
    gazettes: Gazette[],
    config: SpiderConfig
  ): ValidationDetail[] {
    const details: ValidationDetail[] = [];

    // Check if all gazettes have the correct territoryId
    const wrongTerritoryIds = gazettes.filter(
      (g) => g.territoryId !== config.territoryId
    );

    if (wrongTerritoryIds.length > 0) {
      details.push({
        name: 'metadata_valid',
        passed: false,
        message: `${wrongTerritoryIds.length} gazettes have incorrect territoryId`,
        context: {
          expected: config.territoryId,
          found: wrongTerritoryIds.map((g) => g.territoryId),
        },
      });
    } else {
      details.push({
        name: 'metadata_valid',
        passed: true,
        message: 'All gazettes have correct territoryId',
      });
    }

    // Check if all gazettes have valid power
    const invalidPowers = gazettes.filter(
      (g) =>
        !['executive', 'legislative', 'executive_legislative'].includes(g.power)
    );

    if (invalidPowers.length > 0) {
      details.push({
        name: 'power_valid',
        passed: false,
        message: `${invalidPowers.length} gazettes have invalid power`,
      });
    } else {
      details.push({
        name: 'power_valid',
        passed: true,
        message: 'All gazettes have valid power',
      });
    }

    // Check if scrapedAt is recent (within last hour)
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oldScrapes = gazettes.filter(
      (g) => new Date(g.scrapedAt) < oneHourAgo
    );

    if (oldScrapes.length > 0) {
      details.push({
        name: 'scraped_at_recent',
        passed: false,
        message: `${oldScrapes.length} gazettes have old scrapedAt timestamp`,
      });
    } else {
      details.push({
        name: 'scraped_at_recent',
        passed: true,
        message: 'All gazettes have recent scrapedAt timestamp',
      });
    }

    return details;
  }

  /**
   * Validates PDF URLs accessibility (sample check)
   */
  private async validatePdfUrls(gazettes: Gazette[]): Promise<ValidationDetail[]> {
    const details: ValidationDetail[] = [];

    // Sample up to 3 gazettes for URL checking
    const sampleSize = Math.min(3, gazettes.length);
    const sample = gazettes.slice(0, sampleSize);

    let accessibleCount = 0;
    let inaccessibleUrls: string[] = [];

    for (const gazette of sample) {
      try {
        const response = await fetch(gazette.fileUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (response.ok) {
          accessibleCount++;
        } else {
          inaccessibleUrls.push(
            `${gazette.fileUrl} (status: ${response.status})`
          );
        }
      } catch (error: any) {
        inaccessibleUrls.push(`${gazette.fileUrl} (error: ${error.message})`);
      }
    }

    if (accessibleCount === sampleSize) {
      details.push({
        name: 'pdf_urls_accessible',
        passed: true,
        message: `All ${sampleSize} sampled PDF URLs are accessible`,
      });
    } else {
      details.push({
        name: 'pdf_urls_accessible',
        passed: false,
        message: `${inaccessibleUrls.length}/${sampleSize} sampled PDF URLs are inaccessible`,
        context: { inaccessibleUrls },
      });
    }

    return details;
  }

  /**
   * Validates date consistency
   */
  private validateDates(gazettes: Gazette[]): ValidationDetail[] {
    const details: ValidationDetail[] = [];

    // Check if dates are in chronological order (optional, but good practice)
    const dates = gazettes.map((g) => new Date(g.date).getTime());
    const sorted = [...dates].sort((a, b) => b - a); // Descending order (newest first)

    const isOrdered = dates.every((date, i) => date === sorted[i]);

    if (isOrdered) {
      details.push({
        name: 'dates_ordered',
        passed: true,
        message: 'Gazette dates are in chronological order',
      });
    } else {
      details.push({
        name: 'dates_ordered',
        passed: true, // Not critical, just a warning
        message: 'Gazette dates are not in chronological order (not critical)',
      });
    }

    // Check if all dates are valid
    const invalidDates = gazettes.filter((g) => {
      const date = new Date(g.date);
      return isNaN(date.getTime());
    });

    if (invalidDates.length > 0) {
      details.push({
        name: 'dates_valid',
        passed: false,
        message: `${invalidDates.length} gazettes have invalid dates`,
      });
    } else {
      details.push({
        name: 'dates_valid',
        passed: true,
        message: 'All gazette dates are valid',
      });
    }

    // Check if dates are not in the future
    const now = new Date();
    const futureDates = gazettes.filter((g) => new Date(g.date) > now);

    if (futureDates.length > 0) {
      details.push({
        name: 'dates_not_future',
        passed: false,
        message: `${futureDates.length} gazettes have future dates`,
      });
    } else {
      details.push({
        name: 'dates_not_future',
        passed: true,
        message: 'No gazettes have future dates',
      });
    }

    return details;
  }
}
