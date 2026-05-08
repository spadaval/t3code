import * as Effect from "effect/Effect";

import Migration0027 from "./027_ProviderSessionRuntimeInstanceId.ts";
import Migration0028 from "./028_ProjectionThreadSessionInstanceId.ts";

export default Effect.gen(function* () {
  yield* Migration0027;
  yield* Migration0028;
});
