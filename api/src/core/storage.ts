import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Boom from '@hapi/boom';
import type { RunArtifact, UploadedFile } from './types.js';

export interface StorageConfig {
  baseDir: string;
  baseUrl: string;
  signingKey: string;
  urlTtlSeconds: number;
}

export interface PresignPayload {
  path: string;
  exp: number;
  method: 'GET';
}

export class ArtifactStorage {
  constructor(private readonly config: StorageConfig) { }

  public ensureBaseDir() {
    fs.mkdirSync(this.config.baseDir, { recursive: true });
  }

  public generateFileId(): string {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const bytes = crypto.randomBytes(12);
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += alphabet[bytes[i] % alphabet.length];
    }
    return `file_${id}`;
  }

  public storeUploadedFile(tempPath: string, originalName: string, contentType: string): UploadedFile {
    const id = this.generateFileId();
    const destDir = path.join(this.config.baseDir, 'uploads', id);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, originalName);
    const data = fs.readFileSync(tempPath);
    fs.writeFileSync(destPath, data);
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    const metadata = { id, name: originalName, size: data.length, sha256, path: destPath, contentType };
    fs.writeFileSync(path.join(destDir, 'meta.json'), JSON.stringify(metadata));
    return metadata;
  }

  public getUploadedFile(id: string): UploadedFile {
    const dir = path.join(this.config.baseDir, 'uploads', id);
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      throw Boom.notFound('uploaded file not found');
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as UploadedFile;
    return meta;
  }

  public moveArtifact(sourcePath: string, name: string, contentType?: string): RunArtifact {
    const artifactId = this.generateFileId();
    const destDir = path.join(this.config.baseDir, 'artifacts', artifactId);
    fs.mkdirSync(destDir, { recursive: true });
    const fileName = path.basename(name);
    const destPath = path.join(destDir, fileName);
    const data = fs.readFileSync(sourcePath);
    fs.writeFileSync(destPath, data);
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    const size = data.length;
    const metadata = {
      id: artifactId,
      name: fileName,
      originalName: name,
      contentType: contentType ?? 'application/octet-stream',
      size,
      sha256
    };
    fs.writeFileSync(path.join(destDir, 'meta.json'), JSON.stringify(metadata));
    fs.rmSync(sourcePath, { force: true });
    const expiresAt = new Date(Date.now() + this.config.urlTtlSeconds * 1000).toISOString();
    const urlPath = `/v1/files/${artifactId}`;
    const url = this.signUrl(urlPath, expiresAt);
    return {
      name,
      size,
      sha256,
      url,
      expires_at: expiresAt,
      content_type: metadata.contentType
    };
  }

  public signUrl(urlPath: string, expiresAtIso: string): string {
    const exp = Math.floor(new Date(expiresAtIso).getTime() / 1000);
    const payload: PresignPayload = { path: urlPath, exp, method: 'GET' };
    const serialized = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', this.config.signingKey).update(serialized).digest('hex');
    const params = new URLSearchParams({ payload: Buffer.from(serialized).toString('base64url'), sig: signature });
    return `${this.config.baseUrl}${urlPath}?${params.toString()}`;
  }

  public verifySignedRequest(urlPath: string, payloadB64: string, sig: string) {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as PresignPayload;
    const expected = crypto.createHmac('sha256', this.config.signingKey).update(payloadJson).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))) {
      throw Boom.forbidden('invalid signature');
    }
    if (payload.path !== urlPath) {
      throw Boom.forbidden('path mismatch');
    }
    if (payload.method !== 'GET') {
      throw Boom.forbidden('method mismatch');
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw Boom.forbidden('url expired');
    }
    return payload;
  }

  public resolveArtifact(id: string) {
    const artifactDir = path.join(this.config.baseDir, 'artifacts', id);
    if (!fs.existsSync(artifactDir)) {
      throw Boom.notFound('artifact not found');
    }
    const metaPath = path.join(artifactDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      throw Boom.notFound('artifact metadata missing');
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
      name: string;
      originalName: string;
      contentType: string;
      size: number;
      sha256: string;
    };
    const filePath = path.join(artifactDir, meta.name);
    if (!fs.existsSync(filePath)) {
      throw Boom.notFound('artifact content missing');
    }
    return { path: filePath, metadata: meta };
  }
}
