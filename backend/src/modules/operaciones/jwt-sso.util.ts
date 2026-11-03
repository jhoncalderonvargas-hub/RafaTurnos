import { createHmac, timingSafeEqual } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';

export type RolUsuarioSso = 'ADMIN_TH' | 'COORDINADOR' | 'COLABORADOR';

export interface PayloadTokenSsoIntranet {
  documento: string;
  rol: RolUsuarioSso;
  serviciosCoordinados?: string[];
  iat?: number;
  exp?: number;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecodeToString(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Firma un JWT estándar (HS256) usando crypto nativo de Node.js.
 */
export function firmarJwtHmac(
  payload: Record<string, any>,
  secret: string,
  expiresInSeconds = 28800
): string {
  const now = Math.floor(Date.now() / 1000);
  const headerObj = { alg: 'HS256', typ: 'JWT' };
  const payloadObj = {
    ...payload,
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(headerObj));
  const encodedPayload = base64UrlEncode(JSON.stringify(payloadObj));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac('sha256', secret).update(signingInput).digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Verifica la firma criptográfica HMAC-SHA256 y la expiración de un JWT emitido por la Intranet o Rafa Turnos.
 */
export function verificarJwtHmac<T = PayloadTokenSsoIntranet>(
  token: string,
  secret: string
): T {
  if (!token || typeof token !== 'string') {
    throw new UnauthorizedException('Token SSO no proporcionado.');
  }

  const partes = token.trim().split('.');
  if (partes.length !== 3) {
    throw new UnauthorizedException('Formato de token JWT inválido.');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = partes;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = base64UrlEncode(
    createHmac('sha256', secret).update(signingInput).digest()
  );

  const bufRecibida = Buffer.from(encodedSignature, 'utf8');
  const bufEsperada = Buffer.from(expectedSig, 'utf8');
  if (
    bufRecibida.length !== bufEsperada.length ||
    !timingSafeEqual(bufRecibida, bufEsperada)
  ) {
    throw new UnauthorizedException('Firma criptográfica del token SSO inválida.');
  }

  let payload: any;
  try {
    payload = JSON.parse(base64UrlDecodeToString(encodedPayload));
  } catch {
    throw new UnauthorizedException('Payload del token SSO corrupto.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new UnauthorizedException('El token SSO ha expirado. Vuelve a ingresar desde la Intranet.');
  }

  return payload as T;
}
