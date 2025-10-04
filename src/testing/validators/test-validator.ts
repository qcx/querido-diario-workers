/**
 * Test validator for spider testing
 */

import { BaseSpider } from '../../spiders/base/base-spider';
import { SpiderConfig, DateRange, Gazette } from '../../types';
import {
  CityTestResult,
  TestStatus,
  ValidationResults,
  ValidationDetail,
} from '../types';
import { StructureValidator } from './structure-validator';
import { ContentValidator } from './content-validator';
import { PerformanceValidator } from './performance-validator';

/**
 * Main test validator
 */
export class TestValidator {
  private structureValidator: StructureValidator;
  private contentValidator: ContentValidator;
  private performanceValidator: PerformanceValidator;

  constructor() {
    this.structureValidator = new StructureValidator();
    this.contentValidator = new ContentValidator();
    this.performanceValidator = new PerformanceValidator();
  }

  /**
   * Validates a spider by running it and checking the results
   */
  async validateSpider(
    spider: BaseSpider,
    config: SpiderConfig,
    dateRange: DateRange
  ): Promise<CityTestResult> {
    const startTime = Date.now();
    const validationDetails: ValidationDetail[] = [];

    let status: TestStatus = 'success';
    let gazettes: Gazette[] = [];
    let error: any = undefined;

    try {
      // Run the spider
      gazettes = await spider.crawl();

      // Validate structure
      const structureValidation = this.structureValidator.validate(gazettes);
      validationDetails.push(...structureValidation.details);

      // Validate content
      const contentValidation = await this.contentValidator.validate(
        gazettes,
        config
      );
      validationDetails.push(...contentValidation.details);

      // Validate performance
      const performanceValidation = this.performanceValidator.validate(
        spider,
        Date.now() - startTime
      );
      validationDetails.push(...performanceValidation.details);

      // Determine overall status
      const allPassed = validationDetails.every((d) => d.passed);
      const criticalFailed = validationDetails.some(
        (d) => !d.passed && d.name.includes('critical')
      );

      if (criticalFailed) {
        status = 'failure';
      } else if (!allPassed) {
        status = 'failure';
      } else {
        status = 'success';
      }
    } catch (err: any) {
      status = 'error';
      error = {
        message: err.message || 'Unknown error',
        code: err.code,
        stack: err.stack,
      };

      validationDetails.push({
        name: 'spider_execution',
        passed: false,
        message: `Spider execution failed: ${err.message}`,
      });
    }

    const executionTime = Date.now() - startTime;

    // Build validation results
    const validations: ValidationResults = {
      urlAccessible: validationDetails.some(
        (d) => d.name === 'url_accessible' && d.passed
      ),
      canFetchGazettes: gazettes.length > 0 || status === 'success',
      validStructure: validationDetails.some(
        (d) => d.name === 'structure_valid' && d.passed
      ),
      validMetadata: validationDetails.some(
        (d) => d.name === 'metadata_valid' && d.passed
      ),
      pdfUrlsAccessible: validationDetails.some(
        (d) => d.name === 'pdf_urls_accessible' && d.passed
      ),
      details: validationDetails,
    };

    return {
      cityId: config.id,
      cityName: config.name,
      territoryId: config.territoryId,
      spiderType: config.spiderType,
      status,
      gazettesFound: gazettes.length,
      executionTime,
      requestCount: spider.getRequestCount ? spider.getRequestCount() : 0,
      dateRange,
      error,
      validations,
      testedAt: new Date().toISOString(),
    };
  }
}
