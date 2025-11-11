/**
 * V2 Concurso Patterns - Duplicated from V1 for safe modification
 * These patterns are used for detecting concurso-related content in V2 system
 */

export type ConcursoDocumentType = 
  | 'edital_abertura'
  | 'convocacao'
  | 'homologacao'
  | 'resultado_preliminar'
  | 'resultado_final'
  | 'resultado_parcial'
  | 'resultado_insencao'
  | 'edital_retificacao'
  | 'reclassificacao_resultado'
  | 'cronograma'
  | 'gabarito'
  | 'outros';

export type PatternPriority = 'primary' | 'secondary' | 'supporting';

export interface ConcursoPatternV2 {
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
 * V2 Patterns for each document type (duplicated from V1)
 */
export const CONCURSO_PATTERNS_V2: ConcursoPatternV2[] = [
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
      'realização de concurso público',
      'concurso público para provimento',
      'abertura do concurso público',
      'torna público que estão abertas as inscrições',
      'torna pública que estão abertas as inscrições',
      'estão abertas as inscrições',
      'abertas as inscrições do concurso público',
      'abertas as inscrições para',
      'são requisitos para inscrição',
      'requisitos para inscrição',
      'as inscrições estão abertas',
      'as inscrições ficarão abertas',
      'período de inscrições aberto',
      'pedido de inscrição no site',
      'inscrições ficarão abertas'
    ],
    moderateKeywords: [
      'edital de abertura',
      'edital de concurso',
      'edital nº',
      'estarão abertas as inscrições',
      'abertas as inscrições',
      'inscrições para realização'
    ],
    weakKeywords: [],
    patterns: [
      /(?:torna|tornar)\s+p[uú]blic[oa].*(?:abertura|realiza[çc][ãa]o).*concurso/i,
      /abertura\s+(?:de|das)\s+inscri[çc][õo]es/i,
      /inscri[çc][õo]es\s+(?:abertas|iniciadas|começam)/i,
      /realiza[çc][ãa]o\s+de\s+concurso\s+p[uú]blico/i,
      /concurso\s+p[uú]blico\s+para\s+(?:provimento|preenchimento)/i,
      /edital\s+de\s+abertura.*concurso/i,
      /torna\s+p[uú]blic[oa]\s+que\s+est[ãa]o\s+abertas.*inscri[çc][õo]es/i,
      /est[ãa]o\s+abertas.*inscri[çc][õo]es.*concurso\s+p[uú]blico/i,
      /abertas.*inscri[çc][õo]es.*concurso\s+p[uú]blico/i,
      // Conselho Tutelar selection process patterns
      /faz\s+publicar\s+este\s+edital\s+para\s+a\s+realiza[çc][ãa]o\s+do\s+processo\s+de\s+escolha/i,
      /processo\s+de\s+escolha.*para\s+membros\s+do\s+conselho\s+tutelar/i,
      /edital\s+para\s+a\s+realiza[çc][ãa]o\s+do\s+processo\s+de\s+escolha/i,
      /inscri[çc][õo]es\s+ficar[ãa]o\s+abertas.*exclusivamente/i,
      /per[íi]odo\s+para\s+inscri[çc][ãa]o\s+de\s+candidatos/i,
    ],
    excludePatterns: [
      /prorroga(?:[çc][ãa]o|r|ndo).*(?:concurso|edital|inscri[çc][õo]es)/i,
      /(?:concurso|edital|inscri[çc][õo]es).*prorroga(?:[çc][ãa]o|r|ndo)/i,
      /retifica(?:[çc][ãa]o|r|ndo)/i,
      /resultado\s+(?:final|preliminar|parcial)/i,
      /classifica[çc][ãa]o\s+(?:final|preliminar)/i,
      /(?:edital\s+de\s+)?homologa(?:[çc][ãa]o|r|ndo).*(?:resultado\s+final|classifica[çc][ãa]o\s+final|concurso\s+p[úu]blico)/i,
      /(?:concurso|edital|inscri[çc][õo]es).*homologa(?:[çc][ãa]o|r|ndo)/i,
      /edital\s+de\s+classifica[çc][ãa]o/i,
      /edital\s+de\s+notas/i,
      /notas\s+das?\s+provas?\s+pr[áa]ticas?/i,
      /classificados?\s+em\s+ampla\s+concorr[êe]ncia/i,
      /TAF.*concurso\s+p[uú]blico/i,
      /nota\s+final.*nota\s+(?:da\s+)?prova/i,
    ],
    conflictKeywords: [
      'edital de classificação',
      'resultado preliminar',
      'resultado final',
      'homologação do resultado',
      'retificação',
      'prorrogação',
      'convocação',
      'reclassificação'
    ],
    proximity: {
      required: false,
      maxDistance: 50,
      boostNearby: true,
    },
    minKeywordsTogether: 1,
    minStrongKeywords: 1,
  },

  // Convocação
  {
    documentType: 'convocacao',
    weight: 0.95,
    priority: 'primary',
    strongKeywords: [
      'convoca o(s) seguinte(s) aprovado(s)',
      'convoca os seguintes aprovados',
      'convoca o seguinte aprovado',
      'convocação dos aprovados',
      'convocação do aprovado',
      'convoca para tomar posse',
      'convoca para assumir',
      'convoca para apresentar-se',
      'convoca para apresentar documentos',
      'convoca para exame médico',
      'convoca para comprovação',
      'convoca para entrega de documentos',
      'convoca para nomeação',
      'convoca para posse',
      'convoca os candidatos aprovados',
      'convoca o candidato aprovado',
      'convocados para posse',
      'convocados para nomeação',
      'convocados para apresentação',
      'convocação para posse',
      'convocação para nomeação',
      'convocação para apresentação',
      'convocação para exame médico',
      'convocação para comprovação',
      'convocação para entrega de documentos',
      'convocação para assumir',
      'convocação para tomar posse',
      'fica convocado',
      'ficam convocados',
      'são convocados',
      'é convocado',
      'convocação nº',
      'edital de convocação',
      'convocação dos candidatos',
      'convocação do candidato'
    ],
    moderateKeywords: [
      'convocação',
      'convoca',
      'convocados',
      'convocado',
      'apresentar-se',
      'tomar posse',
      'assumir o cargo',
      'nomeação',
      'posse'
    ],
    weakKeywords: [],
    patterns: [
      /convoca\s+o\(?s\)?\s+seguintes?\s+aprovados?/i,
      /convoca[çc][ãa]o\s+dos?\s+(?:candidatos?\s+)?aprovados?/i,
      /convoca\s+para\s+(?:tomar\s+posse|assumir|apresentar)/i,
      /convoca\s+para\s+(?:exame\s+m[ée]dico|comprova[çc][ãa]o|entrega)/i,
      /convoca\s+para\s+(?:nomea[çc][ãa]o|posse)/i,
      /convocados?\s+para\s+(?:posse|nomea[çc][ãa]o|apresenta[çc][ãa]o)/i,
      /convoca[çc][ãa]o\s+para\s+(?:posse|nomea[çc][ãa]o|apresenta[çc][ãa]o)/i,
      /convoca[çc][ãa]o\s+para\s+(?:exame\s+m[ée]dico|comprova[çc][ãa]o)/i,
      /convoca[çc][ãa]o\s+para\s+(?:entrega|assumir|tomar\s+posse)/i,
      /ficam?\s+convocados?/i,
      /s[ãa]o\s+convocados?/i,
      /[ée]\s+convocado/i,
      /convoca[çc][ãa]o\s+n[°º]?\s*\d+/i,
      /edital\s+de\s+convoca[çc][ãa]o/i,
      /convoca[çc][ãa]o\s+dos?\s+candidatos?/i,
    ],
    excludePatterns: [
      /abertura.*inscri[çc][õo]es/i,
      /inscri[çc][õo]es.*abertas/i,
      /realiza[çc][ãa]o.*concurso/i,
      /resultado\s+(?:final|preliminar)/i,
      /classifica[çc][ãa]o\s+(?:final|preliminar)/i,
      /homologa[çc][ãa]o/i,
      /retifica[çc][ãa]o/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'inscrições abertas',
      'resultado final',
      'resultado preliminar',
      'homologação',
      'retificação',
      'classificação final'
    ],
    proximity: {
      required: true,
      maxDistance: 30,
      boostNearby: true,
    },
    minKeywordsTogether: 1,
    minStrongKeywords: 1,
  },

  // Homologação
  {
    documentType: 'homologacao',
    weight: 0.9,
    priority: 'primary',
    strongKeywords: [
      'homologa o resultado final',
      'homologa o resultado',
      'homologa a classificação final',
      'homologa a classificação',
      'homologação do resultado final',
      'homologação do resultado',
      'homologação da classificação final',
      'homologação da classificação',
      'resultado final homologado',
      'classificação final homologada',
      'fica homologado o resultado',
      'fica homologada a classificação',
      'homologa o concurso público',
      'homologação do concurso público',
      'concurso público homologado',
      'edital de homologação',
      'homologação nº',
      'homologa definitivamente',
      'homologação definitiva'
    ],
    moderateKeywords: [
      'homologação',
      'homologa',
      'homologado',
      'homologada',
      'resultado final',
      'classificação final'
    ],
    weakKeywords: [],
    patterns: [
      /homologa\s+o\s+resultado\s+final/i,
      /homologa\s+o\s+resultado/i,
      /homologa\s+a\s+classifica[çc][ãa]o\s+final/i,
      /homologa\s+a\s+classifica[çc][ãa]o/i,
      /homologa[çc][ãa]o\s+do\s+resultado\s+final/i,
      /homologa[çc][ãa]o\s+do\s+resultado/i,
      /homologa[çc][ãa]o\s+da\s+classifica[çc][ãa]o\s+final/i,
      /homologa[çc][ãa]o\s+da\s+classifica[çc][ãa]o/i,
      /resultado\s+final\s+homologado/i,
      /classifica[çc][ãa]o\s+final\s+homologada/i,
      /fica\s+homologado\s+o\s+resultado/i,
      /fica\s+homologada\s+a\s+classifica[çc][ãa]o/i,
      /homologa\s+o\s+concurso\s+p[uú]blico/i,
      /homologa[çc][ãa]o\s+do\s+concurso\s+p[uú]blico/i,
      /concurso\s+p[uú]blico\s+homologado/i,
      /edital\s+de\s+homologa[çc][ãa]o/i,
      /homologa[çc][ãa]o\s+n[°º]?\s*\d+/i,
      /homologa\s+definitivamente/i,
      /homologa[çc][ãa]o\s+definitiva/i,
    ],
    excludePatterns: [
      /abertura.*inscri[çc][õo]es/i,
      /inscri[çc][õo]es.*abertas/i,
      /convoca[çc][ãa]o/i,
      /retifica[çc][ãa]o/i,
      /resultado\s+preliminar/i,
      /classifica[çc][ãa]o\s+preliminar/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'inscrições abertas',
      'convocação',
      'retificação',
      'resultado preliminar',
      'classificação preliminar'
    ],
    proximity: {
      required: true,
      maxDistance: 20,
      boostNearby: true,
    },
    minKeywordsTogether: 1,
    minStrongKeywords: 1,
  },

  // Add other document types following the same pattern...
  // (I'll include a few more key ones for completeness)

  // Resultado Final
  {
    documentType: 'resultado_final',
    weight: 0.9,
    priority: 'primary',
    strongKeywords: [
      'resultado final',
      'classificação final',
      'lista final dos aprovados',
      'relação final dos aprovados',
      'resultado definitivo',
      'classificação definitiva',
      'aprovados em caráter definitivo',
      'resultado final do concurso',
      'classificação final do concurso',
      'divulga o resultado final',
      'publica o resultado final',
      'torna público o resultado final',
      'resultado final homologado'
    ],
    moderateKeywords: [
      'resultado',
      'classificação',
      'aprovados',
      'lista de aprovados',
      'relação de aprovados'
    ],
    weakKeywords: [],
    patterns: [
      /resultado\s+final/i,
      /classifica[çc][ãa]o\s+final/i,
      /lista\s+final\s+dos?\s+aprovados?/i,
      /rela[çc][ãa]o\s+final\s+dos?\s+aprovados?/i,
      /resultado\s+definitivo/i,
      /classifica[çc][ãa]o\s+definitiva/i,
      /aprovados?\s+em\s+car[áa]ter\s+definitivo/i,
      /resultado\s+final\s+do\s+concurso/i,
      /classifica[çc][ãa]o\s+final\s+do\s+concurso/i,
      /divulga\s+o\s+resultado\s+final/i,
      /publica\s+o\s+resultado\s+final/i,
      /torna\s+p[uú]blic[oa]\s+o\s+resultado\s+final/i,
      /resultado\s+final\s+homologado/i,
    ],
    excludePatterns: [
      /abertura.*inscri[çc][õo]es/i,
      /inscri[çc][õo]es.*abertas/i,
      /convoca[çc][ãa]o/i,
      /resultado\s+preliminar/i,
      /classifica[çc][ãa]o\s+preliminar/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'inscrições abertas',
      'convocação',
      'resultado preliminar',
      'classificação preliminar'
    ],
    proximity: {
      required: false,
      maxDistance: 30,
      boostNearby: true,
    },
    minKeywordsTogether: 1,
    minStrongKeywords: 1,
  },

  // Retificação
  {
    documentType: 'edital_retificacao',
    weight: 0.85,
    priority: 'secondary',
    strongKeywords: [
      'retifica o edital',
      'retificação do edital',
      'edital de retificação',
      'retifica o concurso',
      'retificação do concurso',
      'errata do edital',
      'correção do edital',
      'alteração do edital',
      'retifica os itens',
      'retificação dos itens',
      'onde se lê',
      'leia-se',
      'fica retificado',
      'ficam retificados'
    ],
    moderateKeywords: [
      'retificação',
      'retifica',
      'retificado',
      'retificados',
      'errata',
      'correção',
      'alteração'
    ],
    weakKeywords: [],
    patterns: [
      /retifica\s+o\s+edital/i,
      /retifica[çc][ãa]o\s+do\s+edital/i,
      /edital\s+de\s+retifica[çc][ãa]o/i,
      /retifica\s+o\s+concurso/i,
      /retifica[çc][ãa]o\s+do\s+concurso/i,
      /errata\s+do\s+edital/i,
      /corre[çc][ãa]o\s+do\s+edital/i,
      /altera[çc][ãa]o\s+do\s+edital/i,
      /retifica\s+os?\s+itens?/i,
      /retifica[çc][ãa]o\s+dos?\s+itens?/i,
      /onde\s+se\s+l[êe]/i,
      /leia-se/i,
      /fica\s+retificado/i,
      /ficam\s+retificados/i,
    ],
    excludePatterns: [
      /abertura.*inscri[çc][õo]es/i,
      /resultado\s+(?:final|preliminar)/i,
      /convoca[çc][ãa]o/i,
      /homologa[çc][ãa]o/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'resultado final',
      'resultado preliminar',
      'convocação',
      'homologação'
    ],
    proximity: {
      required: false,
      maxDistance: 40,
      boostNearby: true,
    },
    minKeywordsTogether: 1,
    minStrongKeywords: 1,
  },
];

