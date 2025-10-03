import { format, parse, eachMonthOfInterval, isWithinInterval, parseISO } from 'date-fns';

/**
 * Generates a sequence of month/year strings between two dates
 * @param startDate Start date
 * @param endDate End date
 * @param formatStr Format string (default: "yyyy/MM")
 * @returns Array of formatted month/year strings
 */
export function generateMonthlySequence(
  startDate: Date,
  endDate: Date,
  formatStr: string = 'yyyy/MM'
): string[] {
  const months = eachMonthOfInterval({ start: startDate, end: endDate });
  return months.map(month => format(month, formatStr));
}

/**
 * Parses a date string in Brazilian format
 * Supports: "DD/MM/YYYY", "DD de MMMM de YYYY", "DD-MM-YYYY"
 * @param dateStr Date string
 * @returns Date object
 */
export function parseBrazilianDate(dateStr: string): Date {
  // Try numeric format first: DD/MM/YYYY
  let date = parse(dateStr, 'dd/MM/yyyy', new Date());
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try with dashes: DD-MM-YYYY
  date = parse(dateStr, 'dd-MM-yyyy', new Date());
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try Portuguese month names: "30 de setembro de 2024"
  const monthNames: { [key: string]: string } = {
    'janeiro': '01',
    'fevereiro': '02',
    'março': '03',
    'abril': '04',
    'maio': '05',
    'junho': '06',
    'julho': '07',
    'agosto': '08',
    'setembro': '09',
    'outubro': '10',
    'novembro': '11',
    'dezembro': '12',
  };

  // Match pattern: "DD de MONTH de YYYY"
  const match = dateStr.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i);
  if (match) {
    const day = match[1].padStart(2, '0');
    const monthName = match[2].toLowerCase();
    const year = match[3];
    const month = monthNames[monthName];

    if (month) {
      return parse(`${day}/${month}/${year}`, 'dd/MM/yyyy', new Date());
    }
  }

  // If all parsing attempts fail, return invalid date
  return new Date(NaN);
}

/**
 * Checks if a date is within a range
 * @param date Date to check
 * @param startDate Range start
 * @param endDate Range end
 * @returns True if date is within range
 */
export function isDateInRange(date: Date, startDate: Date, endDate: Date): boolean {
  return isWithinInterval(date, { start: startDate, end: endDate });
}

/**
 * Converts a date to ISO string (YYYY-MM-DD)
 * @param date Date object
 * @returns ISO date string
 */
export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Parses an ISO date string
 * @param isoDate ISO date string (YYYY-MM-DD)
 * @returns Date object
 */
export function fromISODate(isoDate: string): Date {
  return parseISO(isoDate);
}

/**
 * Gets current timestamp in ISO format
 * @returns ISO timestamp string
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Formats a date to Brazilian format (DD-MM-YYYY)
 * Used for Instar platform URL construction
 * @param date Date object
 * @returns Formatted date string (DD-MM-YYYY)
 */
export function formatBrazilianDate(date: Date): string {
  return format(date, 'dd-MM-yyyy');
}
