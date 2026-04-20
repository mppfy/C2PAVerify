// VENDOR: copied from mppfy/platform — extract to @mppfy/platform-core after M6.
// See src/_vendor/VENDOR.md for sync policy. Do not modify in-place.

/**
 * NoneAdapter — no-op payment adapter для development.
 * 
 * Использование:
 * - Local development (no real Tempo wallet)
 * - Testing services без payment overhead
 * - Smoke testing scaffold
 * 
 * В production НЕ использовать — это означает что сервисы free!
 * Активируется только когда PAYMENT_MODE=dev в Worker env.
 */

import type { 
  PaymentAdapter, 
  PaymentRequirement, 
  PaymentVerification 
} from './types';

export const noneAdapter: PaymentAdapter = {
  name: 'none',
  
  detects(_request: Request): boolean {
    // В dev mode — всегда matches
    return true;
  },
  
  async verify(
    _request: Request,
    requirement: PaymentRequirement
  ): Promise<PaymentVerification | null> {
    // Dev mode: всегда возвращаем "paid" без реальной проверки
    return {
      verified: true,
      protocol: 'none',
      amount: requirement.amount,
      metadata: { 
        mode: 'dev',
        warning: 'No real payment verification - dev mode only',
      },
    };
  },
  
  create402(_requirement: PaymentRequirement, _request: Request): Response {
    // Never called в dev mode (verify всегда returns verified=true)
    // Но implement для safety
    return new Response(
      JSON.stringify({
        error: 'payment_required',
        message: 'Dev mode active but payment challenge requested - check PAYMENT_MODE env',
      }),
      {
        status: 402,
        headers: { 'content-type': 'application/json' },
      }
    );
  },
  
  attachReceipt(response: Response, _verification: PaymentVerification): Response {
    // Dev mode — просто возвращаем response с маркером
    const headers = new Headers(response.headers);
    headers.set('x-payment-mode', 'dev');
    headers.set('x-payment-warning', 'No actual payment verification performed');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
