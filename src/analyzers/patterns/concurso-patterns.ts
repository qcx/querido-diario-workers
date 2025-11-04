/**
 * Patterns for detecting and classifying concurso documents
 */

import { ConcursoDocumentType } from '../../types/analysis';

export type PatternPriority = 'primary' | 'secondary' | 'supporting';

export interface ConcursoPattern {
  documentType: ConcursoDocumentType;
  patterns: RegExp[];
  weight: number; // Confidence weight
  
  // Tiered keywords system for better accuracy
  strongKeywords: string[]; // Tier 1: Action verbs and stage-specific terms (weight: 1.0)
  moderateKeywords?: string[]; // Tier 2: Contextual phrases requiring validation (weight: 0.6)
  weakKeywords?: string[]; // Tier 3: Generic references, only count with strong signals (weight: 0.3)
  
  excludePatterns?: RegExp[]; // Patterns that should NOT match
  
  // Enhanced exclusion - keywords from other stages that conflict
  conflictKeywords?: string[]; // Strong keywords that indicate this is NOT the right stage
  
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
  // Minimum strong keywords required for classification
  minStrongKeywords?: number;
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
    strongKeywords: [
      'abertura de inscrições',
      'inscrições abertas',
      'inscrições iniciadas',
      'torna público a abertura',
      'torna público a realização',
      'torna pública a abertura',
      'realização de concurso público',
      'concurso público para provimento',
      'abertura do concurso público',
    ],
    moderateKeywords: [
      'edital de abertura',
      'edital de concurso',
      'edital nº',
    ],
    weakKeywords: [
      'concurso público',
      'processo seletivo',
    ],
    patterns: [
      /(?:torna|tornar)\s+p[uú]blic[oa].*(?:abertura|realiza[çc][ãa]o).*concurso/i,
      /abertura\s+(?:de|das)\s+inscri[çc][õo]es/i,
      /inscri[çc][õo]es\s+(?:abertas|iniciadas|começam)/i,
      /realiza[çc][ãa]o\s+de\s+concurso\s+p[uú]blico/i,
      /concurso\s+p[uú]blico\s+para\s+(?:provimento|preenchimento)/i,
      /edital\s+de\s+abertura.*concurso/i,
    ],
    excludePatterns: [
      /prorroga(?:[çc][ãa]o|r|ndo)/i,
      /retifica(?:[çc][ãa]o|r|ndo)/i,
      /convoca(?:[çc][ãa]o|r|ndo).*(?:candidatos?|aprovados?)/i,
      /resultado\s+(?:final|preliminar|parcial)/i,
      /lista\s+(?:de|dos)\s+(?:aprovados|classificados|convocados)/i,
      /classifica[çc][ãa]o\s+(?:final|preliminar)/i,
      /homologa(?:[çc][ãa]o|r|ndo)/i,
      /cancelamento/i,
      /suspens[ãa]o/i,
    ],
    conflictKeywords: [
      'prorroga',
      'prorrogação',
      'retifica',
      'retificação',
      'convoca',
      'convocação',
      'homologa',
      'homologação',
      'resultado final',
      'classificação final',
      'lista de aprovados',
      'lista de classificados',
      'candidatos convocados',
      'cancelamento',
      'suspensão',
    ],
    proximity: {
      required: true,
      maxDistance: 150,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
    minStrongKeywords: 1,
  },

