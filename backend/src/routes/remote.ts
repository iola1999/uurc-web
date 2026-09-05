import { Router } from "express";
import { REMOTE_SESSION_HEADER, isRemoteSessionId } from "@uurc/shared/remoteSession";
import { isAuthorizedSignalRoom } from "@uurc/shared/signalGateway/authorization";
import {
  ValidationError,
  parseOptionalEventId,
  parseSignalControlRequest,
  parseSignalGatewayStartRequest,
  parseSignalSoacRequest,
} from "@uurc/shared/signalGateway/requests";

import { RemoteControlService } from "../services/remoteControlService.js";
import type { RemoteControlSessionRegistry } from "../services/remoteControlSessionRegistry.js";

export function createRemoteRouter(remoteControlSessions: RemoteControlSessionRegistry): Router {
  const router = Router();

  router.use("/remote", (req, res, next) => {
    const sessionId = req.get(REMOTE_SESSION_HEADER);
    if (!isRemoteSessionId(sessionId)) {
      res.status(401).json({ error: "A valid remote session capability is required" });
      return;
    }
    res.locals.remoteSessionId = sessionId;
    res.locals.remoteControl = remoteControlSessions.get(sessionId) ?? new RemoteControlService();
    next();
  });

  router.get("/remote/bootstrap", async (_req, res, next) => {
    try {
      const remoteControl = getRemoteControl(res.locals);
      const bootstrap = await remoteControl.createBootstrap();
      if (!bootstrap) {
        res.status(404).json({ error: "Join a room before starting remote control" });
        return;
      }

      res.json(bootstrap);
    } catch (error) {
      next(error);
    }
  });

  router.post("/remote/signal/start", async (req, res, next) => {
    try {
      const remoteControl = getRemoteControl(res.locals);
      const input = parseSignalGatewayStartRequest(req.body);
      if (
        !isAuthorizedSignalRoom(remoteControlSessions.authorization(getRemoteSessionId(res.locals)), input.roomConfig)
      ) {
        res.status(403).json({ error: "Join the room through this gateway before starting its signal connection" });
        return;
      }
      const status = await remoteControl.startSignalGateway(input);
      if (!status) {
        res.status(404).json({ error: "Join a room before starting remote control" });
        return;
      }

      res.json(status);
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.get("/remote/signal/status", (_req, res) => {
    const remoteControl = getRemoteControl(res.locals);
    res.json(remoteControl.getSignalGatewayStatus());
  });

  router.get("/remote/signal/events", (req, res) => {
    try {
      const remoteControl = getRemoteControl(res.locals);
      const afterEventId = parseOptionalEventId(req.query.after);
      res.json(remoteControl.getSignalGatewayEvents(afterEventId));
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  router.get("/remote/signal/diagnostics", (_req, res) => {
    const remoteControl = getRemoteControl(res.locals);
    res.json(remoteControl.getSignalReadinessDiagnostics());
  });

  router.post("/remote/signal/control", async (req, res, next) => {
    try {
      const remoteControl = getRemoteControl(res.locals);
      const input = parseSignalControlRequest(req.body);
      const result = await remoteControl.sendSignalControl(input);
      if (!result) {
        res.status(409).json({ error: "Start the signal gateway before sending control" });
        return;
      }

      res.json(result);
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.post("/remote/signal/soac", async (req, res, next) => {
    try {
      const remoteControl = getRemoteControl(res.locals);
      const input = parseSignalSoacRequest(req.body);
      const result = await remoteControl.sendSignalSoac(input);
      if (!result) {
        res.status(409).json({ error: "Start the signal gateway before sending SOAC" });
        return;
      }

      res.json(result);
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  router.delete("/remote/signal", async (_req, res, next) => {
    try {
      const remoteControl = getRemoteControl(res.locals);
      const sessionId = getRemoteSessionId(res.locals);
      res.json(await remoteControl.stopSignalGateway());
      remoteControlSessions.release(sessionId);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function getRemoteControl(locals: Record<string, unknown>): RemoteControlService {
  return locals.remoteControl as RemoteControlService;
}

function getRemoteSessionId(locals: Record<string, unknown>): string {
  return locals.remoteSessionId as string;
}
