import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * Chiffrement des tokens Google (refresh + access) — AES-256-GCM.
 *
 * La clé GOOGLE_ENC_KEY (base64, 32 octets) vit uniquement dans
 * l'environnement du serveur SvelteKit (.env.local en dev, variables
 * Netlify en prod). Elle n'apparaît jamais dans le code, la base Convex
 * ou le navigateur. Format stocké : base64(iv[12] | tag[16] | ciphertext).
 */

function key(): Buffer {
	const raw = env.GOOGLE_ENC_KEY;
	if (!raw) throw new Error('GOOGLE_ENC_KEY manquante — configure-la dans .env.local / Netlify.');
	const buf = Buffer.from(raw, 'base64');
	if (buf.length !== 32) throw new Error('GOOGLE_ENC_KEY invalide : attendu 32 octets en base64 (openssl rand -base64 32).');
	return buf;
}

/** Chiffre un secret → base64(iv[12] | tag[16] | ciphertext). */
export function encryptToken(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** Déchiffre un blob base64(iv[12] | tag[16] | ciphertext) → secret en clair. */
export function decryptToken(blob: string): string {
	const data = Buffer.from(blob, 'base64');
	const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
	decipher.setAuthTag(data.subarray(12, 28));
	return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
