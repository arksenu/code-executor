import Boom from '@hapi/boom';
import type { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import type { ArtifactStorage } from '../core/storage.js';

export interface FilesRouteDeps {
  storage: ArtifactStorage;
}

export function registerFileRoutes(router: Router, deps: FilesRouteDeps) {
  const upload = multer({ dest: path.join('/tmp', 'uploads') });

  router.post('/v1/files', upload.single('file'), (req, res, next) => {
    try {
      if (!req.file) {
        throw Boom.badRequest('file is required');
      }
      const stored = deps.storage.storeUploadedFile(
        req.file.path,
        req.file.originalname,
        req.file.mimetype || 'application/octet-stream'
      );
      res.json({ id: stored.id, name: stored.name, size: stored.size, sha256: stored.sha256 });
    } catch (err) {
      next(err);
    } finally {
      if (req.file) {
        fs.rm(req.file.path, { force: true }, () => undefined);
      }
    }
  });

  router.get('/v1/files/:id', (req, res, next) => {
    try {
      const payload = req.query['payload'];
      const sig = req.query['sig'];
      if (typeof payload !== 'string' || typeof sig !== 'string') {
        throw Boom.forbidden('missing signature');
      }
      const urlPath = `/v1/files/${req.params.id}`;
      deps.storage.verifySignedRequest(urlPath, payload, sig);
      const artifact = deps.storage.resolveArtifact(req.params.id);
      res.setHeader('Content-Type', artifact.metadata.contentType);
      res.sendFile(artifact.path);
    } catch (err) {
      next(err);
    }
  });
}
