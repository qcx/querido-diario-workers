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
      /prorroga(?:[çc][ãa]o|r|ndo).*(?:concurso|edital|inscri[çc][õo]es)/i,  // Only exclude if near concurso terms
      /(?:concurso|edital|inscri[çc][õo]es).*prorroga(?:[çc][ãa]o|r|ndo)/i,  // Bidirectional
      /retifica(?:[çc][ãa]o|r|ndo)/i,
      /resultado\s+(?:final|preliminar|parcial)/i,
      /classifica[çc][ãa]o\s+(?:final|preliminar)/i,
      /(?:edital\s+de\s+)?homologa(?:[çc][ãa]o|r|ndo).*(?:resultado\s+final|classifica[çc][ãa]o\s+final|concurso\s+p[úu]blico)/i,
      /(?:concurso|edital|inscri[çc][õo]es).*homologa(?:[çc][ãa]o|r|ndo)/i,  
      // NEW: Exclude resultado_parcial patterns
      /edital\s+de\s+classifica[çc][ãa]o/i,
      /edital\s+de\s+notas/i,
      /notas\s+das?\s+provas?\s+pr[áa]ticas?/i,
      /classificados?\s+em\s+ampla\s+concorr[êe]ncia/i,
      /TAF.*concurso\s+p[uú]blico/i,
      /nota\s+final.*nota\s+(?:da\s+)?prova/i,
    ],
    conflictKeywords: [
      // NEW: Add resultado_parcial conflict keywords
      'edital de classificação',
      'edital de notas',
      'notas das provas práticas',
      'classificação preliminar',
      'classificados em ampla concorrência',
      'TAF',
      'nota da prova prática',
    ],
    proximity: {
      required: true,
      maxDistance: 200,
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
      'candidatos classificados',
      // NEW: Missing patterns from failing examples
      'edital de convocação',
      'convoca o(s) seguinte(s)',
      'convoca os seguintes',
      'convoca o seguinte',
      'convoca os aprovados',
      'convoca o aprovado',
      'convoca para o cargo',
      'convoca os candidatos aprovados',
    ],
    moderateKeywords: [
      'convocação',
      'candidatos',
      'aprovados',
      'classificados',
      'posse',
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
      // NEW: Enhanced patterns for better detection
      /edital\s+de\s+convoca[çc][ãa]o/i,
      /convoca\s+o\(?s\)?\s+seguintes?\s+aprovados?/i,
      /convoca\s+os?\s+(?:candidatos?\s+)?aprovados?/i,
      /convoca\s+para\s+o\s+cargo/i,
      /(?:^|\n)\s*convoca[çc][ãa]o[^\n]*(?:concurso|p[úu]blico)/i,
    ],
    excludePatterns: [
      /edital\s+de\s+abertura(?!.*(?:convoca|classifica[çc][ãa]o))/i,
      /abertura\s+de\s+inscri[çc][õo]es(?!.*(?:convoca|aprovados))/i,
      /inscri[çc][õo]es\s+abertas(?!.*convoca)/i,
      /prorroga(?:[çc][ãa]o|r).*(?:prazo|inscri[çc][õo]es)/i,
      /retifica(?:[çc][ãa]o|r)/i,
      /homologa(?:[çc][ãa]o|r).*resultado\s+final/i,
      /gabarito/i,
      // NEW: Exclude nomeação documents
      /decreto.*nomea[çc][ãa]o/i,
      /nomea[çc][ãa]o\s+dos?\s+candidatos?\s+aprovados?/i,
      /art\.?\s*\d+[°º]?\s+nomea[çc][ãa]o/i,
      /portaria.*nomea[çc][ãa]o/i,
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
      'nomeação',
      'decreto',
      'nomear',
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
      'classificação final',
    ],
    moderateKeywords: [
      'homologação',
      'homologa',
      'resultado final',
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
      'prorrogação de processos seletivos',
      'prorrogação de seleções públicas',
      'edital de prorrogação',
      'prorrogação de processos',
      'prorrogação de seleções',
      'prorroga por mais',
      'prorrogação de processos seletivos simplificados',
    ],
    moderateKeywords: [
      'nova data',
      'adiamento',
      'fica prorrogado',
      'prazo prorrogado',
      'processos seletivos simplificados',
      'seleções públicas',
      'processo seletivo',
      'seleção pública',
      'edital de prorrogação',
      'fica prorrogado até',
      'prorrogado por mais',
    ],
    weakKeywords: [],
    patterns: [
      /prorroga(?:[çc][ãa]o|r|ndo)?\s+(?:por|de|o\s+prazo|a\s+validade|as\s+inscri[çc][õo]es)/i,
      /(?:fica|ficam)\s+prorrogad[oa]s?/i,
      /extens[ãa]o\s+(?:de|do)\s+prazo/i,
      /prorroga[çc][ãa]o.*(?:inscri[çc][õo]es|prazo|validade|edital|concurso)/i,
      /adiamento.*(?:prova|inscri[çc][õo]es|data)/i,
      /edital\s+de\s+prorroga[çc][ãa]o.*processos?\s+seletivos?\s+simplificados?/i,
      /prorroga[çc][ãa]o.*processos?\s+seletivos?\s+simplificados?/i,
      /prorroga[çc][ãa]o.*sele[çc][õo]es?\s+p[uú]blicas?/i,
      /edital.*prorroga[çc][ãa]o.*processo\s+seletivo/i,
      /prorroga[çc][ãa]o.*de.*processos?\s+seletivos?/i,
    ],
    excludePatterns: [
      /(?:torna|tornar)\s+p[uú]blico.*(?:abertura|realiza[çc][ãa]o)/i,
      /abertura\s+de\s+inscri[çc][õo]es/i,
      /inscri[çc][õo]es\s+abertas/i,
      /lista.*(?:aprovados|classificados|convocados)/i,
      // NEW: Exclude resultado_parcial patterns
      /edital\s+de\s+classifica[çc][ãa]o/i,
      /edital\s+de\s+notas/i,
      /notas\s+das?\s+provas?\s+pr[áa]ticas?/i,
      /classificados?\s+em\s+ampla\s+concorr[êe]ncia/i,
      /classifica[çc][ãa]o\s+preliminar/i,
      /TAF.*concurso\s+p[uú]blico/i,
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
      // NEW: Add resultado_parcial conflict keywords
      'edital de classificação',
      'edital de notas',
      'notas das provas práticas',
      'classificação preliminar',
      'classificados em ampla concorrência',
      'TAF',
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
    weight: 0.92, // Increased from 0.86 for better competition
    priority: 'primary', // Changed from 'secondary' for higher priority
    strongKeywords: [
      'resultado preliminar',
      'resultado provisório',
      'resultado parcial',
      'classificação preliminar',
      'classificação provisória',
      'classificação final',
      'resultado da prova',
      'resultado da etapa',
      // NEW: Add missing strong keywords for better detection
      'edital de classificação',
      'edital de notas',
      'notas das provas',
      'prova prática',
      'TAF',
      'teste de aptidão física',
      'classificados em ampla concorrência',
      'nota final',
      'nota da prova prática',
      'edital de classificação preliminar',
      'notas das provas práticas',
      'classificação preliminar II',
    ],
    moderateKeywords: [
      'resultado',
      'classificação',
      'lista de aprovados',
      'lista de classificados',
      'aprovados',
      'notas',
      // NEW: Additional moderate keywords
      'preliminar',
      'provisório',
      'parcial',
      'prova',
      'etapa',
      'fase',
    ],
    weakKeywords: [
      'nota',
      'pontuação',
      'candidato',
      'inscrição',
    ],
    patterns: [
      /resultado\s+(?:preliminar|provis[óo]rio|parcial)/i,
      /resultado.*(?:prova|etapa|fase)/i,
      /classifica[çc][ãa]o.*(?:provis[óo]ria|preliminar)/i,
      /lista\s+de\s+(?:aprovados?|classificados?).*(?:preliminar|provis[óo]rio)/i,
      /resultado.*(?:prova\s+)?objetiva/i,
      // NEW: Add missing patterns for better detection
      /edital\s+de\s+classifica[çc][ãa]o/i,
      /edital\s+de\s+notas/i,
      /notas\s+das?\s+provas?\s+pr[áa]ticas?/i,
      /prova\s+pr[áa]tica.*TAF/i,
      /classificados?\s+em\s+ampla\s+concorr[êe]ncia/i,
      /nota\s+final.*nota\s+(?:da\s+)?prova/i,
      /edital\s+de\s+classifica[çc][ãa]o\s+preliminar/i,
      /classifica[çc][ãa]o\s+preliminar.*(?:II|2)/i,
      /TAF.*concurso\s+p[uú]blico/i,
      /teste\s+de\s+aptid[ãa]o\s+f[íi]sica/i,
    ],
    excludePatterns: [
      /homologa[çc][ãa]o/i,
      /gabarito/i,
      /convoca[çc][ãa]o/i,
      // NEW: Exclude opening and extension patterns
      /abertura\s+de\s+inscri[çc][õo]es/i,
      /inscri[çc][õo]es\s+abertas/i,
      /prorroga[çc][ãa]o\s+de\s+prazo/i,
      /torna\s+p[uú]blic[oa].*abertura/i,
    ],
    conflictKeywords: [
      'homologação',
      'gabarito',
      'abertura de inscrições',
      'inscrições abertas',
      'prorrogação de prazo',
      'torna público a abertura',
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

  // Resultado de Isenção (Exemption Fee Results)
  {
    documentType: 'resultado_insencao',
    weight: 0.92,
    priority: 'primary',
    strongKeywords: [
      'isenção da taxa de inscrição',
      'resultado da solicitação de isenção',
      'análise de recurso contra o resultado',
      'divulgação da análise de recurso',
      'deferimento de isenção',
      'indeferimento de isenção',
      'resultado do pedido de isenção',
      'resultado da isenção',
      'recurso contra isenção',
      'análise de pedido de isenção',
      'edital de divulgação da análise de recurso',
      'divulgação da análise de recurso contra o resultado',
      'recurso contra o resultado da solicitação de isenção',
      'análise de recurso contra o resultado da solicitação',
      'resultado da solicitação de isenção da taxa',
    ],
    moderateKeywords: [
      'isenção de taxa',
      'solicitação de isenção',
      'resultado de isenção',
      'pedido de isenção',
      'recurso de isenção',
      'análise de recurso',
      'taxa de inscrição',
      'edital de divulgação',
      'contra o resultado',
      'documentação comprobatória',
      'não atendeu ao disposto',
      'divulga aos candidatos',
    ],
    weakKeywords: [
      'isenção',
      'taxa',
      'deferido',
      'indeferido',
    ],
    patterns: [
      /(?:resultado|divulga[çc][ãa]o|an[aá]lise).*(?:solicita[çc][ãa]o|pedido).*isen[çc][ãa]o.*taxa/i,
      /isen[çc][ãa]o.*taxa.*inscri[çc][ãa]o/i,
      /recurso.*(?:contra|sobre).*resultado.*isen[çc][ãa]o/i,
      /(?:deferimento|indeferimento).*isen[çc][ãa]o/i,
      /an[aá]lise.*recurso.*isen[çc][ãa]o/i,
      /resultado.*pedido.*isen[çc][ãa]o/i,
      /divulga[çc][ãa]o.*an[aá]lise.*recurso.*isen[çc][ãa]o/i,
      /edital.*divulga[çc][ãa]o.*an[aá]lise.*recurso/i,
      /divulga[çc][ãa]o.*an[aá]lise.*recurso.*contra.*resultado/i,
      /recurso.*contra.*resultado.*solicita[çc][ãa]o.*isen[çc][ãa]o/i,
      /an[aá]lise.*recurso.*contra.*resultado.*solicita[çc][ãa]o/i,
    ],
    excludePatterns: [
      /abertura\s+de\s+inscri[çc][õo]es/i,
      /inscri[çc][õo]es\s+abertas/i,
      /edital\s+de\s+abertura/i,
      /realiza[çc][ãa]o\s+de\s+concurso/i,
      /torna\s+p[uú]blic[oa].*abertura/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'inscrições abertas',
      'edital de abertura',
      'realização de concurso',
      'torna público a abertura',
      'torna pública a abertura',
      'convocação de candidatos',
      'homologação do resultado',
    ],
    proximity: {
      required: true,
      maxDistance: 150,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
    minStrongKeywords: 1,
  },

  // Reclassificação de Resultado (Reclassification Results)
  {
    documentType: 'reclassificacao_resultado',
    weight: 0.90,
    priority: 'primary',
    strongKeywords: [
      'autoriza a reclassificação',
      'autoriza reclassificação',
      'reclassificação para o final da lista',
      'reclassificação para final da lista',
      'reclassificação de aprovados',
      'reclassificação no concurso',
      'final da lista de aprovados',
      'final da fila da lista',
      'requerimento de reclassificação',
      'reclassificação de candidatos',
      'reclassificação para a última colocação',
      'reclassificação para o final da fila',
      'concedida a reclassificação',
    ],
    moderateKeywords: [
      'reclassificação',
      'lista de aprovados',
      'processo administrativo',
      'final da lista',
      'final da fila',
      'última colocação',
      'requerimento',
      'reposicionamento',
      'validade do concurso',
      'período de validade',
    ],
    weakKeywords: [
      'aprovados',
      'candidatos',
      'concurso',
    ],
    patterns: [
      /autoriza.*reclassifica[çc][ãa]o.*(?:final|[uú]ltima).*(?:lista|fila)/i,
      /reclassifica[çc][ãa]o.*(?:para\s+o?\s*)?final.*(?:lista|fila).*aprovados/i,
      /reclassifica[çc][ãa]o.*concurso.*p[uú]blico/i,
      /requerimento.*reclassifica[çc][ãa]o.*aprovados/i,
      /autoriza.*reclassifica[çc][ãa]o.*candidatos?/i,
      /reclassifica[çc][ãa]o.*[uú]ltima.*coloca[çc][ãa]o/i,
      /(?:fica\s+)?concedida.*reclassifica[çc][ãa]o/i,
      /reclassifica[çc][ãa]o.*para.*final.*fila/i,
      /autoriza\s+a\s+reclassifica[çc][ãa]o\s+para\s+o\s+final/i,
    ],
    excludePatterns: [
      /abertura\s+de\s+inscri[çc][õo]es/i,
      /inscri[çc][õo]es\s+abertas/i,
      /edital\s+de\s+abertura/i,
      /convoca[çc][ãa]o\s+(?:de\s+)?candidatos/i,
      /resultado\s+(?:final|preliminar)/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'inscrições abertas',
      'edital de abertura',
      'convocação de candidatos',
      'resultado final',
      'resultado preliminar',
      'homologação',
    ],
    proximity: {
      required: true,
      maxDistance: 150,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
    minStrongKeywords: 1,
  },

  // Exoneração e Nomeação (Employee Dismissal/Resignation and Appointment - Combined)
  {
    documentType: 'exoneracao_nomeacao',
    weight: 0.90,
    priority: 'primary',
    strongKeywords: [
      // Exoneração strong keywords
      'exonerar servidor',
      'exoneração do cargo',
      'desligar a pedido',
      'desligamento de servidor',
      'exonerar do cargo',
      'exoneração a pedido',
      'demitir servidor',
      'demissão do servidor',
      'exonerar da função',
      'exoneração da função',
      'desligamento do cargo',
      'torna sem efeito as nomeações',
      'tornar sem efeito as nomeações',
      'torna sem efeito os atos de nomeação',
      'tornar sem efeito os atos de nomeação',
      'sem efeito as nomeações',
      'anular nomeações',
      'anulação de nomeações',
      // Nomeação strong keywords
      'nomear para o cargo',
      'nomeação para exercer',
      'nomear servidor',
      'nomeação do candidato',
      'nomear o aprovado',
      'nomeação para o cargo',
      'nomear para exercer',
      'nomeação do servidor',
      'designar para o cargo',
      'designação para exercer',
      'resolve nomear',
      'fica nomeado',
      'fica nomeada',
      'portaria de nomeação',
      'nomeação efetuada',
      'tomada de posse',
      'comparecer para posse',
      'apresentar documentos para posse',
      'nomeação dos candidatos aprovados',
      'nomeação de candidatos aprovados',
      'decreto nomeação',
      'candidato aprovado no concurso público',
      'aprovado no concurso público',
      'para provimento de cargo',
      'quadro efetivo de pessoal',
    ],
    moderateKeywords: [
      // Exoneração moderate keywords
      'exoneração',
      'exonerar',
      'desligamento',
      'desligar',
      'demissão',
      'demitir',
      // Nomeação moderate keywords
      'nomeação',
      'nomear',
      'designar',
      'designação',
      'candidato aprovado',
      'servidor',
      'posse',
      'apresentação',
      'documentos necessários',
      'prazo legal',
    ],
    weakKeywords: [
      'cargo',
      'função',
      'pedido',
      'concurso',
    ],
    patterns: [
      // Exoneração patterns
      /exonerar.*servidor/i,
      /exonera[çc][ãa]o.*(?:do\s+)?cargo/i,
      /desligar.*(?:a\s+)?pedido/i,
      /desligamento.*servidor/i,
      /demiss[ãa]o.*servidor/i,
      /exonerar.*fun[çc][ãa]o/i,
      /(?:resolve|fica).*exonera(?:r|do)/i,
      /torna(?:r)?\s+sem\s+efeito.*nomea[çc][õo]es/i,
      /sem\s+efeito.*(?:atos?\s+de\s+)?nomea[çc][ãa]o/i,
      /anula(?:r|[çc][ãa]o).*nomea[çc][õo]es/i,
      /(?:resolve|fica).*sem\s+efeito.*nomea[çc][ãa]o/i,
      // Nomeação patterns
      /nomear.*(?:para\s+(?:o\s+)?)?cargo/i,
      /nomea[çc][ãa]o.*(?:para\s+)?exercer/i,
      /nomear.*servidor/i,
      /nomea[çc][ãa]o.*candidato/i,
      /nomear.*aprovado/i,
      /designar.*cargo/i,
      /(?:resolve|fica).*nomea(?:r|do)/i,
      /portaria.*nomea[çc][ãa]o/i,
      /nomea[çc][ãa]o.*efetuada/i,
      /tomada\s+de\s+posse/i,
      /comparecer.*posse/i,
      /apresentar.*documentos.*posse/i,
      /prazo.*posse/i,
      /decreto.*nomea[çc][ãa]o/i,
      /nomea[çc][ãa]o\s+dos?\s+candidatos?\s+aprovados?/i,
      /candidatos?\s+aprovados?\s+no\s+concurso\s+p[uú]blico/i,
      /para\s+provimento\s+de\s+cargo/i,
      /quadro\s+efetivo\s+de\s+pessoal/i,
      /art\.?\s*\d+[°º]?\s+nomea[çc][ãa]o/i,
      /decreta:?\s*art\.?\s*\d+[°º]?\s+.*nomea[çc][ãa]o/i,
    ],
    excludePatterns: [
      /abertura\s+de\s+inscri[çc][õo]es/i,
      /torna\s+p[uú]blic[oa].*abertura/i,
      /inscri[çc][õo]es\s+abertas/i,
      /realiza[çc][ãa]o\s+de\s+concurso/i,
      /est[ãa]o\s+abertas.*inscri[çc][õo]es/i,
    ],
    conflictKeywords: [
      'abertura de inscrições',
      'edital de abertura',
      'torna público a abertura',
      'torna pública a abertura',
      'inscrições abertas',
      'realização de concurso público',
      'estão abertas as inscrições',
      'abertas as inscrições',
    ],
    proximity: {
      required: true,
      maxDistance: 200,
      boostNearby: true,
    },
    minKeywordsTogether: 2,
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
      /CONVOCA[ÇC][ÃA]O.*CONCURSO\s+P[ÚU]BLICO/i,
      /CONCURSO\s+P[ÚU]BLICO.*CONVOCA[ÇC][ÃA]O/i,
      /EDITAIS?\s+.*\s+CONVOCA[ÇC][ÃA]O/i,
      // NEW: Enhanced title patterns for better detection
      /EDITAL\s+DE\s+CONVOCA[ÇC][ÃA]O\s+N[°º]?\s*\d+/i, // "EDITAL DE CONVOCAÇÃO Nº 035/2025"
      /(?:^|\n)\s*EDITAL\s+DE\s+CONVOCA[ÇC][ÃA]O/i,
      /CONVOCA[ÇC][ÃA]O\s+N[°º]?\s*\d+/i,
    ],
    baseConfidence: 0.9, // Increased confidence for better competition
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
  {
    documentType: 'resultado_insencao',
    patterns: [
      /^EDITAL.*DIVULGA[ÇC][ÃA]O.*ISEN[ÇC][ÃA]O/i,
      /^RESULTADO.*ISEN[ÇC][ÃA]O.*TAXA/i,
      /^DIVULGA[ÇC][ÃA]O.*AN[ÁA]LISE.*RECURSO.*ISEN[ÇC][ÃA]O/i,
      /^EDITAL.*RESULTADO.*SOLICITA[ÇC][ÃA]O.*ISEN[ÇC][ÃA]O/i,
      /ISEN[ÇC][ÃA]O.*TAXA.*INSCRI[ÇC][ÃA]O/i,
    ],
    baseConfidence: 0.9,
  },
  {
    documentType: 'reclassificacao_resultado',
    patterns: [
      /^AUTORIZA.*RECLASSIFICA[ÇC][ÃA]O/i,
      /^RECLASSIFICA[ÇC][ÃA]O.*FINAL.*LISTA/i,
      /^EDITAL.*RECLASSIFICA[ÇC][ÃA]O/i,
      /AUTORIZA.*RECLASSIFICA[ÇC][ÃA]O.*APROVADOS/i,
      /RECLASSIFICA[ÇC][ÃA]O.*CONCURSO.*P[ÚU]BLICO/i,
    ],
    baseConfidence: 0.88,
  },
  {
    documentType: 'exoneracao',
    patterns: [
      /^PORTARIA.*EXONERA[ÇC][ÃA]O/i,
      /^PORTARIA.*DESLIGAMENTO/i,
      /^EXONERA[ÇC][ÃA]O/i,
      /^DESLIGAMENTO/i,
      /EXONERA[ÇC][ÃA]O.*SERVIDOR/i,
      /DESLIGAMENTO.*SERVIDOR/i,
    ],
    baseConfidence: 0.85,
  },
  {
    documentType: 'nomeacao',
    patterns: [
      /^PORTARIA.*NOMEA[ÇC][ÃA]O/i,
      /^NOMEA[ÇC][ÃA]O/i,
      /^EDITAL.*NOMEA[ÇC][ÃA]O/i,
      /NOMEA[ÇC][ÃA]O.*(?:SERVIDOR|CANDIDATO)/i,
      /NOMEAR.*CANDIDATO/i,
      // NEW: Decree-specific title patterns
      /^DECRETO.*NOMEA[ÇC][ÃA]O/i,
      /DECRETO.*N[°º]?\s*\d+.*NOMEA[ÇC][ÃA]O/i,
      /NOMEA[ÇC][ÃA]O.*CANDIDATOS?\s+APROVADOS?/i,
      /NOMEA[ÇC][ÃA]O.*CONCURSO\s+P[ÚU]BLICO/i,
      /DECRETO.*CANDIDATOS?\s+APROVADOS?.*CONCURSO/i,
    ],
    baseConfidence: 0.88, // Increased confidence for better detection
  },
  {
    documentType: 'resultado_parcial',
    patterns: [
      /^EDITAL\s+DE\s+CLASSIFICA[ÇC][ÃA]O/i,
      /^EDITAL\s+DE\s+NOTAS/i,
      /^RESULTADO.*(?:PRELIMINAR|PARCIAL|PROVIS[ÓO]RIO)/i,
      /CLASSIFICA[ÇC][ÃA]O.*PRELIMINAR/i,
      /NOTAS.*PROVAS?\s+PR[ÁA]TICAS?/i,
      /EDITAL.*TAF/i,
      /CLASSIFICA[ÇC][ÃA]O\s+PRELIMINAR.*(?:II|2)/i,
      /EDITAL\s+DE\s+CLASSIFICA[ÇC][ÃA]O\s+PRELIMINAR/i,
    ],
    baseConfidence: 0.90,
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
    /edital\s+n[°º]?\s*(\d+[._-]\d{4})/i,  // Handles alternative separators (dots, underscores, dashes)
    /edital\s+n[°º]?\s*(\d{4}[-\/]\d+)/i,  // Reversed format (2024/001)
    /edital\s+de\s+\w+\s+n[°º]?\s*(\d+\/\d{4})/i,  // "Edital de Abertura nº..."
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
    /(?:remunera[çc][ãa]o|sal[áa]rio|vencimento)[:\s]*R\$?\s*([\d.,]+)/i,  // With optional whitespace
    /(?:valor|quantia)[:\s]*R\$?\s*([\d.,]+)(?:\s*\(.*?remunera[çc][ãa]o.*?\))?/i,  // With context
    /R\$\s*([\d.,]+)\s*(?:mensais?|por\s+m[êe]s)/i,  // "R$ X mensais"
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
    /prova.*?(\d{1,2}\/\d{1,2}\/\d{4})/i,  // Non-greedy match
    /data\s+da\s+prova[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i,  // With optional whitespace
    /realiza[çc][ãa]o[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i,  // With optional whitespace
    /prova\s+em[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i,  // "prova em DD/MM/YYYY"
    /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,  // Written format: "15 de março de 2024"
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
    /(?:^|\n)\s*(?:a\s+)?prefeitura\s+(?:municipal\s+)?de\s+([\wÀ-ÿ\s]{3,50}?)(?=[,\n]|torna|comunica|através)/i,  // With length limit and boundary
    /(?:^|\n)\s*(?:a\s+)?c[âa]mara\s+municipal\s+de\s+([\wÀ-ÿ\s]{3,50}?)(?=[,\n]|torna)/i,  // With length limit and boundary
    /(?:^|\n)\s*([\wÀ-ÿ\s]{5,60}?)(?:,|\s+)(?:através|por\s+meio).*?torna\s+p[uú]blico/i,  // Non-greedy with boundary
    /secretaria\s+(?:municipal\s+)?de\s+([\wÀ-ÿ\s]{3,50}?)(?=[,\n])/i,  // For secretariats
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
    /cargo[:\s]*([^\n]+)\n\s*vagas?[:\s]*(\d+)\n\s*(?:sal[áa]rio|remunera[çc][ãa]o|vencimento)[:\s]*R?\$?\s*([\d.,]+)/gi,  // Vertical format
    /([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^\t\n]+)\t+(\d+)\t+R?\$?\s*([\d.,]+)/gi,  // Tab-separated
    /([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç\s]+)\s+[-|]\s+(\d+)\s+vaga[s]?\s+[-|]\s+R\$\s*([\d.,]+)\s+[-|]\s+(ensino\s+\w+|n[íi]vel\s+\w+)/gi,  // With escolaridade
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

  // Exemption-specific dates (isenção de taxa)
  prazoRecursoIsencao: [
    /prazo\s+(?:para\s+)?recurso.*isen[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /recurso.*isen[çc][ãa]o.*at[ée]\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /prazo\s+para\s+interposi[çc][ãa]o\s+de\s+recurso.*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /recurso.*de\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+a(?:t[ée])?\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],

  divulgacaoResultadoIsencao: [
    /divulga[çc][ãa]o.*resultado.*isen[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /resultado.*isen[çc][ãa]o.*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /publica[çc][ãa]o.*resultado.*isen[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /data\s+de\s+divulga[çc][ãa]o.*isen[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],

  periodoInscricaoIsencao: [
    /solicita[çc][ãa]o\s+de\s+isen[çc][ãa]o.*de\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+a(?:t[ée])?\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /pedido\s+de\s+isen[çc][ãa]o.*de\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+a(?:t[ée])?\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /per[íi]odo.*solicita[çc][ãa]o.*isen[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+a\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],

  // Reclassification-specific patterns (reclassificação de resultado)
  processoAdministrativo: [
    /processo\s+administrativo\s+n?[°º]?\s*(\d+\/\d+\/\d{4})/i,
    /processo\s+administrativo\s+n?[°º]?\s*(\d+\/\d{4})/i,
    /processo\s+n?[°º]?\s*(\d+\/\d+\/\d{4})/i,
    /processo\s+n?[°º]?\s*(\d+\/\d{4})/i,
    /protocolo\s+n?[°º]?\s*(\d+\/\d+\/\d{4})/i,
    /protocolo\s+n?[°º]?\s*(\d+\/\d{4})/i,
  ],

  dataAutorizacaoReclassificacao: [
    /data.*autoriza[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /autoriza[çc][ãa]o.*em\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /autorizada?\s+em\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],

  dataEfetivaReclassificacao: [
    /efetiva[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /vigora[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /a\s+partir\s+de\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /efeitos?\s+a\s+partir\s+de\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],

  // Exoneração/Nomeação-specific patterns
  portariaNumero: [
    /portaria\s+n?[°º]?\s*(\d+\/\d{4})/i,
    /portaria\s+n?[°º]?\s*(\d+[-_]\d{4})/i,
    /portaria\s+n?[°º]?\s*(\d+)/i,
  ],

  nomeServidor: [
    /(?:servidor|servidora|candidato|candidata|aprovado|aprovada)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç\s]+?)(?:,|\s+portador|\s+matr[íi]cula|\s+RG|\s+CI|\s+CPF|\s+admitid)/i,
    /(?:exonerar|nomear|desligar)\s+(?:o\s+|a\s+)?(?:servidor|servidora|candidato|candidata)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç\s]+?)(?:,|\s+portador|\s+matr[íi]cula|\s+RG|\s+CI|\s+CPF)/i,
  ],

  cargoServidor: [
    /cargo\s+de\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç\s]+?)(?:,|\s+a\s+partir|\s+com\s+efeito|\.|;)/i,
    /(?:para\s+)?exercer\s+o\s+cargo\s+de\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç\s]+?)(?:,|\s+a\s+partir|\s+com\s+efeito|\.|;)/i,
    /fun[çc][ãa]o\s+de\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç\s]+?)(?:,|\s+a\s+partir|\s+com\s+efeito|\.|;)/i,
  ],

  matriculaServidor: [
    /matr[íi]cula\s+n?[°º]?\s*([\d.-]+)/i,
    /matr[íi]cula:?\s*([\d.-]+)/i,
  ],

  rgServidor: [
    /(?:portador|portadora)\s+do?\s+(?:RG|CI)[\/\s]+n?[°º]?\s*([\d.-]+)/i,
    /(?:RG|CI)[:\s]+n?[°º]?\s*([\d.-]+)/i,
  ],

  dataEfetivacaoExoneracao: [
    /a\s+partir\s+de\s+(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
    /a\s+partir\s+de\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /com\s+efeitos?\s+a\s+partir\s+de\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /em\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],

  tipoDesligamento: [
    /a\s+pedido/i,
    /a\s+requerimento/i,
    /por\s+iniciativa\s+pr[óo]pria/i,
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
    'processo seletivo simplificado',
    'seleção pública',
    'seleção publica',  // without accent
    'seleção simplificada',
    'edital de prorrogação',
    'prorrogação de processos seletivos',
    'prorrogação de seleções públicas',
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
