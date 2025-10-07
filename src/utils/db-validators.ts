/**
 * Database Validation Utilities
 * Provides validation functions for database fields and operations
 */

/**
 * Validates if a string is a valid UUID v4
 */
export function isValidUUID(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Validates that a required field is present and not empty
 */
export function validateRequired(value: any, fieldName: string): void {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Field '${fieldName}' is required but was ${value}`);
  }
}

/**
 * Validates that a value is one of the allowed enum values
 */
export function validateEnum(value: string, validValues: string[], fieldName: string): void {
  if (!validValues.includes(value)) {
    throw new Error(`Field '${fieldName}' must be one of: ${validValues.join(', ')}. Got: ${value}`);
  }
}

/**
 * Validates that a string doesn't exceed maximum length
 */
export function validateMaxLength(value: string, maxLength: number, fieldName: string): void {
  if (value && value.length > maxLength) {
    throw new Error(`Field '${fieldName}' exceeds maximum length of ${maxLength}. Got: ${value.length}`);
  }
}

/**
 * Validates that a number is within the specified range
 */
export function validateNumericRange(value: number, min: number, max: number, fieldName: string): void {
  if (value < min || value > max) {
    throw new Error(`Field '${fieldName}' must be between ${min} and ${max}. Got: ${value}`);
  }
}

/**
 * Validates that a date string is in valid ISO format
 */
export function validateISODate(value: string, fieldName: string): void {
  if (!value) return;
  
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Field '${fieldName}' must be a valid ISO date string. Got: ${value}`);
  }
}

/**
 * Validates JSON structure
 */
export function validateJSON(value: any, fieldName: string): void {
  if (value === null || value === undefined) return;
  
  try {
    if (typeof value === 'string') {
      JSON.parse(value);
    } else if (typeof value === 'object') {
      JSON.stringify(value);
    } else {
      throw new Error('Invalid JSON type');
    }
  } catch (error) {
    throw new Error(`Field '${fieldName}' must be valid JSON. Got: ${typeof value}`);
  }
}

/**
 * Sanitizes text input by trimming whitespace and removing null characters
 */
export function sanitizeText(value: string): string {
  if (!value) return value;
  
  return value
    .trim()
    .replace(/\0/g, '') // Remove null characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remove control characters
}

/**
 * Validates territory ID format (should be alphanumeric with underscores)
 */
export function validateTerritoryId(value: string, fieldName: string = 'territoryId'): void {
  validateRequired(value, fieldName);
  
  const territoryRegex = /^[a-z]{2}_\d{7}$/;
  if (!territoryRegex.test(value)) {
    throw new Error(`Field '${fieldName}' must be in format 'xx_xxxxxxx' (state_code). Got: ${value}`);
  }
}

/**
 * Validates spider ID format
 */
export function validateSpiderId(value: string, fieldName: string = 'spiderId'): void {
  validateRequired(value, fieldName);
  validateMaxLength(value, 100, fieldName);
  
  // Spider ID should be alphanumeric with underscores and hyphens
  const spiderRegex = /^[a-zA-Z0-9_-]+$/;
  if (!spiderRegex.test(value)) {
    throw new Error(`Field '${fieldName}' can only contain letters, numbers, underscores, and hyphens. Got: ${value}`);
  }
}

/**
 * Comprehensive validation for OCR result data
 */
export function validateOcrResult(ocrResult: any): void {
  validateRequired(ocrResult.jobId, 'jobId');
  validateRequired(ocrResult.territoryId, 'territoryId');
  validateRequired(ocrResult.extractedText, 'extractedText');
  
  validateTerritoryId(ocrResult.territoryId);
  validateMaxLength(ocrResult.jobId, 255, 'jobId');
}

/**
 * Comprehensive validation for gazette data
 */
export function validateGazette(gazette: any): void {
  validateRequired(gazette.territoryId, 'territoryId');
  validateRequired(gazette.date, 'date');
  validateRequired(gazette.fileUrl, 'fileUrl');
  
  validateTerritoryId(gazette.territoryId);
  validateISODate(gazette.date, 'date');
  
  if (gazette.editionNumber) {
    validateMaxLength(gazette.editionNumber, 50, 'editionNumber');
  }
}

/**
 * Comprehensive validation for analysis result data
 */
export function validateAnalysisResult(analysis: any): void {
  validateRequired(analysis.jobId, 'jobId');
  validateRequired(analysis.territoryId, 'territoryId');
  validateRequired(analysis.publicationDate, 'publicationDate');
  
  validateTerritoryId(analysis.territoryId);
  validateISODate(analysis.publicationDate, 'publicationDate');
  validateMaxLength(analysis.jobId, 255, 'jobId');
  
  if (analysis.totalFindings !== undefined) {
    validateNumericRange(analysis.totalFindings, 0, 10000, 'totalFindings');
  }
  
  if (analysis.categories) {
    if (!Array.isArray(analysis.categories)) {
      throw new Error('Field categories must be an array');
    }
  }
}

/**
 * Validates error log data
 */
export function validateErrorLog(errorLog: any): void {
  validateRequired(errorLog.workerName, 'workerName');
  validateRequired(errorLog.operationType, 'operationType');
  validateRequired(errorLog.severity, 'severity');
  validateRequired(errorLog.errorMessage, 'errorMessage');
  
  validateEnum(errorLog.severity, ['warning', 'error', 'critical'], 'severity');
  validateMaxLength(errorLog.workerName, 100, 'workerName');
  validateMaxLength(errorLog.operationType, 100, 'operationType');
  validateMaxLength(errorLog.errorMessage, 2000, 'errorMessage');
  
  if (errorLog.jobId && !isValidUUID(errorLog.jobId)) {
    throw new Error(`Field 'jobId' must be a valid UUID if provided. Got: ${errorLog.jobId}`);
  }
  
  if (errorLog.territoryId) {
    validateTerritoryId(errorLog.territoryId, 'territoryId');
  }
  
  if (errorLog.context) {
    validateJSON(errorLog.context, 'context');
  }
}
