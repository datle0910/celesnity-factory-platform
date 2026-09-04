import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfig } from './app-config';

/**
 * Handling of source credentials.
 *
 * A credential reaches the platform in one of two ways and is treated
 * differently in each:
 *
 *   by reference   the operator names an environment variable. Nothing secret
 *                  is ever persisted; the value is read at connect time.
 *   masked input   the operator types the value into a masked field. It is
 *                  encrypted with AES-256-GCM before it touches the database.
 *
 * In both cases the value only ever exists in memory for the duration of a
 * connection attempt. It is never projected into an API response — see the
 * source DTO mapping, which builds responses from an explicit field list rather
 * than spreading the database row — and never written to a log.
 */
@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);

  constructor(private readonly config: AppConfig) {}

  /** Returns an `iv.tag.ciphertext` envelope, all base64url. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.secretEncryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [iv, authTag, ciphertext].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 3) {
      throw new Error('stored credential is malformed');
    }

    const [iv, authTag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.config.secretEncryptionKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /**
   * Resolves the credential for a source, or null when it needs none.
   *
   * @throws when a referenced environment variable is not set, because failing
   *         loudly is better than attempting an anonymous connection and
   *         reporting a confusing authentication error.
   */
  resolve(source: { secretEnvVar: string | null; secretCipher: string | null; name: string }): string | null {
    if (source.secretEnvVar) {
      const value = process.env[source.secretEnvVar];
      if (value === undefined || value === '') {
        throw new Error(
          `source "${source.name}" references environment variable ${source.secretEnvVar}, which is not set`,
        );
      }
      return value;
    }

    if (source.secretCipher) {
      try {
        return this.decrypt(source.secretCipher);
      } catch {
        // The message deliberately carries no detail about the stored value.
        this.logger.error(`unable to decrypt the stored credential for source "${source.name}"`);
        throw new Error(
          `stored credential for source "${source.name}" could not be decrypted; SECRET_ENCRYPTION_KEY may have changed`,
        );
      }
    }

    return null;
  }

  /** Constant-time comparison, used by tests rather than request handling. */
  matches(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
