import type { FastifyInstance } from 'fastify';
import { GatewayError } from '../gateway/router.ts';
import type { DriverRegistry } from '../drivers/registry.ts';
import type { DriverRuntime } from '../drivers/runtime.ts';
import type { DriverInput } from '../drivers/types.ts';
import type { QuotaGuard } from '../metering/quota.ts';
import type { ShadowRunner } from '../eval/shadow.ts';
import { callContext, checkQuota, sendError } from './chat.ts';

type InvokeBody = { input: DriverInput; version?: string };

const invokeSchema = {
  type: 'object',
  required: ['input'],
  properties: {
    input: { anyOf: [{ type: 'string', minLength: 1, maxLength: 8000 }, { type: 'object' }] },
    version: { type: 'string', pattern: '^(v\\d+|stable|canary)$' },
  },
} as const;

export function driverRoutes(
  app: FastifyInstance,
  deps: { registry: DriverRegistry; runtime: DriverRuntime; quota: QuotaGuard; shadow?: ShadowRunner },
) {
  app.get('/drivers', async () => ({ data: deps.registry.list() }));

  app.post<{ Params: { name: string }; Body: InvokeBody }>(
    '/drivers/:name/invoke',
    { schema: { body: invokeSchema } },
    async (request, reply) => {
      const def = deps.registry.get(request.params.name, request.body.version);
      if (!def) {
        return sendError(reply, new GatewayError(404, 'invalid_request_error', 'driver_not_found', `Unknown driver "${request.params.name}" or version.`));
      }
      if (!(await checkQuota(deps.quota, request, reply))) return reply;

      const { ctx, done } = callContext(request, reply);
      try {
        const result = await deps.runtime.run(ctx, def, request.body.input);
        // Shadow traffic: when the caller got the stable version, the canary may run on the same
        // input in the background. Its answer is stored for comparison and never returned.
        const isStable = !request.body.version || request.body.version === 'stable';
        if (isStable && deps.shadow) {
          deps.shadow.maybeRun({ tenantId: ctx.tenantId, apiKeyId: ctx.apiKeyId, log: request.log }, def.name, request.body.input, result);
        }
        reply.header('x-simpang-driver', result.driver);
        return result;
      } catch (err) {
        if (err instanceof GatewayError) return sendError(reply, err);
        throw err;
      } finally {
        done();
      }
    },
  );
}
