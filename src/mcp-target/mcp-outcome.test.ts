import { classifyMcpOutcome, BEHAVIOR_OUTCOMES } from '../outcomes';

describe('classifyMcpOutcome (JSON-RPC layer, not HTTP status)', () => {
  it('maps each JSON-RPC error code to the matching outcome', () => {
    const cases: Array<[number, string]> = [
      [-32001, BEHAVIOR_OUTCOMES.ERROR_401],
      [-32003, BEHAVIOR_OUTCOMES.ERROR_403],
      [-32004, BEHAVIOR_OUTCOMES.ERROR_404],
      [-32601, BEHAVIOR_OUTCOMES.ERROR_404],
      [-32029, BEHAVIOR_OUTCOMES.ERROR_429],
      [-32602, BEHAVIOR_OUTCOMES.ERROR_400],
      [-32600, BEHAVIOR_OUTCOMES.ERROR_400],
      [-32700, BEHAVIOR_OUTCOMES.ERROR_400],
      [-32000, BEHAVIOR_OUTCOMES.ERROR_500],
      [-31999, BEHAVIOR_OUTCOMES.ERROR_UNKNOWN], // unmapped
    ];
    for (const [code, expected] of cases) {
      expect(classifyMcpOutcome({ error: { code } })).toBe(expected);
    }
  });

  it('treats a present result with no error as success', () => {
    expect(classifyMcpOutcome({ result: { isError: false } })).toBe(BEHAVIOR_OUTCOMES.SUCCESS);
    expect(classifyMcpOutcome({ result: {} })).toBe(BEHAVIOR_OUTCOMES.SUCCESS);
  });

  it('treats a result flagged isError as a tool-level failure', () => {
    expect(classifyMcpOutcome({ result: { isError: true } })).toBe(BEHAVIOR_OUTCOMES.ERROR_UNKNOWN);
  });
});
