/**
 * Structure validator - validates gazette data structure
 */

import { Gazette } from '../../types';
import { ValidationDetail } from '../types';

export interface StructureValidationResult {
  passed: boolean;
  details: ValidationDetail[];
}

/**
 * Validates the structure of gazette data
 */
export class StructureValidator {
  /**
   * Validates an array of gazettes
   */
  validate(gazettes: Gazette[]): StructureValidationResult {
    const details: ValidationDetail[] = [];

    // Check if gazettes array is valid
    if (!Array.isArray(gazettes)) {
      details.push({
        name: 'structure_valid',
        passed: false,
        message: 'Gazettes is not an array',
      });

      return { passed: false, details };
    }

    details.push({
      name: 'structure_valid',
      passed: true,
      message: 'Gazettes array is valid',
    });

    // If no gazettes, still consider structure valid
    if (gazettes.length === 0) {
      details.push({
        name: 'gazette_count',
        passed: true,
        message: 'No gazettes found (may be expected for the date range)',
      });

      return { passed: true, details };
    }

    // Validate each gazette
    let allValid = true;
    const invalidGazettes: string[] = [];

    for (let i = 0; i < gazettes.length; i++) {
      const gazette = gazettes[i];
      const validation = this.validateGazette(gazette, i);

      if (!validation.passed) {
        allValid = false;
        invalidGazettes.push(`#${i}: ${validation.message}`);
      }
    }

    if (allValid) {
      details.push({
        name: 'all_gazettes_valid',
        passed: true,
        message: `All ${gazettes.length} gazettes have valid structure`,
      });
    } else {
      details.push({
        name: 'all_gazettes_valid',
        passed: false,
        message: `Some gazettes have invalid structure: ${invalidGazettes.join(', ')}`,
        context: { invalidGazettes },
      });
    }

    return { passed: allValid, details };
  }

  /**
   * Validates a single gazette
   */
  private validateGazette(
    gazette: any,
    index: number
  ): { passed: boolean; message: string } {
    // Check required fields
    const requiredFields = [
      'date',
      'fileUrl',
      'isExtraEdition',
      'power',
      'territoryId',
      'scrapedAt',
    ];

    for (const field of requiredFields) {
      if (!(field in gazette)) {
        return {
          passed: false,
          message: `Missing required field: ${field}`,
        };
      }
    }

    // Validate field types
    if (typeof gazette.date !== 'string') {
      return {
        passed: false,
        message: 'Field "date" must be a string',
      };
    }

    if (typeof gazette.fileUrl !== 'string') {
      return {
        passed: false,
        message: 'Field "fileUrl" must be a string',
      };
    }

    if (typeof gazette.isExtraEdition !== 'boolean') {
      return {
        passed: false,
        message: 'Field "isExtraEdition" must be a boolean',
      };
    }

    if (
      !['executive', 'legislative', 'executive_legislative'].includes(
        gazette.power
      )
    ) {
      return {
        passed: false,
        message: `Invalid power value: ${gazette.power}`,
      };
    }

    if (typeof gazette.territoryId !== 'string') {
      return {
        passed: false,
        message: 'Field "territoryId" must be a string',
      };
    }

    if (typeof gazette.scrapedAt !== 'string') {
      return {
        passed: false,
        message: 'Field "scrapedAt" must be a string',
      };
    }

    // Validate date format (ISO 8601: YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(gazette.date)) {
      return {
        passed: false,
        message: `Invalid date format: ${gazette.date} (expected YYYY-MM-DD)`,
      };
    }

    // Validate scrapedAt format (ISO 8601 datetime)
    const datetimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    if (!datetimeRegex.test(gazette.scrapedAt)) {
      return {
        passed: false,
        message: `Invalid scrapedAt format: ${gazette.scrapedAt} (expected ISO 8601)`,
      };
    }

    // Validate URL format
    try {
      new URL(gazette.fileUrl);
    } catch {
      return {
        passed: false,
        message: `Invalid fileUrl: ${gazette.fileUrl}`,
      };
    }

    // Validate territoryId (IBGE code - 7 digits)
    if (!/^\d{7}$/.test(gazette.territoryId)) {
      return {
        passed: false,
        message: `Invalid territoryId: ${gazette.territoryId} (expected 7 digits)`,
      };
    }

    return { passed: true, message: 'Valid' };
  }

  /**
   * Validates date format
   */
  private isValidDate(dateString: string): boolean {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Validates URL format
   */
  private isValidUrl(urlString: string): boolean {
    try {
      new URL(urlString);
      return true;
    } catch {
      return false;
    }
  }
}
