/**
 * Test entrypoint: the transport-agnostic suite, run against every
 * transport. Run with `node --test dist/`.
 */

import { runSuite } from "./suite.js";
import { localTransport } from "./transport-local.js";
import { httpTransport } from "./transport-http.js";
import { stdioTransport } from "./transport-stdio.js";

runSuite(localTransport);
runSuite(httpTransport);
runSuite(stdioTransport);
