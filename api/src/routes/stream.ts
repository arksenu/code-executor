import type { Express } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import Boom from '@hapi/boom';
import type { Orchestrator } from '../core/orchestrator.js';
import type { RunStore } from '../core/run_store.js';
import type { TokenBucketLimiter } from '../core/rate_limit.js';
import type { StreamEvent, RunRequest } from '../core/types.js';
import { Logger } from '../util/logger.js';

export interface StreamRouteOptions {
  orchestrator: Orchestrator;
  runStore: RunStore;
  limiter: TokenBucketLimiter;
  tokenLimits: Record<string, { label: string; rateLimitRps: number; burst: number }>;
  logger: Logger;
}

export function registerStreamRoutes(
  app: Express,
  server: HTTPServer,
  options: StreamRouteOptions
) {
  const wss = new WebSocketServer({ noServer: true });

  // Map to track active streaming connections by run ID
  const activeStreams = new Map<string, WebSocket>();

  // Handle WebSocket upgrade requests
  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url;

    // Only handle /v1/runs/:id/stream WebSocket connections
    const streamMatch = pathname?.match(/^\/v1\/runs\/([^\/]+)\/stream$/);

    if (streamMatch) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        const runId = streamMatch[1];
        wss.emit('connection', ws, request, runId);
      });
    } else {
      socket.destroy();
    }
  });

  // Handle WebSocket connections
  wss.on('connection', (ws: WebSocket, _request: any, runId: string) => {
    options.logger.info('WebSocket connection established', { runId });

    // Store the WebSocket connection
    activeStreams.set(runId, ws);

    // Send initial connection confirmation
    ws.send(JSON.stringify({
      type: 'connected',
      runId,
      timestamp: Date.now()
    }));

    ws.on('close', () => {
      options.logger.info('WebSocket connection closed', { runId });
      activeStreams.delete(runId);
    });

    ws.on('error', (error) => {
      options.logger.error('WebSocket error', { runId, error: error.message });
      activeStreams.delete(runId);
    });
  });

  // POST /v1/runs/stream - Create a run with streaming enabled
  app.post('/v1/runs/stream', async (req, res, next) => {
    try {
      const apiKey = (req as any).apiKey;
      if (!apiKey) {
        throw Boom.unauthorized('missing api key');
      }

      const keyConfig = options.tokenLimits[apiKey];
      if (!keyConfig) {
        throw Boom.unauthorized('invalid api key');
      }

      // Check rate limit (this throws if exceeded)
      options.limiter.check(apiKey, keyConfig.rateLimitRps, keyConfig.burst);

      const request: RunRequest = req.body;

      // Generate a temporary run ID to return immediately
      const runId = `run_${Math.random().toString(36).substring(2, 15)}`;

      // Send the run ID immediately so the client can connect via WebSocket
      res.json({
        id: runId,
        status: 'starting',
        message: 'Connect to WebSocket at /v1/runs/' + runId + '/stream for real-time output'
      });

      // Execute the run asynchronously with streaming
      setImmediate(async () => {
        try {
          const streamCallback = (event: StreamEvent) => {
            const ws = activeStreams.get(runId);
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(event));
            }
          };

          const runRecord = await options.orchestrator.createRunWithStreaming(
            request,
            apiKey,
            streamCallback
          );

          // Store the completed run
          options.runStore.save(runRecord);

          // Send final completion event with full run record
          const ws = activeStreams.get(runId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'complete',
              runRecord,
              timestamp: Date.now()
            }));
            // Close the WebSocket after sending completion
            setTimeout(() => ws.close(), 100);
          }

          activeStreams.delete(runId);
        } catch (error: any) {
          options.logger.error('streaming run failed', { runId, error: error.message });

          const ws = activeStreams.get(runId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              error: error.message,
              timestamp: Date.now()
            }));
            ws.close();
          }
          activeStreams.delete(runId);
        }
      });
    } catch (err) {
      next(err);
    }
  });

  return wss;
}
