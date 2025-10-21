/**
 * OCR Queue Sender Service
 * Sends gazette URLs to OCR processing queue
 */

import { Gazette } from '../types/gazette';
import { OcrQueueMessage } from '../types/ocr';
import { logger } from '../utils';

export interface OcrQueueBinding {
  send(message: OcrQueueMessage): Promise<void>;
  sendBatch(messages: { body: OcrQueueMessage }[]): Promise<void>;
}

export class OcrQueueSender {
  private queue: OcrQueueBinding;
  private enabled: boolean;

  constructor(queue: OcrQueueBinding | undefined) {
    this.queue = queue as OcrQueueBinding;
    this.enabled = !!queue;
    
    if (!this.enabled) {
      logger.warn('OCR Queue not configured - gazette URLs will not be sent for OCR processing');
    }
  }

  /**
   * Send a single gazette to OCR queue
   */
  async sendGazette(gazette: Gazette, spiderId: string, crawlJobId?: string): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const message: OcrQueueMessage = {
      jobId: this.generateJobId(gazette),
      pdfUrl: gazette.fileUrl,
      territoryId: gazette.territoryId,
      publicationDate: gazette.date,
      editionNumber: gazette.editionNumber,
      spiderId: spiderId,
      queuedAt: new Date().toISOString(),
      metadata: {
        power: gazette.power,
        isExtraEdition: gazette.isExtraEdition,
        sourceText: gazette.sourceText,
        crawlJobId: crawlJobId,
      },
    };

    try {
      await this.queue.send(message);
      
      logger.info(`Sent gazette to OCR queue`, {
        jobId: message.jobId,
        pdfUrl: gazette.fileUrl,
        territoryId: gazette.territoryId,
        date: gazette.date,
      });
    } catch (error: any) {
      logger.error(`Failed to send gazette to OCR queue`, error, {
        pdfUrl: gazette.fileUrl,
        territoryId: gazette.territoryId,
      });
      throw error;
    }
  }

  /**
   * Send multiple gazettes to OCR queue in batch
   */
  async sendGazettes(gazettes: Gazette[], spiderId: string, crawlJobId?: string): Promise<void> {
    if (!this.enabled || gazettes.length === 0) {
      return;
    }

    const messages: OcrQueueMessage[] = gazettes.map(gazette => ({
      jobId: this.generateJobId(gazette),
      pdfUrl: gazette.fileUrl,
      territoryId: gazette.territoryId,
      publicationDate: gazette.date,
      editionNumber: gazette.editionNumber,
      spiderId: spiderId,
      queuedAt: new Date().toISOString(),
      metadata: {
        power: gazette.power,
        isExtraEdition: gazette.isExtraEdition,
        sourceText: gazette.sourceText,
        crawlJobId: crawlJobId,
      },
    }));

    try {
      // Wrap messages in the format expected by Cloudflare Queues
      const wrappedMessages = messages.map(msg => ({ body: msg }));
      await this.queue.sendBatch(wrappedMessages);
      
      logger.info(`Sent ${messages.length} gazettes to OCR queue`, {
        spiderId,
        count: messages.length,
      });
    } catch (error: any) {
      logger.error(`Failed to send gazettes to OCR queue`, error, {
        spiderId,
        count: gazettes.length,
      });
      throw error;
    }
  }

  /**
   * Generate a deterministic job ID for a gazette to prevent duplicate OCR processing
   */
  private generateJobId(gazette: Gazette): string {
    // Format: territoryId_date_edition_timestamp
    const timestamp = Date.now();
    const edition = gazette.editionNumber || 'regular';
    return `${gazette.territoryId}_${gazette.date}_${edition}_${timestamp}`;
  }

  /**
   * Check if OCR queue is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
