/**
 * Patterns for detecting and classifying concurso documents
 */

import { ConcursoDocumentType } from '../../types/analysis';

export interface ConcursoPattern {
  documentType: ConcursoDocumentType;
  patterns: RegExp[];
  weight: number; // Confidence weight
  keywords: string[];
  excludePatterns?: RegExp[]; // Patterns that should NOT match
}

/**
 * Patterns for each document type
 */
export const CONCURSO_PATTERNS: ConcursoPattern[] = [
  // Edital de Abertura
  {
    documentType: 'edital_abertura',
    weight: 0.95,
    keywords: [
      'edital de abertura',
      'torna público',
      'abertura de inscrições',
      'realização de concurso público',
      'concurso público para provimento',
    ],
    patterns: [
      /edital\s+(?:de\s+)?abertura/i,
      /torna\s+p[uú]blico.*concurso/i,
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
  },

  // Edital de Retificação
  {
    documentType: 'edital_retificacao',
    weight: 0.9,
    keywords: [
      'retificação',
      'retifica',
      'alteração',
      'correção',
      'errata',
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
    keywords: [
      'convocação',
      'convoca',
      'candidatos aprovados',
      'chamada',
      'apresentação',
    ],
    patterns: [
      /convoca[çc][ãa]o.*(?:candidatos?|aprovados?)/i,
      /convoca.*para\s+(?:posse|apresenta[çc][ãa]o|nomeação)/i,
      /candidatos?\s+(?:convocados?|aprovados?)/i,
      /chamada.*concurso/i,
      /lista\s+de\s+convoca[çc][ãa]o/i,
    ],
  },

  // Homologação
  {
    documentType: 'homologacao',
    weight: 0.93,
    keywords: [
      'homologação',
      'homologa',
      'resultado final',
      'classificação final',
    ],
    patterns: [
      /homologa[çc][ãa]o.*(?:resultado|concurso)/i,
      /homologa.*(?:resultado\s+)?final/i,
      /resultado\s+final.*homolog/i,
      /classifica[çc][ãa]o\s+final.*concurso/i,
    ],
  },

  // Prorrogação
  {
    documentType: 'prorrogacao',
    weight: 0.88,
    keywords: [
      'prorrogação',
      'prorroga',
      'extensão',
      'adiamento',
    ],
    patterns: [
      /prorroga[çc][ãa]o.*(?:inscri[çc][õo]es|prazo)/i,
      /prorroga.*(?:prazo|data)/i,
      /extens[ãa]o.*prazo/i,
      /adiamento.*(?:prova|inscri[çc][õo]es)/i,
    ],
  },

  // Cancelamento/Suspensão
  {
    documentType: 'cancelamento',
    weight: 0.91,
    keywords: [
      'cancelamento',
      'cancela',
      'suspensão',
      'suspende',
      'anulação',
    ],
    patterns: [
      /cancelamento.*(?:concurso|edital)/i,
      /cancela.*concurso\s+p[uú]blico/i,
      /suspens[ãa]o.*(?:concurso|edital)/i,
      /suspende.*concurso/i,
      /anula[çc][ãa]o.*(?:concurso|edital)/i,
    ],
  },

  // Resultado Parcial
  {
    documentType: 'resultado_parcial',
    weight: 0.85,
    keywords: [
      'resultado',
      'classificação',
      'aprovados',
      'nota',
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
  },

  // Gabarito
  {
    documentType: 'gabarito',
    weight: 0.87,
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
    'concurso público',
    'concurso',
    'edital',
    'seleção pública',
    'processo seletivo',
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