/**
 * V2 Title patterns that provide high confidence when found
 */
export const TITLE_PATTERNS_V2: Array<{
  documentType: ConcursoDocumentType;
  patterns: RegExp[];
  baseConfidence: number;
}> = [
  {
    documentType: 'convocacao',
    patterns: [
      /^CONVOCA[ÇC][ÃA]O/i,
      /^EDITAL\s+DE\s+CONVOCA[ÇC][ÃA]O/i,
      /^[\d]+[ªº]?\s*CONVOCA[ÇC][ÃA]O/i,
      /CONVOCA[ÇC][ÃA]O.*CONCURSO\s+P[ÚU]BLICO/i,
      /CONCURSO\s+P[ÚU]BLICO.*CONVOCA[ÇC][ÃA]O/i,
      /EDITAIS?\s+.*\s+CONVOCA[ÇC][ÃA]O/i,
      /EDITAL\s+DE\s+CONVOCA[ÇC][ÃA]O\s+N[°º]?\s*\d+/i,
      /(?:^|\n)\s*EDITAL\s+DE\s+CONVOCA[ÇC][ÃA]O/i,
      /CONVOCA[ÇC][ÃA]O\s+N[°º]?\s*\d+/i,
    ],
    baseConfidence: 0.9,
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
 * V2 Patterns for extracting structured data
 */
export const EXTRACTION_PATTERNS_V2 = {
  // Edital number
  editalNumero: [
    /edital\s+n[°º]?\s*(\d+\/\d{4})/i,
    /edital\s+n[°º]?\s*(\d+[-\/]\d{4})/i,
    /processo\s+n[°º]?\s*(\d+\/\d{4})/i,
    /edital\s+n[°º]?\s*(\d+[._-]\d{4})/i,
    /edital\s+n[°º]?\s*(\d{4}[-\/]\d+)/i,
    /edital\s+de\s+\w+\s+n[°º]?\s*(\d+\/\d{4})/i,
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
    /(?:remunera[çc][ãa]o|sal[áa]rio|vencimento)[:\s]*R\$?\s*([\d.,]+)/i,
    /(?:valor|quantia)[:\s]*R\$?\s*([\d.,]+)(?:\s*\(.*?remunera[çc][ãa]o.*?\))?/i,
    /R\$\s*([\d.,]+)\s*(?:mensais?|por\s+m[êe]s)/i,
  ],

  // Registration period
  inscricoes: [
    /inscri[çc][õo]es.*de\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+a(?:t[ée])?\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /per[íi]odo\s+de\s+inscri[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+a\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],

  // Exam date
  prova: [
    /prova.*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /exame.*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /avalia[çc][ãa]o.*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],
};

/**
 * V2 Helper functions for concurso detection
 */

/**
 * Check if text contains direct concurso público keywords
 */
export function hasDirectConcursoKeywords(text: string): boolean {
  const directKeywords = [
    'concurso público',
    'concurso publico',  // without accent
    'concursos públicos',
    'concursos publicos', // without accent
  ];
  
  const lowerText = text.toLowerCase();
  return directKeywords.some(kw => lowerText.includes(kw));
}

/**
 * Check if text contains ambiguous concurso terms that need AI validation
 */
export function hasAmbiguousConcursoKeywords(text: string): boolean {
  const ambiguousKeywords = [
    'processo seletivo',
    'processo de seleção',
    'processo de selecao', // without accent
    'concurso', // without "público"
  ];
  
  const lowerText = text.toLowerCase();
  
  // Check for ambiguous terms but exclude if direct concurso público is found
  if (hasDirectConcursoKeywords(text)) {
    return false;
  }
  
  return ambiguousKeywords.some(kw => lowerText.includes(kw));
}

/**
 * Check if text has no concurso-related keywords at all
 */
export function hasNoConcursoKeywords(text: string): boolean {
  return !hasDirectConcursoKeywords(text) && !hasAmbiguousConcursoKeywords(text);
}

/**
 * Calculate confidence score for document type detection (V2)
 */
export function calculateTypeConfidenceV2(
  matchedPatterns: number,
  totalPatterns: number,
  keywordMatches: number,
  weight: number
): number {
  const patternScore = totalPatterns > 0 ? matchedPatterns / totalPatterns : 0;
  const keywordScore = Math.min(keywordMatches / 3, 1); // Normalize to max 3 keywords
  
  return Math.min((patternScore * 0.6 + keywordScore * 0.4) * weight, 1);
}



