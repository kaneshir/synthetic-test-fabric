/**
 * verifier.test.ts
 *
 * Proves that the VerifierContract interface is correctly shaped: a minimal
 * mock implementation must satisfy the contract and VerificationResult must
 * carry the expected fields.
 */

import type { VerificationResult, VerifierContract } from './verifier';

class PassingVerifier implements VerifierContract {
  async verify(_iterRoot: string): Promise<VerificationResult> {
    return { pass: true, errors: [], warnings: [] };
  }
}

class FailingVerifier implements VerifierContract {
  async verify(_iterRoot: string): Promise<VerificationResult> {
    return {
      pass: false,
      errors: ['alias missing: account.seeker'],
      warnings: ['low entity count'],
    };
  }
}

describe('VerifierContract', () => {
  it('a passing mock implementation satisfies the interface', async () => {
    const v: VerifierContract = new PassingVerifier();
    const result = await v.verify('/tmp/fake-root');

    expect(result.pass).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('a failing mock implementation surfaces errors and sets pass=false', async () => {
    const v: VerifierContract = new FailingVerifier();
    const result = await v.verify('/tmp/fake-root');

    expect(result.pass).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('account.seeker');
    expect(result.warnings).toHaveLength(1);
  });

  it('VerificationResult has the expected shape', async () => {
    const v: VerifierContract = new PassingVerifier();
    const result: VerificationResult = await v.verify('/tmp/fake-root');

    expect(typeof result.pass).toBe('boolean');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('verify() returns a Promise', () => {
    const v: VerifierContract = new PassingVerifier();
    const returnValue = v.verify('/tmp/fake-root');
    expect(returnValue).toBeInstanceOf(Promise);
  });
});
