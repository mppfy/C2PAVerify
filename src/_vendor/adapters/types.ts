// VENDOR: copied from mppfy/platform — extract to @mppfy/platform-core after M6.
// See src/_vendor/VENDOR.md for sync policy. Do not modify in-place.

/**
 * Payment Adapter Interface
 * 
 * Абстракция для payment protocols (MPP, x402, ATXP и future).
 * Services работают с одним унифицированным interface,
 * реальный protocol handling делегируется specific adapter.
 * 
 * Design принципы:
 * - Services не знают о protocol specifics
 * - Adapters handle detection, verification, 402 responses, receipts
 * - Multiple adapters можно combine через MultiProtocolAdapter
 * - Dev mode использует NoneAdapter для testing без payments
 */

/**
 * Требование к платежу, передается от handler к adapter.
 * Adapter использует эту информацию для создания 402 challenge.
 */
export interface PaymentRequirement {
  /** Сумма в USD */
  amount: string;
  
  /** Валюта — пока только USDC */
  currency: 'USDC';
  
  /** Адрес получателя платежа */
  recipient: string;
  
  /** Сеть для on-chain settlement */
  network: 'tempo' | 'base' | 'solana';
  
  /** Service ID — для receipt и logging */
  serviceId: string;
  
  /** Дополнительные protocol-specific параметры */
  extra?: Record<string, unknown>;
}

/**
 * Результат verification платежа.
 * Null означает payment отсутствует или invalid — нужен 402 challenge.
 */
export interface PaymentVerification {
  /** True если платеж verified on-chain */
  verified: boolean;
  
  /** Какой protocol был использован */
  protocol: string;
  
  /** Transaction hash для audit trail */
  txHash?: string;
  
  /** Адрес плательщика (agent wallet) */
  payerAddress?: string;
  
  /** Сумма платежа в USDC */
  amount?: string;
  
  /** Для observability */
  metadata?: Record<string, unknown>;
}

/**
 * Adapter contract.
 * Каждый payment protocol реализует этот interface.
 */
export interface PaymentAdapter {
  /** 
   * Имя protocol для logging и observability.
   * Example: 'mpp', 'x402', 'atxp', 'none'
   */
  readonly name: string;
  
  /**
   * Определить, соответствует ли request этому protocol.
   * Используется в MultiProtocolAdapter для dispatch.
   * 
   * Typical implementation: проверка specific headers (X-MPP-Receipt, etc.)
   */
  detects(request: Request): boolean;
  
  /**
   * Проверить payment в request.
   * 
   * Returns:
   * - PaymentVerification с verified=true: платеж проверен, можно выполнять service
   * - null: payment отсутствует/invalid, нужен 402 challenge
   * - throws: upstream error (Tempo node unavailable, etc.)
   */
  verify(
    request: Request,
    requirement: PaymentRequirement
  ): Promise<PaymentVerification | null>;
  
  /**
   * Сгенерировать 402 Payment Required response.
   * Response должен содержать всю информацию которую agent нужно для оплаты.
   * 
   * Для MPP: Tempo chain payment details
   * Для x402: Base/Solana payment details
   * Для multi-protocol: все опции одновременно
   */
  create402(requirement: PaymentRequirement, request: Request): Response;
  
  /**
   * Прикрепить receipt к successful response.
   * Agent использует receipt для verification что payment был applied.
   *
   * Для MPP: добавляет X-Payment-Receipt header
   * Для x402: добавляет specific x402 receipt format
   */
  attachReceipt(
    response: Response,
    verification: PaymentVerification
  ): Response;

  /**
   * Финализировать платёж (async post-verify step).
   *
   * Вызывается после того как handler вернул 2xx response и attachReceipt()
   * уже добавил sync headers. Используется для protocols, которые требуют
   * отдельного on-chain settlement call.
   *
   *   MPP: не использует (receipt уже в attachReceipt) — адаптер может не
   *        реализовывать этот метод, либо вернуть response без изменений.
   *   x402: вызывает facilitator.settle() и добавляет `X-PAYMENT-RESPONSE` +
   *        `X-PAYMENT-TX-HASH`. Если settle падает, возвращает response
   *        as-is (caller sees 2xx без receipt headers — это flag для client'а
   *        повторить платёж при необходимости).
   *
   * Optional чтобы не ломать NoneAdapter / MPP. Multi-adapter форвардит
   * вызов по verification.protocol.
   */
  settle?(
    request: Request,
    response: Response,
    verification: PaymentVerification
  ): Promise<Response>;
}

/**
 * Helper для создания стандартного 402 response payload.
 * Используется различными adapters для consistency.
 */
export interface Payment402Payload {
  error: 'payment_required';
  protocol: string;
  amount: string;
  currency: 'USDC';
  recipient: string;
  network: string;
  service_id: string;
  retry_with_payment?: string; // instructions для retry
  extra?: Record<string, unknown>;
}
