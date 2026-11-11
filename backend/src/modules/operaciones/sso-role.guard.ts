import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  firmarJwtHmac,
  PayloadTokenSsoIntranet,
  verificarJwtHmac,
} from './jwt-sso.util';

@Injectable()
export class SsoRoleGuard implements CanActivate {
  private obtenerSecret(): string {
    return (
      process.env.INTRANET_JWT_SECRET ||
      'clave_secreta_compartida_con_intranet_hospitalaria'
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const method: string = (req.method || 'GET').toUpperCase();
    const url: string = (req.originalUrl || req.url || '').split('?')[0];

    // 1. Endpoint de intercambio inicial SSO siempre es público
    if (url.endsWith('/intranet/sso-login') || url.endsWith('/health')) {
      return true;
    }

    // 2. Extraer token Bearer si viene en la cabecera
    const authHeader: string | undefined = req.headers?.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';

    let payload: (PayloadTokenSsoIntranet & { empleadoId?: string }) | null = null;
    if (token) {
      payload = verificarJwtHmac<PayloadTokenSsoIntranet & { empleadoId?: string }>(
        token,
        this.obtenerSecret()
      );
      req.usuarioSso = payload;

      // Renovación deslizante (Sliding Session): si quedan menos de 2 horas (< 7200s), emitir token renovado por 8h
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp === 'number' && payload.exp - now < 7200) {
        const nuevoToken = firmarJwtHmac(
          {
            documento: payload.documento,
            empleadoId: payload.empleadoId,
            rol: payload.rol,
            serviciosCoordinados: payload.serviciosCoordinados,
          },
          this.obtenerSecret(),
          28800
        );
        res.setHeader('x-renewed-token', nuevoToken);
      }
    }

    // 3. Las consultas de lectura (GET) sin token o simulaciones puras sin escritura pasan
    if (
      method === 'GET' ||
      url.endsWith('/cuadrantes/validar-celda') ||
      url.endsWith('/banco-horas-nomina/simular-cierre') ||
      url.endsWith('/permutas/simular')
    ) {
      return true;
    }

    // 4. Toda operación de escritura (POST, PUT, PATCH, DELETE) exige sesión SSO válida
    if (!payload) {
      throw new UnauthorizedException(
        'Sesión SSO requerida o expirada. Ingresa nuevamente desde la Intranet Hospitalaria.'
      );
    }

    const rol = payload.rol;

    // 5. Reglas de autorización por Rol en Backend
    if (rol === 'ADMIN_TH') {
      return true;
    }

    if (rol === 'COLABORADOR') {
      // El colaborador tiene acceso de solo lectura para consultar su calendario, compañeros y servicios
      if (method === 'GET' || method === 'HEAD') {
        return true;
      }

      const esAccionPermutaPropia =
        (method === 'POST' && url.endsWith('/api/v1/permutas')) ||
        (method === 'PATCH' &&
          (url.endsWith('/aceptar-par') || url.endsWith('/rechazar-par')));

      if (!esAccionPermutaPropia) {
        throw new ForbiddenException(
          'Acceso denegado: tu perfil de Colaborador solo está autorizado para solicitar o responder permutas entre pares.'
        );
      }
      return true;
    }

    if (rol === 'COORDINADOR') {
      // Coordinador no puede modificar configuración global (servicios-admin, catálogo de turnos, festivos ni recálculo global)
      if (
        url.includes('/api/v1/servicios-admin') ||
        url.includes('/api/v1/festivos') ||
        url.includes('/api/v1/liquidacion')
      ) {
        throw new ForbiddenException(
          'Acceso denegado: la administración global de servicios, turnos, festivos y recálculo normativo está reservada a Talento Humano (ADMIN_TH).'
        );
      }

      // Coordinador puede publicar (BORRADOR -> PUBLICADO), pero no cerrar Nómina (CERRADO_NOMINA)
      if (url.endsWith('/api/v1/cuadrantes/estado')) {
        const nuevoEstado = req.body?.estado;
        if (nuevoEstado === 'CERRADO_NOMINA' || nuevoEstado === 'BORRADOR') {
          throw new ForbiddenException(
            'Acceso denegado: el cierre y reapertura de Nómina están reservados exclusivamente a Talento Humano (ADMIN_TH).'
          );
        }
      }

      // Verificar alcance de servicios permitidos para el Coordinador
      const srvIdBody = req.body?.servicioId;
      if (
        srvIdBody &&
        Array.isArray(payload.serviciosCoordinados) &&
        payload.serviciosCoordinados.length > 0 &&
        !payload.serviciosCoordinados.includes(srvIdBody)
      ) {
        throw new ForbiddenException(
          `Acceso denegado: no tienes permisos de coordinación sobre el servicio "${srvIdBody}".`
        );
      }

      return true;
    }

    return true;
  }
}
