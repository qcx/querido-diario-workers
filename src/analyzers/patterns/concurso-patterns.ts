/**
 * Patterns for detecting and classifying concurso documents
 */

import { ConcursoDocumentType } from '../../types/analysis';

export type PatternPriority = 'primary' | 'secondary' | 'supporting';

export interface ConcursoPattern {
  documentType: ConcursoDocumentType;
  patterns: RegExp[];
  weight: number; // Confidence weight
  keywords: string[];
  excludePatterns?: RegExp[]; // Patterns that should NOT match
  // New proximity requirements
  proximity?: {
    required: boolean; // If true, keywords must be within maxDistance
    maxDistance: number; // Maximum word distance between keywords
    boostNearby: boolean; // Apply proximity bonus
  };
  // Pattern priority (higher = check first)
  priority?: 'primary' | 'secondary' | 'supporting';
  // Minimum keywords that must be found together
  minKeywordsTogether?: number;
}

/**
 * Patterns for each document type
 */
export const CONCURSO_PATTERNS: ConcursoPattern[] = [
  // Edital de Abertura
  {
    documentType: 'edital_abertura',
    weight: 0.95,
    priority: 'primary',
    keywords: [
      'edital de abertura',
      'edital de concurso',
     // 'torna público',
      'abertura de inscrições',
      'inscrições abertas',
      'inscrições iniciadas',
      'realização de concurso público',
      'concurso público para provimento',
    ],
    patterns: [
      /edital\s+(?:de\s+)?abertura/i,
 //     /torna\s+p[uú]blico.*concurso/i,
      /abertura\s+(?:de\s+)?inscri[çc][õo]es/i,
      /realiza[çc][ãa]o\s+de\s+concurso/i,
      /concurso\s+p[uú]blico\s+para\s+provimento/i,
      /edital\s+n[°º]?\s*\d+\/\d{4}.*concurso/i,
    ],
    excludePatterns: [
      /retifica[çc][ãa]o/i,
      /convoca[çc][ãa]o/i,
      /resultado/i,
    ],
    proximity: {
      required: true,
      maxDistance: 150, // Larger window for opening notices
      boostNearby: true,
    },
    minKeywordsTogether: 2,
  },

  // Edital de Retificação
  {
    documentType: 'edital_retificacao',
    weight: 0.9,
    keywords: [
      'retificação do edital',
      'retifica',
      'alteração do edital',
  //    'correção',
  //    'errata',
  //    'onde se lê',
    ],
    patterns: [
      /retifica[çc][ãa]o\s+(?:do\s+)?edital/i,
      /edital\s+(?:de\s+)?retifica[çc][ãa]o/i,
      /altera[çc][ãa]o\s+(?:do\s+)?edital/i,
      /errata.*edital/i,
      /retifica.*concurso\s+p[uú]blico/i,
    ],
  },

  // Convocação
  {
    documentType: 'convocacao',
    weight: 0.92,
    priority: 'primary',
    keywords: [
  //    'convocação',
  //    'convoca',
      'candidatos aprovados',
      'candidatos convocados',
      'candidatos selecionados',
      'candidatos reprovados',
      'cadastro reserva',
      'chamada',
  //    'apresentação',
  //    'posse',
  //    'nomeação',
    ],
    patterns: [
      /convoca[çc][ãa]o.*(?:candidatos?|aprovados?)/i,
      /convoca.*para\s+(?:posse|apresenta[çc][ãa]o|nomeação)/i,
      /candidatos?\s+(?:convocados?|aprovados?)/i,
      /chamada.*concurso/i,
      /lista\s+de\s+convoca[çc][ãa]o/i,
    ],
    proximity: {
      required: true,
      maxDistance: 100, // Keywords must be within 100 words
      boostNearby: true,
    },
    minKeywordsTogether: 2, // At least 2 keywords must be found together
  },

  // Homologação
  {
    documentType: 'homologacao',
    weight: 0.93,
    priority: 'primary',
    keywords: [
  //    'homologação',
  //    'homologa',
  //    'resultado final',
      'classificação final',
      'aprovação do resultado',
      'homologação do resultado',
    ],
    patterns: [
      /homologa[çc][ãa]o.*(?:resultado|concurso)/i,
      /homologa.*(?:resultado\s+)?final/i,
      /resultado\s+final.*homolog/i,
      /classifica[çc][ãa]o\s+final.*concurso/i,
    ],
    proximity: {
      required: true,
      maxDistance: 200,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
  },

  // Prorrogação
  {
    documentType: 'prorrogacao',
    weight: 0.88,
    priority: 'secondary',
    keywords: [
      'prorrogação',
      'prorroga',
      'extensão de prazo',
      'adiamento',
      'nova data',
    ],
    patterns: [
      /prorroga[çc][ãa]o.*(?:inscri[çc][õo]es|prazo)/i,
      /prorroga.*(?:prazo|data)/i,
      /extens[ãa]o.*prazo/i,
      /adiamento.*(?:prova|inscri[çc][õo]es)/i,
    ],
    proximity: {
      required: true,
      maxDistance: 200,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
  },

  // Cancelamento/Suspensão
  {
    documentType: 'cancelamento',
    weight: 0.91,
    priority: 'primary',
    keywords: [
      'cancelamento',
      'cancela',
      'suspensão',
      'suspende',
      'anulação',
      'revogação',
    ],
    patterns: [
      /cancelamento.*(?:concurso|edital)/i,
      /cancela.*concurso\s+p[uú]blico/i,
      /suspens[ãa]o.*(?:concurso|edital)/i,
      /suspende.*concurso/i,
      /anula[çc][ãa]o.*(?:concurso|edital)/i,
    ],
    proximity: {
      required: true,
      maxDistance: 50,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
  },

  // Resultado Parcial
  {
    documentType: 'resultado_parcial',
    weight: 0.85,
    priority: 'secondary',
    keywords: [
      'resultado',
      'classificação',
      'aprovados',
      'nota',
      'pontuação',
      'lista de classificados',
    ],
    patterns: [
      /resultado.*(?:prova|etapa|fase)/i,
      /classifica[çc][ãa]o.*(?:provis[óo]ria|preliminar)/i,
      /lista\s+de\s+(?:aprovados?|classificados?)/i,
      /resultado.*objetiva/i,
    ],
    excludePatterns: [
      /homologa[çc][ãa]o/i,
      /final/i,
    ],
    proximity: {
      required: true,
      maxDistance: 200,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
  },

  // Gabarito
  {
    documentType: 'gabarito',
    weight: 0.87,
    priority: 'secondary',
    keywords: [
      'gabarito',
      'respostas',
      'resposta oficial',
    ],
    patterns: [
      /gabarito.*(?:oficial|preliminar|definitivo)/i,
      /gabarito.*prova/i,
      /resposta\s+oficial/i,
      /divulga[çc][ãa]o.*gabarito/i,
    ],
    proximity: {
      required: false, // Gabarito can be standalone
      maxDistance: 200,
      boostNearby: true,
    },
    minKeywordsTogether: 1, // Just gabarito is enough
  },
];

/**
 * Title patterns that provide high confidence when found
 * These patterns are checked against document titles/headers
 */
export const TITLE_PATTERNS: Array<{
  documentType: ConcursoDocumentType;
  patterns: RegExp[];
  baseConfidence: number;
}> = [
  {
    documentType: 'convocacao',
    patterns: [
      /^CONVOCA[ÇC][ÃA]O/i,
      /^EDITAL\s+DE\s+CONVOCA[ÇC][ÃA]O/i,
      /^[\d]+[ªº]?\s*CONVOCA[ÇC][ÃA]O/i, // "17ª CONVOCAÇÃO"
    ],
    baseConfidence: 0.85,
  },
  {
    documentType: 'edital_abertura',
    patterns: [
      /^EDITAL\s+DE\s+ABERTURA/i,
      /^EDITAL\s+DE\s+CONCURSO\s+P[ÚU]BLICO/i,
      /^ABERTURA\s+DE\s+CONCURSO/i,
    ],
    baseConfidence: 0.9,
  },
  {
    documentType: 'homologacao',
    patterns: [
      /^HOMOLOGA[ÇC][ÃA]O/i,
      /^EDITAL\s+DE\s+HOMOLOGA[ÇC][ÃA]O/i,
      /^RESULTADO\s+FINAL\s+HOMOLOGADO/i,
    ],
    baseConfidence: 0.9,
  },
  {
    documentType: 'edital_retificacao',
    patterns: [
      /^RETIFICA[ÇC][ÃA]O/i,
      /^EDITAL\s+DE\s+RETIFICA[ÇC][ÃA]O/i,
      /^ERRATA/i,
    ],
    baseConfidence: 0.85,
  },
];

/**
 * Patterns for extracting structured data
 */
export const EXTRACTION_PATTERNS = {
  // Edital number
  editalNumero: [
    /edital\s+n[°º]?\s*(\d+\/\d{4})/i,
    /edital\s+n[°º]?\s*(\d+[-\/]\d{4})/i,
    /processo\s+n[°º]?\s*(\d+\/\d{4})/i,
  ],

  // Vacancies
  vagas: [
    /(\d+)\s+(?:\([\w\s]+\)\s+)?vagas?/i,
    /total\s+de\s+(\d+)\s+vagas?/i,
    /n[úu]mero\s+de\s+vagas?:?\s*(\d+)/i,
  ],

  // Job position
  cargo: [
    /cargo:?\s*([^\n\r]+)/i,
    /fun[çc][ãa]o:?\s*([^\n\r]+)/i,
    /emprego:?\s*([^\n\r]+)/i,
  ],

  // Salary
  salario: [
    /remunera[çc][ãa]o:?\s*R\$\s*([\d.,]+)/i,
    /sal[áa]rio:?\s*R\$\s*([\d.,]+)/i,
    /vencimento:?\s*R\$\s*([\d.,]+)/i,
  ],

  // Registration period
  inscricoes: [
    /inscri[çc][õo]es.*de\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+a(?:t[ée])?\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /per[íi]odo\s+de\s+inscri[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+a\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],

  // Exam date
  prova: [
    /prova.*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /data\s+da\s+prova:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /realiza[çc][ãa]o.*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],

  // Registration fee
  taxa: [
    /taxa\s+de\s+inscri[çc][ãa]o:?\s*R\$\s*([\d.,]+)/i,
    /valor\s+da\s+inscri[çc][ãa]o:?\s*R\$\s*([\d.,]+)/i,
  ],

  // Organization/Banca
  banca: [
    /organiza(?:do)?(?:ra)?:?\s*([^\n\r.]+)/i,
    /empresa\s+(?:organizadora|respons[áa]vel):?\s*([^\n\r.]+)/i,
    /cnpj:?\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i,
  ],

  // Cities (for multi-city support)
  cidades: [
    /munic[íi]pios?:?\s*([^\n\r]+)/i,
    /cidades?:?\s*([^\n\r]+)/i,
    /localidades?:?\s*([^\n\r]+)/i,
  ],

  // Organization/Entity
  orgao: [
    /prefeitura\s+(?:municipal\s+)?de\s+([^\n\r]+)/i,
    /c[âa]mara\s+municipal\s+de\s+([^\n\r]+)/i,
    /governo\s+do\s+estado\s+(?:de|do)\s+([^\n\r]+)/i,
    /([^\n\r]+)\s+torna\s+p[uú]blico/i,
  ],
};

/**
 * Helper to detect if text contains concurso-related content
 */
export function hasConcursoKeywords(text: string): boolean {
  const keywords = [
    'concurso',
  //  'processo seletivo',
  ];
  
  const lowerText = text.toLowerCase();
  return keywords.some(kw => lowerText.includes(kw));
}

/**
 * Calculate confidence score for document type detection
 */
export function calculateTypeConfidence(
  matchedPatterns: number,
  totalPatterns: number,
  keywordMatches: number,
  weight: number
): number {
  const patternScore = matchedPatterns / Math.max(totalPatterns, 1);
  const keywordScore = Math.min(keywordMatches / 2, 1); // Cap at 2 keyword matches
  
  return Math.min((patternScore * 0.6 + keywordScore * 0.4) * weight, 1);
}
