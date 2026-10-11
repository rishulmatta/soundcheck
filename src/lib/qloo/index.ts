/** Entry point. Returns the live client when QLOO_API_KEY is set and QLOO_MOCK is not "1", otherwise the mock. Implemented by the Qloo workstream. */
import type { QlooClient } from "./contract";
export type * from "./contract";

export function getQloo(): QlooClient {
  throw new Error("Qloo client not implemented yet: see src/lib/qloo/contract.ts");
}