  // Edital de Retificação
  {
    documentType: 'edital_retificacao',
    weight: 0.91,
    priority: 'primary',
    strongKeywords: [
      'retificação do edital',
      'retifica o edital',
      'edital de retificação',
      'alteração do edital',
      'retifica o concurso',
      'errata do edital',
    ],
    moderateKeywords: [
      'retificação',
      'retifica',
      'alteração',
      'errata',
      'correção',
    ],
    weakKeywords: [
      'onde se lê',
      'leia-se',
    ],
    patterns: [
      /retifica[çc][ãa]o\s+(?:do|no)\s+edital/i,
      /edital\s+(?:de\s+)?retifica[çc][ãa]o/i,
      /(?:retifica|altera)\s+(?:o\s+)?edital/i,
      /errata.*edital.*concurso/i,
      /retifica.*concurso\s+p[uú]blico/i,
      /altera[çc][ãa]o.*edital/i,
    ],
    excludePatterns: [
      /abertura\s+de\s+inscri[çc][õo]es/i,
      /inscri[çc][õo]es\s+abertas/i,
      /prorroga[çc][ãa]o/i,
      /convoca[çc][ãa]o/i,
      /homologa[çc][ãa]o/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'inscrições abertas',
      'prorroga',
      'prorrogação',
      'convoca',
      'convocação',
      'homologa',
      'homologação',
      'cancelamento',
    ],
    proximity: {
      required: true,
      maxDistance: 150,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
    minStrongKeywords: 1,
  },

  // Convocação
  {
    documentType: 'convocacao',
    weight: 0.94,
    priority: 'primary',
    strongKeywords: [
      'candidatos convocados',
      'candidatos aprovados',
      'convoca candidatos',
      'convocação de candidatos',
      'lista de convocados',
      'lista de aprovados',
      'convoca para posse',
      'convoca para apresentação',
      'chamada de candidatos',
      'relação de candidatos',
      'classificação final',
      'candidatos classificados',
    ],
    moderateKeywords: [
      'convocação',
      'candidatos',
      'aprovados',
      'classificados',
      'posse',
      'nomeação',
      'apresentação',
    ],
    weakKeywords: [
      'cadastro reserva',
      'chamada',
    ],
    patterns: [
      /(?:convoca|chama)(?:[çc][ãa]o)?\s+(?:os\s+)?candidatos?\s+(?:aprovados?|classificados?|para\s+posse)/i,
      /candidatos?\s+(?:convocados?|aprovados?|classificados?).*(?:concurso|edital)/i,
      /lista\s+(?:de|dos)\s+(?:convocados|aprovados|classificados)/i,
      /convoca[çc][ãa]o.*(?:candidatos?|aprovados?|para\s+posse)/i,
      /rela[çc][ãa]o\s+(?:de|dos)\s+candidatos.*(?:aprovados|classificados)/i,
      /classifica[çc][ãa]o\s+final.*candidatos/i,
      /passaram\s+ao\s+final\s+da\s+lista/i,
    ],
    excludePatterns: [
      /edital\s+de\s+abertura(?!.*(?:convoca|classifica[çc][ãa]o))/i,
      /abertura\s+de\s+inscri[çc][õo]es(?!.*(?:convoca|aprovados))/i,
      /inscri[çc][õo]es\s+abertas(?!.*convoca)/i,
      /prorroga(?:[çc][ãa]o|r).*(?:prazo|inscri[çc][õo]es)/i,
      /retifica(?:[çc][ãa]o|r)/i,
      /homologa(?:[çc][ãa]o|r).*resultado\s+final/i,
      /gabarito/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'inscrições abertas',
      'torna público a abertura',
      'prorroga',
      'prorrogação',
      'retifica',
      'retificação',
      'gabarito',
      'resposta oficial',
    ],
    proximity: {
      required: true,
      maxDistance: 120,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
    minStrongKeywords: 1,
  },

  // Homologação
  {
    documentType: 'homologacao',
    weight: 0.94,
    priority: 'primary',
    strongKeywords: [
      'homologação do resultado',
      'homologa o resultado',
      'resultado final homologado',
      'homologação do concurso',
      'homologa o concurso',
      'homologação final',
    ],
    moderateKeywords: [
      'homologação',
      'homologa',
      'resultado final',
      'classificação final',
      'aprovação do resultado',
    ],
    weakKeywords: [
      'resultado',
      'classificação',
    ],
    patterns: [
      /homologa[çc][ãa]o\s+(?:do|de)\s+(?:resultado|concurso)/i,
      /homologa\s+(?:o\s+)?(?:resultado|concurso)/i,
      /resultado\s+final.*homolog/i,
      /homolog.*resultado\s+final/i,
      /classifica[çc][ãa]o\s+final.*homolog/i,
    ],
    excludePatterns: [
      /abertura\s+de\s+inscri[çc][õo]es/i,
      /inscri[çc][õo]es\s+abertas/i,
      /prorroga[çc][ãa]o/i,
      /retifica[çc][ãa]o/i,
      /resultado\s+(?:preliminar|parcial|provis[óo]rio)/i,
      /gabarito/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'inscrições abertas',
      'prorroga',
      'prorrogação',
      'retifica',
      'retificação',
      'resultado preliminar',
      'resultado parcial',
      'gabarito',
    ],
    proximity: {
      required: true,
      maxDistance: 150,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
    minStrongKeywords: 1,
  },

  // Prorrogação
  {
    documentType: 'prorrogacao',
    weight: 0.93,
    priority: 'primary',
    strongKeywords: [
      'prorroga',
      'prorrogação',
      'prorrogação de prazo',
      'prorrogação das inscrições',
      'extensão de prazo',
      'prorroga o prazo',
      'prorroga a validade',
      'prorroga por',
    ],
    moderateKeywords: [
      'nova data',
      'adiamento',
      'fica prorrogado',
      'prazo prorrogado',
    ],
    weakKeywords: [],
    patterns: [
      /prorroga(?:[çc][ãa]o|r|ndo)?\s+(?:por|de|o\s+prazo|a\s+validade|as\s+inscri[çc][õo]es)/i,
      /(?:fica|ficam)\s+prorrogad[oa]s?/i,
      /extens[ãa]o\s+(?:de|do)\s+prazo/i,
      /prorroga[çc][ãa]o.*(?:inscri[çc][õo]es|prazo|validade|edital|concurso)/i,
      /adiamento.*(?:prova|inscri[çc][õo]es|data)/i,
    ],
    excludePatterns: [
      /(?:torna|tornar)\s+p[uú]blico.*(?:abertura|realiza[çc][ãa]o)/i,
      /abertura\s+de\s+inscri[çc][õo]es/i,
      /inscri[çc][õo]es\s+abertas/i,
      /lista.*(?:aprovados|classificados|convocados)/i,
    ],
    conflictKeywords: [
      'homologa',
      'homologação',
      'convoca',
      'convocação',
      'resultado final',
      'abertura de inscrições',
      'inscrições abertas',
      'retifica',
      'retificação',
    ],
    proximity: {
      required: true,
      maxDistance: 150,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
    minStrongKeywords: 1,
  },

  // Cancelamento/Suspensão
  {
    documentType: 'cancelamento',
    weight: 0.93,
    priority: 'primary',
    strongKeywords: [
      'cancelamento do concurso',
      'cancela o concurso',
      'cancelamento do edital',
      'suspensão do concurso',
      'suspende o concurso',
      'anulação do concurso',
      'revogação do edital',
    ],
    moderateKeywords: [
      'cancelamento',
      'cancela',
      'suspensão',
      'suspende',
      'anulação',
      'revogação',
    ],
    weakKeywords: [],
    patterns: [
      /cancelamento\s+(?:do|de)\s+(?:concurso|edital)/i,
      /cancela\s+(?:o\s+)?(?:concurso|edital)/i,
      /suspens[ãa]o\s+(?:do|de)\s+(?:concurso|edital)/i,
      /suspende\s+(?:o\s+)?concurso/i,
      /anula[çc][ãa]o\s+(?:do|de)\s+(?:concurso|edital)/i,
      /revoga[çc][ãa]o.*edital/i,
    ],
    excludePatterns: [
      /abertura\s+de\s+inscri[çc][õo]es/i,
      /prorroga[çc][ãa]o/i,
      /retifica[çc][ãa]o/i,
      /convoca[çc][ãa]o/i,
      /homologa[çc][ãa]o/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'prorroga',
      'prorrogação',
      'retifica',
      'retificação',
      'convoca',
      'convocação',
      'homologa',
      'homologação',
    ],
    proximity: {
      required: true,
      maxDistance: 100,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
    minStrongKeywords: 1,
  },

  // Resultado Parcial
  {
    documentType: 'resultado_parcial',
    weight: 0.86,
    priority: 'secondary',
    strongKeywords: [
      'resultado preliminar',
      'resultado provisório',
      'resultado parcial',
      'classificação preliminar',
      'classificação provisória',
      'resultado da prova',
      'resultado da etapa',
    ],
    moderateKeywords: [
      'resultado',
      'classificação',
      'lista de aprovados',
      'lista de classificados',
      'aprovados',
      'notas',
    ],
    weakKeywords: [
      'nota',
      'pontuação',
    ],
    patterns: [
      /resultado\s+(?:preliminar|provis[óo]rio|parcial)/i,
      /resultado.*(?:prova|etapa|fase)/i,
      /classifica[çc][ãa]o.*(?:provis[óo]ria|preliminar)/i,
      /lista\s+de\s+(?:aprovados?|classificados?).*(?:preliminar|provis[óo]rio)/i,
      /resultado.*(?:prova\s+)?objetiva/i,
    ],
    excludePatterns: [
      /homologa[çc][ãa]o/i,
      /resultado\s+final/i,
      /classifica[çc][ãa]o\s+final/i,
      /gabarito/i,
      /convoca[çc][ãa]o/i,
    ],
    conflictKeywords: [
      'homologação',
      'resultado final',
      'classificação final',
      'gabarito',
      'abertura de inscrições',
    ],
    proximity: {
      required: true,
      maxDistance: 150,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
    minStrongKeywords: 1,
  },

  // Gabarito
  {
    documentType: 'gabarito',
    weight: 0.89,
    priority: 'secondary',
    strongKeywords: [
      'gabarito oficial',
      'gabarito preliminar',
      'gabarito definitivo',
      'gabarito da prova',
      'resposta oficial',
      'divulgação do gabarito',
    ],
    moderateKeywords: [
      'gabarito',
      'respostas',
    ],
    weakKeywords: [],
    patterns: [
      /gabarito\s+(?:oficial|preliminar|definitivo)/i,
      /gabarito.*prova/i,
      /resposta\s+oficial/i,
      /divulga[çc][ãa]o.*gabarito/i,
      /gabarito.*concurso/i,
    ],
    excludePatterns: [
      /abertura\s+de\s+inscri[çc][õo]es/i,
      /prorroga[çc][ãa]o/i,
      /convoca[çc][ãa]o/i,
      /homologa[çc][ãa]o.*resultado/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'prorroga',
      'prorrogação',
      'convoca',
      'convocação',
      'homologação do resultado',
    ],
    proximity: {
      required: false, // Gabarito can be standalone
      maxDistance: 150,
      boostNearby: true,
    },
    minKeywordsTogether: 1, // Just gabarito is enough
    minStrongKeywords: 1,
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

  // Education level / Requirements
  escolaridade: [
    /escolaridade:?\s*([^\n\r]+)/i,
    /n[íi]vel\s+(?:de\s+)?escolaridade:?\s*([^\n\r]+)/i,
    /requisito:?\s*([^\n\r]+)/i,
    /forma[çc][ãa]o:?\s*([^\n\r]+)/i,
    /(?:ensino|n[íi]vel)\s+(fundamental|m[ée]dio|superior|t[ée]cnico|gradua[çc][ãa]o|p[óo]s-gradua[çc][ãa]o)/i,
  ],

  // Work hours / Schedule
  jornada: [
    /jornada:?\s*([^\n\r]+)/i,
    /carga\s+hor[áa]ria:?\s*([^\n\r]+)/i,
    /(\d{1,2})\s*(?:h|horas?)(?:\s*semanais?)?/i,
    /regime:?\s*(\d{1,2}\s*(?:h|horas?))/i,
  ],

  // Benefits
  beneficios: [
    /benef[íi]cios?:?\s*([^\n\r]+)/i,
    /vale[- ](?:transporte|alimenta[çc][ãa]o|refei[çc][ãa]o)/i,
    /aux[íi]lio[- ](?:transporte|alimenta[çc][ãa]o|sa[úu]de|creche)/i,
    /plano\s+de\s+sa[úu]de/i,
    /ticket\s+(?:alimenta[çc][ãa]o|refei[çc][ãa]o)/i,
  ],

  // Vacancy reservations
  reservaVagas: [
    /(?:reserva(?:das?)?|vagas?)\s+(?:para\s+)?(?:pessoas?\s+com\s+)?defici[êe]nci[ao]s?\s*\(?PCD\)?:?\s*(\d+)/i,
    /PCD:?\s*(\d+)\s*vagas?/i,
    /ampla\s+concorr[êe]ncia:?\s*(\d+)\s*vagas?/i,
    /(?:negros?|cotistas?):?\s*(\d+)\s*vagas?/i,
  ],

  // Multiple cargo patterns (table-like structures)
  cargoTable: [
    /cargo[:\s]+([^\n\r|]+?)[\s|]+vagas?[:\s]+(\d+)[\s|]+(?:sal[áa]rio|remunera[çc][ãa]o|vencimento)[:\s]+R?\$?\s*([\d.,]+)/gi,
    /([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç\s]+)\s+[-|]\s+(\d+)\s+vagas?\s+[-|]\s+R\$\s*([\d.,]+)/gi,
  ],

  // Requirements patterns
  requisitos: [
    /requisitos?:?\s*([^\n\r]+)/i,
    /exig[êe]ncias?:?\s*([^\n\r]+)/i,
    /qualifica[çc][õo]es?:?\s*([^\n\r]+)/i,
  ],

  // Work location
  localTrabalho: [
    /local\s+de\s+trabalho:?\s*([^\n\r]+)/i,
    /lotac[çc][ãa]o:?\s*([^\n\r]+)/i,
    /cidade:?\s*([^\n\r]+)/i,
  ],
};

/**
 * Helper to detect if text contains concurso-related content
 */
export function hasConcursoKeywords(text: string): boolean {
  const keywords = [
    'concurso público',
    'concurso publico',  // without accent
  ];
  
  const lowerText = text.toLowerCase();
  return keywords.some(kw => lowerText.includes(kw));
}

/**
 * Helper to detect if text contains ambiguous concurso terms needing AI validation
 */
export function hasAmbiguousConcursoKeywords(text: string): boolean {
  const ambiguousKeywords = [
    'concurso', // Without "público"
    'processo seletivo',
    'seleção pública',
    'seleção simplificada',
    'processo seletivo simplificado',
  ];
  
  const lowerText = text.toLowerCase();
  
  // Check if text has ambiguous keywords but NOT the specific "concurso público"
  const hasAmbiguous = ambiguousKeywords.some(kw => lowerText.includes(kw));
  const hasSpecific = lowerText.includes('concurso público') || lowerText.includes('concurso publico');
  
  return hasAmbiguous && !hasSpecific;
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
